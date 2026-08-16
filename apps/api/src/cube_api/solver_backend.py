from __future__ import annotations

import importlib
import os
import re
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any, NoReturn, cast

if TYPE_CHECKING:
    from .main import ValidateRequest

Emit = Callable[[str, dict[str, object]], None]
Cancelled = Callable[[], bool]
CubeFactory = Callable[[str], Any]

_LOOKUP_TABLE_BASE_URL = "https://rubiks-cube-lookup-tables.s3.amazonaws.com"
_DOWNLOAD_PROGRESS: Callable[[dict[str, object]], None] | None = None


def _report_download_progress(target: Path, *, cached: bool) -> None:
    if _DOWNLOAD_PROGRESS is not None:
        size = target.stat().st_size if target.exists() else 0
        _DOWNLOAD_PROGRESS(
            {
                "table": target.name,
                "bytes": size,
                "total_bytes": size,
                "cached": cached,
            }
        )


def _raise_job_cancelled() -> NoReturn:
    # Import lazily so importing this backend does not initialize the FastAPI app.
    from .main import JobCancelled

    raise JobCancelled()


def _download_lookup_table(filename: str | Path) -> None:
    """Download and unpack one upstream table without writing through ``/app``."""
    target = Path(filename)
    archive = Path(f"{target}.gz")
    partial = Path(f"{archive}.part")
    unpacked_partial = Path(f"{target}.part")
    if target.exists():
        _validate_lookup_table_file(target)
        partial.unlink(missing_ok=True)
        unpacked_partial.unlink(missing_ok=True)
        _report_download_progress(target, cached=True)
        return
    archive.parent.mkdir(parents=True, exist_ok=True)
    url = f"{_LOOKUP_TABLE_BASE_URL}/{archive.name}"
    try:
        if not archive.exists():
            subprocess.run(
                ["wget", "--no-verbose", "--output-document", str(partial), url],
                check=True,
            )
            if not partial.is_file() or partial.stat().st_size == 0:
                raise RuntimeError(f"lookup table download produced no data: {url}")
            os.replace(partial, archive)
        with unpacked_partial.open("wb") as output:
            subprocess.run(
                ["gunzip", "--stdout", str(archive)],
                check=True,
                stdout=output,
            )
        if unpacked_partial.stat().st_size == 0:
            raise RuntimeError(f"lookup table archive unpacked to no data: {url}")
        os.replace(unpacked_partial, target)
        archive.unlink()
        _report_download_progress(target, cached=False)
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        archive.unlink(missing_ok=True)
        raise BackendTableDownloadError(
            f"lookup table download failed for {archive.name}: {exc}"
        ) from exc
    finally:
        partial.unlink(missing_ok=True)
        unpacked_partial.unlink(missing_ok=True)


def _validate_lookup_table_file(
    filename: str | Path,
    *,
    expected_linecount: int | None = None,
    expected_filesize: int | None = None,
) -> None:
    """Validate a downloaded table before allowing it into the solver cache."""
    target = Path(filename)
    try:
        size = target.stat().st_size
        if size == 0:
            raise ValueError("file is empty")
        if expected_filesize is not None and size != expected_filesize:
            raise ValueError(
                f"file size {size} does not match expected {expected_filesize}"
            )
        if target.suffix != ".txt" and expected_linecount is None:
            return
        with target.open("rb") as handle:
            first = handle.readline()
            if not first or b":" not in first:
                raise ValueError("first record is missing a state/value separator")
            width = len(first)
            if width == 0 or size % width != 0:
                raise ValueError("records do not have a uniform width")
            linecount = size // width
            if expected_linecount is not None and linecount != expected_linecount:
                raise ValueError(
                    "record count "
                    f"{linecount} does not match expected {expected_linecount}"
                )
            handle.seek((linecount - 1) * width)
            last = handle.read(width)
            if len(last) != width or b":" not in last:
                raise ValueError("last record is truncated")
            for record in (first, last):
                state, value = record.rstrip(b"\n\r").split(b":", 1)
                if not state or not value:
                    raise ValueError("record has an empty state or value")
    except (OSError, ValueError) as exc:
        raise BackendTableDownloadError(
            f"lookup table integrity check failed for {target.name}: {exc}"
        ) from exc


