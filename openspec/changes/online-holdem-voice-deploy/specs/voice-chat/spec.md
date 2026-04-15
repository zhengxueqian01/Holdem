## ADDED Requirements

### Requirement: Table-scoped voice room
The system SHALL provide a voice room for each active table and SHALL prevent users from joining voice rooms for tables they are not allowed to access.

#### Scenario: Join allowed table voice
- **WHEN** an authenticated player requests voice access for a table they are seated at or allowed to observe
- **THEN** the system issues a voice access token scoped to that table room

#### Scenario: Reject unauthorized voice access
- **WHEN** a user requests voice access for a table they cannot access
- **THEN** the system rejects the request and does not issue a voice token

### Requirement: Voice controls
The system SHALL allow each voice participant to join, leave, mute microphone, unmute microphone, and see their local connection state.

#### Scenario: Toggle mute
- **WHEN** a participant mutes or unmutes their microphone
- **THEN** the system updates the local microphone state and reflects the participant's mute status in the table UI

### Requirement: Speaking indicators
The system SHALL show speaking indicators for connected voice participants at the table.

#### Scenario: Participant speaks
- **WHEN** a connected participant is actively sending audio above the speaking threshold
- **THEN** the table UI marks that participant as speaking

### Requirement: Voice room cleanup
The system SHALL clean up voice participation state when a user leaves the table, disconnects from voice, or loses table access.

#### Scenario: Leave table while in voice
- **WHEN** a participant leaves a table while connected to its voice room
- **THEN** the system removes their voice access and updates the participant list
