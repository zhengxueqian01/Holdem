# Holdem MVP

Authoritative online no-limit Texas Hold'em MVP with realtime table sync.

## Workspace

- `apps/server`: Express + WebSocket authoritative server
- `apps/web`: React + Vite web client (lobby + table + actions)
- `packages/poker`: Poker engine (table lifecycle, actions, side pots, showdown, hand history)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm run dev:server
```

3. In another terminal, start web:

```bash
npm run dev:web
```

4. Open `http://localhost:5173`.

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
