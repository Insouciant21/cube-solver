import { expect, test, type Page } from "@playwright/test";

async function mockApi(page: Page, moves: string[] = ["R", "U'"]): Promise<{
  validateBody: () => Record<string, unknown> | undefined;
}> {
  let validateBody: Record<string, unknown> | undefined;
  await page.route("**/api/validate", async (route) => {
    validateBody = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, errors: [], revision: validateBody.revision ?? 0 }),
    });
  });
  await page.route("**/api/solve", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ job_id: "playwright-job", revision: 0 }),
      status: 202,
    });
  });
  await page.route("**/api/jobs/playwright-job/events", async (route) => {
    await route.fulfill({
      contentType: "text/event-stream",
      body: `event: queued\ndata: {}\n\nevent: completed\ndata: ${JSON.stringify({ moves, verified: true })}\n\n`,
    });
  });
  return { validateBody: () => validateBody };
}

test("desktop inspects the 3D workbench, uses the default frame, and replays formula", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/");

  await expect(page.getByText("613 CODING · 魔方公式工作台")).toBeVisible();
  await page.getByRole("combobox", { name: "魔方阶数" }).click();
  await page.getByRole("option", { name: "7×7" }).click();
  await expect(page.getByTestId("three-cube-canvas")).toBeVisible();
  await expect(page.getByRole("group", { name: "六面快速视角" }).getByRole("button")).toHaveCount(6);
  await page.getByRole("button", { name: "校验状态" }).click();
  await expect(page.getByRole("status")).toContainText("校验通过");

  expect(api.validateBody()).toMatchObject({ order: 7, front: "F", top: "U" });
  await page.getByRole("button", { name: "开始求解" }).click();
  await expect(page.getByRole("region", { name: "解法公式" })).toContainText("右层");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByRole("button", { name: "第 1 步 R" })).toHaveAttribute("aria-current", "step");
});

test("long solution formula stays readable and contained", async ({ page }, testInfo) => {
  const movePattern = ["D2", "Lw2", "Rw2", "U'", "F", "B'", "R2", "Uw2", "Fw2", "Bw2"];
  const moves = Array.from({ length: 55 }, (_, index) => movePattern[index % movePattern.length]);
  await mockApi(page, moves);
  await page.goto("/");
  await page.getByRole("button", { name: "开始求解" }).click();

  const formula = page.getByRole("region", { name: "解法公式" });
  const moveList = page.getByRole("list", { name: "解法步骤" });
  await expect(formula).toContainText("55 步");
  await expect(moveList.getByRole("button")).toHaveCount(55);
  await expect(page.getByRole("combobox", { name: "播放速度" })).toBeVisible();
  const layout = await moveList.evaluate((element) => {
    const firstButton = element.querySelector("button");
    const style = firstButton ? getComputedStyle(firstButton) : null;
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      background: style?.backgroundColor ?? "",
      color: style?.color ?? "",
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.background).toBe("rgb(17, 26, 33)");
  expect(layout.color).toBe("rgb(220, 230, 235)");
  if (testInfo.project.name === "desktop") {
    const panelLayout = await page.evaluate(() => {
      const solution = document.querySelector<HTMLElement>(".solution-panel");
      const control = document.querySelector<HTMLElement>(".control-panel");
      if (!solution || !control) return null;
      const solutionRect = solution.getBoundingClientRect();
      const controlRect = control.getBoundingClientRect();
      return {
        solutionPosition: getComputedStyle(solution).position,
        solutionHeight: solution.getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
        gap: controlRect.top - solutionRect.bottom,
      };
    });
    expect(panelLayout).not.toBeNull();
    expect(panelLayout?.solutionPosition).toBe("static");
    expect(panelLayout?.solutionHeight).toBeLessThanOrEqual(Math.min(790, panelLayout?.viewportHeight ?? 0));
    expect(panelLayout?.gap).toBeGreaterThanOrEqual(0);
    const documentLayout = await page.evaluate(() => ({
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    expect(documentLayout.documentHeight).toBeLessThanOrEqual(documentLayout.viewportHeight + 1);
    await expect.poll(() => moveList.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))).toMatchObject({ overflowY: "hidden" });
    await expect(moveList).toHaveAttribute("data-scrollbar", "perfect");
    await expect(moveList.locator(".ps__rail-y")).toBeVisible();
    const scrollbarGeometry = await moveList.evaluate((element) => {
      const rail = element.querySelector<HTMLElement>(".ps__rail-y");
      const firstButton = element.querySelector<HTMLElement>("button");
      if (!rail || !firstButton) return null;
      const railRect = rail.getBoundingClientRect();
      const buttonRect = firstButton.getBoundingClientRect();
      return { railLeft: railRect.left, buttonRight: buttonRect.right };
    });
    expect(scrollbarGeometry).not.toBeNull();
    expect(scrollbarGeometry?.buttonRight).toBeLessThanOrEqual((scrollbarGeometry?.railLeft ?? 0) - 3);
    for (let index = 0; index < 20; index += 1) {
      await page.getByRole("button", { name: "下一步" }).click();
    }
    await expect(moveList.getByRole("button").nth(19)).toHaveAttribute("aria-current", "step");
    await expect.poll(() => moveList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => moveList.evaluate((element) => {
      const active = element.querySelector<HTMLElement>('[aria-current="step"]');
      if (!active) return false;
      const panelRect = element.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      return activeRect.top >= panelRect.top - 1 && activeRect.bottom <= panelRect.bottom + 1;
    })).toBe(true);
  }
  if (testInfo.project.name === "mobile") {
    const mobilePanelLayout = await formula.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        maxHeight: style.maxHeight,
        overflowY: style.overflowY,
      };
    });
    expect(mobilePanelLayout.maxHeight).not.toBe("none");
    expect(mobilePanelLayout.overflowY).toBe("hidden");
    await expect.poll(() => moveList.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))).toMatchObject({ overflowY: "auto" });
    const documentScrollBeforePlayback = await page.evaluate(() => window.scrollY);
    await page.getByRole("button", { name: "下一步" }).click();
    const documentScrollAfterFirstStep = await page.evaluate(() => window.scrollY);
    for (let index = 1; index < 20; index += 1) {
      await page.getByRole("button", { name: "下一步" }).click();
    }
    expect(documentScrollAfterFirstStep).toBeGreaterThanOrEqual(documentScrollBeforePlayback);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(documentScrollAfterFirstStep);
    await expect.poll(() => moveList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }
  await formula.screenshot({ path: testInfo.outputPath("long-formula.png") });
});

