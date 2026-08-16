/**
 * Legacy coordinate helpers.
 *
 * Superseded by ./coordinates, which contains the canonical sticker
 * position/layout helpers used by the rest of the web app. This module
 * re-exports the same public API so any older imports keep resolving.
 */
import {
  FACES as COORDINATE_FACES,
  faceNormal as coordinateFaceNormal,
  faceletPosition,
  faceletPositions,
} from './coordinates';
import type { Face as CoordinateFace, Position } from './coordinates';

export * from './coordinates';

export type Vec3 = Position;

export function coordOf(face: CoordinateFace, row: number, col: number, order: number): Vec3 {
  return faceletPosition(order, face, row * order + col);
}

export function faceWithNormal(normal: Vec3): CoordinateFace {
  return (
    COORDINATE_FACES.find((face) => {
      const expected = coordinateFaceNormal(face);
      return expected.x === normal.x && expected.y === normal.y && expected.z === normal.z;
    }) ?? 'U'
  );
}

export function rowColOf(
  position: Vec3,
  normal: Vec3,
  order?: number,
): { face: CoordinateFace; row: number; col: number } {
  const face = COORDINATE_FACES.find((candidate) => {
    const expected = coordinateFaceNormal(candidate);
    return expected.x === normal.x && expected.y === normal.y && expected.z === normal.z;
  });
  if (!face) throw new Error('normal must be a unit cube-face normal');

  const axis = face === 'U' || face === 'D' ? 'y' : face === 'F' || face === 'B' ? 'z' : 'x';
  const inferredOrder = order ?? Math.round(Math.abs(position[axis]) * 2);
  if (!Number.isInteger(inferredOrder) || inferredOrder < 2 || inferredOrder > 7) {
    throw new Error(`unsupported cube order: ${inferredOrder}`);
  }
  const candidates = faceletPositions(inferredOrder, face);
  const epsilon = 1e-9;
  const index = candidates.findIndex(
    (candidate) =>
      Math.abs(candidate.x - position.x) <= epsilon &&
      Math.abs(candidate.y - position.y) <= epsilon &&
      Math.abs(candidate.z - position.z) <= epsilon,
  );
  if (index < 0) throw new Error('position is not a sticker center');
  return {
    face,
    row: Math.floor(index / inferredOrder),
    col: index % inferredOrder,
  };
}
