## ADDED Requirements

### Requirement: Authenticated realtime connection
The system SHALL require an authenticated session before a client can connect to realtime table channels or submit player actions.

#### Scenario: Connect with valid session
- **WHEN** a client opens a realtime connection with a valid authenticated session
- **THEN** the system accepts the connection and returns the player's subscribed lobby and table state

#### Scenario: Reject unauthenticated connection
- **WHEN** a client opens a realtime connection without a valid authenticated session
- **THEN** the system rejects the connection and does not subscribe the client to any table state

### Requirement: Table subscriptions
The system SHALL broadcast table-specific updates only to clients authorized to view that table.

#### Scenario: Broadcast action result
- **WHEN** a legal player action changes the canonical table state
- **THEN** the system broadcasts the resulting public state update to all authorized subscribers for that table

#### Scenario: Hide private cards
- **WHEN** the system sends state to a player
- **THEN** the system includes only that player's private cards and excludes other players' private cards

### Requirement: Serialized player actions
The system SHALL process commands for a table in a single canonical order and reject stale or duplicate commands.

#### Scenario: Concurrent actions
- **WHEN** two commands arrive for the same table at nearly the same time
- **THEN** the system applies at most the command valid for the current table version and rejects stale commands

### Requirement: Timers and automatic actions
The system SHALL enforce action timers and apply configured automatic behavior when a player times out.

#### Scenario: Player times out
- **WHEN** the active player's timer expires without a valid action
- **THEN** the system applies the configured timeout action and broadcasts the updated state

### Requirement: Reconnection
The system SHALL allow a disconnected player to reconnect to the same table and receive the latest canonical state.

#### Scenario: Reconnect during active hand
- **WHEN** a disconnected seated player reconnects with a valid session during an active hand
- **THEN** the system restores their table subscription and sends the latest state including their own private cards
