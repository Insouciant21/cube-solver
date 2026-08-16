from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

FACE_KEYS: tuple[str, ...] = ("U", "D", "F", "B", "L", "R")
StickerMap = dict[str, list[int]]


@dataclass(frozen=True)
class _Cell:
    pos: tuple[int, int, int]
    face: str
    index: int


def _geometry(
    order: int,
) -> tuple[tuple[_Cell, ...], dict[tuple[int, int, int], _Cell]]:
    half2 = order - 1
    dist2 = order
    cells: list[_Cell] = []
    by_pos: dict[tuple[int, int, int], _Cell] = {}

    def put(face: str, row: int, col: int, pos: tuple[int, int, int]) -> None:
        cell = _Cell(pos, face, row * order + col)
        cells.append(cell)
        by_pos[pos] = cell

    for row in range(order):
        for col in range(order):
            put("U", row, col, (2 * col - half2, dist2, 2 * row - half2))
            put("D", row, col, (2 * col - half2, -dist2, half2 - 2 * row))
            put("F", row, col, (2 * col - half2, half2 - 2 * row, dist2))
            put("B", row, col, (half2 - 2 * col, half2 - 2 * row, -dist2))
            put("L", row, col, (-dist2, half2 - 2 * row, 2 * col - half2))
            put("R", row, col, (dist2, half2 - 2 * row, half2 - 2 * col))
    return tuple(cells), by_pos


def _parse(token: str) -> tuple[str, int, int]:
    if not isinstance(token, str):
        raise ValueError("move must be a string")
    raw = token.strip()
    match = re.fullmatch(
        r"(?P<prefix>\d*)(?P<face>[UDLRFBxyzudlrfb])(?P<wide>w?)(?P<suffix>['′]|2)?",
        raw,
    )
    if match is None:
        raise ValueError(f"invalid move: {raw}")
    face = match.group("face")
    prefix = match.group("prefix")
    wide_marker = match.group("wide")
    suffix = match.group("suffix")
    if face in "xyzXYZ":
        if prefix or wide_marker:
            raise ValueError(f"invalid whole-cube move: {raw}")
        normalized_face = face.lower()
        wide = 0
    else:
        normalized_face = face.upper()
        if wide_marker:
            wide = int(prefix) if prefix else 2
        elif face.islower():
            if prefix:
                raise ValueError(f"numeric prefix requires w: {raw}")
            wide = 2
        elif prefix:
            raise ValueError(f"numeric prefix requires w: {raw}")
        else:
            wide = 1
        if wide < 1:
            raise ValueError(f"invalid move width: {raw}")
    turns = 2 if suffix == "2" else 3 if suffix in {"'", "′"} else 1
    return normalized_face, wide, turns


def _rotate(
    pos: tuple[int, int, int], axis: str, sign: int, turns: int
) -> tuple[int, int, int]:
    x, y, z = pos
    for _ in range(turns):
        if sign == -1:
            if axis == "x":
                y, z = z, -y
            elif axis == "y":
                x, z = -z, x
            else:
                x, y = -y, x
        else:
            if axis == "x":
                y, z = -z, y
            elif axis == "y":
                x, z = z, -x
            else:
                x, y = y, -x
    return x, y, z


def _affected(pos: tuple[int, int, int], face: str, order: int, wide: int) -> bool:
    if face in "xyz":
        return True
    x, y, z = pos
    threshold = order - 2 * wide
    return {
        "U": y > threshold,
        "D": y < -threshold,
        "F": z > threshold,
        "B": z < -threshold,
        "L": x < -threshold,
        "R": x > threshold,
    }[face]


def _apply(stickers: Mapping[str, Sequence[int]], order: int, token: str) -> StickerMap:
    face, wide, turns = _parse(token)
    if face not in "xyz" and wide > order:
        raise ValueError(f"wide layer {wide} exceeds cube order {order}")
    axis, sign = {
        "U": ("y", -1),
        "D": ("y", 1),
        "F": ("z", -1),
        "B": ("z", 1),
        "L": ("x", 1),
        "R": ("x", -1),
        "x": ("x", -1),
        "y": ("y", -1),
        "z": ("z", -1),
    }[face]
    cells, by_pos = _geometry(order)
    source = {name: list(stickers[name]) for name in FACE_KEYS}
    result = {name: values.copy() for name, values in source.items()}
    for cell in cells:
        if not _affected(cell.pos, face, order, wide):
            continue
        target = by_pos.get(_rotate(cell.pos, axis, sign, turns))
        if target is None:
            raise ValueError(f"move mapped a sticker to an invalid position: {token}")
        result[target.face][target.index] = source[cell.face][cell.index]
    return result


def replay_moves(
    order: int,
    stickers: Mapping[str, Sequence[int]],
    moves: Sequence[str],
    cancelled: Callable[[], bool] | None = None,
) -> StickerMap:
    if order < 2 or order > 7:
        raise ValueError("order must be between 2 and 7")
    current: StickerMap = {face: list(stickers[face]) for face in FACE_KEYS}
    for token in moves:
        if cancelled is not None and cancelled():
            break
        current = _apply(current, order, token)
        if cancelled is not None and cancelled():
            break
    return current


def is_solved_stickers(order: int, stickers: Mapping[str, Sequence[int]]) -> bool:
    size = order * order
    return all(
        len(stickers[face]) == size
        and all(color == index for color in stickers[face])
        for index, face in enumerate(FACE_KEYS)
    )
