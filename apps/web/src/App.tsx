import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Chip,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
  useMediaQuery,
} from "@mui/material";
import PerfectScrollbar from "perfect-scrollbar";
import CubeViewport, { type CubeAnimation, type CubeFace, type ViewControls } from "./CubeViewport";
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
const MOBILE_MEDIA_QUERY = "(max-width: 760px)";
const MOBILE_LAYOUT_QUERY = "@media (max-width: 760px)";
const DESKTOP_LAYOUT_QUERY = "@media (min-width: 761px)";
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
type SpeedPreset = "slow" | "standard" | "fast" | "custom";
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
const PRESET_SPEEDS: Record<Exclude<SpeedPreset, "custom">, number> = {
  slow: 1000,
  standard: 700,
  fast: 350,
};

function faceLabel(face: Face): string {
  return `${FACE_LABELS[face]}面`;
}

function formatCustomSpeed(seconds: number): string {
  return `${Number(seconds.toFixed(2))} 秒`;
}

interface MobileWorkspaceControlsProps {
  viewControls: ViewControls | null;
  order: number;
  formula: string[];
  playbackIndex: number;
  playing: boolean;
  speedPreset: SpeedPreset;
  customSpeedSeconds: number;
  isBusy: boolean;
  hasActiveJob: boolean;
  onOrderChange: (value: string) => void;
  onSolve: () => void;
  onCancelSolve: () => void;
  onCopyFormula: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlayback: () => void;
  onSpeedPresetChange: (preset: SpeedPreset) => void;
  onCustomSpeedChange: (seconds: number) => void;
}

