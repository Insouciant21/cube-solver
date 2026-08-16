import { describe, expect, it } from "vitest";

import { checkOrientation, orientedStickers } from "./orientation";
import { checkReachability, validateCubeState } from "./validation";
import { createCubeState } from "./state";

describe("flat numeric state contracts", () => {
  it.each([2, 3, 7])("accepts a solved order-%i state", (order) => {
    const state = createCubeState(order);
    expect(validateCubeState(state).ok).toBe(true);
    expect(checkReachability(state).ok).toBe(true);
    expect(orientedStickers(state)).toHaveLength(6 * order * order);
    expect(orientedStickers(state)[0]?.color).toBe(0);
    expect(checkOrientation(state).ok).toBe(true);
  });

  it("reports a fixed center mismatch on an odd-order state", () => {
    const state = createCubeState(3);
    [state.stickers.U[4], state.stickers.D[4]] = [state.stickers.D[4], state.stickers.U[4]];
    expect(checkReachability(state)).toEqual({
      ok: false,
      errors: [
        "阶数 3 的魔方中心块固定不动：面 U 的中心应为 U，实际为 D",
        "阶数 3 的魔方中心块固定不动：面 D 的中心应为 D，实际为 U",
      ],
    });
  });
});
