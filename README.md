# 613 Cube Solver

`613 Cube Solver` 是一个本地优先的 2 到 7 阶魔方录入、校验和求解工作台。用户可在
3D 视图中直接编辑贴纸，选择正面与相邻顶面，并获得经过后端双重回放验证的 WCA 公式、
中文逐步说明和动画回放。魔方状态不会发送到托管求解服务。

正式求解路径固定使用 `PLAN.md` 记录的 NxNxN 与 Kociemba commit。2–3 阶使用成熟
求解算法，4–7 阶使用降阶和持久化查表；有界 BFS 仅用于显式开启的开发后备，Compose
始终将其关闭。

## 推荐运行方式

Docker Compose 提供生产式的本地单入口，并将高阶查找表持久化到 `solver-data` 命名卷：

```bash
docker compose up -d --build
```

浏览器地址：http://127.0.0.1:6131

健康检查：

```bash
curl http://127.0.0.1:6131/api/health
```

API 与 Web 容器均以非 root 用户和只读根文件系统运行；运行时临时目录使用 tmpfs。
不要执行 `docker compose down -v`，除非确实要删除已下载的高阶查找表。

查看持久化查找表与命名卷：

```bash
docker compose exec -T api du -sh /app/lookup-tables
docker volume ls --filter name=solver-data
```

### 开发模式

API 和 Vite 也可分别作为宿主机进程启动。先完成“安装依赖”一节中的安装，并确保
宿主机 Python 环境已安装 `PLAN.md` 锁定的正式 Kociemba/NxNxN 求解器版本。

终端一（API）：

```bash
cd apps/api
CUBE_ALLOW_BOUNDED_FALLBACK=0 uv run uvicorn cube_api.main:app --host 127.0.0.1 --port 8000
```

终端二（Web）：

```bash
cd tmp/cube
npm run dev --workspace @613-cube-solver/web -- --host 127.0.0.1
```

浏览器地址：http://127.0.0.1:5173

Vite 已将 `/api/*` 代理到 `127.0.0.1:8000`，因此浏览器不需要跨域配置。从
`apps/api` 启动 API 时，查表缓存位于 `apps/api/lookup-tables/`。

4–7 阶的固定上游还会调用 `ida_search_via_graph` 原生 helper。Docker Compose
会在构建 API 镜像时从锁定 commit 编译它；宿主机运行正式高阶求解时，应将同一构建
产物的绝对路径设置为 `CUBE_IDA_SEARCH_PATH`。helper 缺失会报告
`SOLVER_OPERATIONAL_ERROR`，不会把运行环境问题误报为非法魔方。

## 目录结构

```text
tmp/cube/
├── AGENT_LOG.md                 # 613 Coding 操作记录（追加写入）
├── harness.toml                 # 本项目的 613 Coding 运行配置
├── package.json                 # npm workspace 根配置
├── package-lock.json
├── scripts/verify.sh             # 前端和 API 的统一验证脚本
├── apps/web/e2e/                 # Playwright 桌面/移动端验收
└── apps/
    ├── web/                     # React + Vite + TypeScript 前端
    │   ├── src/App.tsx
    │   ├── src/App.test.tsx
    │   └── src/cube/
    │       ├── coordinates.ts   # 贴纸与三维坐标的映射
    │       ├── moves.ts         # 转动解析和状态变换
    │       ├── palette.ts       # 面与颜色的默认映射
    │       ├── state.ts         # 状态、历史、撤销/重做和持久化校验
    │       └── types.ts         # 魔方领域类型
    └── api/                     # FastAPI 后端
        ├── pyproject.toml
        ├── uv.lock
        ├── src/cube_api/main.py
        └── tests/test_health.py
```

`node_modules/`、`apps/web/dist/`、Python 虚拟环境和 `.613-coding/` 等目录属于本地生成物，不是产品源码，也不应手动提交。

## 环境要求

- Node.js 和 npm
- Python 3.12 或更高版本
- `uv`
- 如需使用 613 Coding，先完成其凭据配置；密钥保存在系统 keyring 中，不写入仓库文件

Python 依赖统一由 `uv` 管理，不使用 pip requirements 文件。

## 安装依赖

在本目录执行：

