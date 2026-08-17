import { useCallback, useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, Pause, Play } from "@phosphor-icons/react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from "./kumo-ui";
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

const ORDERS = [2, 3, 4, 5, 6, 7] as const;
const COLORS = ["白", "黄", "绿", "蓝", "橙", "红"] as const;
const MOBILE_LAYOUT_QUERY = "@media (max-width: 820px)";
const DESKTOP_LAYOUT_QUERY = "@media (min-width: 821px)";
const MOBILE_MEDIA_QUERY = "(max-width: 820px)";
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
type StatusJob = {
  job_id: string;
  order: number;
  revision: number;
  phase: string;
  done: boolean;
  position?: number;
};
type BackendStatus = {
  status: string;
  generated_at: string;
  solver: {
    registered: boolean;
    active_job_id: string | null;
    queue_length: number;
  };
  active: StatusJob | null;
  queue: StatusJob[];
  jobs: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
};

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
const STATUS_TOKEN_STORAGE_KEY = "613-cube-status-token";
const CUSTOM_SPEED_MIN_SECONDS = 0;
const CUSTOM_SPEED_MAX_SECONDS = 1;
const CUSTOM_SPEED_STEP_SECONDS = 0.05;

const QUICK_MOVE_FACES = ["U", "R", "F", "D", "L", "B"] as const;

function quickMoveNotations(order: number): string[] {
  const moves = QUICK_MOVE_FACES.flatMap((face) => [face, face + "'"]);
  for (let width = 2; width <= Math.floor(order / 2); width += 1) {
    const prefix = width === 2 ? "" : String(width);
    for (const face of QUICK_MOVE_FACES) {
      moves.push(prefix + face + "w", prefix + face + "w'");
    }
  }
  return moves;
}

function faceLabel(face: Face): string {
  return `${FACE_LABELS[face]}面`;
}

