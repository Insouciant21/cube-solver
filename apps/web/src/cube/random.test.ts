import { describe, expect, it } from "vitest";

import { applySequence } from "./moves";
import { randomScramble, seededRandom } from "./random";
import { createCubeState } from "./state";

function centerSignature(state: ReturnType<typeof createCubeState>): number[] {
  const values: number[] = [];
  for (const face of ["U", "D", "F", "B", "L", "R"] as const) {
    for (let row = 1; row <= 3; row += 1) {
      for (let column = 1; column <= 3; column += 1) {
        values.push(state.stickers[face][row * state.order + column]);
      }
    }
  }
  return values;
}

describe("random scrambles", () => {
  it.each([4, 5, 6, 7])("adds wide turns to %ix%i scrambles", (order) => {
    const moves = randomScramble(order, order * 20, seededRandom(613 + order));

    expect(moves.some((move) => move.includes("w"))).toBe(true);

    const solved = createCubeState(order);
    const scrambled = applySequence(solved, moves);
    expect(centerSignature(scrambled)).not.toEqual(centerSignature(solved));
  });

  it("keeps 3x3 scrambles on outer face turns", () => {
    const moves = randomScramble(3, 20, seededRandom(613));

    expect(moves.every((move) => !move.includes("w"))).toBe(true);
  });
});
