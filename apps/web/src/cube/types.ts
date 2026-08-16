/** Canonical flat numeric cube contracts shared by the web domain helpers. */

import {
  FACES as STATE_FACES,
  MAX_ORDER as STATE_MAX_ORDER,
  MIN_ORDER as STATE_MIN_ORDER,
  isValidOrder as stateIsValidOrder,
} from "./state";
import type {
  CubeSnapshot as StateCubeSnapshot,
  CubeState as StateCubeState,
  Face as StateFace,
  Sticker as StateSticker,
  Stickers as StateStickers,
} from "./state";

export type FaceKey = StateFace;
export type CubeFace = StateFace;
export type CubeColor = string;
export type Move = string;
export type Sequence = readonly Move[] | string;
export type Sticker = StateSticker;
export type Stickers = StateStickers;
export type CubeState = StateCubeState;
export type Cube = StateCubeState;
export type CubeSnapshot = StateCubeSnapshot;

export const FACES = STATE_FACES;
export const MIN_ORDER = STATE_MIN_ORDER;
export const MAX_ORDER = STATE_MAX_ORDER;
export const FACE_INDEX: Record<FaceKey, number> = {
  U: 0,
  D: 1,
  F: 2,
  B: 3,
  L: 4,
  R: 5,
};

export function isFaceKey(value: unknown): value is FaceKey {
  return typeof value === "string" && (FACES as readonly string[]).includes(value);
}

export function isValidOrder(value: unknown): value is number {
  return stateIsValidOrder(value) && value >= STATE_MIN_ORDER && value <= STATE_MAX_ORDER;
}
