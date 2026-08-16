import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { createCubeState } from "./cube/state";

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: undefined,
  });
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the Chinese 3D workbench without the old 2D sticker editor", () => {
    render(<App />);

    expect(screen.queryByRole("heading", { name: "613 魔方求解器" })).not.toBeInTheDocument();
    expect(screen.queryByText("本地验证状态，生成可回放的 NxNxN 还原公式。")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "魔方阶数" })).toHaveValue("3");
    expect(screen.getByRole("img", { name: "3D 魔方编辑器。点击贴纸修改颜色，拖动旋转视角。" })).toBeInTheDocument();
    expect(screen.queryByText("Sticker palette")).not.toBeInTheDocument();
  });

  it("submits a solve job and renders its replay-verified formula", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ job_id: "job-1", revision: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          'event: queued\ndata: {}\n\nevent: completed\ndata: {"moves":["R\'"] ,"verified":true}\n\n',
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "开始求解" }));

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "解法公式" })).toHaveTextContent("R'")
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/solve",
      expect.objectContaining({ method: "POST" }),
    );
    vi.unstubAllGlobals();
  });

  it("switches cube order and keeps color editing in the 3D toolbar", () => {
    render(<App />);

    fireEvent.change(screen.getByRole("combobox", { name: "魔方阶数" }), {
      target: { value: "2" },
    });
    expect(screen.getByRole("combobox", { name: "魔方阶数" })).toHaveValue("2");

    fireEvent.click(screen.getByRole("button", { name: "选择红色" }));

    expect(screen.getByRole("button", { name: "选择红色" })).toHaveAttribute("aria-pressed", "true");
  });

  it("confirms before replacing an edited cube with another order", () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);
    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: "移动记号" }), { target: { value: "R" } });
    fireEvent.click(screen.getByRole("button", { name: "执行移动" }));
    fireEvent.change(screen.getByRole("combobox", { name: "魔方阶数" }), {
      target: { value: "2" },
    });

    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("combobox", { name: "魔方阶数" })).toHaveValue("3");
  });

  it("applies a move and supports undo, redo, and reset", () => {
    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: "移动记号" }), {
      target: { value: "R" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行移动" }));
    expect(screen.getByRole("status")).toHaveTextContent("第 1 次修改");

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("status")).toHaveTextContent("第 2 次修改");

    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getByRole("status")).toHaveTextContent("第 3 次修改");

    fireEvent.click(screen.getByRole("button", { name: "重置魔方" }));
    expect(screen.getByRole("status")).toHaveTextContent("已复原");
  });

  it("randomly scrambles the current cube without filling the single-move input", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "随机打乱魔方" }));

    expect(screen.getByRole("status")).toHaveTextContent(/已随机打乱 \d+ 步/);
    expect(screen.getByRole("textbox", { name: "移动记号" })).toHaveValue("");
  });

  it("validates input through the /api/validate endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, errors: [], revision: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "校验状态" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("校验通过"),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/validate",
      expect.objectContaining({ method: "POST" }),
    );

    vi.unstubAllGlobals();
  });

  it("shows a 3D cube preview", () => {
    render(<App />);

    expect(
      screen.getByRole("img", { name: "3D 魔方编辑器。点击贴纸修改颜色，拖动旋转视角。" }),
    ).toBeInTheDocument();
  });
  it("restores a persisted cube state for the selected order", () => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    });
    const base = createCubeState(3);
    const saved = { ...base, stickers: { ...base.stickers, U: [5, ...base.stickers.U.slice(1)] }, revision: 4 };
    window.localStorage.setItem("613-cube-state-v1-3", JSON.stringify(saved));
    render(<App />);
    expect(screen.getByText(/#4/)).toBeInTheDocument();
    window.localStorage.removeItem("613-cube-state-v1-3");
  });

  it("explains formula moves and supports playback navigation and copy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ job_id: "job-playback", revision: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          'event: completed\ndata: {"moves":["R","U\'"] ,"verified":true}\n\n',
      });
    vi.stubGlobal("fetch", fetchMock);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "开始求解" }));

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "解法公式" })).toHaveTextContent(
        "右层",
      ),
    );
    expect(screen.getByRole("button", { name: "上一步" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放公式" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("button", { name: "第 1 步 R" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    fireEvent.click(screen.getByRole("button", { name: "复制公式" }));
    expect(writeText).toHaveBeenCalledWith("R U'");
    vi.unstubAllGlobals();
  });

  it("cancels a queued solve job through the API", async () => {
    let resolveEvents: (() => void) | undefined;
    const eventsPending = new Promise<string>((resolve) => {
      resolveEvents = () => resolve("");
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ job_id: "job-cancel", revision: 0 }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => eventsPending })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cancelled: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "开始求解" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "取消求解" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消求解" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("求解已取消"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/job-cancel",
      expect.objectContaining({ method: "DELETE" }),
    );
    resolveEvents?.();
    vi.unstubAllGlobals();
  });
});

  it("uses the default front and top orientation for API requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, errors: [], revision: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "校验状态" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ front: "F", top: "U" });
    vi.unstubAllGlobals();
  });

