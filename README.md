# Holdem MVP

Authoritative online no-limit Texas Hold'em MVP with realtime table sync.

[中文](./README.zh-CN.md)

## Workspace

- `apps/server`: Express + WebSocket authoritative server
- `apps/web`: React + Vite web client (lobby + table + actions)
- `packages/poker`: Poker engine (table lifecycle, actions, side pots, showdown, hand history)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables (optional but recommended):

```bash
cp .env.example .env
```

The server will automatically search common locations for `.env` (including repository root).  
If your process starts from a custom working directory, set `DOTENV_CONFIG_PATH=/absolute/path/to/.env`.

3. Start server:

```bash
npm run dev:server
```

4. In another terminal, start web:

```bash
npm run dev:web
```

5. Open `http://localhost:5173`.

## Admin Usage

Set admin usernames via `.env`:

```env
ADMIN_USERNAMES=admin,alice,bob
```

Rules:

- Username matching is case-insensitive (`admin` == `Admin`).
- If you login with an admin username, you get admin privileges automatically.
- Admin identity is grouped by configured name (for example `admin` appears as one admin user group in management).

What admin can do in UI/API:

- Search users: `GET /api/admin/users?q=xxx`
- Create user: `POST /api/admin/users`
- Rename user: `PATCH /api/admin/users/:playerId`
- Delete user: `DELETE /api/admin/users/:playerId`
- Close table: `DELETE /api/admin/tables/:tableId`

Game flow constraints:

- First player who seats at a table becomes the host.
- Only host can start a new hand.
- After a hand has started on a table, seat switching is disabled.

## Implemented Capabilities

- Authenticated guest session and protected API routes.
- Table creation/listing/joining/leaving.
- Authoritative server hand progression:
  - dealer/blinds
  - turn order
  - legal action validation
  - check/call/bet/raise/fold/all-in
  - side pots
  - showdown and uncontested settlement
- Realtime table subscriptions over WebSocket.
- Per-player private card visibility.
- Stale-version rejection via `expectedVersion`.
- Turn timeout with automatic `check` or `fold`.
- Hand history persistence in memory.
- Dockerfiles + compose stack + reverse proxy example.

## Verification

- Poker package tests:

```bash
npm run test --workspace @holdem/poker
```

- Typecheck all workspaces:

```bash
npm run typecheck
```

- API smoke check (server running on localhost:3001):

```powershell
./scripts/smoke-check.ps1
```

## Notes

- Current persistence layer is in-memory; table/hand state resets on server restart.
- Docker compose includes PostgreSQL/Redis services for deployment wiring, but the current MVP server does not yet persist to PostgreSQL or use Redis for distributed locking.
