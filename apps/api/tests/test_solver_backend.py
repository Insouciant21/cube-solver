from __future__ import annotations

import importlib
from pathlib import Path
from types import ModuleType

import pytest

from cube_api import solver_backend
from cube_api.main import JobCancelled, ValidateRequest
from cube_api.solver_backend import (
    BackendInvalidState,
    BackendOperationalError,
    BackendTableDownloadError,
    BackendUnavailable,
    _to_upstream_state,
)

FACE_KEYS = ("U", "D", "F", "B", "L", "R")

# Solved 2x2 upstream state laid out in U,R,F,D,L,B order.
_SOLVED_2_UPSTREAM = "UUUURRRRFFFFDDDDLLLLBBBB"


def _solved_request(order: int = 2) -> ValidateRequest:
    stickers = {face: [i] * (order * order) for i, face in enumerate(FACE_KEYS)}
    return ValidateRequest(
        order=order, revision=0, front="F", top="U", stickers=stickers
    )


def _noop_emit(name: str, data: dict[str, object]) -> None:
    return None


class FakeCube:
    def __init__(self, state: str) -> None:
        self.state = state
        self.sanity_called = False
        self.solve_args: list[object] | None = None
        self.solution = ["R", "COMMENT_1", "U'", "COMMENT_2", "F2"]

    def sanity_check(self) -> None:
        self.sanity_called = True

    def solve(self, *args: object) -> None:
        self.solve_args = list(args)


def test_to_upstream_state_maps_to_urfdlb_order() -> None:
    assert _to_upstream_state(_solved_request(2)) == _SOLVED_2_UPSTREAM


def test_cube_class_map_covers_orders_two_to_seven() -> None:
    expected = {
        2: "RubiksCube222",
        3: "RubiksCube333",
        4: "RubiksCube444",
        5: "RubiksCube555",
        6: "RubiksCube666",
        7: "RubiksCube777",
    }
    assert solver_backend._CUBE_CLASSES == expected


def test_missing_upstream_raises_backend_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_import = importlib.import_module

    def fake_import(name: str, package: str | None = None) -> ModuleType:
        if name == "rubikscubennnsolver" or name.startswith("rubikscubennnsolver."):
            raise ImportError("no rubikscubennnsolver")
        return real_import(name, package)

    monkeypatch.setattr(importlib, "import_module", fake_import)

    with pytest.raises(BackendUnavailable):
        solver_backend.solve(_solved_request(2), _noop_emit, lambda: False)


def test_fake_upstream_cube_calls_sanity_and_filters_comments() -> None:
    instances: list[FakeCube] = []

    def factory(state: str) -> FakeCube:
        cube = FakeCube(state)
        instances.append(cube)
        return cube

    result = solver_backend.solve(
        _solved_request(2), _noop_emit, lambda: False, cube_factory=factory
    )

    assert len(instances) == 1
    cube = instances[0]
    assert cube.state == _SOLVED_2_UPSTREAM
    assert cube.sanity_called is True
    assert cube.solve_args == [[]]
    assert result == ["R", "U'", "F2"]
    assert result == [t for t in cube.solution if not t.startswith("COMMENT_")]


def test_formal_solution_preserves_upstream_front_back_turns() -> None:
    class FrontBackCube(FakeCube):
        def __init__(self, state: str) -> None:
            super().__init__(state)
            self.solution = ["F", "B'", "Fw", "3Bw2"]

    result = solver_backend.solve(
        _solved_request(2), _noop_emit, lambda: False, cube_factory=FrontBackCube
    )

    assert result == ["F", "B'", "Fw", "3Bw2"]


def test_cancelled_raises_job_cancelled() -> None:
    with pytest.raises(JobCancelled):
        solver_backend.solve(
            _solved_request(2), _noop_emit, lambda: True, cube_factory=FakeCube
        )


