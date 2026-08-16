from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cube_api.main import create_app

FACES = ("U", "D", "F", "B", "L", "R")


@pytest.fixture(autouse=True)
def enable_offline_bounded_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUBE_ALLOW_BOUNDED_FALLBACK", "1")


def solved_payload(order: int = 2) -> dict[str, object]:
    size = order * order
    return {
        "order": order,
        "revision": 7,
        "front": "F",
        "top": "U",
        "stickers": {face: [index] * size for index, face in enumerate(FACES)},
    }


def test_validate_accepts_a_solved_state() -> None:
    response = TestClient(create_app()).post("/api/validate", json=solved_payload())

    assert response.status_code == 200
    assert response.json() == {"ok": True, "errors": [], "revision": 7}


def test_validate_reports_color_count_diagnostics() -> None:
    payload = solved_payload()
    stickers = payload["stickers"]
    assert isinstance(stickers, dict)
    stickers["U"][-1] = 1

    response = TestClient(create_app()).post("/api/validate", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["errors"] == [{"code": "COLOR_COUNT", "message": "颜色数量不正确"}]


def test_validate_rejects_non_adjacent_orientation() -> None:
    payload = solved_payload()
    payload["top"] = "B"

    response = TestClient(create_app()).post("/api/validate", json=payload)

    assert response.status_code == 200
    assert response.json() == {
        "ok": False,
        "errors": [{"code": "ORIENTATION", "message": "正面与顶面必须相邻"}],
    }


def test_validate_rejects_malformed_request() -> None:
    response = TestClient(create_app()).post("/api/validate", json={"order": 2})

    assert response.status_code == 422


def test_solve_creates_job_and_streams_replay_verified_completion() -> None:
    client = TestClient(create_app())
    response = client.post("/api/solve", json=solved_payload())
    assert response.status_code == 202
    body = response.json()
    assert isinstance(body["job_id"], str)
    assert body["revision"] == 7
    events = client.get(f"/api/jobs/{body['job_id']}/events")
    assert events.status_code == 200
    assert events.headers["content-type"].startswith("text/event-stream")
    assert "event: queued" in events.text
    assert "event: completed" in events.text
    assert '"verified":true' in events.text.replace(" ", "")


def test_solve_rejects_invalid_cube_before_creating_job() -> None:
    payload = solved_payload()
    stickers = payload["stickers"]
    assert isinstance(stickers, dict)
    stickers["U"][-1] = 1
    response = TestClient(create_app()).post("/api/solve", json=payload)
    assert response.status_code == 400
    assert response.json() == {
        "code": "INVALID_STATE",
        "errors": [{"code": "COLOR_COUNT", "message": "颜色数量不正确"}],
    }


def test_solve_does_not_mark_an_invalid_solver_move_as_verified() -> None:
    def bad_solver(payload: object, emit: object, cancelled: object) -> list[str]:
        return ["not-a-valid-move"]
    client = TestClient(create_app(solver=bad_solver))
    response = client.post("/api/solve", json=solved_payload())
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    events = client.get(f"/api/jobs/{job_id}/events")
    assert events.status_code == 200
    assert "event: failed" in events.text
    assert '"code":"INTERNAL_ERROR"' in events.text.replace(" ", "")
    assert "event: completed" not in events.text


def test_solve_accepts_non_empty_moves_when_replay_reaches_solved() -> None:
    def four_turn_solver(payload: object, emit: object, cancelled: object) -> list[str]:
        return ["R", "R", "R", "R"]
    client = TestClient(create_app(solver=four_turn_solver))
    response = client.post("/api/solve", json=solved_payload())
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    events = client.get(f"/api/jobs/{job_id}/events")
    assert events.status_code == 200
    compact = events.text.replace(" ", "")
    assert "event: completed" in events.text
    assert '"moves":["R","R","R","R"]' in compact
    assert '"verified":true' in compact


def test_solve_reports_backend_unavailable_distinctly() -> None:
    from cube_api.solver_backend import BackendUnavailable

    def unavailable_solver(
        payload: object, emit: object, cancelled: object
    ) -> list[str]:
        raise BackendUnavailable("backend missing")

    client = TestClient(create_app(solver=unavailable_solver))
    response = client.post("/api/solve", json=solved_payload())
    job_id = response.json()["job_id"]
    events = client.get(f"/api/jobs/{job_id}/events")

    assert '"code":"SOLVER_UNAVAILABLE"' in events.text.replace(" ", "")


def test_solve_reports_invalid_backend_state_distinctly() -> None:
    from cube_api.solver_backend import BackendInvalidState

    def invalid_solver(
        payload: object, emit: object, cancelled: object
    ) -> list[str]:
        raise BackendInvalidState("unreachable")

    client = TestClient(create_app(solver=invalid_solver))
    response = client.post("/api/solve", json=solved_payload())
    job_id = response.json()["job_id"]
    events = client.get(f"/api/jobs/{job_id}/events")

    assert '"code":"INVALID_STATE"' in events.text.replace(" ", "")


def test_solve_returns_formula_in_selected_orientation_after_canonical_replay() -> None:
    def canonical_four_turn_solver(
        payload: object, emit: object, cancelled: object
    ) -> list[str]:
        return ["R", "R", "R", "R"]

    payload = solved_payload()
    payload["front"] = "R"
    payload["top"] = "U"
    client = TestClient(create_app(solver=canonical_four_turn_solver))
    response = client.post("/api/solve", json=payload)
    job_id = response.json()["job_id"]
    events = client.get(f"/api/jobs/{job_id}/events")

    compact = events.text.replace(" ", "")
    assert '"moves":["F","F","F","F"]' in compact
    assert '"verified":true' in compact


def test_solve_emits_verifying_phase_before_completion() -> None:
    client = TestClient(create_app())
    response = client.post("/api/solve", json=solved_payload())
    job_id = response.json()["job_id"]
    events = client.get(f"/api/jobs/{job_id}/events")

    assert "event: verifying" in events.text


def test_validate_reports_corner_reachability_diagnostic() -> None:
    payload = solved_payload(3)
    stickers = payload["stickers"]
    assert isinstance(stickers, dict)
    stickers["U"][0], stickers["F"][0] = stickers["F"][0], stickers["U"][0]

    response = TestClient(create_app()).post("/api/validate", json=payload)

    assert response.status_code == 200
    assert response.json()["errors"] == [
        {"code": "CORNER_DUPLICATE", "message": "角块颜色组合重复或缺失"}
    ]


def test_validate_reports_fixed_center_diagnostic() -> None:
    payload = solved_payload(3)
    stickers = payload["stickers"]
    assert isinstance(stickers, dict)
    center = 4
    (stickers["U"][center], stickers["D"][center]) = (
        stickers["D"][center],
        stickers["U"][center],
    )

    response = TestClient(create_app()).post("/api/validate", json=payload)

    assert response.status_code == 200
    assert response.json()["errors"] == [
        {"code": "CENTER_MISMATCH", "message": "面 U 的固定中心颜色不匹配"},
        {"code": "CENTER_MISMATCH", "message": "面 D 的固定中心颜色不匹配"},
    ]


def test_solve_times_out_with_stable_operational_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import time

    def slow_solver(
        payload: object, emit: object, cancelled: object
    ) -> list[str]:
        time.sleep(0.2)
        return []

    monkeypatch.setenv("SOLVER_TIMEOUT_SECONDS", "0.01")
    client = TestClient(create_app(solver=slow_solver))
    response = client.post("/api/solve", json=solved_payload())
    events = client.get(f"/api/jobs/{response.json()['job_id']}/events")

    assert '"code":"SOLVER_TIMEOUT"' in events.text.replace(" ", "")
    assert "event: completed" not in events.text


def test_cancel_job_finishes_stream_without_waiting_for_solver() -> None:
    import time

    def ignoring_solver(
        payload: object, emit: object, cancelled: object
    ) -> list[str]:
        time.sleep(1.0)
        return []

    client = TestClient(create_app(solver=ignoring_solver))
    response = client.post("/api/solve", json=solved_payload())
    job_id = response.json()["job_id"]
    started = time.monotonic()
    cancelled = client.delete(f"/api/jobs/{job_id}")
    events = client.get(f"/api/jobs/{job_id}/events")

    assert cancelled.json() == {"cancelled": True}
    assert time.monotonic() - started < 0.5
    assert "event: cancelled" in events.text
    assert "event: completed" not in events.text


def test_solver_runs_in_an_isolated_worker_process() -> None:
    import os

    def pid_solver(
        payload: object, emit: object, cancelled: object
    ) -> list[str]:
        emit("worker_pid", {"pid": os.getpid()})  # type: ignore[operator]
        return []

    client = TestClient(create_app(solver=pid_solver))
    response = client.post("/api/solve", json=solved_payload())
    events = client.get(f"/api/jobs/{response.json()['job_id']}/events")

    worker_event = next(
        line for line in events.text.splitlines() if line.startswith('data: {"pid"')
    )
    assert int(worker_event.split('"pid":', 1)[1].split("}", 1)[0]) != os.getpid()




def test_solver_jobs_are_queued_in_submission_order() -> None:
    import time

    def slow_solver(
        payload: object, emit: object, cancelled: object
    ) -> list[str]:
        emit("started", {})  # type: ignore[operator]
        time.sleep(0.5)
        return []

    client = TestClient(create_app(solver=slow_solver))
    first = client.post("/api/solve", json=solved_payload())
    first_id = first.json()["job_id"]
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        snapshot = client.get(f"/api/jobs/{first_id}").json()
        if any(name == "started" for name, _ in snapshot["events"]):
            break
        time.sleep(0.01)
    else:
        pytest.fail("first solver did not start")

    second = client.post("/api/solve", json=solved_payload())
    second_id = second.json()["job_id"]
    time.sleep(0.1)
    second_snapshot = client.get(f"/api/jobs/{second_id}").json()

    assert [name for name, _ in second_snapshot["events"]] == ["queued"]
    assert "event: completed" in client.get(
        f"/api/jobs/{first_id}/events"
    ).text
    assert "event: completed" in client.get(
        f"/api/jobs/{second_id}/events"
    ).text



def test_solve_reports_table_download_failure_distinctly() -> None:
    from cube_api.solver_backend import BackendTableDownloadError

    def unavailable_table_solver(
        payload: object, emit: object, cancelled: object
    ) -> list[str]:
        raise BackendTableDownloadError("table unavailable")

    client = TestClient(create_app(solver=unavailable_table_solver))
    response = client.post("/api/solve", json=solved_payload())
    events = client.get(f"/api/jobs/{response.json()['job_id']}/events")

    assert '"code":"TABLE_DOWNLOAD_FAILED"' in events.text.replace(" ", "")


def test_solver_worker_uses_an_isolated_temp_directory() -> None:
    import os

    def probe_solver(
        payload: object,
        emit: Callable[[str, dict[str, object]], None],
        cancelled: Callable[[], bool],
    ) -> list[str]:
        emit("probe", {"tmpdir": os.environ.get("TMPDIR", "")})
        return []

    client = TestClient(create_app(solver=probe_solver))
    response = client.post("/api/solve", json=solved_payload())
    events = client.get(f"/api/jobs/{response.json()['job_id']}/events")

    assert '"tmpdir":"/tmp/613-cube-solver-' in events.text.replace(" ", "")


def test_solver_worker_prepares_native_ida_helper_in_isolated_cwd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import os

    helper = tmp_path / "trusted-ida-search"
    helper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    helper.chmod(0o755)
    lookup_cache = tmp_path / "lookup-tables"
    lookup_cache.mkdir()
    monkeypatch.setenv("CUBE_IDA_SEARCH_PATH", str(helper))
    monkeypatch.setenv("CUBE_LOOKUP_TABLE_PATH", str(lookup_cache))

    def probe_solver(
        payload: object,
        emit: Callable[[str, dict[str, object]], None],
        cancelled: Callable[[], bool],
    ) -> list[str]:
        local_helper = Path.cwd() / "ida_search_via_graph"
        emit(
            "probe",
            {
                "cwd": str(Path.cwd()),
                "helper": str(local_helper.resolve()),
                "executable": os.access(local_helper, os.X_OK),
                "lookup_cache": str((Path.cwd() / "lookup-tables").resolve()),
            },
        )
        return []

    client = TestClient(create_app(solver=probe_solver))
    response = client.post("/api/solve", json=solved_payload())
    events = client.get(f"/api/jobs/{response.json()['job_id']}/events")
    compact = events.text.replace(" ", "")

    assert '"cwd":"/tmp/613-cube-solver-' in compact
    assert f'"helper":"{helper}"' in compact
    assert '"executable":true' in compact
    assert f'"lookup_cache":"{lookup_cache}"' in compact


def test_missing_configured_ida_helper_is_an_operational_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CUBE_IDA_SEARCH_PATH", "/missing/ida_search_via_graph")

    client = TestClient(create_app(solver=lambda payload, emit, cancelled: []))
    response = client.post("/api/solve", json=solved_payload())
    events = client.get(f"/api/jobs/{response.json()['job_id']}/events")
    compact = events.text.replace(" ", "")

    assert '"code":"SOLVER_OPERATIONAL_ERROR"' in compact
    assert '"code":"INVALID_STATE"' not in compact