def _validate_cube_lookup_tables(cube: Any) -> None:
    """Validate table dimensions declared by the pinned upstream objects."""
    for table in vars(cube).values():
        filename = getattr(table, "filename", None)
        if not filename:
            continue
        path = Path(filename)
        expected_linecount = getattr(table, "linecount", None)
        expected_filesize = getattr(table, "filesize", None)
        binary_filename = getattr(table, "filename_bin", None)
        state_index_filename = getattr(table, "filename_state_index", None)
        row_length = getattr(table, "ROW_LENGTH", None)
        if path.exists():
            _validate_lookup_table_file(
                path,
                expected_linecount=expected_linecount
                if isinstance(expected_linecount, int)
                else None,
                expected_filesize=expected_filesize
                if isinstance(expected_filesize, int)
                else None,
            )
            continue
        if (
            binary_filename
            and state_index_filename
            and Path(binary_filename).exists()
            and Path(state_index_filename).exists()
        ):
            binary_size = (
                expected_linecount * row_length
                if isinstance(expected_linecount, int) and isinstance(row_length, int)
                else None
            )
            _validate_lookup_table_file(
                binary_filename,
                expected_filesize=binary_size,
            )
            _validate_lookup_table_file(
                state_index_filename,
                expected_linecount=expected_linecount
                if isinstance(expected_linecount, int)
                else None,
            )
            continue
        raise BackendTableDownloadError(
            f"lookup table is missing after initialization: {path}"
        )


def _install_lookup_table_downloader() -> None:
    """Replace the pinned upstream downloader's root-relative implementation."""
    lookup_table = importlib.import_module("rubikscubennnsolver.LookupTable")
    vars(lookup_table)["download_file_if_needed"] = _download_lookup_table
    ida_module = importlib.import_module("rubikscubennnsolver.LookupTableIDAViaGraph")
    vars(ida_module)["download_file_if_needed"] = _download_lookup_table


# Upstream rubikscubennnsolver expects the sticker state as a single string
# with faces laid out in U,R,F,D,L,B order (each sticker as a 0..5 digit).
_UPSTREAM_FACE_ORDER = ("U", "R", "F", "D", "L", "B")

_CUBE_CLASSES = {
    2: "RubiksCube222",
    3: "RubiksCube333",
    4: "RubiksCube444",
    5: "RubiksCube555",
    6: "RubiksCube666",
    7: "RubiksCube777",
}


class BackendUnavailable(RuntimeError):
    """The upstream NxNxN solver dependency is not installed/usable."""


class BackendInvalidState(RuntimeError):
    """The cube state could not be constructed or failed sanity checks."""


class BackendOperationalError(RuntimeError):
    """The upstream solver raised an unexpected error while solving."""


class BackendTableDownloadError(RuntimeError):
    """A required lookup table could not be downloaded or unpacked."""


_FACE_VECTORS: dict[str, tuple[int, int, int]] = {
    "U": (0, 1, 0),
    "D": (0, -1, 0),
    "F": (0, 0, 1),
    "B": (0, 0, -1),
    "L": (-1, 0, 0),
    "R": (1, 0, 0),
}
_MOVE_PATTERN = re.compile(
    r"^(?P<prefix>\d*)(?P<face>[UDLRFBxyz])"
    r"(?P<wide>w?)(?P<suffix>['2]?)$"
)
_AXIS_VECTORS: dict[str, tuple[int, int, int]] = {
    "x": (1, 0, 0),
    "y": (0, 1, 0),
    "z": (0, 0, 1),
}
Vector = tuple[int, int, int]