function formatCustomSpeed(seconds: number): string {
  return `${Number(seconds.toFixed(2))} 秒`;
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

function readStatusToken(): string {
  try {
    return window.sessionStorage?.getItem(STATUS_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function formatStatusTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function useMediaQuery(query: string): boolean {
  const getMatches = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);

  return matches;
}

function statusPhaseLabel(phase: string): string {
  return STATUS_LABELS[phase as SolveStatus] ?? phase;
}

function StatusPage() {
  const [statusToken, setStatusToken] = useState(readStatusToken);
  const [draftToken, setDraftToken] = useState(statusToken);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);

  const loadStatus = useCallback(async (candidate: string) => {
    setStatusLoading(true);
    try {
      const response = await fetch("/api/status", {
        headers: { Authorization: `Bearer ${candidate}` },
      });
      const body = (await response.json().catch(() => ({}))) as Partial<BackendStatus> & { detail?: unknown };
      if (!response.ok) {
        if (response.status === 401) {
          try {
            window.sessionStorage?.removeItem(STATUS_TOKEN_STORAGE_KEY);
          } catch {
            // Ignore unavailable session storage.
          }
          setStatusToken("");
          setBackendStatus(null);
        }
        throw new Error(String(body.detail ?? "状态请求失败"));
      }
      setBackendStatus(body as BackendStatus);
      setStatusError("");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "状态请求失败");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!statusToken) return undefined;
    const initialLoad = window.setTimeout(() => void loadStatus(statusToken), 0);
    const timer = window.setInterval(() => void loadStatus(statusToken), 3000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [loadStatus, statusToken]);

  const connect = () => {
    const candidate = draftToken.trim();
    if (!candidate) {
      setStatusError("请输入状态访问令牌");
      return;
    }
    try {
      window.sessionStorage?.setItem(STATUS_TOKEN_STORAGE_KEY, candidate);
    } catch {
      // Continue with the in-memory token when storage is unavailable.
    }
    setBackendStatus(null);
    setStatusError("");
    setStatusToken(candidate);
  };

  const disconnect = () => {
    try {
      window.sessionStorage?.removeItem(STATUS_TOKEN_STORAGE_KEY);
    } catch {
      // Ignore unavailable session storage.
    }
    setStatusToken("");
    setBackendStatus(null);
    setStatusError("");
  };

  return (
    <Box
      component="main"
      className="status-page"
      sx={{
        width: "min(1100px, 100%)",
        mx: "auto",
        px: { xs: 1.5, sm: "clamp(14px, 4vw, 58px)" },
        pt: { xs: 2.375, sm: 3.5 },
        pb: { xs: 3.75, sm: 5.25 },
      }}
    >
      <Box component="header" className="status-page-header">
        <Box className="status-page-brand">
          <Typography component="p" className="status-page-eyebrow">613 CODING · 魔方公式工作台</Typography>
          <Typography component="p" className="status-page-caption">/status · 实时后端监控</Typography>
        </Box>
        <Button component="a" href="/" size="small" className="status-back-button">返回工作台</Button>
      </Box>

      <Paper component="section" className="status-shell" aria-labelledby="status-page-title" sx={{ p: 0 }}>
        <Box className="status-intro">
          <Box className="status-intro-copy">
            <Typography component="p" className="status-section-kicker">系统监控</Typography>
            <Typography id="status-page-title" component="h1" className="status-page-title">后端状态</Typography>
            <Typography component="p" className="status-page-description">
              查看求解器注册状态、当前任务和 FIFO 排队情况。状态接口需要 Bearer 令牌。
            </Typography>
          </Box>
          <Box className={`status-access-badge ${statusToken ? "status-access-badge--connected" : "status-access-badge--locked"}`}>
            <Box className="status-access-dot" aria-hidden="true" />
            <Typography component="span">{statusToken ? "已授权" : "需要授权"}</Typography>
          </Box>
        </Box>

        <Box className="status-auth-form">
          <TextField
            className="status-token-field"
            fullWidth
            size="small"
            type="password"
            label="状态访问令牌"
            value={draftToken}
            onChange={(event) => setDraftToken(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") connect(); }}
          />
          <Box className="status-auth-actions">
            <Button variant="contained" color="primary" onClick={connect} disabled={!draftToken.trim() || statusLoading} sx={{ color: "primary.contrastText" }}>
              {statusLoading && !backendStatus ? "连接中…" : "连接状态"}
            </Button>
            {statusToken && <Button onClick={disconnect}>退出授权</Button>}
          </Box>
        </Box>

        {statusError && <Alert className="status-error" severity="error">{statusError}</Alert>}

        {!backendStatus && !statusError && (
          <Box className="status-auth-placeholder">
            <Typography component="p" className="status-placeholder-title">输入令牌以查看实时数据</Typography>
            <Typography component="p" className="status-placeholder-copy">
              连接后可查看求解器状态、任务统计与等待队列。
            </Typography>
          </Box>
        )}

        {backendStatus && (
          <Box className="status-dashboard">
            <Box className="status-summary-grid" aria-label="后端状态摘要">
              {[
                { label: "任务总数", value: backendStatus.jobs.total, tone: "total" },
                { label: "排队中", value: backendStatus.jobs.queued, tone: "queued" },
                { label: "运行中", value: backendStatus.jobs.running, tone: "running" },
                { label: "已完成", value: backendStatus.jobs.completed, tone: "completed" },
                { label: "失败", value: backendStatus.jobs.failed, tone: "failed" },
                { label: "已取消", value: backendStatus.jobs.cancelled, tone: "cancelled" },
              ].map(({ label, value, tone }) => (
                <Box key={label} className={`status-stat status-stat--${tone}`}>
                  <Typography component="p" className="status-stat-label">{label}</Typography>
                  <Typography component="p" className="status-stat-value">{value}</Typography>
                </Box>
              ))}
            </Box>

            <Box className="status-system-card">
              <Box className="status-system-item">
                <Typography component="p" className="status-field-label">求解器</Typography>
                <Box className="status-system-state">
                  <Box className={`status-state-dot ${backendStatus.solver.registered ? "status-state-dot--ok" : "status-state-dot--danger"}`} aria-hidden="true" />
                  <Typography component="p" className="status-system-value">{backendStatus.solver.registered ? "已注册" : "未注册"}</Typography>
                </Box>
                <Typography component="p" className="status-system-meta">队列长度 {backendStatus.solver.queue_length}</Typography>
              </Box>
              <Box className="status-system-item">
                <Typography component="p" className="status-field-label">当前任务</Typography>
              {backendStatus.active ? (
                <Typography component="p" className="status-system-value status-system-value--compact">
                  {backendStatus.active.order}×{backendStatus.active.order} · {statusPhaseLabel(backendStatus.active.phase)}
                </Typography>
              ) : (
                <Typography component="p" className="status-system-value status-system-value--muted">当前没有运行中的任务</Typography>
              )}
                {backendStatus.active && <Typography component="p" className="status-system-meta status-system-job-id">{backendStatus.active.job_id}</Typography>}
              </Box>
              <Typography component="p" className="status-system-footer">最近更新 · {formatStatusTime(backendStatus.generated_at)}</Typography>
            </Box>

            <Box className="status-queue-section">
              <Box className="status-section-heading">
                <Box>
                  <Typography component="p" className="status-field-label">任务调度</Typography>
                  <Typography component="h2" className="status-section-title">等待队列</Typography>
                </Box>
                <Typography component="span" className="status-queue-count">{backendStatus.queue.length} 个任务</Typography>
              </Box>
              {backendStatus.queue.length === 0 ? (
                <Box className="status-empty-state">
                  <Typography component="p" className="status-empty-title">队列为空</Typography>
                  <Typography component="p" className="status-empty-copy">当前没有排队任务</Typography>
                </Box>
              ) : (
                <Box className="status-queue-list">
                  {backendStatus.queue.map((job) => (
                    <Box key={job.job_id} className="status-queue-job">
                      <Box className="status-job-position">#{job.position ?? "—"}</Box>
                      <Box className="status-job-main">
                        <Typography component="span" className="status-job-id">{job.job_id}</Typography>
                        <Typography component="span" className="status-job-meta">{job.order}×{job.order} · {statusPhaseLabel(job.phase)}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  );
}

export default function App() {
  const isMobileViewport = useMediaQuery(MOBILE_MEDIA_QUERY);
  const [cube, setCube] = useState<CubeState>(loadCube);
  const [order, setOrder] = useState(() => cube.order);
  const [selectedColor, setSelectedColor] = useState(0);
  const [viewFacing, setViewFacing] = useState<ViewFacing>(() => facingFaces(DEFAULT_VIEW_TRANSFORM));
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
  const [customSpeedSeconds, setCustomSpeedSeconds] = useState(0.7);
  const [playbackAnimation, setPlaybackAnimation] = useState<CubeAnimation | null>(null);
  const [pendingOrder, setPendingOrder] = useState<number | null>(null);
  // Keep the formula viewport self-contained at every breakpoint. This is
  // important on mobile: advancing a step must never scroll the document
  // away from the 3D model.
  const formulaScrollbarEnabled = true;
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
  const playbackDelayMs = Math.round(customSpeedSeconds * 1000);

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
    // Keep playback scrolling inside the formula viewport. Calling
    // scrollIntoView here would scroll the document on mobile and can move
    // the 3D model out of view when the formula panel is below it.
    if (list.scrollHeight <= list.clientHeight || list.clientHeight <= 0) return;
    const listRect = list.getBoundingClientRect();
    const stepRect = step.getBoundingClientRect();
    const delta = stepRect.top < listRect.top
      ? stepRect.top - listRect.top
      : stepRect.bottom > listRect.bottom
        ? stepRect.bottom - listRect.bottom
        : 0;
    if (delta) {
      if (typeof list.scrollBy === "function") list.scrollBy({ top: delta, behavior: "auto" });
      else list.scrollTop += delta;
      perfectScrollbarRef.current?.update();
    }
  }, [playbackIndex]);

  const setPlaybackStep = useCallback((nextIndex: number, animate = true) => {
    const bounded = formula.length === 0 ? -1 : Math.max(-1, Math.min(formula.length - 1, nextIndex));
    if (formula.length > 0 && bounded >= formula.length - 1) setPlaying(false);
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

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (formula.length > 0 && playbackIndex >= formula.length - 1) setPlaybackStep(-1, false);
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing || !formula.length || playbackIndex >= formula.length - 1) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      if (playbackIndexRef.current >= formula.length - 1) setPlaying(false);
      else setPlaybackStep(playbackIndexRef.current + 1);
    }, playbackDelayMs);
    return () => window.clearTimeout(timer);
  }, [formula.length, playbackIndex, playing, setPlaybackStep, playbackDelayMs]);

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

  const applyOrderChange = (nextOrder: number) => {
    const saved = loadCubeForOrder(nextOrder);
    setOrder(nextOrder);
    announce(saved ?? createCubeState(nextOrder), `新建 ${nextOrder}×${nextOrder} 魔方`);
  };

  const changeOrder = (value: string) => {
    const nextOrder = Number(value);
    if (!Number.isInteger(nextOrder) || nextOrder < 2 || nextOrder > 7) return;
    if (!isSolved(cube)) {
      setPendingOrder(nextOrder);
      return;
    }
    applyOrderChange(nextOrder);
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
  const applyQuickMove = (notation: string) => {
    try {
      announce(applyMove(cube, notation), `已执行 ${notation}`, notation);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移动记号无效");
    }
  };
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
  const statusTone = isBusy ? "working" : solveStatus === "completed" ? "success" : solveStatus === "failed" ? "danger" : "neutral";
  const formulaProgress = formula.length > 0
    ? `${String(Math.max(0, playbackIndex + 1)).padStart(2, "0")} / ${String(formula.length).padStart(2, "0")}`
    : "等待";

  const renderSolveControls = (idPrefix: string) => (
    <>
      <Box className="order-control">
        <Typography component="span" className="order-control-label">魔方阶数</Typography>
        <Select
          id={`${idPrefix}-order-select`}
          label="魔方阶数"
          aria-label="魔方阶数"
          value={order}
          onChange={(event) => changeOrder(String(event.target.value))}
        >
          {ORDERS.map((value) => <MenuItem key={value} value={value}>{value}×{value}</MenuItem>)}
        </Select>
      </Box>
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
    </>
  );

  const renderMobilePlaybackControls = () => (
    <>
      <Button className="mobile-copy-button" type="button" onClick={copyFormula} disabled={!formula.length}>复制公式</Button>
      <Box className="mobile-custom-speed-control">
        <Typography component="p">每步 {formatCustomSpeed(customSpeedSeconds)}</Typography>
        <Slider
          aria-label="移动端每步秒数"
          value={customSpeedSeconds}
          min={CUSTOM_SPEED_MIN_SECONDS}
          max={CUSTOM_SPEED_MAX_SECONDS}
          step={CUSTOM_SPEED_STEP_SECONDS}
          valueLabelDisplay="auto"
          valueLabelFormat={(value) => formatCustomSpeed(Number(value))}
          onChange={(_, value) => setCustomSpeedSeconds(typeof value === "number" ? value : value[0] ?? CUSTOM_SPEED_MIN_SECONDS)}
        />
      </Box>
    </>
  );

  const renderPlayerButtons = () => (
    <>
      <Button className="formula-player-button" type="button" aria-label="上一步" title="上一步" disabled={playbackIndex < 0} onClick={() => setPlaybackStep(playbackIndex - 1)}>
        <CaretLeft size={22} weight="bold" aria-hidden="true" />
      </Button>
      <Button className="formula-player-button formula-player-button--play" type="button" aria-label={playing ? "暂停播放" : "播放公式"} title={playing ? "暂停播放" : "播放公式"} onClick={togglePlayback}>
        {playing ? <Pause size={22} weight="fill" aria-hidden="true" /> : <Play size={22} weight="fill" aria-hidden="true" />}
      </Button>
      <Button className="formula-player-button" type="button" aria-label="下一步" title="下一步" disabled={playbackIndex >= formula.length - 1} onClick={() => setPlaybackStep(playbackIndex + 1)}>
        <CaretRight size={22} weight="bold" aria-hidden="true" />
      </Button>
    </>
  );

  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/status") {
    return (
      <StatusPage />
    );
  }

  return (
    <Box
        component="main"
        className={`app-shell${formula.length ? " has-formula" : ""}`}
        sx={{
          width: "100%",
          mx: "auto",
          px: 0,
          pt: 0,
          pb: { xs: 3.75, sm: 5.25 },
        }}
      >
        <Box
          component="header"
          className="topbar"
          sx={{
            display: "block",
          }}
        >
          <Box className="topbar-inner">
            <Box component="a" href="#cube-panel" className="brand-lockup" aria-label="回到 613 CODING 魔方公式工作台">
              <Typography component="span" className="brand-title">613 CODING · 魔方公式工作台</Typography>
            </Box>
            <Box className="task-meta">
              <Box component="span" className={`status-pill status-pill--${statusTone}`} role="status" aria-live="polite">
                {message}
              </Box>
              <Box className="task-meta-copy">
                <Typography component="span" className="eyebrow">当前任务</Typography>
                <Typography component="strong" className="task-title">{jobId ? `任务 ${jobId}` : STATUS_LABELS[solveStatus]}</Typography>
              </Box>
            </Box>
            <Box className="header-spacer" />
            {!isMobileViewport && (
              <Box
                className="desktop-header-actions"
                aria-label="求解控制"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  flexShrink: 0,
                  [MOBILE_LAYOUT_QUERY]: { display: "none" },
                }}
              >
                {renderSolveControls("header")}
              </Box>
            )}
          </Box>
        </Box>

        <Box
          className="status-line"
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
        </Box>

        <Box
          className={`workbench${formula.length ? " has-formula" : ""}`}
          sx={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            alignItems: "start",
            gap: 2.25,
            pt: { xs: 0, sm: 2.25 },
            [MOBILE_LAYOUT_QUERY]: {
              gridTemplateColumns: "minmax(0, 1fr)",
              gridTemplateAreas: '"workspace"',
              columnGap: 0,
              rowGap: 0,
              alignItems: "stretch",
            },
            [DESKTOP_LAYOUT_QUERY]: {
              gridTemplateColumns: "minmax(0, 1.35fr) minmax(370px, .82fr)",
              ...(formula.length > 0 && { alignItems: "stretch", gridTemplateRows: "minmax(0, 1fr)", flex: "1 1 auto", minHeight: 0 }),
            },
          }}
        >
          <Box
            className="mobile-workspace"
            sx={{
              display: "contents",
              minWidth: 0,
              [MOBILE_LAYOUT_QUERY]: {
                display: "grid",
                gridArea: "workspace",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gridTemplateAreas: '"mobile-controls mobile-controls" "cube solution" "editor editor" "control control"',
                columnGap: 0.875,
                rowGap: 0,
                minWidth: 0,
                p: 0,
                border: 0,
                borderRadius: 0,
                bgcolor: "transparent",
                overflow: "visible",
              },
            }}
          >
          <Box
            className="mobile-solve-controls mobile-workspace-controls"
            aria-label="求解控制"
            sx={{
              display: "none",
              [MOBILE_LAYOUT_QUERY]: {
                display: "grid",
                gridArea: "mobile-controls",
                alignItems: "center",
                gap: 1,
                minWidth: 0,
                px: 0,
                py: 0,
              },
            }}
          >
            <Box className="mobile-solve-primary">
              {isMobileViewport && renderSolveControls("mobile")}
            </Box>
            {formula.length > 0 && (
              <Box className="mobile-playback-controls" aria-label="公式回放控制">
                {renderMobilePlaybackControls()}
              </Box>
            )}
          </Box>
          <Box
            className="left-column"
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: 2.25,
              minWidth: 0,
              alignContent: "start",
              [MOBILE_LAYOUT_QUERY]: { display: "contents" },
            }}
          >
          <Paper
            component="section"
            className="panel cube-panel"
            aria-labelledby="cube-panel-title"
            sx={{
              minWidth: 0,
              alignSelf: "start",
              p: 0,
              [MOBILE_LAYOUT_QUERY]: { gridArea: "cube", p: 0, border: "none", borderRadius: 0, bgcolor: "transparent" },
            }}
          >
            <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2.25, mb: 2.125 }}>
              <Box>
                <Typography component="p" className="section-kicker" sx={{ mb: 0.75, color: "#7893a2", fontSize: ".63rem", fontWeight: 750, letterSpacing: ".14em", lineHeight: 1.5 }}>
                  输入观察
                </Typography>
                <Typography id="cube-panel-title" component="h2" variant="h2">3D 魔方模型</Typography>
              </Box>
              <Typography component="span" className="revision-chip" sx={{ color: "primary.main", fontSize: ".72rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {isSolved(visibleCube) ? "已复原" : "已编辑"} · #{visibleCube.revision}
              </Typography>
            </Box>

            <Box
              className="viewport-card viewport"
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
                animationDuration={Math.max(240, Math.min(520, playbackDelayMs * 0.72))}
                onViewChange={handleViewChange}
              />
              <Box
                className="view-readout"
                aria-live="polite"
                sx={{ px: 1.5, py: 1.25, color: "#a9bbc4", bgcolor: "#0d171e", borderTop: "1px solid #22313b" }}
                >
                <Typography component="p" sx={{ m: 0, fontSize: ".77rem", color: "inherit" }}>
                  <Box component="span" className="view-readout-full">
                    当前视角：正面 {faceLabel(viewFacing.front)} · 画面上方 {faceLabel(viewFacing.top)}
                  </Box>
                  <Box component="span" className="view-readout-mobile">
                    视角 {faceLabel(viewFacing.front)} · 上方 {faceLabel(viewFacing.top)}
                  </Box>
                </Typography>
              </Box>
            </Box>

          </Paper>

          <Box
            className="editor-bar palette-panel"
            sx={{
              display: "flex",
              alignItems: { xs: "stretch", sm: "flex-end" },
              justifyContent: "space-between",
              flexDirection: { xs: "column", sm: "row" },
              gap: 2.25,
              mt: 0,
              pt: 1.875,
              [MOBILE_LAYOUT_QUERY]: { gridArea: "editor", px: 1.5, pt: 1.25, pb: 0.5 },
            }}
          >
            <Box className="editor-copy palette-copy">
              <Typography component="p" className="section-kicker" sx={{ mb: 0.75, color: "#7893a2", fontSize: ".63rem", fontWeight: 750, letterSpacing: ".14em", lineHeight: 1.5 }}>
                3D 编辑
              </Typography>
              <Typography component="p" sx={{ m: 0, color: "text.secondary", fontSize: ".77rem", lineHeight: 1.5 }}>
                选择颜色后点击模型上的贴纸；拖动模型可自由旋转视角。
              </Typography>
            </Box>
            <Box className="editor-tools palette-options" aria-label="3D 贴纸颜色" sx={{ display: "flex", flexWrap: "wrap", justifyContent: { xs: "flex-start", sm: "flex-end" }, gap: 0.875 }}>
              {COLORS.map((color, index) => (
                <Button
                  key={color}
                  variant="outlined"
                  color="inherit"
                  type="button"
                  aria-label={`选择${color}色`}
                  aria-pressed={selectedColor === index}
                  data-color={index}
                  onClick={() => setSelectedColor(index)}
                  className="color-button"
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
                />
              ))}
            </Box>
          </Box>
          </Box>

          <Box
            component="aside"
            className="side-column"
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: 2.25,
              minWidth: 0,
              minHeight: 0,
              alignItems: "stretch",
              [MOBILE_LAYOUT_QUERY]: { display: "contents" },
              [DESKTOP_LAYOUT_QUERY]: {
                gridTemplateColumns: "minmax(0, 1fr)",
                ...(formula.length > 0 && { gridTemplateRows: "minmax(0, 1fr) auto", height: "100%", minHeight: 0, overflow: "hidden" }),
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
                overflow: formula.length ? "hidden" : "visible",
                height: formula.length ? { xs: "min(640px, calc(100svh - 96px))", sm: "auto" } : "auto",
                maxHeight: formula.length
                  ? { xs: "min(640px, calc(100svh - 96px))", sm: "none" }
                  : { xs: "none", sm: "none" },
                ["@media (min-width: 560px)"]: { overflow: "hidden" },
                [MOBILE_LAYOUT_QUERY]: {
                  gridArea: "solution",
                  height: formula.length ? "min(460px, calc(100svh - 280px))" : "auto",
                  maxHeight: formula.length ? "460px" : "none",
                  p: 0.75,
                  border: "none",
                  borderRadius: 0,
                  bgcolor: "transparent",
                },
                [DESKTOP_LAYOUT_QUERY]: {
                  height: "auto",
                  maxHeight: "none",
                  minHeight: 0,
                  overflow: "hidden",
                },
              }}
            >
              <Box className="solution-heading" sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.875 }}>
                <Box>
                  <Typography component="p" className="section-kicker" sx={{ mb: 0.75, color: "#7893a2", fontSize: ".63rem", fontWeight: 750, letterSpacing: ".14em", lineHeight: 1.5 }}>
                    逐步回放
                  </Typography>
                  <Typography component="h2" variant="h2">解法公式</Typography>
                </Box>
                <Box className="formula-header-right">
                  <Box className="formula-progress">
                    <Typography component="span" className="progress-copy">{formulaProgress}</Typography>
                    <Box className="progress-track" aria-hidden="true">
                      <Box className="progress-fill" sx={{ width: formula.length > 0 ? `${Math.max(0, ((playbackIndex + 1) / formula.length) * 100)}%` : "0%" }} />
                    </Box>
                  </Box>
                </Box>
              </Box>

              {isMobileViewport && formula.length > 0 && (
                <Box className="mobile-solution-player" aria-label="移动端播放器控制">
                  <Box className="mobile-player-controls">
                    {renderPlayerButtons()}
                  </Box>
                </Box>
              )}

              <Box
                className="formula-toolbar"
                sx={{
                  mt: 1,
                  pt: 0.875,
                  pb: 1.25,
                  [MOBILE_LAYOUT_QUERY]: { display: "none" },
                }}
              >
                <Box className="formula-toolbar-top">
                  <Button className="formula-copy-button" type="button" onClick={copyFormula} disabled={!formula.length}>复制公式</Button>
                </Box>
                {formula.length > 0 && (
                  <Box className="custom-speed-control formula-toolbar-custom">
                    <Typography component="p">
                      每步 {formatCustomSpeed(customSpeedSeconds)}
                    </Typography>
                    <Slider
                      aria-label="自定义每步秒数"
                      value={customSpeedSeconds}
                      min={CUSTOM_SPEED_MIN_SECONDS}
                      max={CUSTOM_SPEED_MAX_SECONDS}
                      step={CUSTOM_SPEED_STEP_SECONDS}
                      valueLabelDisplay="auto"
                      valueLabelFormat={(value) => formatCustomSpeed(Number(value))}
                      onChange={(_, value) => {
                        setCustomSpeedSeconds(typeof value === "number" ? value : value[0] ?? CUSTOM_SPEED_MIN_SECONDS);
                      }}
                    />
                  </Box>
                )}
                {formula.length > 0 && (
                  <Box className="formula-player-controls" aria-label="播放器控制">
                    {renderPlayerButtons()}
                  </Box>
                )}
              </Box>

              {formula.length > 0 ? (
                <Box
                  component="ol"
                  ref={formulaListRef}
                  className="formula-steps"
                  aria-label="解法步骤"
                  data-scrollbar={formulaScrollbarEnabled ? "perfect" : "native"}
                  sx={{
                    display: "grid",
                    flex: "1 1 0",
                    gridTemplateColumns: "minmax(0, 1fr)",
                    alignContent: "start",
                    gap: 0.875,
                    minHeight: 0,
                    m: "15px 0 0",
                    // Perfect Scrollbar draws its rail over the right edge of
                    // the container, so reserve a gutter for it explicitly.
                    p: formulaScrollbarEnabled ? "0 16px 0 0" : "0 5px 0 0",
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                    scrollbarGutter: "stable",
                    overscrollBehavior: "contain",
                    listStyle: "none",
                    ["@media (min-width: 560px)"]: { overflowY: "hidden" },
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
                          "&[aria-current=\"step\"]": { color: "#343438", backgroundColor: "#f2f5ff", borderColor: "rgba(37, 99, 235, .35)", boxShadow: "none" },
                          "&[data-played=\"true\"]": { borderColor: "#36544f", opacity: 0.72 },
                          [MOBILE_LAYOUT_QUERY]: { gridTemplateColumns: "25px minmax(0, 1fr)", gap: 0.625, px: 0.625 },
                        }}
                      >
                        <Box component="span" className="move-number" sx={{ display: "grid", width: 27, height: 27, placeItems: "center", color: "#78909d", bgcolor: "transparent", borderRadius: "50%", fontSize: ".68rem", fontVariantNumeric: "tabular-nums" }}>{moveIndex + 1}</Box>
                        <Box component="span" className="move-token" sx={{ color: "#8fe0d0", fontSize: ".91rem", fontWeight: 800 }}>{token}</Box>
                        <Box component="span" className="move-explanation" sx={{ minWidth: 0, overflowWrap: "anywhere", color: "#aebdc5", fontSize: ".75rem", lineHeight: 1.35, [MOBILE_LAYOUT_QUERY]: { display: "none" } }}>{explainMove(token)}</Box>
                      </Button>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Box className="formula-empty" aria-live="polite">
                  <Typography component="p" className="formula-empty-title">解法尚未生成</Typography>
                  <Typography component="p" className="formula-empty-copy">完成颜色观察后，点击“开始求解”生成可回放的移动序列。</Typography>
                </Box>
              )}
            </Paper>

            <Paper component="section" className="panel control-panel" aria-labelledby="control-panel-title" sx={{ minWidth: 0, p: { xs: 2, sm: 2.625 }, [MOBILE_LAYOUT_QUERY]: { gridArea: "control", p: 0.75, border: "none", borderRadius: 0, bgcolor: "transparent" } }}>
              <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2.25, mb: 2.125 }}>
                <Box>
                  <Typography component="p" className="section-kicker" sx={{ mb: 0.75, color: "#7893a2", fontSize: ".63rem", fontWeight: 750, letterSpacing: ".14em", lineHeight: 1.5 }}>
                  移动与校验
                  </Typography>
                  <Typography id="control-panel-title" component="h2" variant="h2">快速移动</Typography>
                </Box>
                <Chip label={STATUS_LABELS[solveStatus]} size="small" variant="outlined" color="warning" sx={{ bgcolor: "rgb(228 184 120 / 9%)", borderColor: "rgb(228 184 120 / 25%)", whiteSpace: "nowrap" }} />
              </Box>

              <Box className="quick-moves" aria-label="快速移动">
                {quickMoveNotations(order).map((notation) => (
                  <Button className="quick-move" key={notation} type="button" onClick={() => applyQuickMove(notation)}>{notation}</Button>
                ))}
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
        <Dialog
          open={pendingOrder !== null}
          onClose={() => setPendingOrder(null)}
          aria-labelledby="change-order-dialog-title"
          aria-describedby="change-order-dialog-description"
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle id="change-order-dialog-title">切换魔方阶数</DialogTitle>
          <DialogContent>
            <DialogContentText id="change-order-dialog-description">
              切换阶数会替换当前魔方，是否继续？
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPendingOrder(null)}>取消</Button>
            <Button
              variant="contained"
              color="primary"
              onClick={() => {
                if (pendingOrder !== null) applyOrderChange(pendingOrder);
                setPendingOrder(null);
              }}
              sx={{ color: "primary.contrastText" }}
            >
              确定
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
  );
}
