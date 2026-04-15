## 1. Project Foundation

- [ ] 1.1 Initialize a TypeScript workspace with `apps/web`, `apps/server`, and `packages/poker`.
- [ ] 1.2 Add shared formatting, linting, typecheck, test, and build scripts.
- [ ] 1.3 Add environment schema validation and `.env.example` without real secrets.
- [ ] 1.4 Add baseline CI/local verification commands for install, lint, test, and build.

## 2. Poker Domain Engine

- [ ] 2.1 Implement deck, shuffle, card, seat, table, player, stack, action, and hand state models in `packages/poker`.
- [ ] 2.2 Implement table creation validation, seat assignment, buy-in validation, sit-out, and leave-seat behavior.
- [ ] 2.3 Implement hand start, dealer/blind rotation, blind posting, private card dealing, and public street progression.
- [ ] 2.4 Implement legal action calculation for fold, check, call, bet, raise, and all-in.
- [ ] 2.5 Implement pot and side-pot calculation, showdown evaluation, uncontested wins, and chip settlement.
- [ ] 2.6 Add table-driven tests for normal hands, invalid actions, all-in side pots, folds, showdown, and edge cases.

## 3. Persistence and Server API

- [ ] 3.1 Add PostgreSQL schema and migrations for users, sessions, tables, seats, hands, actions, and hand histories.
- [ ] 3.2 Add server authentication suitable for MVP accounts or guest sessions.
- [ ] 3.3 Add API endpoints for lobby table listing, table creation, join/leave seat, and table metadata.
- [ ] 3.4 Add hand history persistence and retrieval for completed hands.
- [ ] 3.5 Add integration tests for API validation, persistence, and hand history writes.

## 4. Realtime Session Layer

- [ ] 4.1 Add authenticated WebSocket connection handling and lobby/table subscription management.
- [ ] 4.2 Add server-side command handling that serializes table actions and rejects stale commands.
- [ ] 4.3 Broadcast public table state while sending private cards only to the owning player.
- [ ] 4.4 Implement action timers and configured timeout behavior.
- [ ] 4.5 Implement disconnect tracking and reconnect state restoration.
- [ ] 4.6 Add realtime integration tests for auth rejection, legal action broadcast, hidden-card privacy, stale commands, timers, and reconnect.

## 5. Web Client

- [ ] 5.1 Build lobby UI for table list, create table, and join table flows.
- [ ] 5.2 Build table UI for seats, stacks, blinds, dealer marker, board, pots, current actor, legal actions, and action timer.
- [ ] 5.3 Add authenticated realtime client state management with reconnect handling.
- [ ] 5.4 Add player action controls with validation feedback and disabled states for illegal actions.
- [ ] 5.5 Add hand result and hand history display.
- [ ] 5.6 Add responsive layout checks for desktop and mobile table views.

## 6. Voice Chat

- [ ] 6.1 Add LiveKit service configuration and server-side table-scoped token issuance.
- [ ] 6.2 Enforce voice access checks for seated players and allowed observers.
- [ ] 6.3 Add web voice controls for join, leave, mute, unmute, connection state, and speaking indicators.
- [ ] 6.4 Clean up voice participation when a user leaves a table, disconnects, or loses table access.
- [ ] 6.5 Add tests for token authorization and unauthorized voice rejection.

## 7. Production Deployment

- [ ] 7.1 Add production Dockerfiles for web and server services.
- [ ] 7.2 Add Docker Compose configuration for web, server, PostgreSQL, Redis, LiveKit, and reverse proxy.
- [ ] 7.3 Add reverse proxy config for HTTPS, API routing, WebSocket upgrades, static assets, and voice networking.
- [ ] 7.4 Add migration and startup commands that fail fast on missing required environment variables.
- [ ] 7.5 Add deployment documentation covering DNS, TLS, ports, environment variables, backups, and rollback.
- [ ] 7.6 Add smoke checks for web health, API health, database migration status, realtime connection, and voice token issuance.

## 8. End-to-End Verification

- [ ] 8.1 Add an end-to-end test that creates a table, seats players, plays a hand, and verifies final stacks.
- [ ] 8.2 Add an end-to-end reconnect test during an active hand.
- [ ] 8.3 Add a deployment smoke-test script that can run against local Compose and a production URL.
- [ ] 8.4 Run the fastest relevant verification commands and document any remaining manual checks.