```bash
npm install
uv sync --project apps/api --all-groups
```

## 验证

统一验证前端测试、lint、类型检查、构建，以及 API 的 pytest、Ruff 和 mypy：

```bash
bash scripts/verify.sh
```

也可以分别执行根目录的 npm 脚本：

```bash
npm run test:web
npm run lint:web
npm run typecheck:web
npm run build:web
```

Playwright 浏览器验收（首次需要下载 Chromium）：

```bash
npx playwright install chromium
npm run test:e2e:web
```

该套件会在临时 Vite 服务上 mock 求解 API，覆盖桌面和 Chromium 移动视口；宿主机开发
Vite 和 Compose nginx 都通过 `/api` 代理连接 FastAPI。

API 检查：

```bash
cd apps/api
uv run pytest
uv run ruff check .
uv run mypy
```

## 本地启动

启动前端开发服务器：

```bash
npm run dev --workspace @613-cube-solver/web
```

或：

```bash
cd apps/web
npm run dev
```

Vite 通常监听 `http://localhost:5173`，并把 `/api` 转发到 `http://localhost:8000`。

启动 FastAPI：

```bash
cd apps/api
uv run uvicorn cube_api.main:app --reload --host 127.0.0.1 --port 8000
```

API 通常监听 `http://localhost:8000`。健康检查接口为：

```bash
curl http://localhost:8000/api/health
```

预期响应：

```json
{"status":"ok"}
```

## 当前能力

- React/Vite 工作台支持 2x2–7x7、直接在 3D 模型上编辑贴纸、撤销/重做、重置、localStorage 持久化和修订状态；不再提供 2D 展开图涂色。
- Three.js canvas 预览支持按阶数生成六面贴纸、可跨越顶/底面的四元数自由拖拽视角、六面快速对准、滚轮/双指缩放以及重置/适配视图；3D 涂色不会重置相机，贴纸颜色不受底面光照阴影影响。无 WebGL 时保留可访问的 canvas 占位。
- 解法列表与 3D 模型并排显示，逐步播放时按移动轴/层做 90°、180° 动画，并在界面显示当前镜头朝向。
- 前端默认使用 F/U 参考面，支持 `/api/validate`、`/api/solve`、SSE 事件订阅、取消任务和显示 replay-verified 公式。
- FastAPI 提供颜色数量/结构/方向校验、短任务生命周期、取消、SSE，以及后端几何 replay 校验。
- 默认求解路径是固定版本 `rubiks-cube-NxNxN-solver`，会按阶数选择 2x2/3x3 或 4x4–7x7 降阶查表流程；所有结果都经过后端 replay 验证。
- 仅当 `CUBE_ALLOW_BOUNDED_FALLBACK=1` 时才允许确定性 BFS 处理短公式开发样例；Compose 生产配置将其关闭，正式后端不可用时返回 `SOLVER_UNAVAILABLE`，helper/进程执行故障返回 `SOLVER_OPERATIONAL_ERROR`。
- API 使用显式条件队列保证提交顺序；每个求解在独立进程组中运行，worker 使用一次性临时目录、环境白名单和可配置 CPU/内存/PID 上限。SSE 会增量发送 `queued`、`running`、`downloading`、`reducing`、`solving`、`verifying`、`completed`、`cancelled` 和稳定失败码。取消和超时会终止整个进程组。
- 4–7 阶首次求解可能从上游 S3 获取查表数据；宿主机模式将表写入 `apps/api/lookup-tables/`，后续运行复用缓存。SSE 会显示已完成表文件的实际字节数和缓存命中状态；适配器会按上游对象声明的行数/行宽/文件大小校验表。删除该目录会触发重新下载。下载、解压或完整性校验失败返回 `TABLE_DOWNLOAD_FAILED`，不会伪装成非法状态。
- Compose 提供 API 与 nginx Web 服务：API 使用非 root `nobody`，Web 使用 UID 101 的非 root `nginx`，内部监听 8080 并通过 `127.0.0.1:6131` 提供同源入口；两者均为只读根文件系统并将运行时临时文件限制到 tmpfs。`scripts/verify-api-perms.sh` 检查 API 源码权限策略。

## 当前限制

