from __future__ import annotations

import pytest

from cube_api.replay import is_solved_stickers, replay_moves

FACES = ("U", "D", "F", "B", "L", "R")


def solved(order: int) -> dict[str, list[int]]:
    return {face: [index] * (order * order) for index, face in enumerate(FACES)}


@pytest.mark.parametrize("move", ["Rw", "3Rw", "Uw2", "3Fw'"])
def test_replay_supports_wca_wide_moves(move: str) -> None:
    order = 4
    state = solved(order)
    scrambled = replay_moves(order, state, [move])
    inverse = (
        move
        if move.endswith("2")
        else move[:-1]
        if move.endswith("'")
        else f"{move}'"
    )

    assert is_solved_stickers(order, replay_moves(order, scrambled, [inverse]))


@pytest.mark.parametrize("move", ["x", "y'", "z2"])
def test_replay_supports_whole_cube_rotations(move: str) -> None:
    order = 3
    state = solved(order)
    scrambled = replay_moves(order, state, [move])
    inverse = (
        move
        if move.endswith("2")
        else move[:-1]
        if move.endswith("'")
        else f"{move}'"
    )

    assert is_solved_stickers(order, replay_moves(order, scrambled, [inverse]))


def test_replay_keeps_front_turn_results_aligned_with_wca_direction() -> None:
    solved_state = solved(3)
    clockwise = replay_moves(3, solved_state, ["F"])
    counter_clockwise = replay_moves(3, solved_state, ["F'"])

    assert [clockwise["R"][index] for index in (0, 3, 6)] == [0, 0, 0]
    assert [counter_clockwise["R"][index] for index in (0, 3, 6)] == [1, 1, 1]


def test_replay_rejects_wide_layer_beyond_order() -> None:
    with pytest.raises(ValueError):
        replay_moves(2, solved(2), ["3Rw"])
