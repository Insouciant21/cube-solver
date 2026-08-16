# 613 Cube Solver — 项目功能总结

这是一个**本地优先（local-first）的魔方求解 Web 应用**，包含一个浏览器端
（React + Three.js）和一个 Python FastAPI 后端（`apps/api`）。用户为 2–7
阶魔方贴纸直接在 3D 模型上编辑，由后端 NxNxN 求解器算出还原步骤，前端负责展示与播放。

## 功能模块

### 前端（`apps/web`）
- **魔方状态核心**（`src/cube/`）：
  - `state.ts`：`CubeState` 是 2–7 阶的唯一数据源（single source of truth），
    支持创建、3D 涂色、撤销/重做、重置与持久化（localStorage），不再维护 2D 展开图编辑器。
  - `moves.ts` / `notation.ts`：移动表示与 WCA 符号解析/解释。
  - `coordinates.ts` / `orientation.ts` / `painting.ts` / `palette.ts` /
    `random.ts` / `history.ts` / `validation.ts`：坐标、朝向、涂色、随机打乱、
    历史记录与校验等工具。
- **`App.tsx`**：主界面，包含求解状态机（排队 → 下载 → 归约 → 求解 → 搜索 →
  验证 → 完成/失败/取消），通过 SSE 增量消费后端事件。
- **`CubeViewport.tsx`**：Three.js 3D 编辑视图，贴纸网格带稳定的 face/index 元数据，
  支持完整自由视角、六面快速对准和按 move 的分层动画；点击贴纸与拖拽旋转都在同一 3D 入口完成。
- 播放使用独立状态，绝不改动用户涂色的输入魔方。
- 编辑会递增 revision、清空播放/结果并取消旧的求解。

### 后端（`apps/api`）
- **`main.py`**：FastAPI 应用，提供求解、校验、健康检查等接口。
  - 显式 FIFO 求解队列，隔离进程组，一次性 worker 临时目录。
  - 环境变量白名单、可选资源限制（CPU/内存/进程数）以及取消/超时清理。
  - SSE 事件流：排队、下载、归约、求解、搜索、验证、完成/失败/取消。
- **`solver.py` / `solver_backend.py`**：调用正式 NxNxN 求解器；BFS 仅在
  显式开启 `CUBE_ALLOW_BOUNDED_FALLBACK=1` 时作为开发用后备。
- **`reachability.py`**：可达性检查（结构、块组合、角/棱朝向、轨道约束与奇偶性）。
- **`replay.py`**：重放移动并校验贴纸是否为已还原状态。
- 查找表原子化下载、校验上游声明的记录维度，仅存入 `solver-data` 卷。

### 测试
- 前端：单元测试（state、moves、notation、coords、validation 等）、
  Playwright E2E（`e2e/cube.spec.ts`）。
- 后端：`test_health.py`、`test_solver.py`、`test_replay.py`、
  `test_reachability.py`、`test_validation.py`、`test_import_order.py` 等。

## 关键设计约束
- 贴纸始终留在浏览器/API 进程中，绝不发送到第三方托管求解器。
- 使用 `PLAN.md` 中记录的固定版本求解器提交。
- 在求解前确定性校验；超时、下载、取消或后端不可用绝不标记为“无效魔方”。
- 重放 canonical 与选定帧公式后才发出 `verified: true`。

## 验证
在 `tmp/cube` 目录运行 `bash scripts/verify.sh` 执行完整验证。