- 高阶查表由固定上游在首次使用时下载；5–7 阶完整真实 fixture 会下载较大的查表文件，因此放在 `RUN_REAL_CUBE_FIXTURES=1` 的 slow 测试中，不会被普通离线单元套件隐式触发。
- API 已做颜色计数、固定中心、角块/棱块组合、角棱方向、3 阶排列 parity 和高阶 wing/center orbit 诊断；固定上游 sanity check 仍是最终求解权威。
- Playwright 桌面/移动端行为验收包含 WebGL canvas 截图与像素检查；首次运行需先安装 Chromium。单元测试覆盖公式逐步播放、中文解释、3D 六面法线和贴纸编辑契约。
- 求解结果保证经过回放验证，但不承诺步数最优。
- 宿主机模式不依赖 Docker 端口转发；若需要局域网访问，应显式将 Vite 的监听地址改为
  `0.0.0.0` 并配置防火墙，同时保留 API 仅监听本机。


## 正式求解路径与查表

求解器适配将 API 的 `U,D,F,B,L,R` 颜色索引转换为上游要求的 `U,R,F,D,L,B` facelet 字符串，并调用固定 commit `c776db79314db3d98cc3dd99685ca85766656937` 的 `RubiksCube222` 到 `RubiksCube777`。3 阶使用锁定 commit `64fd123bd9cc21d058b37a66473a2fe1807b6dad` 构建的 Kociemba 两阶段算法（GPL-2.0）；4–7 阶采用中心归位、棱块配对、降阶到 3 阶，再结合预计算查表和 IDA* 阶段求解。它们确实是成熟的公式/查表流程，运行时的有限搜索只发生在这些已定义阶段的状态空间内。宿主机缓存相对于进程工作目录写入 `lookup-tables/`（按上述开发命令即 `apps/api/lookup-tables/`，从仓库根运行真实 fixture 时即根目录 `lookup-tables/`）；Compose 缓存位于容器内 `/app/lookup-tables/`，并由 `solver-data` 命名卷持久化。

生产 Compose 设置 `CUBE_ALLOW_BOUNDED_FALLBACK=0`，因此不会把 BFS 当作 2–7 阶的正式算法。开发测试若需覆盖无依赖短公式，可显式设置为 `1`；该开关开启时产生的 `searching` 事件仅代表开发兜底。
## 高阶真实 fixture

默认测试不联网。要运行固定 NxNxN 后端的 2–7 阶单步 fixture（首次运行可能很慢并下载查表），执行：

```bash
RUN_REAL_CUBE_FIXTURES=1 CUBE_ALLOW_BOUNDED_FALLBACK=0 \
  uv run --project apps/api pytest -m slow -vv -s apps/api/tests/test_solver_fixtures.py
```

该测试明确关闭 BFS 兜底，并检查返回公式 replay 后六面复原；其中包含
`4x4 Rw U F2` 用例，覆盖原生 IDA graph helper 的实际执行路径。

## 使用 613 Coding 继续开发

从工作区根目录启动 613 Coding TUI，并把 `tmp/cube` 作为目标仓库：

```bash
cd /home/int21/Workspace/ai4se_project
uv run 613-coding --repo /home/int21/Workspace/ai4se_project/tmp/cube \
  "阅读 AGENT_LOG.md、README.md 和现有 cube domain，先补充 3D 可视化编辑器设计与测试"
```

每次交给 613 Coding 的操作都应追加记录到 `tmp/cube/AGENT_LOG.md`，包括运行命令、任务范围、验证结果和未完成原因。不要把 API key、完整凭据或其他敏感值写入日志或源码。

建议每个任务只处理一个可验证的垂直切片，例如先完成 3D 展示，再完成单贴纸编辑，再完成合法性校验，最后接入求解器和公式展示。每个切片完成后重新运行 `bash scripts/verify.sh`。

## 开发约定

- Python 包和命令使用 `uv` 管理。
- 前端领域逻辑保持为可测试的纯 TypeScript，避免把求解规则直接耦合到渲染组件。
- 变更应保持小范围，并为状态变换、非法输入和公式输出补充测试。
- 不提交本地依赖、构建产物、keyring 内容或运行状态数据库。
