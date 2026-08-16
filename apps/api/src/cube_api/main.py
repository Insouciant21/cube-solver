from __future__ import annotations

import json
import multiprocessing
import os
import shutil
import signal
import tempfile
import threading
import time
from collections import deque
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from pathlib import Path
from queue import Empty
from typing import Any, cast
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .reachability import check_reachability
from .replay import is_solved_stickers, replay_moves

FACE_KEYS: tuple[str, ...] = ("U", "D", "F", "B", "L", "R")
OPPOSITE: dict[str, str] = {
    "U": "D",
    "D": "U",
    "F": "B",
    "B": "F",
    "L": "R",
    "R": "L",
}


class ValidateRequest(BaseModel):
    order: int = Field(ge=2, le=7)
    revision: int = Field(ge=0)
    front: str
    top: str
    stickers: dict[str, list[int]]


EventData = dict[str, Any]
EmitEvent = Callable[[str, EventData], None]
Solver = Callable[["ValidateRequest", EmitEvent, Callable[[], bool]], list[str]]


class SolverUnavailable(RuntimeError):
    pass


class JobCancelled(RuntimeError):
    pass


class SolverTimeout(RuntimeError):
    pass


def _solver_timeout_seconds() -> float:
    raw = os.environ.get("SOLVER_TIMEOUT_SECONDS", "1800")
    try:
        value = float(raw)
    except ValueError:
        return 1800.0
    return value if value > 0 else 1800.0


def _apply_worker_resource_limits() -> None:
    try:
        import resource

        cpu_seconds = int(os.environ.get("SOLVER_CPU_SECONDS", "0"))
        memory_bytes = int(os.environ.get("SOLVER_MEMORY_BYTES", "0"))
        pid_limit = int(os.environ.get("SOLVER_PID_LIMIT", "0"))
        if cpu_seconds > 0:
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        if memory_bytes > 0:
            resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
        if pid_limit > 0 and hasattr(resource, "RLIMIT_NPROC"):
            resource.setrlimit(resource.RLIMIT_NPROC, (pid_limit, pid_limit))
    except (ImportError, OSError, ValueError):
        return


def _prepare_ida_search_helper(worker_tmpdir: str) -> None:
    """Expose the pinned native helper under the name expected by upstream."""
    configured = os.environ.get("CUBE_IDA_SEARCH_PATH")
    discovered = shutil.which("ida_search_via_graph")
    if configured is None and discovered is None:
        default = Path("/usr/local/bin/ida_search_via_graph")
        if not default.exists():
            return
        source = default
    else:
        source = Path(configured or discovered or "")

    if not source.is_absolute():
        raise RuntimeError("CUBE_IDA_SEARCH_PATH must be an absolute path")
    try:
        source = source.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError(f"IDA search helper is unavailable: {source}") from exc
    if not source.is_file() or not os.access(source, os.X_OK):
        raise RuntimeError(f"IDA search helper is not executable: {source}")

    (Path(worker_tmpdir) / "ida_search_via_graph").symlink_to(source)


def _prepare_lookup_table_cache(worker_tmpdir: str, previous_cwd: str) -> None:
    """Keep upstream relative table paths on the persistent solver-data mount."""
    configured = os.environ.get("CUBE_LOOKUP_TABLE_PATH")
    source = Path(configured) if configured else Path(previous_cwd) / "lookup-tables"
    if configured is None and not source.exists():
        return
    if not source.is_absolute():
        raise RuntimeError("CUBE_LOOKUP_TABLE_PATH must be an absolute path")
    try:
        source = source.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError(f"lookup-table cache is unavailable: {source}") from exc
    if not source.is_dir():
        raise RuntimeError(f"lookup-table cache is not a directory: {source}")

    (Path(worker_tmpdir) / "lookup-tables").symlink_to(source, target_is_directory=True)


