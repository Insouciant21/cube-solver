/** Move history helpers backed by the canonical flat CubeState. */

import type { CubeState, Move } from "./types";
import { applySequence } from "./moves";
import { createCubeState } from "./state";

export interface MoveHistory {
  moves: Move[];
  index: number;
}

export function createHistory(): MoveHistory {
  return { moves: [], index: 0 };
}

export function pushMove(history: MoveHistory, move: Move | string): MoveHistory {
  const moves = history.moves.slice(0, history.index);
  moves.push(String(move));
  return { moves, index: moves.length };
}

export function canUndo(history: MoveHistory): boolean {
  return history.index > 0;
}

export function canRedo(history: MoveHistory): boolean {
  return history.index < history.moves.length;
}

export function undo(history: MoveHistory): MoveHistory {
  return canUndo(history) ? { moves: history.moves, index: history.index - 1 } : history;
}

export function redo(history: MoveHistory): MoveHistory {
  return canRedo(history) ? { moves: history.moves, index: history.index + 1 } : history;
}

export function stateFromHistory(order: number, history: MoveHistory): CubeState {
  return applySequence(createCubeState(order), history.moves.slice(0, history.index));
}

export function historyToString(history: MoveHistory): string {
  return history.moves.slice(0, history.index).join(" ");
}
