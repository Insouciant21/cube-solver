import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CssBaseline,
  FormControl,
  InputLabel,
  Paper,
  Select,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
  useMediaQuery,
} from "@mui/material";
import PerfectScrollbar from "perfect-scrollbar";
import CubeViewport, { type CubeAnimation } from "./CubeViewport";
import {
  MAX_HISTORY,
  applyMove,
  createCubeState,
  isSolved,
  redo,
  resetCube,
  snapshotOf,
  undo,
  validateStoredCubeState,
  type CubeState,
  type Face,
} from "./cube/state";
import { applyMoves, parseMove } from "./cube/moves";
import { explainMove } from "./cube/notation";
import { randomScrambleString } from "./cube/random";
import {
  DEFAULT_VIEW_TRANSFORM,
  STICKER_COLORS,
  facingFaces,
  type ViewFacing,
} from "./cube/viewport";
import "./cube/moves";
import "perfect-scrollbar/css/perfect-scrollbar.css";
import "./index.css";

const theme = createTheme({
  breakpoints: {
    values: { xs: 0, sm: 600, md: 1051, lg: 1280, xl: 1920 },
  },
  palette: {
    mode: "dark",
    primary: { main: "#8cc8c4", light: "#b6e3dc", dark: "#4f9b94", contrastText: "#071014" },
    background: { default: "#0b1116", paper: "#111a21" },
    text: { primary: "#edf2f5", secondary: "#91a4ae" },
    divider: "#22313b",
    warning: { main: "#e4b878" },
  },
  typography: {
    fontFamily: 'Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif',
    h2: { fontSize: "1.06rem", fontWeight: 700, letterSpacing: "-.01em" },
    h3: { fontSize: ".93rem", fontWeight: 700 },
    body2: { lineHeight: 1.5 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { minWidth: 320, backgroundColor: "#0b1116" },
        body: { minWidth: 320, minHeight: "100vh", backgroundColor: "#0b1116" },
        "#root": { minHeight: "100vh" },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: "none", border: "1px solid #22313b" },
      },
    },
    MuiButton: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: {
          minHeight: 42,
          borderRadius: 8,
          borderColor: "#3b5361",
          color: "#dce6eb",
          fontWeight: 650,
          textTransform: "none",
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: "#0e171e",
          "& .MuiOutlinedInput-notchedOutline": { borderColor: "#2b3b47" },
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#5c7b89" },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#66d9c1" },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: { root: { color: "#91a4ae", "&.Mui-focused": { color: "#8cc8c4" } } },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 99, fontWeight: 650 },
      },
    },
  },
});

const ORDERS = [2, 3, 4, 5, 6, 7] as const;
const COLORS = ["白", "黄", "绿", "蓝", "橙", "红"] as const;
const FACE_LABELS: Record<Face, string> = {
  U: "U（上）",
  D: "D（下）",
  F: "F（前）",
  B: "B（后）",
  L: "L（左）",
  R: "R（右）",
};
const STORAGE_KEY = "613-cube-state-v1-3";
const DEFAULT_FRONT: Face = "F";
const DEFAULT_TOP: Face = "U";
type SolveStatus = "idle" | "queued" | "running" | "downloading" | "reducing" | "solving" | "searching" | "verifying" | "completed" | "failed" | "cancelled";
type SolveEvent = { name: string; data: Record<string, unknown> };
type ValidationError = { code?: unknown; message?: unknown };

const STATUS_LABELS: Record<SolveStatus, string> = {
  idle: "待命",
  queued: "排队中",
  running: "准备中",
  downloading: "下载查表",
  reducing: "降阶处理中",
  solving: "求解中",
  searching: "开发后备搜索",
  verifying: "回放校验中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function faceLabel(face: Face): string {
  return `${FACE_LABELS[face]}面`;
}