test("mobile keeps the canvas and controls usable", async ({ page }, testInfo) => {
  await mockApi(page);
  await page.goto("/");

  if (testInfo.project.name === "mobile") {
    const mobileLayout = await page.evaluate(() => {
      const cube = document.querySelector<HTMLElement>(".cube-panel")?.getBoundingClientRect();
      const solution = document.querySelector<HTMLElement>(".solution-panel")?.getBoundingClientRect();
      const control = document.querySelector<HTMLElement>(".control-panel")?.getBoundingClientRect();
      if (!cube || !solution || !control) return null;
      return {
        cubeLeft: cube.left,
        solutionLeft: solution.left,
        firstRowBottom: Math.max(cube.bottom, solution.bottom),
        controlTop: control.top,
      };
    });
    expect(mobileLayout).not.toBeNull();
    expect(mobileLayout?.cubeLeft).toBeLessThan(mobileLayout?.solutionLeft ?? 0);
    expect(mobileLayout?.controlTop).toBeGreaterThanOrEqual((mobileLayout?.firstRowBottom ?? 0) - 1);
  }

  const canvas = page.getByTestId("three-cube-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(testInfo.project.name === "mobile" ? 120 : 250);
  expect(box?.height).toBeGreaterThan(180);

  await page.getByRole("combobox", { name: "魔方阶数" }).click();
  await page.getByRole("option", { name: "2×2" }).click();
  await expect(page.getByTestId("three-cube-canvas")).toBeVisible();
  await page.getByRole("button", { name: "选择红色" }).click();
  await expect(page.getByRole("button", { name: "选择红色" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "校验状态" })).toBeVisible();
});

test("3D drag rotates without painting and a click paints", async ({ page }, testInfo) => {
  await mockApi(page);
  await page.goto("/");

  const canvas = page.getByTestId("three-cube-canvas");
  await canvas.screenshot({ path: testInfo.outputPath("cube-canvas.png") });
  const pixels = await canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement;
    source.dispatchEvent(new WheelEvent("wheel", { cancelable: true, deltaY: 0 }));
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    const context = copy.getContext("2d");
    context?.drawImage(source, 0, 0);
    const data = context?.getImageData(0, 0, copy.width, copy.height).data ?? [];
    let visible = 0;
    let white = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (red + green + blue > 30) visible += 1;
      if (red > 170 && green > 170 && blue > 170) white += 1;
    }
    return { visible, white };
  });
  expect(pixels.visible).toBeGreaterThan(5_000);
  expect(pixels.white).toBeGreaterThan(500);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y);
  await page.mouse.move(x + 4, y);
  await page.mouse.up();
  await expect(page.getByRole("status")).toContainText("第 0 次修改");
  const rotatedView = await canvas.getAttribute("data-view-transform");
  expect(rotatedView).not.toBeNull();

  await page.getByRole("button", { name: "选择红色" }).click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByRole("status")).toContainText("第 1 次修改");
  await expect(canvas).toHaveAttribute("data-view-transform", rotatedView ?? "");

  await page.getByRole("button", { name: "适应窗口" }).click();
  await expect(canvas).toHaveAttribute("data-view-distance", "5.200");
  await page.getByRole("button", { name: "重置视角" }).click();
  await expect(canvas).toHaveAttribute("data-view-transform", "-0.180,0.550,6.600");

  for (const face of ["F", "B", "U", "D", "L", "R"]) {
    await page.getByRole("button", { name: `查看 ${face} 面` }).click();
    await expect(canvas).toHaveAttribute("data-view-faces", new RegExp(`^${face},`));
  }
});
