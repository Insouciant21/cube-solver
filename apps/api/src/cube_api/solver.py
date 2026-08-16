from __future__ import annotations

import os
from collections import deque
from collections.abc import Callable
from typing import TYPE_CHECKING

from .replay import is_solved_stickers, replay_moves
from .solver_backend import (
    BackendUnavailable,
    map_solution_to_orientation,
)
from .solver_backend import solve as solve_formal

if TYPE_CHECKING:
    from .main import ValidateRequest

Emit = Callable[[str, dict[str, object]], None]
Cancelled = Callable[[], bool]

_FACES = ("U", "D", "F", "B", "L", "R")
_MOVES = tuple(
    move
    for face in _FACES
    for move in (face, f"{face}'", f"{face}2")
)
_MAX_DEPTH = 6
_SIDE_DEPTH = _MAX_DEPTH // 2
_MAX_QUEUE = 20_000
_CUBE_ROTATIONS = ("x", "y", "z")


def _key(stickers: dict[str, list[int]]) -> tuple[int, ...]:
    return tuple(color for face in _FACES for color in stickers[face])


def _inverse(move: str) -> str:
    if move.endswith("2"):
        return move
    return move[:-1] if move.endswith("'") else f"{move}'"


def _solved(order: int) -> dict[str, list[int]]:
    size = order * order
    return {face: [index] * size for index, face in enumerate(_FACES)}


def _backward_frontier(
    order: int,
    solved: dict[str, list[int]],
    cancelled: Cancelled,
    emit: Emit,
) -> dict[tuple[int, ...], tuple[dict[str, list[int]], tuple[str, ...]]]:
    frontier: deque[tuple[dict[str, list[int]], tuple[str, ...]]] = deque(
        [(solved, ())]
    )
    seen: dict[tuple[int, ...], tuple[dict[str, list[int]], tuple[str, ...]]] = {
        _key(solved): (solved, ())
    }
    for depth in range(_SIDE_DEPTH):
        emit("searching", {"depth": depth + 1, "limit": _MAX_DEPTH})
        for _ in range(len(frontier)):
            if cancelled():
                return {}
            state, path = frontier.popleft()
            for move in _MOVES:
                if cancelled():
                    return {}
                next_state = replay_moves(order, state, (move,))
                next_key = _key(next_state)
                if next_key in seen:
                    continue
                next_path = path + (move,)
                if len(seen) >= _MAX_QUEUE:
                    return seen
                seen[next_key] = (next_state, next_path)
                frontier.append((next_state, next_path))
    return seen


def _bounded_solve(
    payload: ValidateRequest,
    emit: Emit,
    cancelled: Cancelled,
) -> list[str]:
    """Solve short local scrambles with bounded bidirectional BFS."""
    order = payload.order
    start = {face: list(payload.stickers[face]) for face in _FACES}
    if cancelled():
        return []
    if is_solved_stickers(order, start):
        return []

    solved = _solved(order)
    backward = _backward_frontier(order, solved, cancelled, emit)
    if not backward or cancelled():
        return []

    start_key = _key(start)
    if start_key in backward:
        return [_inverse(move) for move in reversed(backward[start_key][1])]

    frontier: deque[tuple[dict[str, list[int]], tuple[str, ...]]] = deque(
        [(start, ())]
    )
    seen = {start_key}
    for depth in range(_SIDE_DEPTH):
        emit("searching", {"depth": _SIDE_DEPTH + depth + 1, "limit": _MAX_DEPTH})
        for _ in range(len(frontier)):
            if cancelled():
                return []
            state, path = frontier.popleft()
            for move in _MOVES:
                if cancelled():
                    return []
                next_state = replay_moves(order, state, (move,))
                next_key = _key(next_state)
                if next_key in seen:
                    continue
                next_path = path + (move,)
                match = backward.get(next_key)
                if match is not None:
                    solution = list(next_path)
                    solution.extend(
                        _inverse(token) for token in reversed(match[1])
                    )
                    if is_solved_stickers(
                        order, replay_moves(order, start, solution)
                    ):
                        return solution
                if len(seen) >= _MAX_QUEUE:
                    return []
                seen.add(next_key)
                frontier.append((next_state, next_path))
    return []


def _canonicalize_two_by_two_solution(
    payload: ValidateRequest, solution: list[str]
) -> list[str]:
    """Append a cube orientation when 2x2 solving leaves a rotated solution."""
    if payload.order != 2:
        return solution
    start = replay_moves(payload.order, payload.stickers, solution)
    if is_solved_stickers(payload.order, start):
        return solution

    queue: deque[tuple[dict[str, list[int]], tuple[str, ...]]] = deque(
        [(start, ())]
    )
    seen = {_key(start)}
    while queue:
        state, path = queue.popleft()
        for rotation in _CUBE_ROTATIONS:
            next_state = replay_moves(payload.order, state, (rotation,))
            next_path = path + (rotation,)
            if is_solved_stickers(payload.order, next_state):
                return solution + list(next_path)
            next_key = _key(next_state)
            if next_key in seen:
                continue
            seen.add(next_key)
            queue.append((next_state, next_path))
    return solution


def solve(
    payload: ValidateRequest,
    emit: Emit,
    cancelled: Cancelled,
) -> list[str]:
    """Prefer the formal NxNxN backend and retain bounded BFS as a dev fallback."""
    if cancelled():
        return []
    try:
        solution = solve_formal(payload, emit, cancelled)
    except BackendUnavailable:
        fallback_value = os.getenv("CUBE_ALLOW_BOUNDED_FALLBACK", "0").strip().lower()
        allow_fallback = fallback_value not in {"0", "false", "no", "off"}
        if not allow_fallback:
            raise
        emit("searching", {"backend": "bounded-fallback", "limit": _MAX_DEPTH})
        fallback_solution = _bounded_solve(payload, emit, cancelled)
        if cancelled():
            return []
        display_solution = map_solution_to_orientation(
            fallback_solution, payload.front, payload.top
        )
        emit(
            "solution",
            {"moves": display_solution, "backend": "bounded-fallback"},
        )
        return fallback_solution
    solution = _canonicalize_two_by_two_solution(payload, solution)
    if cancelled():
        return []
    display_solution = map_solution_to_orientation(
        solution, payload.front, payload.top
    )
    emit(
        "solution",
        {"moves": display_solution, "backend": "rubikscubennnsolver"},
    )
    return solution
