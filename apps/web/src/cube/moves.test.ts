import { describe, expect, it } from "vitest";

import { applyMove, parseMove } from "./moves";
import { createCubeState, isSolved } from "./state";

const orders = [2, 3, 4, 5, 6, 7] as const;

function stickers(state: ReturnType<typeof createCubeState>) {
  return state.stickers;
}

describe.each(orders)("cube moves on order %i", (order) => {
  it("restores the state after four quarter-turns", () => {
    const initial = createCubeState(order);
    const moved = ["R", "R", "R", "R"].reduce(applyMove, initial);

    expect(stickers(moved)).toEqual(stickers(initial));
    expect(moved.revision).toBe(initial.revision + 4);
  });

  it("supports every outer face turn", () => {
    for (const move of ["U", "D", "L", "R", "F", "B"] as const) {
      const initial = createCubeState(order);
      const moved = applyMove(initial, move);

      expect(stickers(moved)).not.toEqual(stickers(initial));
      expect(stickers(applyMove(moved, `${move}'`))).toEqual(stickers(initial));
    }
  });

  it("supports inverse and half turns", () => {
    const initial = createCubeState(order);
    const inverse = applyMove(initial, "R'");
    const half = applyMove(initial, "R2");

    expect(stickers(applyMove(inverse, "R"))).toEqual(stickers(initial));
    expect(stickers(applyMove(half, "R2"))).toEqual(stickers(initial));
  });

  it("supports whole-cube x, y, and z rotations", () => {
    for (const rotation of ["x", "y", "z"] as const) {
      const initial = createCubeState(order);
      const moved = applyMove(initial, rotation);

      expect(stickers(moved)).not.toEqual(stickers(initial));
      expect(stickers(applyMove(moved, `${rotation}'`))).toEqual(stickers(initial));
    }
  });
});

describe.each(orders.filter((order) => order >= 3))(
  "wide moves on order %i",
  (order) => {
    it("supports Rw", () => {
      const initial = createCubeState(order);
      const moved = applyMove(initial, "Rw");

      expect(stickers(moved)).not.toEqual(stickers(initial));
      expect(stickers(applyMove(moved, "Rw'"))).toEqual(stickers(initial));
    });
  },
);

describe.each(orders.filter((order) => order >= 4))(
  "three-layer wide moves on order %i",
  (order) => {
    it("supports 3Rw", () => {
      const initial = createCubeState(order);
      const moved = applyMove(initial, "3Rw");

      expect(stickers(moved)).not.toEqual(stickers(initial));
      expect(stickers(applyMove(moved, "3Rw'"))).toEqual(stickers(initial));
    });
  },
);

it("keeps front turn results aligned with WCA direction", () => {
  const clockwise = applyMove(createCubeState(3), "F");
  const counterClockwise = applyMove(createCubeState(3), "F'");
  const leftColumn = (values: number[]) => values.filter((_, index) => index % 3 === 0);

  expect(leftColumn(clockwise.stickers.R)).toEqual([0, 0, 0]);
  expect(leftColumn(counterClockwise.stickers.R)).toEqual([1, 1, 1]);
});

it("keeps side OLL parity replay aligned with the solver's z rotation", () => {
  const ollParity =
    "2Rw2 R2 U2 2Rw2 R2 U2 2Rw R' U2 2Rw R' U2 " +
    "2Rw' R' U2 B2 U 2Rw' R U' B2 U 2Rw R' U R2";
  let state = createCubeState(4);
  for (const move of `${ollParity} z`.split(" ")) state = applyMove(state, move);
  for (const move of `z' ${ollParity}`.split(" ")) state = applyMove(state, move);

  expect(isSolved(state)).toBe(true);
});


it("rejects impossible wide-layer notation", () => {
  expect(() => parseMove("0Rw")).toThrow();
  expect(() => parseMove("xw")).toThrow();
  expect(() => applyMove(createCubeState(2), "3Rw")).toThrow();
});
