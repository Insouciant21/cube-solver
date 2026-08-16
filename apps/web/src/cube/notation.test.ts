import { describe, expect, it } from "vitest";

import { explainMove } from "./notation";

describe("wide move explanations", () => {
  it("includes the numeric layer width", () => {
    expect(explainMove("3Rw'")).toContain("右侧三层");
  });
});
