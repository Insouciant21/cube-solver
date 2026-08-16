/**
 * CubeState / move contract.
 *
 * A CubeState owns:
 *  - order: cube size in [MIN_ORDER, MAX_ORDER]
 *  - stickers: Record keyed exactly by U, D, F, B, L, R; every value is a flat
 *    array of order*order color indices (0..5)
 *  - revision: monotonically increasing counter
 *  - history: previous snapshots (capped at MAX_HISTORY)
 *  - future: snapshots that can be restored with redo
 */

import { applyMove as applyMoveStickers } from './moves';
import type { MoveLike } from './moves';

export type { MoveLike } from './moves';

export function resetCube(state: CubeState): CubeState {
  return {
    order: state.order,
    stickers: solvedStickers(state.order),
    revision: state.revision + 1,
    history: [],
    future: [],
  };
}

export function isSolved(state: CubeState): boolean {
  return FACES.every((face, index) => state.stickers[face].every((color) => color === index));
}

export function validateStoredCubeState(value: unknown): CubeState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const { order } = candidate;
  if (!isValidOrder(order)) {
    return null;
  }
  const { revision } = candidate;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    return null;
  }
  const size = order * order;
  const validStickers = (stickers: unknown): boolean => {
    if (typeof stickers !== 'object' || stickers === null || Array.isArray(stickers)) {
      return false;
    }
    const record = stickers as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== FACES.length || FACES.some((face) => !(face in record))) {
      return false;
    }
    return FACES.every((face) => {
      const faceStickers = record[face];
      return (
        Array.isArray(faceStickers) &&
        faceStickers.length === size &&
        faceStickers.every(
          (color) => typeof color === 'number' && Number.isInteger(color) && color >= 0 && color < 6,
        )
      );
    });
  };
  const validSnapshot = (snapshot: unknown): boolean => {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      return false;
    }
    const record = snapshot as Record<string, unknown>;
    return (
      typeof record.revision === 'number' &&
      Number.isInteger(record.revision) &&
      (record.revision as number) >= 0 &&
      validStickers(record.stickers)
    );
  };
  if (!(
    validStickers(candidate.stickers) &&
    Array.isArray(candidate.history) &&
    candidate.history.every(validSnapshot) &&
    Array.isArray(candidate.future) &&
    candidate.future.every(validSnapshot)
  )) {
    return null;
  }
  return candidate as unknown as CubeState;
}

export const FACES = ['U', 'D', 'F', 'B', 'L', 'R'] as const;

export type Face = (typeof FACES)[number];

export type Sticker = number;

/** Color index of a sticker: U=0, D=1, F=2, B=3, L=4, R=5. */
export enum StickerColor {
  U = 0,
  D = 1,
  F = 2,
  B = 3,
  L = 4,
  R = 5,
}

export type Stickers = Record<Face, Sticker[]>;

export interface CubeSnapshot {
  stickers: Stickers;
  revision: number;
}

export interface CubeState {
  order: number;
  stickers: Stickers;
  revision: number;
  history: CubeSnapshot[];
  future: CubeSnapshot[];
}

export const MIN_ORDER = 2;
export const MAX_ORDER = 7;
export const MAX_HISTORY = 200;

export function isValidOrder(order: unknown): order is number {
  return (
    typeof order === 'number' && Number.isInteger(order) && order >= MIN_ORDER && order <= MAX_ORDER
  );
}

export function solvedStickers(order: number): Stickers {
  const size = order * order;
  const stickers = {} as Stickers;
  FACES.forEach((face, index) => {
    stickers[face] = new Array<Sticker>(size).fill(index);
  });
  return stickers;
}

export function createCubeState(order: number): CubeState {
  const safeOrder = isValidOrder(order) ? order : 3;
  return {
    order: safeOrder,
    stickers: solvedStickers(safeOrder),
    revision: 0,
    history: [],
    future: [],
  };
}

/** Returns a deep copy of the given stickers map. */
export function cloneStickers(stickers: Stickers): Stickers {
  const copy = {} as Stickers;
  FACES.forEach((face) => {
    copy[face] = [...stickers[face]];
  });
  return copy;
}

/** Builds a snapshot of the current stickers plus a new revision number. */
export function snapshotOf(state: Pick<CubeState, 'stickers' | 'revision'>): CubeSnapshot {
  return {
    stickers: cloneStickers(state.stickers),
    revision: state.revision,
  };
}


export function pushHistory(state: CubeState, snapshot: CubeSnapshot): CubeSnapshot[] {
  const history = [...state.history, snapshot];
  return history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history;
}

export function applyMove(state: CubeState, move: MoveLike): CubeState {
  return applyMoveStickers(state, move);
}

export function undo(state: CubeState): CubeState {
  if (state.history.length === 0) {
    return state;
  }
  const previous = state.history[state.history.length - 1];
  return {
    ...state,
    stickers: cloneStickers(previous.stickers),
    revision: state.revision + 1,
    history: state.history.slice(0, -1),
    future: [...state.future, snapshotOf(state)],
  };
}

export function redo(state: CubeState): CubeState {
  if (state.future.length === 0) {
    return state;
  }
  const next = state.future[state.future.length - 1];
  return {
    ...state,
    stickers: cloneStickers(next.stickers),
    revision: state.revision + 1,
    history: pushHistory(state, snapshotOf(state)),
    future: state.future.slice(0, -1),
  };
}
