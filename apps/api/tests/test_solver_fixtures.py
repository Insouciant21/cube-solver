from __future__ import annotations

import os

import pytest

from cube_api.main import ValidateRequest, _run_solver_in_process
from cube_api.replay import is_solved_stickers, replay_moves
from cube_api.solver import solve

FACES = ("U", "D", "F", "B", "L", "R")
pytestmark = pytest.mark.slow


def solved(order: int) -> dict[str, list[int]]:
    return {face: [index] * (order * order) for index, face in enumerate(FACES)}


def test_real_pinned_backend_solves_fixed_single_r_fixture_for_orders_two_to_seven(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if os.environ.get("RUN_REAL_CUBE_FIXTURES") != "1":
        pytest.skip("set RUN_REAL_CUBE_FIXTURES=1 for real NxNxN table-backed fixtures")
    monkeypatch.setenv("CUBE_ALLOW_BOUNDED_FALLBACK", "0")

    for order in range(2, 8):
        start = solved(order)
        scrambled = replay_moves(order, start, ["R"])
        payload = ValidateRequest(
            order=order, revision=order, front="F", top="U", stickers=scrambled
        )
        events: list[tuple[str, dict[str, object]]] = []

        def collect(
            name: str,
            data: dict[str, object],
            *,
            sink: list[tuple[str, dict[str, object]]] = events,
        ) -> None:
            sink.append((name, data))

        solution = solve(payload, collect, lambda: False)

        assert solution
        assert "searching" not in [name for name, _ in events]
        assert is_solved_stickers(order, replay_moves(order, scrambled, solution))


def test_real_four_by_four_fixture_executes_native_ida_graph_helper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if os.environ.get("RUN_REAL_CUBE_FIXTURES") != "1":
        pytest.skip("set RUN_REAL_CUBE_FIXTURES=1 for real NxNxN table-backed fixtures")
    monkeypatch.setenv("CUBE_ALLOW_BOUNDED_FALLBACK", "0")

    order = 4
    start = solved(order)
    scrambled = replay_moves(order, start, ["Rw", "U", "F2"])
    payload = ValidateRequest(
        order=order, revision=40, front="F", top="U", stickers=scrambled
    )
    events: list[tuple[str, dict[str, object]]] = []

    solution = _run_solver_in_process(
        solve,
        payload,
        lambda name, data: events.append((name, data)),
        lambda: False,
    )

    assert solution
    assert "searching" not in [name for name, _ in events]
    assert is_solved_stickers(order, replay_moves(order, scrambled, solution))
