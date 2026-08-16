/** Deterministic WCA scramble helpers for the canonical flat CubeState. */

import type { Cube, CubeState, Move } from "./types";
import { applySequence } from "./moves";
import { createCubeState } from "./state";

const FACE_MOVES: readonly string[] = ["U", "D", "F", "B", "R", "L"];
const SUFFIXES: readonly string[] = ["", "2", "'"];

function wideWidth(order: number, rng: () => number): number {
  const maximum = Math.floor(order / 2);
  return 2 + Math.floor(rng() * (maximum - 1));
}

export function randomScramble(order: number, length?: number, rng?: () => number): Move[] {
  const rand = rng ?? Math.random;
  const len = length ?? Math.max(20, order * 20);
  const moves: Move[] = [];
  let previous = "";
  for (let index = 0; index < len; index += 1) {
    let face = FACE_MOVES[Math.floor(rand() * FACE_MOVES.length)];
    while (face === previous) face = FACE_MOVES[Math.floor(rand() * FACE_MOVES.length)];
    previous = face;
    const useWide = order >= 4 && rand() < 0.35;
    const width = useWide ? wideWidth(order, rand) : 1;
    const layer = useWide ? `${width === 2 ? "" : width}${face}w` : face;
    moves.push(layer + SUFFIXES[Math.floor(rand() * SUFFIXES.length)]);
  }
  return moves;
}

export function randomScrambleString(order: number, length?: number, rng?: () => number): string {
  return randomScramble(order, length, rng).join(" ");
}

export function scramble(stateOrOrder: Cube | number, length?: number, rng?: () => number): CubeState {
  const base = typeof stateOrOrder === "number" ? createCubeState(stateOrOrder) : stateOrOrder;
  return applySequence(base, randomScramble(base.order, length, rng));
}

export function scrambleTo(state: Cube, moves: readonly Move[]): CubeState {
  return applySequence(state, moves);
}

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