def test_sanity_check_failure_raises_backend_invalid_state() -> None:
    class BadStateCube(FakeCube):
        def sanity_check(self) -> None:
            raise ValueError("bad state")

    with pytest.raises(BackendInvalidState):
        solver_backend.solve(
            _solved_request(2), _noop_emit, lambda: False, cube_factory=BadStateCube
        )


def test_solve_failure_raises_backend_operational_error() -> None:
    class FailSolveCube(FakeCube):
        def solve(self, *args: object) -> None:
            raise RuntimeError("boom")

    with pytest.raises(BackendOperationalError):
        solver_backend.solve(
            _solved_request(2), _noop_emit, lambda: False, cube_factory=FailSolveCube
        )




def test_lookup_downloader_writes_atomic_archive_in_target_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The table adapter must not download through the non-writable app root."""
    import gzip
    import subprocess
    from pathlib import Path

    target = Path(tmp_path) / "lookup-tables" / "sample.bin"
    calls: list[list[str]] = []

    def fake_run(argv: list[str], check: bool, stdout: object | None = None) -> None:
        del check
        calls.append(argv)
        if argv[0] == "wget":
            output = Path(argv[argv.index("--output-document") + 1])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(gzip.compress(b"table-data"))
        elif argv[0] == "gunzip":
            archive = Path(argv[-1])
            data = gzip.decompress(archive.read_bytes())
            if stdout is None:
                Path(str(archive)[:-3]).write_bytes(data)
                archive.unlink()
            else:
                stdout.write(data)  # type: ignore[attr-defined]

    monkeypatch.setattr(subprocess, "run", fake_run)
    solver_backend._download_lookup_table(target)

    assert target.read_bytes() == b"table-data"
    assert not Path(f"{target}.gz.part").exists()
    assert calls[0][0] == "wget"
    output_path = Path(calls[0][calls[0].index("--output-document") + 1])
    assert output_path.parent == target.parent


def test_lookup_downloader_never_exposes_partial_unpacked_target(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import gzip
    import subprocess

    target = tmp_path / "lookup-tables" / "sample.bin"

    def fake_run(argv: list[str], check: bool, stdout: object | None = None) -> None:
        del check
        if argv[0] == "wget":
            output = Path(argv[argv.index("--output-document") + 1])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(gzip.compress(b"table-data"))
            return
        if stdout is None:
            target.write_bytes(b"partial")
        else:
            stdout.write(b"partial")  # type: ignore[attr-defined]
        raise subprocess.CalledProcessError(1, argv)

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(BackendTableDownloadError):
        solver_backend._download_lookup_table(target)

    assert not target.exists()
    assert not Path(f"{target}.part").exists()
    assert not Path(f"{target}.gz.part").exists()


def test_solution_moves_map_into_selected_front_top_frame() -> None:
    assert solver_backend.map_solution_to_orientation(
        ["R", "U", "F'", "Rw"], "R", "U"
    ) == ["F", "U", "L'", "Fw"]


def test_solution_move_mapping_rejects_non_adjacent_frame() -> None:
    with pytest.raises(
        BackendInvalidState, match="front and top faces must be adjacent"
    ):
        solver_backend.map_solution_to_orientation(["R"], "R", "L")


def test_formal_backend_emits_phase_progress_for_high_order() -> None:
    events: list[str] = []
    solver_backend.solve(
        _solved_request(4),
        lambda name, data: events.append(name),
        lambda: False,
        cube_factory=FakeCube,
    )

    assert events == ["downloading", "reducing", "solving"]




def test_lookup_downloader_reports_table_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import subprocess

    target = tmp_path / "lookup-tables" / "sample.bin"

    def fail_run(argv: list[str], check: bool) -> None:
        raise subprocess.CalledProcessError(1, argv)

    monkeypatch.setattr(subprocess, "run", fail_run)
    with pytest.raises(BackendTableDownloadError):
        solver_backend._download_lookup_table(target)


def test_lookup_downloader_rejects_empty_cached_table(tmp_path: Path) -> None:
    target = tmp_path / "lookup-tables" / "empty.bin"
    target.parent.mkdir()
    target.touch()

    with pytest.raises(BackendTableDownloadError, match="file is empty"):
        solver_backend._download_lookup_table(target)


def test_lookup_downloader_cleans_stale_partials_on_cache_hit(tmp_path: Path) -> None:
    target = tmp_path / "lookup-tables" / "cached.bin"
    target.parent.mkdir()
    target.write_bytes(b"complete")
    archive_partial = Path(f"{target}.gz.part")
    unpacked_partial = Path(f"{target}.part")
    archive_partial.write_bytes(b"stale archive")
    unpacked_partial.write_bytes(b"stale unpacked data")

    solver_backend._download_lookup_table(target)

    assert not archive_partial.exists()
    assert not unpacked_partial.exists()


def test_formal_backend_validates_tables_created_by_lt_init_before_solving(
    tmp_path: Path,
) -> None:
    target = tmp_path / "lookup-table.txt"
    target.write_text("aa:1\nbb:2\n", encoding="utf-8")

    class LateInitCube(FakeCube):
        solve_called = False

        def lt_init(self) -> None:
            self.lookup_table = type(
                "DeclaredTable",
                (),
                {"filename": str(target), "linecount": 3, "filesize": 10},
            )()

        def solve(self, *args: object) -> None:
            self.solve_called = True

    cube = LateInitCube(_SOLVED_2_UPSTREAM)

    with pytest.raises(BackendTableDownloadError, match="does not match expected"):
        solver_backend.solve(
            _solved_request(4),
            _noop_emit,
            lambda: False,
            cube_factory=lambda state: cube,
        )

    assert cube.solve_called is False


def test_whole_cube_axes_map_into_selected_frame() -> None:
    assert solver_backend.map_solution_to_orientation(
        ["x", "y", "z"], "R", "U"
    ) == ["z", "y", "x'"]


def test_selected_frame_mapping_round_trips_axes() -> None:
    displayed = solver_backend.map_solution_to_orientation(
        ["x", "y", "z", "R'", "3Uw2"], "R", "U"
    )
    assert solver_backend.map_solution_from_orientation(
        displayed, "R", "U"
    ) == ["x", "y", "z", "R'", "3Uw2"]


def test_lookup_table_integrity_rejects_wrong_record_count(tmp_path: Path) -> None:
    target = tmp_path / "lookup-table.txt"
    target.write_text("aa:1\nbb:2\n", encoding="utf-8")

    with pytest.raises(BackendTableDownloadError):
        solver_backend._validate_lookup_table_file(target, expected_linecount=3)


def test_lookup_table_integrity_validates_state_index_files(tmp_path: Path) -> None:
    logical = tmp_path / "lookup-table.txt"
    binary = tmp_path / "lookup-table.bin"
    state_index = tmp_path / "lookup-table.state_index"
    binary.write_bytes(b"123456")
    state_index.write_text("aa:0\nbb:1\n", encoding="utf-8")
    table = type(
        "IndexedTable",
        (),
        {
            "filename": str(logical),
            "filename_bin": str(binary),
            "filename_state_index": str(state_index),
            "linecount": 2,
            "ROW_LENGTH": 3,
        },
    )()
    cube = type("CubeWithIndexedTable", (), {})()
    cube.table = table

    solver_backend._validate_cube_lookup_tables(cube)

    binary.write_bytes(b"12345")
    with pytest.raises(BackendTableDownloadError, match="does not match expected"):
        solver_backend._validate_cube_lookup_tables(cube)


def test_formal_backend_handles_upstream_system_exit_for_solved_cube() -> None:
    class ExitOnSolvedCube(FakeCube):
        def solve(self, *args: object) -> None:
            raise SystemExit(0)

    assert (
        solver_backend.solve(
            _solved_request(), _noop_emit, lambda: False, cube_factory=ExitOnSolvedCube
        )
        == []
    )