def _solver_process_entry(
    solver: Solver,
    payload: ValidateRequest,
    messages: Any,
    cancelled: Any,
) -> None:
    try:
        os.setsid()
    except OSError:
        pass

    worker_tmpdir = tempfile.mkdtemp(prefix="613-cube-solver-")
    previous_environment = os.environ.copy()
    previous_cwd = os.getcwd()
    allowed_environment = {
        key: previous_environment[key]
        for key in (
            "PATH",
            "PYTHONPATH",
            "LANG",
            "LC_ALL",
            "CUBE_ALLOW_BOUNDED_FALLBACK",
            "CUBE_IDA_SEARCH_PATH",
            "CUBE_LOOKUP_TABLE_PATH",
            "SOLVER_TIMEOUT_SECONDS",
            "SOLVER_CPU_SECONDS",
            "SOLVER_MEMORY_BYTES",
            "SOLVER_PID_LIMIT",
        )
        if key in previous_environment
    }
    allowed_environment.update(
        {
            "HOME": worker_tmpdir,
            "TMPDIR": worker_tmpdir,
            "TMP": worker_tmpdir,
            "TEMP": worker_tmpdir,
        }
    )
    os.environ.clear()
    os.environ.update(allowed_environment)
    os.chdir(worker_tmpdir)
    _apply_worker_resource_limits()

    def emit(name: str, data: EventData) -> None:
        messages.put(("event", name, data))

    def is_cancelled() -> bool:
        return bool(cancelled.is_set())

    from .solver_backend import (
        BackendInvalidState,
        BackendOperationalError,
        BackendTableDownloadError,
        BackendUnavailable,
    )

    try:
        _prepare_ida_search_helper(worker_tmpdir)
        _prepare_lookup_table_cache(worker_tmpdir, previous_cwd)
        messages.put(("result", solver(payload, emit, is_cancelled)))
    except JobCancelled:
        messages.put(("error", "cancelled", "solver cancelled"))
    except BackendInvalidState as exc:
        messages.put(("error", "invalid", str(exc)))
    except BackendUnavailable as exc:
        messages.put(("error", "unavailable", str(exc)))
    except BackendTableDownloadError as exc:
        messages.put(("error", "table", str(exc)))
    except BackendOperationalError as exc:
        messages.put(("error", "operational", str(exc)))
    except (OSError, RuntimeError) as exc:
        messages.put(("error", "operational", str(exc)))
    except Exception as exc:  # noqa: BLE001
        messages.put(("error", "internal", str(exc)))
    finally:
        os.chdir(previous_cwd)
        os.environ.clear()
        os.environ.update(previous_environment)
        shutil.rmtree(worker_tmpdir, ignore_errors=True)


def _terminate_solver_process(process: multiprocessing.Process) -> None:
    if not process.is_alive():
        process.join(timeout=0)
        return
    pid = process.pid
    if pid is None:
        process.terminate()
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        process.terminate()
    process.join(timeout=0.5)
    if process.is_alive():
        process.kill()
        process.join(timeout=0.5)


def _run_solver_in_process(
    solver: Solver,
    payload: ValidateRequest,
    emit: EmitEvent,
    cancelled: Callable[[], bool],
) -> list[str]:
    start_method = (
        "fork"
        if "fork" in multiprocessing.get_all_start_methods()
        else multiprocessing.get_start_method()
    )
    context = multiprocessing.get_context(start_method)
    messages = context.Queue()
    worker_cancelled = context.Event()
    process = cast(Any, context).Process(
        target=_solver_process_entry,
        args=(solver, payload, messages, worker_cancelled),
        name="613-cube-solver-worker",
    )
    process.start()
    from .solver_backend import (
        BackendInvalidState,
        BackendOperationalError,
        BackendTableDownloadError,
        BackendUnavailable,
    )

    deadline = time.monotonic() + _solver_timeout_seconds()
    try:
        while True:
            if cancelled():
                worker_cancelled.set()
                _terminate_solver_process(process)
                raise JobCancelled()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                worker_cancelled.set()
                _terminate_solver_process(process)
                raise SolverTimeout(
                    f"solver exceeded {_solver_timeout_seconds():g} seconds"
                )
            try:
                message = messages.get(timeout=min(0.05, remaining))
            except Empty:
                if not process.is_alive():
                    raise RuntimeError(
                        "solver worker exited without a result"
                    ) from None
                continue
            kind = message[0]
            if kind == "event":
                emit(message[1], message[2])
                continue
            if kind == "result":
                result = message[1]
                if not isinstance(result, list) or not all(
                    isinstance(item, str) for item in result
                ):
                    raise RuntimeError("solver worker returned an invalid solution")
                return result
            if kind == "error":
                error_code = message[1]
                message_text = message[2]
                if error_code == "cancelled":
                    raise JobCancelled(message_text)
                if error_code == "invalid":
                    raise BackendInvalidState(message_text)
                if error_code == "unavailable":
                    raise BackendUnavailable(message_text)
                if error_code == "table":
                    raise BackendTableDownloadError(message_text)
                if error_code == "operational":
                    raise BackendOperationalError(message_text)
                raise RuntimeError(message_text)
            raise RuntimeError(f"unknown solver worker message: {kind}")
    finally:
        if process.is_alive():
            _terminate_solver_process(process)
        else:
            process.join(timeout=0)
        messages.close()
        messages.join_thread()


