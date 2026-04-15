export type Suit = "C" | "D" | "H" | "S";

export interface Card {
  rank: number;
  suit: Suit;
}

export interface PlayerProfile {
  id: string;
  name: string;
}

export interface TableConfig {
  id?: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
  actionTimeoutSec: number;
}

export type TableStatus = "waiting" | "active";
export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface ActionInput {
  type: ActionType;
  amount?: number;
  expectedVersion?: number;
}

export interface LegalAction {
  type: ActionType;
  minAmount?: number;
  maxAmount?: number;
  toCall?: number;
}

export interface SeatSnapshot {
  seatIndex: number;
  playerId: string;
  playerName: string;
  stack: number;
  sitOut: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  betThisStreet: number;
  committed: number;
  holeCards: Card[];
}

export interface HandActionRecord {
  actionNo: number;
  playerId: string;
  action: ActionType;
  amount: number;
  street: Street;
  at: string;
}

export interface PotSnapshot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface WinnerRecord {
  playerId: string;
  amount: number;
  reason: "uncontested" | "showdown";
}

export interface HandResult {
  board: Card[];
  pots: PotSnapshot[];
  winners: WinnerRecord[];
}

export interface PublicHandState {
  handId: string;
  street: Street;
  board: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  currentActorSeat: number | null;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  version: number;
  startedAt: string;
  completedAt?: string;
  actions: HandActionRecord[];
  result?: HandResult;
}

export interface CompletedHandSummary {
  handId: string;
  completedAt: string;
  board: Card[];
  result: HandResult;
}

export interface PublicTableState {
  id: string;
  name: string;
  status: TableStatus;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  actionTimeoutSec: number;
  seatedCount: number;
  handCount: number;
  seats: Array<SeatSnapshot | null>;
  hand?: PublicHandState;
  lastCompletedHand?: CompletedHandSummary;
  legalActions: LegalAction[];
}

export interface HandHistoryRecord {
  tableId: string;
  handId: string;
  startedAt: string;
  completedAt: string;
  initialSeats: Array<SeatSnapshot | null>;
  actions: HandActionRecord[];
  board: Card[];
  result: HandResult;
}
