from __future__ import annotations

import pytest

from cube_api.reachability import check_reachability

FACES = ("U", "D", "F", "B", "L", "R")


def solved(order: int) -> dict[str, list[int]]:
    return {face: [index] * (order * order) for index, face in enumerate(FACES)}


@pytest.mark.parametrize("order", range(2, 8))
def test_reachability_detects_corner_combinations(order: int) -> None:
    stickers = solved(order)
    stickers["U"][0], stickers["F"][0] = stickers["F"][0], stickers["U"][0]

    errors = check_reachability(order, stickers)

    assert {error["code"] for error in errors} >= {"CORNER_DUPLICATE"}


@pytest.mark.parametrize("order", [3, 5, 7])
def test_reachability_detects_fixed_center_mismatch(order: int) -> None:
    stickers = solved(order)
    center = (order * order) // 2
    (stickers["U"][center], stickers["D"][center]) = (
        stickers["D"][center],
        stickers["U"][center],
    )

    errors = check_reachability(order, stickers)

    assert {error["code"] for error in errors} >= {"CENTER_MISMATCH"}


def _corner_groups(order: int) -> list[list[tuple[str, int]]]:
    from collections import defaultdict

    from cube_api.replay import _geometry

    def normalize(position: tuple[int, int, int]) -> tuple[int, int, int]:
        values = tuple(
            (order - 1 if value > 0 else -(order - 1))
            if abs(value) == order
            else value
            for value in position
        )
        return values[0], values[1], values[2]

    grouped: defaultdict[
        tuple[int, int, int], list[tuple[str, int]]
    ] = defaultdict(list)
    for cell in _geometry(order)[0]:
        grouped[normalize(cell.pos)].append((cell.face, cell.index))
    return [group for group in grouped.values() if len(group) == 3]


def test_reachability_detects_corner_orientation_sum() -> None:
    stickers = solved(3)
    group = _corner_groups(3)[0]
    values = [stickers[face][index] for face, index in group]
    for (face, index), value in zip(group, values[1:] + values[:1], strict=True):
        stickers[face][index] = value

    errors = check_reachability(3, stickers)

    assert {error["code"] for error in errors} >= {"CORNER_ORIENTATION"}


def test_reachability_detects_corner_permutation_parity() -> None:
    stickers = solved(3)
    groups = _corner_groups(3)
    first, second = groups[:2]
    first_values = [stickers[face][index] for face, index in first]
    second_values = [stickers[face][index] for face, index in second]
    for (face, index), value in zip(first, second_values, strict=True):
        stickers[face][index] = value
    for (face, index), value in zip(second, first_values, strict=True):
        stickers[face][index] = value

    errors = check_reachability(3, stickers)

    assert {error["code"] for error in errors} >= {"PERMUTATION_PARITY"}
