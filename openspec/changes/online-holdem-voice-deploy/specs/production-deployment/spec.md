## ADDED Requirements

### Requirement: Containerized services
The system SHALL provide containerized runtime definitions for the web client, application server, PostgreSQL, Redis, voice service, and reverse proxy.

#### Scenario: Start production stack
- **WHEN** the operator starts the production container stack with a valid environment file
- **THEN** all required services start and expose only the intended public HTTP, HTTPS, and voice networking ports

### Requirement: Environment configuration
The system SHALL document required environment variables without committing secrets or real credentials.

#### Scenario: Missing required environment variable
- **WHEN** a required environment variable is missing at startup
- **THEN** the affected service fails fast with an explicit configuration error

### Requirement: HTTPS and WebSocket routing
The system SHALL route HTTPS traffic, WebSocket upgrades, API requests, web assets, and voice endpoints through the production reverse proxy.

#### Scenario: WebSocket upgrade
- **WHEN** a browser connects to the realtime endpoint over HTTPS
- **THEN** the reverse proxy preserves the WebSocket upgrade and routes the connection to the application server

### Requirement: Persistent data
The system SHALL persist database data and required voice/server state across container restarts.

#### Scenario: Restart services
- **WHEN** the operator restarts the production stack
- **THEN** user accounts, tables, hand histories, and durable configuration remain available

### Requirement: Smoke checks
The system SHALL provide deployment smoke checks for web availability, API health, realtime connection, database migration status, and voice token issuance.

#### Scenario: Run smoke check
- **WHEN** the operator runs the documented smoke check command after deployment
- **THEN** the command verifies the critical services and reports failures with actionable messages
