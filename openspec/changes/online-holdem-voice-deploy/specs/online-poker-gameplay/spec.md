## ADDED Requirements

### Requirement: Table lifecycle
The system SHALL allow authenticated players to create, list, join, leave, and close play-money Texas Hold'em tables with configured blinds, seat count, buy-in range, and action timer.

#### Scenario: Create a table
- **WHEN** an authenticated player creates a table with valid blinds, seat count, buy-in range, and timer settings
- **THEN** the system creates the table and makes it visible in the lobby

#### Scenario: Reject invalid table settings
- **WHEN** a player submits blinds, seat count, buy-in range, or timer settings outside configured limits
- **THEN** the system rejects the request with a validation error and does not create a table

### Requirement: Seat and chip management
The system SHALL track seats, stacks, buy-ins, sit-out status, dealer button, small blind, big blind, and active players for each table.

#### Scenario: Join an open seat
- **WHEN** a player joins an empty seat with a valid buy-in
- **THEN** the system assigns the seat, reserves the chips for that table, and broadcasts the updated seating state

#### Scenario: Prevent duplicate seating
- **WHEN** a seated player attempts to take another seat at the same table
- **THEN** the system rejects the request and keeps the existing seat assignment unchanged

### Requirement: Authoritative hand progression
The system SHALL deal cards, advance streets, post blinds, enforce turn order, validate legal actions, calculate pots, determine winners, and settle chips on the server.

#### Scenario: Start a hand
- **WHEN** at least two seated players are eligible and the table starts a hand
- **THEN** the server shuffles a deck, posts blinds, deals private cards, sets the first actor, and broadcasts public hand state without exposing hidden cards

#### Scenario: Reject illegal action
- **WHEN** a client submits an action that is not legal for the current actor and betting state
- **THEN** the server rejects the action and leaves the canonical hand state unchanged

### Requirement: Betting and pot settlement
The system SHALL support fold, check, call, bet, raise, all-in, side pots, street transitions, showdown, and uncontested pot wins according to no-limit Texas Hold'em rules.

#### Scenario: All-in creates side pot
- **WHEN** players commit unequal all-in amounts during a hand
- **THEN** the system creates main and side pots with eligible player sets and settles each pot independently at showdown

#### Scenario: One player remains
- **WHEN** all but one active player fold
- **THEN** the system awards the uncontested pot to the remaining player and completes the hand

### Requirement: Hand history
The system SHALL persist hand start state, player actions, public board cards, showdown results, and final chip movements for audit and replay.

#### Scenario: Complete hand history
- **WHEN** a hand finishes
- **THEN** the system stores a hand history containing all actions and final settlement
