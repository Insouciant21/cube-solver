from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence

from .replay import _Cell, _geometry

FACE_INDEX = {"U": 0, "D": 1, "F": 2, "B": 3, "L": 4, "R": 5}
Error = dict[str, str]


def _cubie_position(position: tuple[int, int, int], order: int) -> tuple[int, int, int]:
    normalized: list[int] = []
    for value in position:
        if abs(value) == order:
            normalized.append(order - 1 if value > 0 else -(order - 1))
        else:
            normalized.append(value)
    return normalized[0], normalized[1], normalized[2]


def _piece_groups(order: int) -> tuple[tuple[_Cell, ...], ...]:
    cells, _ = _geometry(order)
    grouped: defaultdict[tuple[int, int, int], list[_Cell]] = defaultdict(list)
    for cell in cells:
        grouped[_cubie_position(cell.pos, order)].append(cell)
    return tuple(tuple(group) for group in grouped.values())


def _signature(
    group: Sequence[_Cell], stickers: Mapping[str, Sequence[int]]
) -> tuple[int, ...]:
    return tuple(sorted(stickers[cell.face][cell.index] for cell in group))


def _sorted_groups(order: int, size: int) -> tuple[tuple[_Cell, ...], ...]:
    return tuple(
        sorted(
            (group for group in _piece_groups(order) if len(group) == size),
            key=lambda group: group[0].pos,
        )
    )


def _orbit_key(group: Sequence[_Cell]) -> tuple[int, ...]:
    return tuple(sorted(abs(value) for value in group[0].pos))


def _orbit_signatures_match(
    groups: Sequence[Sequence[_Cell]],
    stickers: Mapping[str, Sequence[int]],
    solved: Mapping[str, Sequence[int]],
) -> bool:
    expected: defaultdict[
        tuple[int, ...], Counter[tuple[int, ...]]
    ] = defaultdict(Counter)
    actual: defaultdict[
        tuple[int, ...], Counter[tuple[int, ...]]
    ] = defaultdict(Counter)
    for group in groups:
        orbit = _orbit_key(group)
        expected[orbit][_signature(group, solved)] += 1
        actual[orbit][_signature(group, stickers)] += 1
    return expected == actual


def _permutation_parity(permutation: Sequence[int]) -> int:
    inversions = sum(
        permutation[left] > permutation[right]
        for left in range(len(permutation))
        for right in range(left + 1, len(permutation))
    )
    return inversions % 2


def _solved_stickers(order: int) -> dict[str, list[int]]:
    size = order * order
    return {face: [index] * size for face, index in FACE_INDEX.items()}


def _piece_permutation(
    groups: Sequence[Sequence[_Cell]], stickers: Mapping[str, Sequence[int]],
    solved: Mapping[str, Sequence[int]],
) -> tuple[list[int], dict[tuple[int, ...], int]]:
    identities = {
        _signature(group, solved): index
        for index, group in enumerate(groups)
    }
    permutation = [
        identities.get(_signature(group, stickers), -1) for group in groups
    ]
    return permutation, identities


def _corner_orientation(
    groups: Sequence[Sequence[_Cell]], stickers: Mapping[str, Sequence[int]]
) -> int | None:
    total = 0
    for group in groups:
        ud = next((cell for cell in group if cell.face in "UD"), None)
        if ud is None:
            return None
        side = [cell for cell in group if cell is not ud]
        if ud.pos[1] > 0:
            side.reverse()
        ordered = [ud, *side]
        colors = [stickers[cell.face][cell.index] for cell in ordered]
        ud_index = next(
            (index for index, color in enumerate(colors) if color in (0, 1)),
            None,
        )
        if ud_index is None:
            return None
        total += ud_index
    return total % 3


def _edge_orientation(
    groups: Sequence[Sequence[_Cell]], stickers: Mapping[str, Sequence[int]]
) -> int | None:
    total = 0
    for group in groups:
        reference = next(
            (cell for cell in group if cell.face in "UD"),
            next((cell for cell in group if cell.face in "FB"), None),
        )
        if reference is None:
            return None
        other = next(cell for cell in group if cell is not reference)
        colors = [
            stickers[cell.face][cell.index]
            for cell in (reference, other)
        ]
        reference_colors = (
            (0, 1) if any(cell.face in "UD" for cell in group) else (2, 3)
        )
        index = next(
            (index for index, color in enumerate(colors) if color in reference_colors),
            None,
        )
        if index is None:
            return None
        total += index
    return total % 2


def check_reachability(
    order: int, stickers: Mapping[str, Sequence[int]]
) -> list[Error]:
    """Check deterministic piece combinations, orientations, parity, and centers."""
    errors: list[Error] = []
    corners = _sorted_groups(order, 3)
    solved = _solved_stickers(order)
    expected_corners = Counter(_signature(group, solved) for group in corners)
    actual_corners = Counter(_signature(group, stickers) for group in corners)
    if actual_corners != expected_corners:
        errors.append({"code": "CORNER_DUPLICATE", "message": "角块颜色组合重复或缺失"})
    else:
        corner_orientation = _corner_orientation(corners, stickers)
        if corner_orientation not in (None, 0):
            errors.append(
                {"code": "CORNER_ORIENTATION", "message": "角块方向总和不合法"}
            )

    edges = _sorted_groups(order, 2)
    if edges:
        expected_edges = Counter(_signature(group, solved) for group in edges)
        actual_edges = Counter(_signature(group, stickers) for group in edges)
        if actual_edges != expected_edges:
            errors.append(
                {"code": "EDGE_DUPLICATE", "message": "棱块颜色组合重复或缺失"}
            )
        elif order == 3:
            edge_orientation = _edge_orientation(edges, stickers)
            if edge_orientation not in (None, 0):
                errors.append(
                    {"code": "EDGE_ORIENTATION", "message": "棱块方向总和不合法"}
                )
        if order >= 4 and not _orbit_signatures_match(edges, stickers, solved):
            errors.append(
                {"code": "EDGE_ORBIT", "message": "高阶棱块轨道组合不合法"}
            )

    centers = _sorted_groups(order, 1)
    if centers and not _orbit_signatures_match(centers, stickers, solved):
        errors.append(
            {"code": "CENTER_ORBIT", "message": "高阶中心块轨道组合不合法"}
        )

    if order == 3 and not any(
        error["code"] in {"CORNER_DUPLICATE", "EDGE_DUPLICATE"}
        for error in errors
    ):
        corner_permutation, _ = _piece_permutation(corners, stickers, solved)
        edge_permutation, _ = _piece_permutation(edges, stickers, solved)
        if (
            _permutation_parity(corner_permutation)
            != _permutation_parity(edge_permutation)
        ):
            errors.append(
                {
                    "code": "PERMUTATION_PARITY",
                    "message": "角块与棱块排列奇偶性不一致",
                }
            )

    if order % 2 == 1:
        center = (order * order) // 2
        for face, expected in FACE_INDEX.items():
            if stickers[face][center] != expected:
                errors.append(
                    {
                        "code": "CENTER_MISMATCH",
                        "message": f"面 {face} 的固定中心颜色不匹配",
                    }
                )
    return errors
