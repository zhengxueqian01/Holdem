## Why

The project needs a deployable MVP for online Texas Hold'em where players can join the same table, play a fair synchronized hand, and communicate by voice during the game. Defining the scope with OpenSpec first keeps the poker engine, realtime transport, voice chat, and deployment work reviewable instead of becoming one large uncontrolled build.

## What Changes

- Add a browser-based online Texas Hold'em game with lobby, table creation, joining, seating, buy-in, blinds, betting rounds, showdown, and hand history.
- Add authoritative server-side game state so clients only submit player actions and never decide cards, pots, winners, or turn order locally.
- Add realtime communication for table state updates, player actions, timers, chat presence, disconnects, and reconnects.
- Add table-scoped voice chat with join/leave, mute/unmute, speaking indicators, permission checks, and room cleanup.
- Add a production deployment target using containerized services, reverse proxy TLS termination, persistent database storage, and operational runbooks.
- Exclude real-money gambling, payments, public matchmaking rankings, native mobile clients, and advanced anti-collusion analytics from the MVP.

## Capabilities

### New Capabilities

- `online-poker-gameplay`: Table lifecycle, seat management, chips, blinds, hand progression, betting rules, winner calculation, and synchronized game state.
- `realtime-session`: WebSocket session management, authenticated table subscriptions, action delivery, timers, disconnect handling, and reconnection.
- `voice-chat`: Table-scoped voice rooms, WebRTC signaling/SFU integration, mute controls, speaking state, and access control.
- `production-deployment`: Containerized deployment, environment configuration, database persistence, TLS/reverse proxy setup, and smoke checks.

### Modified Capabilities

- None.

## Impact

- Adds a full-stack web application structure, likely including a frontend client, API/realtime server, shared poker domain package, database schema, and deployment assets.
- Introduces dependencies for poker hand evaluation, realtime transport, authentication/session handling, database access, and voice infrastructure.
- Requires server-side persistence for users, tables, seats, hands, actions, and reconnectable sessions.
- Requires deployment configuration for application containers, database, reverse proxy, HTTPS, WebSocket upgrade support, and voice networking.