@dataclass
class Job:
    job_id: str
    request: ValidateRequest
    events: list[tuple[str, EventData]] = field(default_factory=list)
    cancelled: threading.Event = field(default_factory=threading.Event)
    condition: threading.Condition = field(default_factory=threading.Condition)
    done: bool = False


def _validation_errors(payload: ValidateRequest) -> list[EventData]:
    expected_size = payload.order * payload.order
    structure_error = set(payload.stickers) != set(FACE_KEYS)
    if not structure_error:
        structure_error = any(
            len(payload.stickers[face]) != expected_size
            or any(color < 0 or color > 5 for color in payload.stickers[face])
            for face in FACE_KEYS
        )
    if not structure_error:
        colors = [color for face in FACE_KEYS for color in payload.stickers[face]]
        structure_error = any(
            colors.count(color) != expected_size for color in range(6)
        )
    if structure_error:
        return [{
            "code": "COLOR_COUNT",
            "message": "颜色数量不正确",
        }]
    if payload.front not in FACE_KEYS or payload.top not in FACE_KEYS:
        return [{
            "code": "ORIENTATION",
            "message": "正面与顶面必须相邻",
        }]
    if payload.front == payload.top or payload.front == OPPOSITE[payload.top]:
        return [{
            "code": "ORIENTATION",
            "message": "正面与顶面必须相邻",
        }]
    return check_reachability(payload.order, payload.stickers)


class _JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, request: ValidateRequest) -> Job:
        with self._lock:
            job = Job(job_id=uuid4().hex, request=request)
            self._jobs[job.job_id] = job
            return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def remove(self, job: Job) -> None:
        with self._lock:
            self._jobs.pop(job.job_id, None)


jobs: _JobStore = _JobStore()

_solver: Solver | None = None
_solver_lock = threading.Lock()
_solver_queue: deque[str] = deque()
_solver_queue_active = False
_solver_queue_condition = threading.Condition()


def _enqueue_solver(job_id: str) -> None:
    with _solver_queue_condition:
        _solver_queue.append(job_id)
        _solver_queue_condition.notify_all()


def _acquire_solver_turn(job: Job) -> None:
    global _solver_queue_active
    with _solver_queue_condition:
        while True:
            if job.cancelled.is_set() or job.done:
                try:
                    _solver_queue.remove(job.job_id)
                except ValueError:
                    pass
                _solver_queue_condition.notify_all()
                raise JobCancelled()
            if (
                not _solver_queue_active
                and _solver_queue
                and _solver_queue[0] == job.job_id
            ):
                _solver_queue.popleft()
                _solver_queue_active = True
                return
            _solver_queue_condition.wait(timeout=0.05)


def _release_solver_turn() -> None:
    global _solver_queue_active
    with _solver_queue_condition:
        _solver_queue_active = False
        _solver_queue_condition.notify_all()


def set_solver(solver: Solver) -> None:
    global _solver
    with _solver_lock:
        _solver = solver


def get_solver() -> Solver:
    with _solver_lock:
        if _solver is None:
            raise SolverUnavailable("No solver registered")
        return _solver


app = FastAPI(title="Cube API")


def create_app(solver: Solver | None = None) -> FastAPI:
    if solver is not None:
        set_solver(solver)
    else:
        from .solver import solve

        set_solver(solve)
    return app


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/validate")
async def validate(payload: ValidateRequest) -> JSONResponse:
    errors = _validation_errors(payload)
    if errors:
        return JSONResponse(content={"ok": False, "errors": errors})
    return JSONResponse(
        content={"ok": True, "errors": [], "revision": payload.revision}
    )