it("replays a formula move into a separate playback state", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ job_id: "job-replay", revision: 0 }),
    })
    .mockResolvedValueOnce({
      ok: true,
      text: async () => 'event: completed\ndata: {"moves":["R"],"verified":true}\n\n',
    });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "开始求解" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "下一步" })).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));

  expect(screen.getByRole("status")).toHaveTextContent("回放第 1/1 步");
  expect(screen.getByRole("button", { name: "第 1 步 R" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  vi.unstubAllGlobals();
});

it("renders validation diagnostics returned by the API", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: false,
      errors: [{ code: "CORNER_ORIENTATION", message: "角块方向总和不合法" }],
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "校验状态" }));

  await waitFor(() =>
    expect(screen.getByRole("region", { name: "校验诊断" })).toHaveTextContent(
      "角块方向总和不合法",
    ),
  );
  vi.unstubAllGlobals();
});

it("does not apply a solve result after the cube revision changes", async () => {
  let resolveEvents: (() => void) | undefined;
  const eventsPending = new Promise<string>((resolve) => {
    resolveEvents = () => resolve('event: completed\ndata: {"moves":["R"],"verified":true}\n\n');
  });
  const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
    if (input === "/api/solve") {
      return Promise.resolve({ ok: true, json: async () => ({ job_id: "job-stale", revision: 0 }) });
    }
    if (input === "/api/jobs/job-stale/events") {
      return Promise.resolve({ ok: true, text: async () => eventsPending });
    }
    if (input === "/api/jobs/job-stale" && init?.method === "DELETE") {
      return Promise.resolve({ ok: true, json: async () => ({ cancelled: true }) });
    }
    return Promise.reject(new Error("unexpected request"));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "开始求解" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "取消求解" })).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "移动记号" }), { target: { value: "R" } });
  fireEvent.click(screen.getByRole("button", { name: "执行移动" }));
  resolveEvents?.();

  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "第 1 步 R" })).not.toBeInTheDocument(),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/jobs/job-stale",
    expect.objectContaining({ method: "DELETE" }),
  );
  vi.unstubAllGlobals();
});

it("cancels a stale job returned after the cube changed", async () => {
  let resolveSolve: ((value: object) => void) | undefined;
  const pendingSolve = new Promise<object>((resolve) => {
    resolveSolve = resolve;
  });
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === "/api/solve") return pendingSolve;
    if (input === "/api/jobs/job-late" && init?.method === "DELETE") {
      return Promise.resolve({ ok: true, json: async () => ({ cancelled: true }) });
    }
    throw new Error(`Unexpected request: ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "开始求解" }));
  fireEvent.change(screen.getByRole("textbox", { name: "移动记号" }), { target: { value: "R" } });
  fireEvent.click(screen.getByRole("button", { name: "执行移动" }));
  resolveSolve?.({
    ok: true,
    json: async () => ({ job_id: "job-late", revision: 0 }),
  });

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/job-late",
      expect.objectContaining({ method: "DELETE" }),
    ),
  );
  expect(fetchMock).not.toHaveBeenCalledWith("/api/jobs/job-late/events");

  vi.unstubAllGlobals();
});
