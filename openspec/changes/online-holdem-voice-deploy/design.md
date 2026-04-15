## Context

This repository starts empty, so the MVP can choose a clean architecture while staying small enough to deploy and review. The system must support browser players joining the same Texas Hold'em table, receiving authoritative realtime state, talking in table-scoped voice rooms, and running on a single production server before scaling out.

Primary stakeholders are players, table hosts/admins, and the operator deploying the service. The MVP is play-money only and must not include payments, real-money gambling, or telemetry.

## Goals / Non-Goals

**Goals:**

- Provide a production-deployable web MVP for online no-limit Texas Hold'em.
- Keep poker rules authoritative on the server and deterministic enough to test.
- Support realtime table updates and reconnects without client-side rule authority.
- Provide table-scoped voice chat with clear access control.
- Ship with Docker-based deployment, environment examples, and smoke checks.

**Non-Goals:**

- Real-money gambling, payment processing, KYC, or jurisdiction-specific gaming compliance.
- Native mobile apps.
- Public ranked matchmaking, tournaments, or multi-table play.
- Advanced bot detection, collusion analytics, or moderation tooling beyond basic admin controls.

## Decisions

### Use a TypeScript monorepo

Use a small workspace with `apps/web`, `apps/server`, and `packages/poker`. The poker engine lives in a shared package used by server tests and any client-side display helpers, but only the server mutates canonical game state.

Alternative considered: a single Next.js app with API routes and WebSocket glue. That is faster at first but tends to mix UI, game engine, realtime transport, and deployment concerns in one place.

### Use an authoritative Node realtime server

Use Node.js with WebSocket support for table subscriptions and player actions. Every client action is validated against the current table state, active seat, legal action set, and action timer before being committed and broadcast.

Alternative considered: peer-to-peer state sync. That is unsuitable for poker because clients must not decide cards, pot settlement, or turn order.

### Use PostgreSQL plus Redis

PostgreSQL stores users, tables, seats, hand snapshots, action history, and durable session metadata. Redis stores short-lived presence, table locks, timers, and pub/sub state needed by realtime workers.

Alternative considered: in-memory-only state. It reduces setup but breaks reconnects, auditability, and crash recovery.

### Use a tested poker hand evaluator

Use a proven poker evaluator library or a compact well-tested internal evaluator if no maintained TypeScript dependency fits. The evaluator must be wrapped behind `packages/poker` so tests define the project contract.

Alternative considered: hand-ranking logic directly inside handlers. That raises bug risk and makes showdown behavior harder to test.

### Use LiveKit for voice rooms

Use LiveKit as the SFU for production voice. The app server mints table-scoped LiveKit access tokens only for authenticated players seated or observing that table, and WebSocket signaling remains separate from poker state.

Alternative considered: raw peer-to-peer WebRTC mesh. Mesh is simpler for two users but gets unreliable and bandwidth-heavy at a full poker table.

### Use Docker Compose for first deployment

Provide Compose services for web, server, PostgreSQL, Redis, LiveKit, and Nginx/Caddy. The first target is one Linux server with HTTPS, WebSocket upgrade support, persistent volumes, and environment-driven secrets.

Alternative considered: Kubernetes. It is unnecessary for the MVP and adds operational overhead before the service needs it.

## Risks / Trade-offs

- Poker rule bugs -> Mitigate with table-driven tests for betting rounds, side pots, all-in flows, showdown, and disconnect/fold timing.
- Timer and concurrency races -> Mitigate with per-table serialized command handling and Redis locks if multiple server instances are enabled.
- Voice network complexity -> Mitigate by using LiveKit and documenting required TCP/UDP ports.
- Regulatory ambiguity -> Mitigate by keeping the MVP play-money only and avoiding payments, prizes, or cash-out flows.
- Single-server deployment limits -> Mitigate by keeping service boundaries compatible with later horizontal scaling.

## Migration Plan

1. Initialize the TypeScript workspace, baseline lint/test/build scripts, and Docker skeleton.
2. Build and test the poker domain engine before wiring UI or network flows.
3. Add persistence and realtime command handling behind integration tests.
4. Add the web lobby/table UI and connect it to authenticated realtime sessions.
5. Add LiveKit token issuance and voice UI controls.
6. Add production Compose files, Nginx/Caddy config, `.env.example`, and smoke checks.
7. Deploy to a staging server, run migrations, verify HTTPS, WebSocket upgrades, table play, reconnect, and voice join.

Rollback for the MVP is container image rollback plus database backup restore if migrations are not backward compatible.

## Open Questions

- Which server domain name and TLS provider should the deployment use?
- Should login be username/password, magic link, or anonymous guest accounts for the MVP?
- What table limits are required first: max players, blind sizes, buy-in range, and action timer duration?
- Should observers be allowed to join voice, or only seated players?