@app.post("/api/solve")
async def solve(payload: ValidateRequest) -> JSONResponse:
    errors = _validation_errors(payload)
    if errors:
        return JSONResponse(
            status_code=400, content={"code": "INVALID_STATE", "errors": errors}
        )
    job = jobs.create(payload)
    with job.condition:
        job.events.append(("queued", {"revision": payload.revision}))
    _enqueue_solver(job.job_id)

    def _run() -> None:
        def emit(name: str, data: EventData) -> None:
            with job.condition:
                if job.done:
                    return
                job.events.append((name, data))
                job.condition.notify_all()

        def is_cancelled() -> bool:
            return job.cancelled.is_set()

        def terminal(name: str, data: EventData) -> None:
            with job.condition:
                if job.done:
                    return
                job.events.append((name, data))
                job.done = True
                job.condition.notify_all()

        from .solver_backend import (
            BackendInvalidState,
            BackendOperationalError,
            BackendTableDownloadError,
            BackendUnavailable,
            map_solution_from_orientation,
            map_solution_to_orientation,
        )

        acquired = False
        try:
            _acquire_solver_turn(job)
            acquired = True
            solver = get_solver()
            emit("running", {"revision": payload.revision})
            solution = _run_solver_in_process(
                solver, payload, emit, is_cancelled
            )
            emit("verifying", {"revision": payload.revision})
            replayed = replay_moves(
                payload.order, payload.stickers, solution, is_cancelled
            )
            display_solution = map_solution_to_orientation(
                solution, payload.front, payload.top
            )
            display_canonical = map_solution_from_orientation(
                display_solution, payload.front, payload.top
            )
            display_replayed = replay_moves(
                payload.order, payload.stickers, display_canonical, is_cancelled
            )
            if is_cancelled():
                raise JobCancelled()
            if not is_solved_stickers(payload.order, replayed):
                raise RuntimeError("solution replay did not reach a solved state")
            if not is_solved_stickers(payload.order, display_replayed):
                raise RuntimeError(
                    "display solution replay did not reach a solved state"
                )
            terminal(
                "completed",
                {
                    "moves": display_solution,
                    "verified": True,
                    "revision": payload.revision,
                },
            )
        except JobCancelled:
            terminal("cancelled", {"job_id": job.job_id})
        except SolverTimeout as exc:
            terminal("failed", {"code": "SOLVER_TIMEOUT", "message": str(exc)})
        except BackendInvalidState as exc:
            terminal("failed", {"code": "INVALID_STATE", "message": str(exc)})
        except BackendTableDownloadError as exc:
            terminal("failed", {"code": "TABLE_DOWNLOAD_FAILED", "message": str(exc)})
        except BackendOperationalError as exc:
            terminal(
                "failed",
                {"code": "SOLVER_OPERATIONAL_ERROR", "message": str(exc)},
            )
        except BackendUnavailable as exc:
            terminal("failed", {"code": "SOLVER_UNAVAILABLE", "message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            terminal("failed", {"code": "INTERNAL_ERROR", "message": str(exc)})
        finally:
            if acquired:
                _release_solver_turn()
            with job.condition:
                job.done = True
                job.condition.notify_all()

    threading.Thread(target=_run, name=f"solve-{job.job_id}", daemon=True).start()
    return JSONResponse(
        status_code=202,
        content={"job_id": job.job_id, "revision": payload.revision},
    )


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> JSONResponse:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    with job.condition:
        events = list(job.events)
        done = job.done
    return JSONResponse(content={"job_id": job_id, "done": done, "events": events})


@app.get("/api/jobs/{job_id}/events")
async def events(job_id: str) -> StreamingResponse:
    return await stream_job(job_id)


@app.get("/api/jobs/{job_id}/stream")
async def stream_job(job_id: str) -> StreamingResponse:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_stream() -> AsyncIterator[str]:
        sent = 0
        while True:
            with job.condition:
                while sent >= len(job.events) and not job.done:
                    if job.condition.wait(timeout=5):
                        continue
                new_events = job.events[sent:]
                sent = len(job.events)
                done = job.done
            for name, data in new_events:
                yield f"event: {name}\ndata: {json.dumps(data)}\n\n"
            if done:
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.delete("/api/jobs/{job_id}")
async def cancel_job(job_id: str) -> JSONResponse:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    with job.condition:
        job.cancelled.set()
        with _solver_queue_condition:
            _solver_queue_condition.notify_all()
        if not job.done:
            job.events.append(("cancelled", {"job_id": job.job_id}))
            job.done = True
        job.condition.notify_all()
    return JSONResponse(content={"cancelled": True})


app = create_app()
