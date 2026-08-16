# 613 Cube Solver — 项目功能总结

本项目是一个魔方（Rubik's Cube）求解器 monorepo，包含两个应用：

## 总体架构
- **`apps/web`** — 前端（React + Vite + Three.js + TypeScript）
- **`apps/api`** — 后端（Python FastAPI，使用 `uv` 管理）

---

## 前端 `apps/web`

### 3D 魔方可视化
- 使用 Three.js 渲染可交互的 3D 魔方工作区（`CubeViewport`），支持跨越顶/底面的四元数自由视角、六面快速对准、触摸/鼠标操作和缩放。
- 支持不同阶数（order 2~7）的魔方，可切换。

### 魔方编辑
- 只通过 3D 模型上的贴纸进行涂色（不再提供 2D 展开图），使用 6 种标准配色（白/黄/绿/蓝/橙/红）。
- 支持撤销（undo）/重做（redo）、重置（reset）、随机打乱（scramble）。
- 状态持久化：每阶魔方状态与视角朝向分别存入 `localStorage`，并在读取时校验（validation）。

### 求解功能
- 前端通过 `fetch POST /api/solve` 提交求解任务。
- 通过 SSE（Server-Sent Events）实时接收进度事件（queued → completed / failed）。
- 求解完成后在 3D 模型旁渲染“回放验证通过”的公式（move formula），逐步回放会同步展示对应的层转动动画。

### 核心状态与逻辑模块（`src/cube/`）
- `state.ts` — 魔方状态建模、应用转动（applyMove）、求解判定（isSolved）、快照/历史。
- `moves.ts` / `notation.ts` — 转动定义与记号解释。
- `coords.ts` / `coordinates.ts` — 贴纸与坐标映射。
- `history.ts` — 撤销/重做历史记录（MAX_HISTORY）。
- `orientation.ts` / `painting.ts` / `palette.ts` / `random.ts` / `validation.ts` / `types.ts` — 朝向、涂色、配色、随机打乱、校验与类型定义。

### 测试
- 单元测试（Vitest + Testing Library）、端到端测试（Playwright）、nginx 配置测试。

---

## 后端 `apps/api`

### HTTP 服务（FastAPI）
- `main.py` — 应用入口与路由。
- 健康检查端点（`/health`）。

### 求解逻辑
- `solver.py` / `solver_backend.py` — 魔方求解器及后端执行。
- `replay.py` — 对求解结果进行回放验证（replay verification），确保公式有效。
- `reachability.py` — 可达性分析。
- 以 SSE 流式推送求解进度。

### 测试
- `tests/` 覆盖健康检查、求解器、回放、可达性、校验、导入顺序等。

---

## 质量保障（`scripts/verify.sh`）
- Web：`vitest` 测试、ESLint 检查、TypeScript 类型检查、`vite build` 构建。
- API：`uv run pytest`、`ruff` 代码规范、`mypy` 类型检查。

## 基础设施
- 每个应用均有 `Dockerfile`；Web 使用 `nginx.conf` 作为运行时服务器。