function MobileWorkspaceControls({
  viewControls,
  order,
  formula,
  playbackIndex,
  playing,
  speedPreset,
  customSpeedSeconds,
  isBusy,
  hasActiveJob,
  onOrderChange,
  onSolve,
  onCancelSolve,
  onCopyFormula,
  onPrevious,
  onNext,
  onTogglePlayback,
  onSpeedPresetChange,
  onCustomSpeedChange,
}: MobileWorkspaceControlsProps) {
  const quickFaces: CubeFace[] = ["F", "B", "U", "D", "L", "R"];
  return (
    <Box
      className="mobile-workspace-controls"
      aria-label="移动端工作区控制"
      sx={{
        display: "grid",
        gridArea: "mobile-controls",
        gap: 1,
        minWidth: 0,
        p: { xs: 1.25, sm: 0 },
        borderBottom: "1px solid #263945",
        bgcolor: "#0d171e",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75, minWidth: 0 }}>
        <Typography component="span" sx={{ display: { xs: "none", sm: "inline" }, color: "#8fa7b2", fontSize: ".7rem", fontWeight: 700, whiteSpace: "nowrap" }}>快速对准</Typography>
        <ButtonGroup variant="outlined" size="small" aria-label="六面快速视角" sx={{ minWidth: 0, flexShrink: 1 }}>
          {quickFaces.map((face) => (
            <Button
              key={face}
              type="button"
              onClick={() => viewControls?.face(face)}
              aria-label={`查看 ${face} 面`}
              title={`查看 ${face} 面`}
              sx={{ minWidth: 31, minHeight: 32, px: 0.75, py: 0.5, color: "#d2e0e4", bgcolor: "rgb(12 20 27 / 76%)", borderColor: "#3c5662", fontSize: ".72rem", fontWeight: 760 }}
            >
              {face}
            </Button>
          ))}
        </ButtonGroup>
        <Button type="button" aria-label="重置视角" onClick={() => viewControls?.reset()} sx={{ minHeight: 32, minWidth: 38, px: 0.75, fontSize: ".72rem" }}>↻</Button>
        <Button type="button" aria-label="适应窗口" onClick={() => viewControls?.fit()} sx={{ minHeight: 32, minWidth: 38, px: 0.75, fontSize: ".82rem" }}>⛶</Button>
      </Box>

      <Box
        className="mobile-solve-controls"
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(112px, auto)",
          alignItems: "center",
          gap: 0.75,
          minWidth: 0,
        }}
      >
        <FormControl size="small" fullWidth sx={{ minWidth: 0 }}>
          <InputLabel id="mobile-order-select-label">魔方阶数</InputLabel>
          <Select
            labelId="mobile-order-select-label"
            id="mobile-order-select"
            label="魔方阶数"
            aria-label="魔方阶数"
            value={order}
            onChange={(event) => onOrderChange(String(event.target.value))}
          >
            {ORDERS.map((value) => <MenuItem key={value} value={value}>{value}×{value}</MenuItem>)}
          </Select>
        </FormControl>
        <Button
          variant="contained"
          color="primary"
          type="button"
          onClick={onSolve}
          disabled={isBusy}
          sx={{ width: "100%", minWidth: 112, px: 1.25, color: "primary.contrastText", fontWeight: 760, whiteSpace: "nowrap" }}
        >
          {isBusy ? "求解中…" : "开始求解"}
        </Button>
        {hasActiveJob && isBusy && (
          <Button type="button" onClick={onCancelSolve} sx={{ gridColumn: "1 / -1", width: "100%" }}>
            取消求解
          </Button>
        )}
      </Box>

      {formula.length > 0 && (
        <Box
          className="mobile-playback-controls"
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 1,
            minWidth: 0,
            pt: 1,
            borderTop: "1px solid #22313b",
          }}
        >
          <Box className="formula-actions" sx={{ display: "flex", flexWrap: "nowrap", gap: 0.75, width: "100%", minWidth: 0 }}>
            <Button type="button" onClick={onCopyFormula} sx={{ flex: "1 1 0", minWidth: 0, minHeight: 42, px: 1.25, fontSize: ".78rem", whiteSpace: "nowrap" }}>复制公式</Button>
            <Button type="button" aria-label="上一步" onClick={onPrevious} disabled={playbackIndex < 0} sx={{ flex: "1 1 0", minWidth: 0, minHeight: 42, px: 1.25, fontSize: ".78rem", whiteSpace: "nowrap" }}>← 上一步</Button>
            <Button type="button" aria-label="下一步" onClick={onNext} sx={{ flex: "1 1 0", minWidth: 0, minHeight: 42, px: 1.25, fontSize: ".78rem", whiteSpace: "nowrap" }}>下一步 →</Button>
            <Button type="button" aria-label={playing ? "暂停播放" : "播放公式"} onClick={onTogglePlayback} sx={{ flex: "1 1 0", minWidth: 0, minHeight: 42, px: 1.25, fontSize: ".78rem", whiteSpace: "nowrap" }}>{playing ? "暂停" : "播放"}</Button>
          </Box>
          <FormControl className="mobile-speed-select" size="small" sx={{ flex: "1 1 100%", width: "100%" }}>
            <InputLabel id="mobile-speed-select-label">播放速度</InputLabel>
            <Select
              labelId="mobile-speed-select-label"
              id="mobile-speed-select"
              label="播放速度"
              aria-label="播放速度"
              value={speedPreset}
              onChange={(event) => onSpeedPresetChange(event.target.value as SpeedPreset)}
              renderValue={(value) => ({ slow: "慢速", standard: "标准", fast: "快速", custom: "自定义" }[value as SpeedPreset])}
            >
              <MenuItem value="slow">慢速（1.0 秒/步）</MenuItem>
              <MenuItem value="standard">标准（0.7 秒/步）</MenuItem>
              <MenuItem value="fast">快速（0.35 秒/步）</MenuItem>
              <MenuItem value="custom">自定义</MenuItem>
            </Select>
          </FormControl>
          {speedPreset === "custom" && (
            <Box className="mobile-custom-speed" sx={{ display: "grid", flex: "1 1 100%", width: "100%", gap: 0.375, px: 0.5 }}>
              <Typography component="p" sx={{ m: 0, color: "text.secondary", fontSize: ".72rem" }}>每步 {formatCustomSpeed(customSpeedSeconds)}</Typography>
              <Slider
                aria-label="移动端自定义每步秒数"
                value={customSpeedSeconds}
                min={CUSTOM_SPEED_MIN_SECONDS}
                max={CUSTOM_SPEED_MAX_SECONDS}
                step={CUSTOM_SPEED_STEP_SECONDS}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => formatCustomSpeed(Number(value))}
                onChange={(_, value) => onCustomSpeedChange(typeof value === "number" ? value : value[0] ?? CUSTOM_SPEED_MIN_SECONDS)}
              />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
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
      sx={{
        width: "min(1100px, 100%)",
        mx: "auto",
        px: { xs: 1.5, sm: "clamp(14px, 4vw, 58px)" },
        pt: { xs: 2.375, sm: 3.5 },
        pb: { xs: 3.75, sm: 5.25 },
      }}
    >
      <Box component="header" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 2.5 }}>
        <Typography component="p" className="eyebrow" variant="overline" sx={{ m: 0, color: "#7893a2", fontSize: ".67rem", fontWeight: 750, letterSpacing: ".14em" }}>
          613 CODING · 魔方公式工作台
        </Typography>
        <Button component="a" href="/" size="small" sx={{ flexShrink: 0 }}>返回工作台</Button>
      </Box>

      <Paper component="section" aria-labelledby="status-page-title" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography component="p" className="section-kicker" sx={{ mb: 0.75, color: "#7893a2", fontSize: ".63rem", fontWeight: 750, letterSpacing: ".14em" }}>
          系统监控
        </Typography>
        <Typography id="status-page-title" component="h1" variant="h2" sx={{ fontSize: "1.35rem", mb: 0.75 }}>后端状态</Typography>
        <Typography component="p" sx={{ m: 0, color: "text.secondary", fontSize: ".8rem" }}>
          查看求解器注册状态、当前任务和 FIFO 排队情况。状态接口需要 Bearer 令牌。
        </Typography>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 2.5 }}>
          <TextField
            fullWidth
            size="small"
            type="password"
            label="状态访问令牌"
            value={draftToken}
            onChange={(event) => setDraftToken(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") connect(); }}
          />
          <Button variant="contained" color="primary" onClick={connect} disabled={!draftToken.trim() || statusLoading} sx={{ flexShrink: 0, color: "primary.contrastText" }}>
            {statusLoading && !backendStatus ? "连接中…" : "连接状态"}
          </Button>
          {statusToken && <Button onClick={disconnect} sx={{ flexShrink: 0 }}>退出授权</Button>}
        </Stack>

        {statusError && <Alert severity="error" sx={{ mt: 2 }}>{statusError}</Alert>}

        {backendStatus && (
          <Box sx={{ mt: 3 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap sx={{ flexWrap: "wrap" }} aria-label="后端状态摘要">
              {[
                ["排队中", backendStatus.jobs.queued],
                ["运行中", backendStatus.jobs.running],
                ["已完成", backendStatus.jobs.completed],
                ["失败", backendStatus.jobs.failed],
                ["已取消", backendStatus.jobs.cancelled],
              ].map(([label, value]) => (
                <Box key={label} sx={{ flex: "1 1 110px", p: 1.25, border: "1px solid #263945", borderRadius: 1, bgcolor: "#0d171e" }}>
                  <Typography component="p" sx={{ m: 0, color: "text.secondary", fontSize: ".7rem" }}>{label}</Typography>
                  <Typography component="p" sx={{ m: 0.25, color: "primary.main", fontSize: "1.25rem", fontVariantNumeric: "tabular-nums", fontWeight: 750 }}>{value}</Typography>
                </Box>
              ))}
            </Stack>

            <Box sx={{ mt: 2, p: 1.5, border: "1px solid #263945", borderRadius: 1, bgcolor: "#0d171e" }}>
              <Typography component="p" sx={{ m: 0, color: "text.secondary", fontSize: ".75rem" }}>
                求解器：{backendStatus.solver.registered ? "已注册" : "未注册"} · 队列长度：{backendStatus.solver.queue_length} · 更新于 {formatStatusTime(backendStatus.generated_at)}
              </Typography>
              {backendStatus.active ? (
                <Typography component="p" sx={{ m: "0.625rem 0 0", color: "#dce6eb", fontSize: ".8rem" }}>
                  当前任务：{backendStatus.active.job_id} · {backendStatus.active.order}×{backendStatus.active.order} · {statusPhaseLabel(backendStatus.active.phase)}
                </Typography>
              ) : (
                <Typography component="p" sx={{ m: "0.625rem 0 0", color: "text.secondary", fontSize: ".8rem" }}>当前没有运行中的任务</Typography>
              )}
            </Box>

            <Box sx={{ mt: 2 }}>
              <Typography component="h2" variant="h3" sx={{ mb: 1 }}>等待队列</Typography>
              {backendStatus.queue.length === 0 ? (
                <Typography component="p" sx={{ m: 0, color: "text.secondary", fontSize: ".8rem" }}>当前没有排队任务</Typography>
              ) : (
                <Stack spacing={0.875}>
                  {backendStatus.queue.map((job) => (
                    <Box key={job.job_id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, p: 1.25, border: "1px solid #263945", borderRadius: 1, bgcolor: "#111a21" }}>
                      <Typography component="span" sx={{ color: "primary.main", fontSize: ".8rem", fontVariantNumeric: "tabular-nums" }}>#{job.position} · {job.job_id}</Typography>
                      <Typography component="span" sx={{ color: "text.secondary", fontSize: ".76rem", whiteSpace: "nowrap" }}>{job.order}×{job.order} · {statusPhaseLabel(job.phase)}</Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  );
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
  const [speedPreset, setSpeedPreset] = useState<SpeedPreset>("standard");
  const [customSpeedSeconds, setCustomSpeedSeconds] = useState(1);
  const [playbackAnimation, setPlaybackAnimation] = useState<CubeAnimation | null>(null);
  const [pendingOrder, setPendingOrder] = useState<number | null>(null);
  const [viewportControls, setViewportControls] = useState<ViewControls | null>(null);
  const mobileLayout = useMediaQuery(MOBILE_MEDIA_QUERY, { noSsr: true });
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
  const viewportControlsRef = useRef<ViewControls | null>(null);
  const playbackDelayMs = speedPreset === "custom"
    ? Math.round(customSpeedSeconds * 1000)
    : PRESET_SPEEDS[speedPreset];

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
  const handleViewControlsReady = useCallback((controls: ViewControls | null) => {
    viewportControlsRef.current = controls;
    setViewportControls(controls);
  }, []);

  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/status") {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <StatusPage />
      </ThemeProvider>
    );
  }

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
            [DESKTOP_LAYOUT_QUERY]: {
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
            alignItems: "center",
            justifyContent: "space-between",
            flexDirection: "row",
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
              m: 0,
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
              [MOBILE_LAYOUT_QUERY]: { display: "none" },
            }}
          >
            <FormControl size="small" sx={{ minWidth: { xs: 112, sm: 124 } }}>
              <InputLabel id="order-select-label">魔方阶数</InputLabel>
              <Select
                labelId="order-select-label"
                id="order-select"
                label="魔方阶数"
                aria-label="魔方阶数"
                value={order}
                onChange={(event) => changeOrder(String(event.target.value))}
              >
                {ORDERS.map((value) => <MenuItem key={value} value={value}>{value}×{value}</MenuItem>)}
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
                gridTemplateColumns: "minmax(0, 1.65fr) minmax(120px, .85fr)",
                gridTemplateAreas: '"mobile-controls mobile-controls" "cube solution" "editor editor" "control control"',
                columnGap: 0.875,
                rowGap: 0,
                minWidth: 0,
                p: 1.25,
                border: "1px solid #263945",
                borderRadius: 1.5,
                bgcolor: "#111a21",
                overflow: "hidden",
              },
            }}
          >
          {mobileLayout && (
            <MobileWorkspaceControls
              viewControls={viewportControls}
              order={order}
              formula={formula}
              playbackIndex={playbackIndex}
              playing={playing}
              speedPreset={speedPreset}
              customSpeedSeconds={customSpeedSeconds}
              isBusy={isBusy}
              hasActiveJob={Boolean(jobId)}
              onOrderChange={changeOrder}
              onSolve={solve}
              onCancelSolve={cancelSolve}
              onCopyFormula={copyFormula}
              onPrevious={() => setPlaybackStep(playbackIndex - 1)}
              onNext={() => setPlaybackStep(playbackIndex + 1)}
              onTogglePlayback={togglePlayback}
              onSpeedPresetChange={setSpeedPreset}
              onCustomSpeedChange={setCustomSpeedSeconds}
            />
          )}
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
              p: { xs: 1.5, sm: 3.375 },
              [MOBILE_LAYOUT_QUERY]: { gridArea: "cube", p: 0.75, border: "none", borderRadius: 0, bgcolor: "transparent" },
            }}
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
                animationDuration={Math.max(240, Math.min(520, playbackDelayMs * 0.72))}
                onViewChange={handleViewChange}
                onViewControlsReady={handleViewControlsReady}
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

          </Paper>

          <Box
            className="editor-bar"
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
            <Box className="editor-copy" sx={{ [MOBILE_LAYOUT_QUERY]: { display: "none" } }}>
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
                [theme.breakpoints.up("sm")]: { overflow: "hidden" },
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
                    02 · 逐步回放
                  </Typography>
                  <Typography component="h2" variant="h2">解法公式</Typography>
                </Box>
                {formula.length > 0 && <Typography component="span" className="formula-count" sx={{ color: "primary.main", fontSize: ".72rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formula.length} 步</Typography>}
              </Box>

              <Box
                className="formula-toolbar"
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto" },
                  alignItems: "start",
                  gap: 1.5,
                  mt: 1,
                  pt: 0.875,
                  pb: 1.25,
                  [MOBILE_LAYOUT_QUERY]: { display: "none" },
                }}
              >
                <Box className="formula-actions" sx={{ display: "grid", gridTemplateColumns: formula.length > 0 ? "repeat(4, minmax(0, 1fr))" : "minmax(0, 1fr)", gap: 0.625, minWidth: 0 }}>
                  <Button type="button" onClick={copyFormula} disabled={!formula.length} sx={{ width: "100%", minWidth: 0, minHeight: 40, px: 0.875, fontSize: ".75rem", whiteSpace: "nowrap" }}>复制公式</Button>
                  {formula.length > 0 && <>
                    <Button type="button" aria-label="上一步" onClick={() => setPlaybackStep(playbackIndex - 1)} sx={{ width: "100%", minWidth: 0, minHeight: 40, px: 0.875, fontSize: ".75rem", whiteSpace: "nowrap" }}>← 上一步</Button>
                    <Button type="button" aria-label="下一步" onClick={() => setPlaybackStep(playbackIndex + 1)} sx={{ width: "100%", minWidth: 0, minHeight: 40, px: 0.875, fontSize: ".75rem", whiteSpace: "nowrap" }}>下一步 →</Button>
                    <Button type="button" aria-label={playing ? "暂停播放" : "播放公式"} onClick={togglePlayback} sx={{ width: "100%", minWidth: 0, minHeight: 40, px: 0.875, fontSize: ".75rem", whiteSpace: "nowrap" }}>{playing ? "暂停" : "播放"}</Button>
                  </>}
                </Box>
                {formula.length > 0 && (
                  <FormControl className="speed-control" fullWidth size="small" sx={{ gridColumn: { xs: "1", sm: "2" }, width: { xs: "100%", sm: 112 }, minWidth: { sm: 112 } }}>
                    <InputLabel id="speed-select-label">播放速度</InputLabel>
                    <Select
                      labelId="speed-select-label"
                      id="speed-select"
                      label="播放速度"
                      aria-label="播放速度"
                      value={speedPreset}
                      onChange={(event) => setSpeedPreset(event.target.value as SpeedPreset)}
                      renderValue={(value) => ({ slow: "慢速", standard: "标准", fast: "快速", custom: "自定义" }[value as SpeedPreset])}
                    >
                      <MenuItem value="slow">慢速（1.0 秒/步）</MenuItem>
                      <MenuItem value="standard">标准（0.7 秒/步）</MenuItem>
                      <MenuItem value="fast">快速（0.35 秒/步）</MenuItem>
                      <MenuItem value="custom">自定义</MenuItem>
                    </Select>
                  </FormControl>
                )}
                {formula.length > 0 && speedPreset === "custom" && (
                  <Box className="custom-speed-control" sx={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 1.25, px: 0.75 }}>
                    <Typography component="p" sx={{ m: 0, color: "text.secondary", fontSize: ".72rem", whiteSpace: "nowrap" }}>
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
                      onChange={(_, value) => setCustomSpeedSeconds(typeof value === "number" ? value : value[0] ?? CUSTOM_SPEED_MIN_SECONDS)}
                    />
                  </Box>
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
                          [MOBILE_LAYOUT_QUERY]: { gridTemplateColumns: "25px minmax(0, 1fr)", gap: 0.625, px: 0.625 },
                        }}
                      >
                        <Box component="span" className="move-number" sx={{ display: "grid", width: 27, height: 27, placeItems: "center", color: "#78909d", bgcolor: "#0b1116", borderRadius: "50%", fontSize: ".68rem", fontVariantNumeric: "tabular-nums" }}>{moveIndex + 1}</Box>
                        <Box component="span" className="move-token" sx={{ color: "#8fe0d0", fontSize: ".91rem", fontWeight: 800 }}>{token}</Box>
                        <Box component="span" className="move-explanation" sx={{ minWidth: 0, overflowWrap: "anywhere", color: "#aebdc5", fontSize: ".75rem", lineHeight: 1.35, [MOBILE_LAYOUT_QUERY]: { display: "none" } }}>{explainMove(token)}</Box>
                      </Button>
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>

            <Paper component="section" className="panel control-panel" aria-labelledby="control-panel-title" sx={{ minWidth: 0, p: { xs: 2, sm: 2.625 }, [MOBILE_LAYOUT_QUERY]: { gridArea: "control", p: 0.75, border: "none", borderRadius: 0, bgcolor: "transparent" } }}>
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
    </ThemeProvider>
  );
}