def _negate(vector: tuple[int, int, int]) -> tuple[int, int, int]:
    return tuple(-value for value in vector)  # type: ignore[return-value]


def _cross(
    left: Vector, right: Vector
) -> Vector:
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def _orientation_face_map(front: str, top: str) -> dict[tuple[int, int, int], str]:
    front_vector = _FACE_VECTORS.get(front)
    top_vector = _FACE_VECTORS.get(top)
    if (
        front_vector is None
        or top_vector is None
        or front == top
        or front_vector == _negate(top_vector)
    ):
        raise BackendInvalidState("front and top faces must be adjacent")
    right_vector = _cross(top_vector, front_vector)
    return {
        top_vector: "U",
        _negate(top_vector): "D",
        front_vector: "F",
        _negate(front_vector): "B",
        right_vector: "R",
        _negate(right_vector): "L",
    }


def _toggle_prime(suffix: str) -> str:
    if suffix == "2":
        return suffix
    return "" if suffix == "'" else "'"


def _user_frame_vectors(
    front: str, top: str
) -> dict[str, tuple[int, int, int]]:
    top_vector = _FACE_VECTORS.get(top)
    front_vector = _FACE_VECTORS.get(front)
    if (
        top_vector is None
        or front_vector is None
        or front == top
        or front_vector == _negate(top_vector)
    ):
        raise BackendInvalidState("front and top faces must be adjacent")
    right_vector = _cross(top_vector, front_vector)
    return {
        "x": right_vector,
        "y": top_vector,
        "z": front_vector,
        "U": top_vector,
        "D": _negate(top_vector),
        "F": front_vector,
        "B": _negate(front_vector),
        "R": right_vector,
        "L": _negate(right_vector),
    }


def _map_move(
    token: str,
    source_vectors: dict[str, tuple[int, int, int]],
    target_face_names: dict[tuple[int, int, int], str],
    target_axis_names: dict[tuple[int, int, int], str],
) -> str:
    if token.startswith("COMMENT_"):
        return token
    match = _MOVE_PATTERN.fullmatch(token)
    if match is None:
        raise BackendOperationalError(f"unsupported solver move: {token}")
    prefix = match.group("prefix")
    face = match.group("face")
    wide = match.group("wide")
    suffix = match.group("suffix")
    if face in _AXIS_VECTORS:
        if prefix or wide:
            raise BackendOperationalError(f"unsupported solver move: {token}")
        vector = source_vectors[face]
        for target_vector, target_axis in target_axis_names.items():
            if vector == target_vector:
                return target_axis + suffix
            if vector == _negate(target_vector):
                return target_axis + _toggle_prime(suffix)
        raise BackendOperationalError(f"unsupported solver axis: {token}")
    vector = source_vectors[face]
    mapped_face = target_face_names.get(vector)
    if mapped_face is None:
        raise BackendOperationalError(f"unsupported solver face: {token}")
    return f"{prefix}{mapped_face}{wide}{suffix}"


def map_solution_to_orientation(
    solution: list[str], front: str, top: str
) -> list[str]:
    """Express canonical solver moves in the user's selected front/top frame."""
    user_vectors = _user_frame_vectors(front, top)
    face_map = {
        vector: face for face, vector in user_vectors.items() if face in _FACE_VECTORS
    }
    axis_map = {
        vector: axis for axis, vector in user_vectors.items() if axis in _AXIS_VECTORS
    }
    return [
        _map_move(token, _FACE_VECTORS | _AXIS_VECTORS, face_map, axis_map)
        for token in solution
    ]


def map_solution_from_orientation(
    solution: list[str], front: str, top: str
) -> list[str]:
    """Convert a displayed user-frame formula back to canonical solver moves."""
    user_vectors = _user_frame_vectors(front, top)
    face_map = {
        vector: face for face, vector in _FACE_VECTORS.items()
    }
    axis_map = {
        vector: axis for axis, vector in _AXIS_VECTORS.items()
    }
    source_vectors = {
        name: user_vectors[name]
        for name in (*_AXIS_VECTORS, *_FACE_VECTORS)
    }
    return [
        _map_move(token, source_vectors, face_map, axis_map)
        for token in solution
    ]