function readStoredCube(key: string): CubeState | null {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage?.getItem(key);
    if (!raw) return null;
    return validateStoredCubeState(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function stateKey(order: number): string {
  return `${STORAGE_KEY}-${order}`;
}

function loadCubeForOrder(order: number): CubeState | null {
  return readStoredCube(stateKey(order));
}

function loadCube(): CubeState {
  const legacy = readStoredCube(STORAGE_KEY);
  if (legacy) return legacy;
  try {
    const active = Number(window.localStorage?.getItem(`${STORAGE_KEY}-active`));
    if (Number.isInteger(active) && active >= 2 && active <= 7) {
      const stored = loadCubeForOrder(active);
      if (stored) return stored;
    }
  } catch {
    // Ignore unavailable local storage.
  }
  for (const order of [3, 2, 4, 5, 6, 7]) {
    const stored = loadCubeForOrder(order);
    if (stored) return stored;
  }
  return createCubeState(3);
}

function parseEvents(text: string): SolveEvent[] {
  return text
    .split("\n\n")
    .map((block) => {
      const name = block.match(/^event: (.+)$/m)?.[1];
      const raw = block.match(/^data: (.+)$/m)?.[1];
      if (!name || !raw) return null;
      try {
        return { name, data: JSON.parse(raw) as Record<string, unknown> };
      } catch {
        return null;
      }
    })
    .filter((event): event is SolveEvent => event !== null);
}

async function readSolveEvents(response: Response, onEvent: (event: SolveEvent) => void): Promise<SolveEvent[]> {
  if (!response.body || typeof response.body.getReader !== "function") {
    const events = parseEvents(await response.text());
    events.forEach(onEvent);
    return events;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: SolveEvent[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = parseEvents(`${block}\n\n`)[0];
        if (!event) continue;
        events.push(event);
        onEvent(event);
        if (["completed", "failed", "cancelled"].includes(event.name)) return events;
      }
    }
    buffer += decoder.decode();
    const event = parseEvents(`${buffer}\n\n`)[0];
    if (event) {
      events.push(event);
      onEvent(event);
    }
    return events;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function inverseMove(move: string): string {
  try {
    const parsed = parseMove(move);
    const face = parsed.face;
    const wide = parsed.wide > 1 ? `${parsed.wide}w` : "";
    const suffix = parsed.amount === 2 ? "2" : parsed.amount === 1 ? "'" : "";
    return `${face}${wide}${suffix}`;
  } catch {
    return move.endsWith("'") ? move.slice(0, -1) : `${move}'`;
  }
}

export default function App() {
  const [cube, setCube] = useState<CubeState>(loadCube);
  const [order, setOrder] = useState(() => cube.order);
  const [selectedColor, setSelectedColor] = useState(0);
  const [viewFacing, setViewFacing] = useState<ViewFacing>(() => facingFaces(DEFAULT_VIEW_TRANSFORM));
  const [move, setMove] = useState("");
  const [message, setMessage] = useState("已复原 · 第 0 次修改");
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [validating, setValidating] = useState(false);
  const [solveStatus, setSolveStatus] = useState<SolveStatus>("idle");
  const [progress, setProgress] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [formula, setFormula] = useState<string[]>([]);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [playbackState, setPlaybackState] = useState<CubeState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(700);
  const [playbackAnimation, setPlaybackAnimation] = useState<CubeAnimation | null>(null);
  const formulaScrollbarEnabled = useMediaQuery(theme.breakpoints.up("sm"), { noSsr: true });
  const cancelledJobIds = useRef(new Set<string>());
  const activeJobRef = useRef<string | null>(null);
  const currentRevisionRef = useRef(cube.revision);
  const solveGenerationRef = useRef(0);
  const playbackBaseRef = useRef<CubeState | null>(null);
  const playbackIndexRef = useRef(-1);
  const animationKeyRef = useRef(0);
  const formulaStepRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const formulaListRef = useRef<HTMLOListElement | null>(null);
  const perfectScrollbarRef = useRef<PerfectScrollbar | null>(null);

  useEffect(() => {
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cube));
      window.localStorage?.setItem(stateKey(cube.order), JSON.stringify(cube));
      window.localStorage?.setItem(`${STORAGE_KEY}-active`, String(cube.order));
    } catch {
      // Ignore unavailable local storage.
    }
  }, [cube]);

  useEffect(() => {
    const list = formulaListRef.current;
    const previousScrollbar = perfectScrollbarRef.current;
    if (previousScrollbar) {
      previousScrollbar.destroy();
      perfectScrollbarRef.current = null;
    }
    if (!list || !formula.length || !formulaScrollbarEnabled) return undefined;

    const scrollbar = new PerfectScrollbar(list, {
      suppressScrollX: true,
      wheelPropagation: false,
      minScrollbarLength: 24,
      scrollingThreshold: 800,
    });
    perfectScrollbarRef.current = scrollbar;
    scrollbar.update();
    return () => {
      scrollbar.destroy();
      if (perfectScrollbarRef.current === scrollbar) perfectScrollbarRef.current = null;
    };
  }, [formula.length, formulaScrollbarEnabled]);

  useEffect(() => {
    if (playbackIndex < 0) return;
    const list = formulaListRef.current;
    const step = formulaStepRefs.current[playbackIndex];
    if (!list || !step) return;
    if (list.scrollHeight > list.clientHeight) {
      const listRect = list.getBoundingClientRect();
      const stepRect = step.getBoundingClientRect();
      const delta = stepRect.top < listRect.top
        ? stepRect.top - listRect.top
        : stepRect.bottom > listRect.bottom
          ? stepRect.bottom - listRect.bottom
          : 0;
      if (delta && typeof list.scrollBy === "function") {
        list.scrollBy({ top: delta, behavior: "auto" });
        perfectScrollbarRef.current?.update();
      }
      return;
    }
    step.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    perfectScrollbarRef.current?.update();
  }, [playbackIndex]);

  const setPlaybackStep = useCallback((nextIndex: number, animate = true) => {
    const bounded = formula.length === 0 ? -1 : Math.max(-1, Math.min(formula.length - 1, nextIndex));
    const previous = playbackIndexRef.current;
    const adjacent = Math.abs(bounded - previous) === 1;
    if (animate && adjacent) {
      const token = bounded > previous ? formula[bounded] : previous >= 0 ? inverseMove(formula[previous]) : undefined;
      if (token) setPlaybackAnimation({ move: token, key: ++animationKeyRef.current });
    } else if (!animate || bounded === previous) {
      setPlaybackAnimation(null);
    }
    playbackIndexRef.current = bounded;
    setPlaybackIndex(bounded);
    const base = playbackBaseRef.current;
    if (bounded < 0 || !base) {
      setPlaybackState(null);
      if (formula.length && bounded < 0) setMessage(`解法已准备 · 共 ${formula.length} 步`);
      return;
    }
    let current = base;
    for (let index = 0; index <= bounded; index += 1) current = applyMove(current, formula[index]);
    setPlaybackState(current);
    setMessage(`回放第 ${bounded + 1}/${formula.length} 步 · ${formula[bounded]}`);
  }, [formula]);

  useEffect(() => {
    if (!playing || !formula.length || playbackIndex >= formula.length - 1) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      if (playbackIndexRef.current >= formula.length - 1) setPlaying(false);
      else setPlaybackStep(playbackIndexRef.current + 1);
    }, speed);
    return () => window.clearTimeout(timer);
  }, [formula.length, playbackIndex, playing, setPlaybackStep, speed]);

  const invalidateActiveSolve = () => {
    solveGenerationRef.current += 1;
    const active = activeJobRef.current;
    if (active) {
      cancelledJobIds.current.add(active);
      void fetch(`/api/jobs/${active}`, { method: "DELETE" }).catch(() => undefined);
    }
    activeJobRef.current = null;
    setJobId(null);
    setSolveStatus("idle");
    setProgress("");
    setFormula([]);
    setPlaying(false);
    playbackIndexRef.current = -1;
    setPlaybackStep(-1, false);
    setPlaybackAnimation(null);
    playbackBaseRef.current = null;
    setDiagnostics([]);
  };

  const announce = (next: CubeState, label: string, animationMove?: string) => {
    invalidateActiveSolve();
    currentRevisionRef.current = next.revision;
    setCube(next);
    if (animationMove) setPlaybackAnimation({ move: animationMove, key: ++animationKeyRef.current });
    setMessage(`${label} · 第 ${next.revision} 次修改`);
  };

  const changeOrder = (value: string) => {
    const nextOrder = Number(value);
    if (!Number.isInteger(nextOrder) || nextOrder < 2 || nextOrder > 7) return;
    if (!isSolved(cube) && !window.confirm("切换阶数会替换当前魔方，是否继续？")) return;
    const saved = loadCubeForOrder(nextOrder);
    setOrder(nextOrder);
    announce(saved ?? createCubeState(nextOrder), `新建 ${nextOrder}×${nextOrder} 魔方`);
  };

  const paintSticker = (face: Face, position: number) => {
    const stickers: CubeState["stickers"] = { ...cube.stickers, [face]: [...cube.stickers[face]] };
    stickers[face][position] = selectedColor;
    announce(
      {
        ...cube,
        stickers,
        revision: cube.revision + 1,
        history: [...cube.history, snapshotOf(cube)].slice(-MAX_HISTORY),
        future: [],
      },
      `${face} 面贴纸已更新`,
    );
  };

  const applyNotation = () => {
    if (!move.trim()) return;
    try {
      const notation = move.trim();
      announce(applyMove(cube, notation), `已执行 ${notation}`, notation);
      setMove("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移动记号无效");
    }
  };

  const randomize = () => {
    const notation = randomScrambleString(cube.order);
    const randomized = applyMoves(cube, notation);
    const moveCount = notation.split(/\s+/).filter(Boolean).length;
    announce(
      {
        ...randomized,
        revision: cube.revision + 1,
        history: [...cube.history, snapshotOf(cube)].slice(-MAX_HISTORY),
        future: [],
      },
      `已随机打乱 ${moveCount} 步`,
    );
  };

  const undoMove = () => announce(undo(cube), "已撤销");
  const redoMove = () => announce(redo(cube), "已重做");
  const reset = () => announce(resetCube(cube), "已复原");
  const copyFormula = async () => {
    try {
      await navigator.clipboard?.writeText(formula.join(" "));
      setMessage("公式已复制");
    } catch {
      setMessage("公式已准备好，可手动复制");
    }
  };
  const apiPayload = () => ({ order: cube.order, front: DEFAULT_FRONT, top: DEFAULT_TOP, stickers: cube.stickers, revision: cube.revision });

  const validateInput = async () => {
    setValidating(true);
    try {
      const response = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload()),
      });
      const result = (await response.json()) as { ok?: boolean; errors?: ValidationError[] };
      const nextDiagnostics = (result.errors ?? []).map(
        (error) => `${String(error.code ?? "VALIDATION")}: ${String(error.message ?? "状态无效")}`,
      );
      setDiagnostics(nextDiagnostics);
      setMessage(result.ok ? `校验通过 · 第 ${cube.revision} 次修改` : "校验未通过");
    } catch {
      setDiagnostics(["VALIDATION_REQUEST: 校验请求失败"]);
      setMessage("校验请求失败");
    } finally {
      setValidating(false);
    }
  };

  const solve = async () => {
    invalidateActiveSolve();
    const requestedGeneration = solveGenerationRef.current;
    const requestedRevision = currentRevisionRef.current;
    setSolveStatus("queued");
    setProgress("已排队");
    let id = "";
    const handleEvent = (event: SolveEvent) => {
      if (requestedGeneration !== solveGenerationRef.current || requestedRevision !== currentRevisionRef.current || cancelledJobIds.current.has(id)) return;
      const phase = event.name;
      const label = STATUS_LABELS[phase as SolveStatus];
      if (!label) return;
      setSolveStatus(phase as SolveStatus);
      const bytes = typeof event.data.bytes === "number" && typeof event.data.total_bytes === "number"
        ? ` · ${event.data.bytes}/${event.data.total_bytes} 字节`
        : "";
      setProgress(`${label}${bytes}`);
      setMessage(`${label}${bytes}`);
    };
    try {
      const response = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload()),
      });
      if (!response.ok) throw new Error("求解任务提交失败");
      const data = (await response.json()) as { job_id?: unknown; revision?: unknown };
      id = typeof data.job_id === "string" ? data.job_id : "";
      if (!id) throw new Error("求解任务缺少编号");
      if (requestedGeneration !== solveGenerationRef.current || requestedRevision !== currentRevisionRef.current) {
        cancelledJobIds.current.add(id);
        await fetch(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      activeJobRef.current = id;
      setJobId(id);
      setSolveStatus("running");
      const stream = await fetch(`/api/jobs/${id}/events`);
      if (!stream.ok) throw new Error("无法读取求解进度");
      const events = await readSolveEvents(stream, handleEvent);
      if (cancelledJobIds.current.has(id) || requestedGeneration !== solveGenerationRef.current || requestedRevision !== currentRevisionRef.current) return;
      const completed = events.find((event) => event.name === "completed");
      const failed = events.find((event) => event.name === "failed");
      if (completed) {
        const completedRevision = completed.data.revision;
        if (typeof completedRevision === "number" && completedRevision !== requestedRevision) return;
        const moves = Array.isArray(completed.data.moves)
          ? completed.data.moves.filter((item): item is string => typeof item === "string")
          : [];
        playbackBaseRef.current = cube;
        playbackIndexRef.current = -1;
        setFormula(moves);
        setPlaybackIndex(-1);
        setPlaybackState(null);
        setPlaybackAnimation(null);
        setSolveStatus("completed");
        setProgress(`已完成 · 共 ${moves.length} 步`);
        setMessage(`解法已生成 · 共 ${moves.length} 步`);
      } else {
        setSolveStatus("failed");
        setProgress("求解失败");
        setMessage(String(failed?.data.message ?? "求解失败"));
      }
    } catch (error) {
      if (cancelledJobIds.current.has(id) || requestedGeneration !== solveGenerationRef.current || requestedRevision !== currentRevisionRef.current) return;
      setSolveStatus("failed");
      setProgress("求解失败");
      setMessage(error instanceof Error ? error.message : "求解失败");
    }
  };

  const cancelSolve = async () => {
    const id = activeJobRef.current ?? jobId;
    if (!id) return;
    cancelledJobIds.current.add(id);
    activeJobRef.current = null;
    setSolveStatus("cancelled");
    setProgress("已取消");
    setMessage("求解已取消");
    try {
      await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    } catch {
      setMessage("取消请求失败");
    }
  };

  const visibleCube = playbackState ?? cube;
  const isBusy = solveStatus !== "idle" && solveStatus !== "completed" && solveStatus !== "failed" && solveStatus !== "cancelled";
  const handleViewChange = useCallback((nextFacing: ViewFacing) => setViewFacing(nextFacing), []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        component="main"
        className={`app-shell${formula.length ? " has-formula" : ""}`}
        sx={{
          width: "min(1560px, 100%)",
          mx: "auto",
          px: { xs: 1.5, sm: "clamp(14px, 4vw, 58px)" },
          pt: { xs: 2.375, sm: 3.5 },
          pb: { xs: 3.75, sm: 5.25 },
          ...(formula.length > 0 && {
            [theme.breakpoints.up("md")]: {
              display: "flex",
              minHeight: 0,
              height: "100vh",
              flexDirection: "column",
              overflow: "hidden",
            },
          }),
        }}
      >
        <Box
          component="header"
          className="topbar"
          sx={{
            display: "flex",
            alignItems: { xs: "stretch", sm: "flex-end" },
            flexDirection: { xs: "column", sm: "row" },
            gap: { xs: 0, sm: 3.5 },
            pb: 0.875,
          }}
        >
          <Typography
            component="p"
            className="eyebrow"
            variant="overline"
            sx={{
              display: "block",
              mb: 1,
              color: "#7893a2",
              fontSize: ".67rem",
              fontWeight: 750,
              letterSpacing: ".14em",
              lineHeight: 1.5,
            }}
          >
            613 CODING · 魔方公式工作台
          </Typography>
        </Box>

        <Box
          className="status-line"
          role="status"
          aria-live="polite"
          sx={{
            display: "flex",
            alignItems: { xs: "flex-start", sm: "center" },
            flexWrap: "wrap",
            gap: 1.125,
            minHeight: 34,
            mt: 0.5,
            mb: 0.5,
            color: "primary.main",
            fontSize: ".83rem",
          }}
        >
          <Box
            aria-hidden="true"
            sx={{
              width: 8,
              height: 8,
              flex: "0 0 auto",
              mt: { xs: 0.7, sm: 0 },
              borderRadius: "50%",
              bgcolor: "primary.main",
              boxShadow: "0 0 12px rgb(140 200 196 / 76%)",
            }}
          />
          <Typography component="span" sx={{ color: "inherit", fontSize: "inherit" }}>{message}</Typography>
          {progress && progress !== message && <Typography component="span" sx={{ color: "inherit", fontSize: "inherit" }}>· {progress}</Typography>}
          {jobId && <Typography component="span" className="job-id" sx={{ color: "#6f8490", fontSize: "inherit", fontVariantNumeric: "tabular-nums" }}>任务 {jobId}</Typography>}
          <Box
            className="status-actions"
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: { xs: "flex-start", sm: "flex-end" },
              gap: 1.125,
              ml: { xs: 0, sm: "auto" },
              flex: { xs: "1 0 100%", sm: "0 1 auto" },
            }}
          >
            <FormControl size="small" sx={{ minWidth: { xs: 112, sm: 124 } }}>
              <InputLabel id="order-select-label">魔方阶数</InputLabel>
              <Select
                native
                labelId="order-select-label"
                id="order-select"
                label="魔方阶数"
                aria-label="魔方阶数"
                value={order}
                onChange={(event) => changeOrder(String(event.target.value))}
              >
                {ORDERS.map((value) => <option key={value} value={value}>{value}×{value}</option>)}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              color="primary"
              type="button"
              onClick={solve}
              disabled={isBusy}
              sx={{ color: "primary.contrastText", fontWeight: 760 }}
            >
              {isBusy ? "求解中…" : "开始求解"}
            </Button>
            {jobId && isBusy && <Button type="button" onClick={cancelSolve}>取消求解</Button>}
          </Box>
        </Box>

        <Box
          className={`workbench${formula.length ? " has-formula" : ""}`}
          sx={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            alignItems: "start",
            gap: 2.25,
            pt: { xs: 1.5, sm: 3 },
            [theme.breakpoints.up("md")]: {
              gridTemplateColumns: "minmax(0, 1.35fr) minmax(370px, .82fr)",
              ...(formula.length > 0 && { alignItems: "stretch", gridTemplateRows: "minmax(0, 1fr)" }),
              ...(formula.length > 0 && { flex: "1 1 auto", minHeight: 0 }),
            },
          }}
        >
          <Paper
            component="section"
            className="panel cube-panel"
            aria-labelledby="cube-panel-title"
            sx={{ minWidth: 0, alignSelf: "start", p: { xs: 2, sm: 3.375 } }}
          >
            <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2.25, mb: 2.125 }}>
              <Box>
                <Typography component="p" className="section-kicker" sx={{ mb: 0.75, color: "#7893a2", fontSize: ".63rem", fontWeight: 750, letterSpacing: ".14em", lineHeight: 1.5 }}>
                  01 · 输入与观察
                </Typography>
                <Typography id="cube-panel-title" component="h2" variant="h2">3D 魔方模型</Typography>
              </Box>
              <Typography component="span" className="revision-chip" sx={{ color: "primary.main", fontSize: ".72rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {isSolved(visibleCube) ? "已复原" : "已编辑"} · #{visibleCube.revision}
              </Typography>
            </Box>

            <Box
              className="viewport-card"
              sx={{
                position: "relative",
                overflow: "hidden",
                bgcolor: "#0b1218",
                background: "radial-gradient(circle at 50% 42%, #1b2d37 0, #101a22 44%, #0b1218 100%)",
                border: "1px solid #263945",
                borderRadius: 1.5,
              }}
            >
              <CubeViewport
                state={visibleCube}
                onStickerClick={paintSticker}
                animation={playbackAnimation}
                animationDuration={Math.max(240, Math.min(520, speed * 0.72))}
                onViewChange={handleViewChange}
              />
              <Box
                className="view-readout"
                aria-live="polite"
                sx={{ px: 1.5, py: 1.25, color: "#a9bbc4", bgcolor: "#0d171e", borderTop: "1px solid #22313b" }}
              >
                <Typography component="p" sx={{ m: 0, fontSize: ".77rem", color: "inherit" }}>
                  当前视角：正面 {faceLabel(viewFacing.front)} · 画面上方 {faceLabel(viewFacing.top)}
                </Typography>
              </Box>
            </Box>

            <Box
              className="editor-bar"
              sx={{
                display: "flex",
                alignItems: { xs: "stretch", sm: "flex-end" },
                justifyContent: "space-between",
                flexDirection: { xs: "column", sm: "row" },
                gap: 2.25,
                mt: 1.875,
                pt: 1.875,
                borderTop: "1px solid #22313b",
              }}
            >
              <Box>
                <Typography component="p" className="section-kicker" sx={{ mb: 0.75, color: "#7893a2", fontSize: ".63rem", fontWeight: 750, letterSpacing: ".14em", lineHeight: 1.5 }}>
                  3D 编辑
                </Typography>
                <Typography component="p" sx={{ maxWidth: "32rem", m: 0, color: "text.secondary", fontSize: ".78rem", lineHeight: 1.5 }}>
                  选择颜色后点击模型上的贴纸；拖动模型可自由旋转视角。
                </Typography>
              </Box>
              <Box className="editor-tools" aria-label="3D 贴纸颜色" sx={{ display: "flex", flexWrap: "wrap", justifyContent: { xs: "flex-start", sm: "flex-end" }, gap: 0.875 }}>
                {COLORS.map((color, index) => (
                  <Button
                    key={color}
                    variant="contained"
                    color="inherit"
                    type="button"
                    aria-label={`选择${color}色`}
                    aria-pressed={selectedColor === index}
                    data-color={index}
                    onClick={() => setSelectedColor(index)}
                    sx={{
                      minWidth: 37,
                      minHeight: 37,
                      px: 1.125,
                      py: 0.625,
                      color: "#0b1216",
                      bgcolor: STICKER_COLORS[index],
                      border: "2px solid rgb(255 255 255 / 24%)",
                      textShadow: "0 1px rgb(255 255 255 / 22%)",
                      "&:hover": { bgcolor: STICKER_COLORS[index], filter: "brightness(1.1)" },
                      "&[aria-pressed=\"true\"]": { borderColor: "primary.main", boxShadow: "0 0 0 2px rgb(102 217 193 / 20%)" },
                    }}
                  >
                    {color}
                  </Button>
                ))}
              </Box>
            </Box>
          </Paper>

          <Box
            component="aside"
            className="side-column"
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: 2.25,
              minWidth: 0,
              alignItems: "stretch",
              [theme.breakpoints.up("sm")]: { gridTemplateColumns: "minmax(0, 1.08fr) minmax(320px, .92fr)", alignItems: "start" },
              [theme.breakpoints.up("md")]: {
                gridTemplateColumns: "minmax(0, 1fr)",
                alignItems: "stretch",
                ...(formula.length > 0 && { gridTemplateRows: "minmax(0, 1fr) auto", minHeight: 0 }),
              },
            }}
          >
            <Paper
              component="section"
              className={`panel solution-panel${formula.length ? " has-formula" : ""}`}
              role="region"
              aria-label="解法公式"
              sx={{
                position: "static",
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                minHeight: 0,
                p: { xs: 2, sm: 2.625 },
                overflow: "visible",
                height: formula.length ? { xs: "auto", sm: "min(710px, calc(100vh - 32px))", md: "auto" } : "auto",
                maxHeight: formula.length
                  ? { xs: "none", sm: "min(710px, calc(100vh - 32px))", md: "none" }
                  : { xs: "none", sm: "710px", md: "min(790px, calc(100vh - 32px))" },
                [theme.breakpoints.up("sm")]: { overflow: "hidden" },
              }}
            >
              <Box className="solution-heading" sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.875 }}>
                <Box>
                  <Typography component="p" className="section-kicker" sx={{ mb: 0.75, color: "#7893a2", fontSize: ".63rem", fontWeight: 750, letterSpacing: ".14em", lineHeight: 1.5 }}>
                    02 · 逐步回放
                  </Typography>
                  <Typography component="h2" variant="h2">解法公式</Typography>
                </Box>
                {formula.length > 0 && <Typography component="span" className="formula-count" sx={{ color: "primary.main", fontSize: ".72rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formula.length} 步</Typography>}
              </Box>

              <Box
                className="formula-toolbar"
                sx={{
                  display: "flex",
                  alignItems: { xs: "stretch", sm: "flex-end" },
                  justifyContent: "space-between",
                  flexDirection: { xs: "column", sm: "row" },
                  flexWrap: "wrap",
                  gap: 1.5,
                  mt: 1,
                  pt: 0.875,
                  pb: 1.25,
                  borderBottom: "1px solid #22313b",
                }}
              >
                <Box className="formula-actions" sx={{ display: "flex", flexWrap: "wrap", gap: 0.875 }}>
                  <Button type="button" onClick={copyFormula} disabled={!formula.length} sx={{ px: 1.25, fontSize: ".77rem" }}>复制公式</Button>
                  {formula.length > 0 && <>
                    <Button type="button" aria-label="上一步" onClick={() => setPlaybackStep(playbackIndex - 1)} sx={{ px: 1.25, fontSize: ".77rem" }}>← 上一步</Button>
                    <Button type="button" aria-label="下一步" onClick={() => setPlaybackStep(playbackIndex + 1)} sx={{ px: 1.25, fontSize: ".77rem" }}>下一步 →</Button>
                    <Button type="button" aria-label={playing ? "暂停播放" : "播放公式"} onClick={() => setPlaying((value) => !value)} sx={{ px: 1.25, fontSize: ".77rem" }}>{playing ? "暂停" : "播放"}</Button>
                  </>}
                </Box>
                {formula.length > 0 && (
                  <FormControl size="small" className="speed-control" sx={{ flex: "0 0 104px", gap: 0.625 }}>
                    <InputLabel id="speed-select-label">播放速度</InputLabel>
                    <Select
                      native
                      labelId="speed-select-label"
                      id="speed-select"
                      label="播放速度"
                      aria-label="播放速度"
                      value={speed}
                      onChange={(event) => setSpeed(Number(event.target.value))}
                    >
                      <option value="1000">慢速</option>
                      <option value="700">标准</option>
                      <option value="350">快速</option>
                    </Select>
                  </FormControl>
                )}
              </Box>

              {formula.length > 0 && (
                <Box
                  component="ol"
                  ref={formulaListRef}
                  className="formula-steps"
                  aria-label="解法步骤"
                  data-scrollbar={formulaScrollbarEnabled ? "perfect" : "native"}
                  sx={{
                    display: "grid",
                    flex: "1 1 auto",
                    gridTemplateColumns: "minmax(0, 1fr)",
                    gap: 0.875,
                    minHeight: 0,
                    m: "15px 0 0",
                    p: "0 5px 0 0",
                    overflowY: "visible",
                    overscrollBehavior: "contain",
                    listStyle: "none",
                    [theme.breakpoints.up("sm")]: { overflowY: "hidden" },
                    "& > li": { minWidth: 0 },
                  }}
                >
                  {formula.map((token, moveIndex) => (
                    <Box component="li" key={`${token}-${moveIndex}`} sx={{ minWidth: 0 }}>
                      <Button
                        fullWidth
                        type="button"
                        ref={(element) => { formulaStepRefs.current[moveIndex] = element; }}
                        aria-label={`第 ${moveIndex + 1} 步 ${token}`}
                        aria-current={playbackIndex === moveIndex ? "step" : undefined}
                        data-played={moveIndex < playbackIndex ? "true" : undefined}
                        onClick={() => setPlaybackStep(moveIndex, false)}
                        sx={{
                          display: "grid",
                          gridTemplateColumns: "29px 42px minmax(0, 1fr)",
                          alignItems: "center",
                          justifyContent: "initial",
                          gap: 1.125,
                          minWidth: 0,
                          minHeight: 52,
                          px: 1.125,
                          py: 0.875,
                          color: "#dce6eb",
                          backgroundColor: "#111a21",
                          borderColor: "#2b3a45",
                          textAlign: "left",
                          "&:hover": { backgroundColor: "#17232c", borderColor: "#3b5361" },
                          "&[aria-current=\"step\"]": { color: "#f5ffff", backgroundColor: "#16332f", borderColor: "#66d9c1", boxShadow: "inset 3px 0 0 #66d9c1" },
                          "&[data-played=\"true\"]": { borderColor: "#36544f", opacity: 0.72 },
                          "@media (max-width: 460px)": { gridTemplateColumns: "27px 38px minmax(0, 1fr)", gap: 0.875, px: 0.875 },
                        }}
                      >
                        <Box component="span" className="move-number" sx={{ display: "grid", width: 27, height: 27, placeItems: "center", color: "#78909d", bgcolor: "#0b1116", borderRadius: "50%", fontSize: ".68rem", fontVariantNumeric: "tabular-nums" }}>{moveIndex + 1}</Box>
                        <Box component="span" className="move-token" sx={{ color: "#8fe0d0", fontSize: ".91rem", fontWeight: 800 }}>{token}</Box>
                        <Box component="span" className="move-explanation" sx={{ minWidth: 0, overflowWrap: "anywhere", color: "#aebdc5", fontSize: ".75rem", lineHeight: 1.35 }}>{explainMove(token)}</Box>
                      </Button>
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>

            <Paper component="section" className="panel control-panel" aria-labelledby="control-panel-title" sx={{ minWidth: 0, p: { xs: 2, sm: 2.625 } }}>
              <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2.25, mb: 2.125 }}>
                <Box>
                  <Typography component="p" className="section-kicker" sx={{ mb: 0.75, color: "#7893a2", fontSize: ".63rem", fontWeight: 750, letterSpacing: ".14em", lineHeight: 1.5 }}>
                    03 · 校验与操作
                  </Typography>
                  <Typography id="control-panel-title" component="h2" variant="h2">移动与校验</Typography>
                </Box>
                <Chip label={STATUS_LABELS[solveStatus]} size="small" variant="outlined" color="warning" sx={{ bgcolor: "rgb(228 184 120 / 9%)", borderColor: "rgb(228 184 120 / 25%)", whiteSpace: "nowrap" }} />
              </Box>

              <Box className="move-entry" sx={{ display: "grid", gap: 0.75, mt: 2.125, color: "text.secondary", fontSize: ".75rem" }}>
                <Typography component="label" htmlFor="move-notation" sx={{ color: "inherit", fontSize: "inherit" }}>执行 WCA 移动记号</Typography>
                <Stack direction="row" spacing={0.875} className="move-row">
                  <TextField
                    id="move-notation"
                    fullWidth
                    size="small"
                    placeholder="例如 R U' F2"
                    slotProps={{ htmlInput: { 'aria-label': '移动记号' } }}
                    value={move}
                    onChange={(event) => setMove(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") applyNotation(); }}
                  />
                  <Button type="button" onClick={applyNotation} sx={{ flex: "0 0 auto", whiteSpace: "nowrap", px: 1.375 }}>执行移动</Button>
                </Stack>
              </Box>

              <Stack direction="row" spacing={0.875} useFlexGap className="button-row" sx={{ mt: 1.625, flexWrap: "wrap" }}>
                <Button type="button" onClick={undoMove} sx={{ flex: "1 1 75px", px: 1.125 }}>撤销</Button>
                <Button type="button" onClick={redoMove} sx={{ flex: "1 1 75px", px: 1.125 }}>重做</Button>
                <Button type="button" aria-label="随机打乱魔方" title="生成随机 WCA 移动并应用到当前魔方" onClick={randomize} sx={{ flex: "1 1 95px", px: 1.125 }}>随机打乱</Button>
                <Button type="button" aria-label="重置魔方" title="将当前魔方恢复为已还原状态" onClick={reset} sx={{ flex: "1 1 75px", px: 1.125 }}>重置魔方</Button>
                <Button type="button" onClick={validateInput} disabled={validating} sx={{ flex: "1 1 75px", px: 1.125 }}>{validating ? "校验中…" : "校验状态"}</Button>
              </Stack>

              {diagnostics.length > 0 && (
                <Box className="diagnostics" role="region" aria-label="校验诊断" sx={{ mt: 2, pt: 1.75, color: "#f0c3be", borderTop: "1px solid #22313b" }}>
                  <Typography component="h3" variant="h3" sx={{ mb: 0.875, fontSize: ".82rem" }}>校验诊断</Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.25, fontSize: ".76rem", lineHeight: 1.5 }}>
                    {diagnostics.map((diagnostic) => <Box component="li" key={diagnostic} sx={{ mt: 0.625 }}>{diagnostic}</Box>)}
                  </Box>
                </Box>
              )}
            </Paper>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
