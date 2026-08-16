/** Structural and deterministic reachability validation for the flat state model. */

import { isSolved } from "./state";
import type { Cube } from "./types";
import { FACE_INDEX, FACES, MAX_ORDER, MIN_ORDER } from "./types";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const COLOR_NAMES = ["U", "D", "F", "B", "L", "R"] as const;

function describeColor(color: unknown): string {
  if (typeof color === "number" && Number.isInteger(color) && color >= 0 && color < COLOR_NAMES.length) {
    return COLOR_NAMES[color];
  }
  return JSON.stringify(color);
}

/** Structural validation: order, face shape, color domain, and exact counts. */
export function validateCubeState(cube: unknown): ValidationResult {
  const errors: string[] = [];
  if (cube === null || typeof cube !== "object" || Array.isArray(cube)) {
    return { ok: false, errors: ["魔方状态必须是对象"] };
  }
  const candidate = cube as { order?: unknown; revision?: unknown; stickers?: unknown };
  const order = candidate.order;
  const numericOrder = typeof order === "number" && Number.isInteger(order) ? order : null;
  if (numericOrder === null) {
    errors.push("魔方阶数必须是整数");
  } else if (numericOrder < MIN_ORDER || numericOrder > MAX_ORDER) {
    errors.push(`不支持的阶数：${numericOrder}（仅支持 ${MIN_ORDER}–${MAX_ORDER}）`);
  }
  if (!Number.isInteger(candidate.revision) || (candidate.revision as number) < 0) {
    errors.push("修订号必须是非负整数");
  }
  if (numericOrder === null || numericOrder < MIN_ORDER || numericOrder > MAX_ORDER) {
    return { ok: errors.length === 0, errors };
  }
  const size = numericOrder * numericOrder;
  const rawStickers = candidate.stickers;
  if (rawStickers === null || typeof rawStickers !== "object" || Array.isArray(rawStickers)) {
    errors.push("魔方状态缺少贴纸面集合");
    return { ok: false, errors };
  }
  const stickers = rawStickers as Record<string, unknown>;
  const keys = Object.keys(stickers);
  if (keys.length !== FACES.length || FACES.some((face) => !(face in stickers))) {
    errors.push("贴纸面集合必须恰好包含 U、D、F、B、L、R");
  }
  const colors: number[] = [];
  for (const face of FACES) {
    const faceStickers = stickers[face];
    if (!Array.isArray(faceStickers)) {
      errors.push(`面 ${face} 缺少贴纸数组`);
      continue;
    }
    if (faceStickers.length !== size) {
      errors.push(`面 ${face} 应有 ${size} 个贴纸，实际为 ${faceStickers.length} 个`);
      continue;
    }
    faceStickers.forEach((color, index) => {
      if (typeof color !== "number" || !Number.isInteger(color) || color < 0 || color >= FACES.length) {
        errors.push(`面 ${face} 位置 ${index} 的贴纸颜色无效：${describeColor(color)}`);
      } else {
        colors.push(color);
      }
    });
  }
  for (let color = 0; color < FACES.length; color += 1) {
    const count = colors.filter((value) => value === color).length;
    if (count !== size) {
      errors.push(`颜色 ${COLOR_NAMES[color]} 应有 ${size} 个，实际为 ${count} 个`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidCubeState(cube: unknown): void {
  const result = validateCubeState(cube);
  if (!result.ok) {
    throw new Error(`魔方状态无效：\n${result.errors.map((error) => `  - ${error}`).join("\n")}`);
  }
}

/** Fixed centers are immovable on odd-order cubes; formal backend checks the remaining piece constraints. */
export function checkReachability(cube: Cube): ValidationResult {
  const structural = validateCubeState(cube);
  if (!structural.ok) return structural;
  const errors: string[] = [];
  if (cube.order % 2 === 1) {
    const center = Math.floor(cube.order / 2) * cube.order + Math.floor(cube.order / 2);
    for (const face of FACES) {
      const color = cube.stickers[face][center];
      const expected = FACE_INDEX[face];
      if (color !== expected) {
        errors.push(
          `阶数 ${cube.order} 的魔方中心块固定不动：面 ${face} 的中心应为 ${COLOR_NAMES[expected]}，实际为 ${describeColor(color)}`,
        );
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateCube(cube: Cube): ValidationResult {
  return checkReachability(cube);
}

export function isSolvedCube(cube: Cube): boolean {
  return isSolved(cube);
}