def _to_upstream_state(request: ValidateRequest) -> str:
    """Convert the API sticker map (U,D,F,B,L,R, colors 0..5) to URFDLB."""
    color_names = ("U", "D", "F", "B", "L", "R")
    result = []
    for face in _UPSTREAM_FACE_ORDER:
        for color in request.stickers[face]:
            try:
                result.append(color_names[color])
            except IndexError as exc:
                raise BackendInvalidState("invalid sticker color index") from exc
    return "".join(result)


def _resolve_cube_factory(order: int) -> CubeFactory:
    try:
        class_name = _CUBE_CLASSES[order]
    except KeyError as exc:
        raise BackendUnavailable(f"no solver backend for cube order {order}") from exc
    try:
        module = importlib.import_module(f"rubikscubennnsolver.{class_name}")
        cube_class = getattr(module, class_name)
        _install_lookup_table_downloader()
    except (ImportError, AttributeError) as exc:
        raise BackendUnavailable(
            "rubikscubennnsolver is not installed or missing the requested cube class"
        ) from exc
    return cast(CubeFactory, lambda state: cube_class(state, "URFDLB"))


def _filter_solution(solution: list[str]) -> list[str]:
    return [
        _translate_upstream_move(token)
        for token in solution
        if not token.startswith("COMMENT_")
    ]


def _translate_upstream_move(token: str) -> str:
    """Keep upstream moves in the shared WCA state convention."""
    return token


def solve(
    request: ValidateRequest,
    emit: Emit,
    cancelled: Cancelled,
    *,
    cube_factory: CubeFactory | None = None,
) -> list[str]:
    """Solve a cube with the upstream NxNxN solver."""
    if cube_factory is None:
        cube_factory = _resolve_cube_factory(request.order)
    if cancelled():
        _raise_job_cancelled()
    state = _to_upstream_state(request)
    try:
        cube = cube_factory(state)
    except Exception as exc:
        raise BackendInvalidState(f"could not build cube from state: {exc}") from exc
    if cancelled():
        _raise_job_cancelled()
    try:
        cube.sanity_check()
    except Exception as exc:
        raise BackendInvalidState(f"cube sanity check failed: {exc}") from exc
    if request.order >= 4:
        emit("downloading", {"order": request.order, "cache": "lookup-tables"})
        emit("reducing", {"order": request.order})
    emit("solving", {"order": request.order, "backend": "rubikscubennnsolver"})
    global _DOWNLOAD_PROGRESS
    previous_progress = _DOWNLOAD_PROGRESS
    def report_progress(data: dict[str, object]) -> None:
        emit("downloading", {"order": request.order, **data})

    _DOWNLOAD_PROGRESS = report_progress
    try:
        initialize_tables = getattr(cube, "lt_init", None)
        if request.order >= 4 and callable(initialize_tables):
            initialize_tables()
        _validate_cube_lookup_tables(cube)
        if cancelled():
            _raise_job_cancelled()
        cube.solve([])
        _validate_cube_lookup_tables(cube)
    except (BackendUnavailable, BackendTableDownloadError):
        raise
    except SystemExit as exc:
        # The pinned 2x2 implementation calls sys.exit(0) for an already
        # solved cube instead of returning an empty solution. Treat only that
        # success exit as a solved result; non-zero exits remain failures.
        if exc.code not in (None, 0):
            raise BackendOperationalError(
                f"solver exited with status {exc.code}"
            ) from exc
        return []
    except Exception as exc:
        raise BackendOperationalError(str(exc)) from exc
    finally:
        _DOWNLOAD_PROGRESS = previous_progress
    if cancelled():
        _raise_job_cancelled()
    return _filter_solution(list(cube.solution))
