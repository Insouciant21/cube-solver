/** Sticker coordinates and orientation checks for the canonical flat numeric state. */

import type { Cube, FaceKey } from "./types";
import { FACES } from "./types";
import { coordOf, faceNormal, faceWithNormal, rowColOf } from "./coords";
import type { Vec3 } from "./coords";

export interface OrientedSticker {
  face: FaceKey;
  row: number;
  col: number;
  color: number;
  position: Vec3;
  normal: Vec3;
}

export function orientedStickers(cube: Cube): OrientedSticker[] {
  const out: OrientedSticker[] = [];
  const n = cube.order;
  for (const face of FACES) {
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        out.push({
          face,
          row,
          col,
          color: cube.stickers[face][row * n + col],
          position: coordOf(face, row, col, n),
          normal: faceNormal(face),
        });
      }
    }
  }
  return out;
}

export interface OrientationResult {
  ok: boolean;
  errors: string[];
}

export function checkOrientation(cube: Cube): OrientationResult {
  const errors: string[] = [];
  const n = cube.order;
  for (const face of FACES) {
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        const pos = coordOf(face, row, col, n);
        const normal = faceNormal(face);
        const back = rowColOf(pos, normal, n);
        if (back.face !== face || back.row !== row || back.col !== col) {
          errors.push(`面 ${face} 位置 (${row}, ${col}) 的坐标反查结果不一致`);
        }
        if (faceWithNormal(normal) !== face) {
          errors.push(`面 ${face} 的法向量反查结果不一致`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
