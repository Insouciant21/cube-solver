from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from cube_api import replay
from cube_api.main import ValidateRequest, create_app
from cube_api.solver import solve
from cube_api.solver_backend import BackendUnavailable

FACE_KEYS = ("U", "D", "F", "B", "L", "R")


@pytest.fixture(autouse=True)
def enable_offline_bounded_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUBE_ALLOW_BOUNDED_FALLBACK", "1")


def _solved_stickers(order: int = 2) -> dict[str, list[int]]:
    return {face: [i] * (order * order) for i, face in enumerate(FACE_KEYS)}


def _payload(stickers: dict[str, list[int]]) -> dict[str, object]:
    return {
        "order": 2,
        "revision": 0,
        "front": "F",
        "top": "U",
        "stickers": stickers,
    }


def _request(stickers: dict[str, list[int]]) -> ValidateRequest:
    return ValidateRequest(
        order=2, revision=0, front="F", top="U", stickers=stickers
    )


def test_create_app_accepts_injected_solver() -> None:
    def fake_solver(
        payload: ValidateRequest,
        emit: Callable[[str, dict[str, object]], None],
        cancelled: Callable[[], bool],
    ) -> list[str]:
        emit("solution", {"moves": []})
        return []

    app = create_app(solver=fake_solver)
    client = TestClient(app)

    response = client.post("/api/solve", json=_payload(_solved_stickers(2)))

    assert response.status_code == 202
    assert response.json()["revision"] == 0


@pytest.mark.parametrize("move", FACE_KEYS)
def test_default_solver_inverts_single_face_scramble(move: str) -> None:
    solved = _solved_stickers(2)
    scrambled = replay.replay_moves(2, solved, [move])

    solution = solve(_request(scrambled), lambda name, data: None, lambda: False)

    assert solution != []
    assert replay.is_solved_stickers(2, replay.replay_moves(2, scrambled, solution))


@pytest.mark.parametrize("move", ["F", "B"])
def test_default_solver_replays_front_and_back_scrambles(move: str) -> None:
    order = 3
    solved = _solved_stickers(order)
    scrambled = replay.replay_moves(order, solved, [move])
    request = ValidateRequest(
        order=order,
        revision=0,
        front="F",
        top="U",
        stickers=scrambled,
    )

    solution = solve(request, lambda name, data: None, lambda: False)

    assert solution != []
    assert replay.is_solved_stickers(
        order, replay.replay_moves(order, scrambled, solution)
    )


@pytest.mark.parametrize("move", FACE_KEYS)
def test_api_default_solver_replays_single_face_scramble(move: str) -> None:
    scrambled = replay.replay_moves(2, _solved_stickers(), [move])
    response = TestClient(create_app()).post("/api/solve", json=_payload(scrambled))
    assert response.status_code == 202
    events = TestClient(create_app()).get(
        f"/api/jobs/{response.json()['job_id']}/events"
    )
    assert events.status_code == 200
    assert "event: completed" in events.text
    assert '"verified":true' in events.text.replace(" ", "")


def test_default_solver_returns_empty_for_solved_input() -> None:
    solved = _solved_stickers(2)

    solution = solve(_request(solved), lambda name, data: None, lambda: False)

    assert solution == []


def test_default_solver_prefers_formal_nxn_backend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[int] = []

    def formal_solver(
        payload: ValidateRequest,
        emit: Callable[[str, dict[str, object]], None],
        cancelled: Callable[[], bool],
    ) -> list[str]:
        calls.append(payload.order)
        return ["R'"]

    monkeypatch.setattr("cube_api.solver.solve_formal", formal_solver)
    scrambled = replay.replay_moves(2, _solved_stickers(), ["R"])

    solution = solve(_request(scrambled), lambda name, data: None, lambda: False)

    assert calls == [2]
    assert solution == ["R'"]


def test_default_solver_cancels_safely() -> None:
    solved = _solved_stickers(2)
    scrambled = replay.replay_moves(2, solved, ["R"])

    cancelled = True
    solution = solve(_request(scrambled), lambda name, data: None, lambda: cancelled)

    assert solution == []


def test_bounded_fallback_requires_explicit_enable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CUBE_ALLOW_BOUNDED_FALLBACK", "0")

    def unavailable(
        payload: ValidateRequest,
        emit: Callable[[str, dict[str, object]], None],
        cancelled: Callable[[], bool],
    ) -> list[str]:
        raise BackendUnavailable("formal backend missing")

    monkeypatch.setattr("cube_api.solver.solve_formal", unavailable)
    with pytest.raises(BackendUnavailable):
        solve(_request(_solved_stickers()), lambda name, data: None, lambda: False)


def test_formal_solver_emits_selected_frame_moves(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def formal_solver(
        payload: ValidateRequest,
        emit: Callable[[str, dict[str, object]], None],
        cancelled: Callable[[], bool],
    ) -> list[str]:
        return ["R", "R", "R", "R"]

    monkeypatch.setattr("cube_api.solver.solve_formal", formal_solver)
    payload = _request(_solved_stickers())
    payload = payload.model_copy(update={"front": "R", "top": "U"})
    events: list[tuple[str, dict[str, object]]] = []

    solve(payload, lambda name, data: events.append((name, data)), lambda: False)

    assert events[-1] == (
        "solution",
        {"moves": ["F", "F", "F", "F"], "backend": "rubikscubennnsolver"},
    )



def test_bounded_fallback_emits_selected_frame_solution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CUBE_ALLOW_BOUNDED_FALLBACK", "1")

    def unavailable(
        payload: ValidateRequest,
        emit: Callable[[str, dict[str, object]], None],
        cancelled: Callable[[], bool],
    ) -> list[str]:
        raise BackendUnavailable("formal backend missing")

    monkeypatch.setattr("cube_api.solver.solve_formal", unavailable)
    def fallback(
        payload: ValidateRequest,
        emit: Callable[[str, dict[str, object]], None],
        cancelled: Callable[[], bool],
    ) -> list[str]:
        return ["R"]

    monkeypatch.setattr("cube_api.solver._bounded_solve", fallback)
    payload = _request(_solved_stickers()).model_copy(update={"front": "R", "top": "U"})
    events: list[tuple[str, dict[str, object]]] = []

    solve(payload, lambda name, data: events.append((name, data)), lambda: False)

    assert events[-1] == ("solution", {"moves": ["F"], "backend": "bounded-fallback"})


def test_bounded_fallback_is_disabled_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CUBE_ALLOW_BOUNDED_FALLBACK", raising=False)

    def unavailable(
        payload: ValidateRequest,
        emit: Callable[[str, dict[str, object]], None],
        cancelled: Callable[[], bool],
    ) -> list[str]:
        raise BackendUnavailable("formal backend missing")

    monkeypatch.setattr("cube_api.solver.solve_formal", unavailable)
    with pytest.raises(BackendUnavailable):
        solve(_request(_solved_stickers()), lambda name, data: None, lambda: False)
