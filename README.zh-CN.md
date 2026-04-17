# Holdem MVP

一个带实时牌桌同步的在线 No-Limit Texas Hold'em MVP，采用服务端权威状态模型。

[English](./README.md)

## 工作区结构

- `apps/server`: 基于 Express + WebSocket 的权威服务端
- `apps/web`: 基于 React + Vite 的 Web 客户端（大厅、牌桌、操作）
- `packages/poker`: 扑克引擎（牌桌生命周期、玩家动作、边池、摊牌、手牌历史）

## 快速开始

1. 安装依赖：

```bash
npm install
```

2. 配置环境变量（可选，但推荐）：

仓库当前没有 `.env.example`，可以直接在仓库根目录创建 `.env`：

```env
SERVER_PORT=3001
CORS_ORIGIN=http://localhost:5173
ADMIN_USERNAMES=admin
VITE_API_URL=http://localhost:3001
```

服务端会自动在常见路径中查找 `.env`，包括仓库根目录。  
如果从自定义工作目录启动进程，也可以显式设置：

```bash
DOTENV_CONFIG_PATH=/absolute/path/to/.env
```

3. 启动服务端：

```bash
npm run dev:server
```

4. 在另一个终端启动前端：

```bash
npm run dev:web
```

5. 打开 `http://localhost:5173`。

## 管理员使用说明

可以通过 `.env` 设置管理员用户名：

```env
ADMIN_USERNAMES=admin,alice,bob
```

规则：

- 用户名匹配不区分大小写（`admin` 和 `Admin` 等价）
- 使用管理员用户名登录后，会自动获得管理员权限
- 管理员身份会按配置名归并（例如管理页里 `admin` 会作为一个管理员用户组出现）

管理员在 UI/API 中可以执行：

- 搜索用户：`GET /api/admin/users?q=xxx`
- 创建用户：`POST /api/admin/users`
- 重命名用户：`PATCH /api/admin/users/:playerId`
- 删除用户：`DELETE /api/admin/users/:playerId`
- 关闭牌桌：`DELETE /api/admin/tables/:tableId`

## 游戏流程约束

- 第一位在牌桌入座的玩家会成为房主
- 只有房主可以开始新的一手
- 一旦牌桌已经开始过手牌，就不能再换座

## 已实现能力

- 游客会话认证和受保护 API 路由
- 创建、列出、加入和离开牌桌
- 服务端权威的手牌流程：
  - 庄家 / 盲注推进
  - 行动顺序控制
  - 合法动作校验
  - `check` / `call` / `bet` / `raise` / `fold` / `all-in`
  - 边池处理
  - 摊牌与无人争夺底池结算
- 基于 WebSocket 的牌桌实时订阅
- 按玩家隔离的私有手牌可见性
- 基于 `expectedVersion` 的并发版本校验
- 超时后自动执行 `check` 或 `fold`
- 内存中的手牌历史
- Dockerfile、Compose 栈和反向代理示例

## 验证

- 扑克引擎测试：

```bash
npm run test --workspace @holdem/poker
```

- 全工作区类型检查：

```bash
npm run typecheck
```

- API 冒烟检查（要求服务端运行在 `localhost:3001`）：

```powershell
./scripts/smoke-check.ps1
```

## 说明

- 当前持久化层仍然是内存态；服务端重启后牌桌和手牌状态会被清空
- `docker-compose.yml` 包含 PostgreSQL / Redis 以便部署联调，但当前 MVP 服务端尚未真正持久化到 PostgreSQL，也未使用 Redis 做分布式协调
