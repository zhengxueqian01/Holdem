import { randomUUID } from "node:crypto";
import { createDeck, shuffleDeck } from "./deck.js";
import { compareHands } from "./evaluator.js";
import type {
  ActionInput,
  ActionType,
  Card,
  CompletedHandSummary,
  HandActionRecord,
  HandHistoryRecord,
  HandResult,
  LegalAction,
  PlayerProfile,
  PotSnapshot,
  PublicHandState,
  PublicTableState,
  SeatSnapshot,
  Street,
  TableConfig,
  TableStatus,
  WinnerRecord
} from "./types.js";

interface SeatState extends SeatSnapshot {
  actedThisStreet: boolean;
}

interface InternalHandState {
  handId: string;
  deck: Card[];
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
  actionNo: number;
  initialSeats: Array<SeatSnapshot | null>;
}

const ACTION_ORDER: ActionType[] = ["fold", "check", "call", "bet", "raise", "all-in"];

const cloneCard = (card: Card): Card => ({ rank: card.rank, suit: card.suit });
const cloneCards = (cards: Card[]): Card[] => cards.map(cloneCard);

export class HoldemTable {
  public readonly id: string;
  public readonly name: string;
  public readonly smallBlind: number;
  public readonly bigBlind: number;
  public readonly maxSeats: number;
  public readonly minBuyIn: number;
  public readonly maxBuyIn: number;
  public readonly actionTimeoutSec: number;

  private readonly seats: Array<SeatState | null>;
  private readonly history: HandHistoryRecord[];
  private dealerSeat: number | null;
  private handCount: number;
  private status: TableStatus;
  private hand: InternalHandState | null;
  private lastCompletedHand: CompletedHandSummary | null;

  constructor(config: TableConfig) {
    if (config.bigBlind <= 0 || config.smallBlind <= 0) {
      throw new Error("Blinds must be greater than 0");
    }
    if (config.smallBlind > config.bigBlind) {
      throw new Error("Small blind cannot exceed big blind");
    }
    if (config.maxSeats < 2 || config.maxSeats > 10) {
      throw new Error("maxSeats must be between 2 and 10");
    }
    if (config.minBuyIn <= 0 || config.maxBuyIn < config.minBuyIn) {
      throw new Error("Invalid buy-in range");
    }
    if (config.actionTimeoutSec < 5 || config.actionTimeoutSec > 120) {
      throw new Error("actionTimeoutSec must be between 5 and 120");
    }

    this.id = config.id ?? randomUUID();
    this.name = config.name;
    this.smallBlind = config.smallBlind;
    this.bigBlind = config.bigBlind;
    this.maxSeats = config.maxSeats;
    this.minBuyIn = config.minBuyIn;
    this.maxBuyIn = config.maxBuyIn;
    this.actionTimeoutSec = config.actionTimeoutSec;
    this.seats = Array.from({ length: config.maxSeats }, () => null);
    this.history = [];
    this.dealerSeat = null;
    this.handCount = 0;
    this.status = "waiting";
    this.hand = null;
    this.lastCompletedHand = null;
  }

  public joinSeat(player: PlayerProfile, seatIndex: number, buyIn: number): void {
    this.assertSeatIndex(seatIndex);
    if (buyIn < this.minBuyIn || buyIn > this.maxBuyIn) {
      throw new Error("Buy-in is outside table limits");
    }
    if (this.findSeatByPlayerId(player.id) !== null) {
      throw new Error("Player is already seated at this table");
    }
    if (this.seats[seatIndex]) {
      throw new Error("Seat is already occupied");
    }

    this.seats[seatIndex] = {
      seatIndex,
      playerId: player.id,
      playerName: player.name,
      stack: buyIn,
      sitOut: false,
      inHand: false,
      folded: false,
      allIn: false,
      betThisStreet: 0,
      committed: 0,
      holeCards: [],
      actedThisStreet: false
    };
  }

  public leaveSeat(playerId: string): void {
    const seatIndex = this.findSeatByPlayerId(playerId);
    if (seatIndex === null) {
      throw new Error("Player is not seated");
    }

    if (this.hand && this.status === "active") {
      const seat = this.mustSeat(seatIndex);
      seat.folded = true;
      seat.inHand = false;
      seat.allIn = true;
      seat.actedThisStreet = true;
      seat.holeCards = [];
      this.maybeCompleteHandAfterAction();
    }

    this.seats[seatIndex] = null;
    if (this.dealerSeat === seatIndex) {
      this.dealerSeat = null;
    }
  }

  public toggleSitOut(playerId: string, sitOut: boolean): void {
    const seatIndex = this.findSeatByPlayerId(playerId);
    if (seatIndex === null) {
      throw new Error("Player is not seated");
    }
    const seat = this.mustSeat(seatIndex);
    seat.sitOut = sitOut;
  }

  public startHand(): PublicTableState {
    if (this.hand && this.status === "active") {
      throw new Error("A hand is already active");
    }

    const eligible = this.eligibleSeatIndexes();
    if (eligible.length < 2) {
      throw new Error("At least two eligible players are required");
    }

    const dealerSeat = this.nextDealerSeat(eligible);
    const [smallBlindSeat, bigBlindSeat] = this.blindSeatsForHand(eligible, dealerSeat);
    const currentActorSeat = this.firstActorSeatPreflop(eligible, dealerSeat, bigBlindSeat);
    const deck = shuffleDeck(createDeck());
    const handId = randomUUID();
    const startedAt = new Date().toISOString();

    for (const seat of this.seats) {
      if (!seat) {
        continue;
      }
      const active = eligible.includes(seat.seatIndex);
      seat.inHand = active;
      seat.folded = false;
      seat.allIn = false;
      seat.betThisStreet = 0;
      seat.committed = 0;
      seat.actedThisStreet = false;
      seat.holeCards = [];
    }

    for (let round = 0; round < 2; round += 1) {
      for (const seatIndex of eligible) {
        const seat = this.mustSeat(seatIndex);
        seat.holeCards.push(this.drawCard(deck));
      }
    }

    this.postBlind(smallBlindSeat, this.smallBlind);
    this.postBlind(bigBlindSeat, this.bigBlind);

    const initialSeats = this.publicSeats(null, false);

    this.hand = {
      handId,
      deck,
      street: "preflop",
      board: [],
      pot: this.totalCommitted(),
      currentBet: Math.max(this.mustSeat(smallBlindSeat).betThisStreet, this.mustSeat(bigBlindSeat).betThisStreet),
      minRaise: this.bigBlind,
      currentActorSeat,
      dealerSeat,
      smallBlindSeat,
      bigBlindSeat,
      version: 1,
      startedAt,
      actions: [],
      actionNo: 0,
      initialSeats
    };
    this.dealerSeat = dealerSeat;
    this.status = "active";
    this.handCount += 1;
    this.normalizeCurrentActor();
    this.maybeFastForwardIfNoActor();
    return this.getPublicState();
  }

  public act(playerId: string, input: ActionInput): PublicTableState {
    const hand = this.requireActiveHand();
    if (input.expectedVersion !== undefined && input.expectedVersion !== hand.version) {
      throw new Error("Stale table version");
    }

    const actorSeatIndex = hand.currentActorSeat;
    if (actorSeatIndex === null) {
      throw new Error("No actor available");
    }

    const seat = this.mustSeat(actorSeatIndex);
    if (seat.playerId !== playerId) {
      throw new Error("It is not this player's turn");
    }

    const legal = this.getLegalActions(playerId);
    const legalAction = legal.find((item) => item.type === input.type);
    if (!legalAction) {
      throw new Error("Action is not legal in current state");
    }

    const beforeBet = hand.currentBet;
    const wasAllIn = seat.allIn;
    let amount = 0;

    switch (input.type) {
      case "fold":
        seat.folded = true;
        seat.actedThisStreet = true;
        amount = seat.betThisStreet;
        break;
      case "check":
        if ((hand.currentBet - seat.betThisStreet) !== 0) {
          throw new Error("Cannot check when facing a bet");
        }
        seat.actedThisStreet = true;
        amount = seat.betThisStreet;
        break;
      case "call": {
        const toCall = hand.currentBet - seat.betThisStreet;
        if (toCall <= 0) {
          throw new Error("Nothing to call");
        }
        const contributed = this.commitChips(seat, toCall);
        if (contributed <= 0) {
          throw new Error("Unable to call");
        }
        seat.actedThisStreet = true;
        amount = seat.betThisStreet;
        break;
      }
      case "bet": {
        if (hand.currentBet !== 0) {
          throw new Error("Use raise when current bet is non-zero");
        }
        const target = this.requireActionAmount(input.amount);
        if (target <= seat.betThisStreet || target > seat.betThisStreet + seat.stack) {
          throw new Error("Invalid bet amount");
        }
        this.commitToStreetTarget(seat, target);
        hand.currentBet = seat.betThisStreet;
        if (hand.currentBet >= this.bigBlind) {
          hand.minRaise = hand.currentBet;
        }
        this.resetActedForOthers(seat.seatIndex);
        amount = seat.betThisStreet;
        break;
      }
      case "raise": {
        if (hand.currentBet === 0) {
          throw new Error("Use bet when current bet is zero");
        }
        const target = this.requireActionAmount(input.amount);
        if (target <= hand.currentBet || target > seat.betThisStreet + seat.stack) {
          throw new Error("Invalid raise amount");
        }
        const fullRaiseTarget = hand.currentBet + hand.minRaise;
        const isAllInTarget = target === seat.betThisStreet + seat.stack;
        if (target < fullRaiseTarget && !isAllInTarget) {
          throw new Error("Raise amount is below minimum");
        }
        this.commitToStreetTarget(seat, target);
        const raiseDelta = seat.betThisStreet - hand.currentBet;
        hand.currentBet = seat.betThisStreet;
        if (raiseDelta >= hand.minRaise) {
          hand.minRaise = raiseDelta;
          this.resetActedForOthers(seat.seatIndex);
        }
        amount = seat.betThisStreet;
        break;
      }
      case "all-in": {
        if (seat.stack <= 0) {
          throw new Error("No chips left");
        }
        const target = seat.betThisStreet + seat.stack;
        this.commitToStreetTarget(seat, target);
        if (target > hand.currentBet) {
          const raiseDelta = target - hand.currentBet;
          const fullRaise = hand.currentBet === 0 || raiseDelta >= hand.minRaise;
          hand.currentBet = target;
          if (fullRaise) {
            if (hand.currentBet > 0 && raiseDelta > 0) {
              hand.minRaise = hand.currentBet === raiseDelta ? Math.max(this.bigBlind, raiseDelta) : raiseDelta;
            }
            this.resetActedForOthers(seat.seatIndex);
          }
        }
        amount = seat.betThisStreet;
        break;
      }
      default:
        throw new Error("Unsupported action");
    }

    if (!wasAllIn && seat.stack === 0) {
      seat.allIn = true;
    }

    hand.pot = this.totalCommitted();
    hand.actionNo += 1;
    hand.actions.push({
      actionNo: hand.actionNo,
      playerId: seat.playerId,
      action: input.type,
      amount,
      street: hand.street,
      at: new Date().toISOString()
    });
    hand.version += 1;

    if (beforeBet !== hand.currentBet) {
      // A bet/raise changes street completion conditions.
    }

    this.maybeCompleteHandAfterAction();
    return this.getPublicState();
  }

  public getLegalActions(playerId: string): LegalAction[] {
    const hand = this.hand;
    if (!hand || this.status !== "active") {
      return [];
    }
    const actorSeat = hand.currentActorSeat;
    if (actorSeat === null) {
      return [];
    }
    const seat = this.mustSeat(actorSeat);
    if (seat.playerId !== playerId || !seat.inHand || seat.folded || seat.allIn) {
      return [];
    }

    const toCall = hand.currentBet - seat.betThisStreet;
    const maxStreetTarget = seat.betThisStreet + seat.stack;
    const legal: LegalAction[] = [];

    legal.push({ type: "fold", toCall });

    if (toCall <= 0) {
      legal.push({ type: "check", toCall: 0 });
      if (seat.stack > 0) {
        const minBet = Math.min(maxStreetTarget, this.bigBlind);
        legal.push({
          type: "bet",
          minAmount: minBet,
          maxAmount: maxStreetTarget,
          toCall: 0
        });
        legal.push({
          type: "all-in",
          minAmount: maxStreetTarget,
          maxAmount: maxStreetTarget,
          toCall: 0
        });
      }
    } else {
      if (seat.stack > 0) {
        legal.push({ type: "call", toCall });
        if (maxStreetTarget > hand.currentBet) {
          const minRaiseTarget = hand.currentBet + hand.minRaise;
          if (maxStreetTarget >= minRaiseTarget) {
            legal.push({
              type: "raise",
              minAmount: minRaiseTarget,
              maxAmount: maxStreetTarget,
              toCall
            });
          }
          legal.push({
            type: "all-in",
            minAmount: maxStreetTarget,
            maxAmount: maxStreetTarget,
            toCall
          });
        }
      }
    }

    return legal.sort((a, b) => ACTION_ORDER.indexOf(a.type) - ACTION_ORDER.indexOf(b.type));
  }

  public getPublicState(viewerId: string | null = null): PublicTableState {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      maxSeats: this.maxSeats,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      minBuyIn: this.minBuyIn,
      maxBuyIn: this.maxBuyIn,
      actionTimeoutSec: this.actionTimeoutSec,
      seatedCount: this.seatedCount(),
      handCount: this.handCount,
      seats: this.publicSeats(viewerId, true),
      hand: this.hand ? this.publicHand(this.hand) : undefined,
      lastCompletedHand: this.lastCompletedHand ?? undefined,
      legalActions: viewerId ? this.getLegalActions(viewerId) : []
    };
  }

  public getHandHistory(limit = 20): HandHistoryRecord[] {
    if (limit <= 0) {
      return [];
    }
    return this.history.slice(-limit);
  }

  public summary(): Omit<PublicTableState, "seats" | "hand" | "legalActions"> {
    const state = this.getPublicState();
    return {
      id: state.id,
      name: state.name,
      status: state.status,
      maxSeats: state.maxSeats,
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      minBuyIn: state.minBuyIn,
      maxBuyIn: state.maxBuyIn,
      actionTimeoutSec: state.actionTimeoutSec,
      seatedCount: state.seatedCount,
      handCount: state.handCount
    };
  }

  public getCurrentActorPlayerId(): string | null {
    const hand = this.hand;
    if (!hand || hand.currentActorSeat === null) {
      return null;
    }
    return this.mustSeat(hand.currentActorSeat).playerId;
  }

  public seatOfPlayer(playerId: string): number | null {
    return this.findSeatByPlayerId(playerId);
  }

  private requireActiveHand(): InternalHandState {
    if (!this.hand || this.status !== "active") {
      throw new Error("No active hand");
    }
    return this.hand;
  }

  private maybeCompleteHandAfterAction(): void {
    const hand = this.hand;
    if (!hand || this.status !== "active") {
      return;
    }

    const contenders = this.contenderSeats();
    if (contenders.length <= 1) {
      this.finishUncontested(contenders[0] ?? null);
      return;
    }

    if (this.isStreetComplete()) {
      this.advanceStreetOrShowdown();
      return;
    }

    this.setNextActor();
  }

  private isStreetComplete(): boolean {
    const hand = this.requireActiveHand();
    const pending = this.activeNotAllInSeats();
    if (pending.length === 0) {
      return true;
    }
    return pending.every((seatIndex) => {
      const seat = this.mustSeat(seatIndex);
      return seat.actedThisStreet && seat.betThisStreet === hand.currentBet;
    });
  }

  private advanceStreetOrShowdown(): void {
    const hand = this.requireActiveHand();
    if (hand.street === "river") {
      this.finishShowdown();
      return;
    }

    if (hand.street === "preflop") {
      hand.board.push(this.drawCard(hand.deck), this.drawCard(hand.deck), this.drawCard(hand.deck));
      hand.street = "flop";
    } else if (hand.street === "flop") {
      hand.board.push(this.drawCard(hand.deck));
      hand.street = "turn";
    } else if (hand.street === "turn") {
      hand.board.push(this.drawCard(hand.deck));
      hand.street = "river";
    }

    hand.currentBet = 0;
    hand.minRaise = this.bigBlind;
    for (const seat of this.seats) {
      if (!seat || !seat.inHand || seat.folded) {
        continue;
      }
      seat.betThisStreet = 0;
      seat.actedThisStreet = seat.allIn;
    }
    hand.currentActorSeat = this.firstActorPostflop();
    hand.version += 1;
    this.maybeFastForwardIfNoActor();
  }

  private maybeFastForwardIfNoActor(): void {
    const hand = this.hand;
    if (!hand || this.status !== "active") {
      return;
    }
    if (hand.currentActorSeat !== null) {
      return;
    }

    while (this.status === "active" && this.hand && this.hand.street !== "river" && this.activeNotAllInSeats().length === 0) {
      this.advanceStreetOrShowdown();
      if (!this.hand || this.status !== "active") {
        return;
      }
      if (this.hand.currentActorSeat !== null) {
        return;
      }
    }

    if (this.status === "active" && this.hand && this.hand.street === "river" && this.activeNotAllInSeats().length === 0) {
      this.finishShowdown();
    }
  }

  private setNextActor(): void {
    const hand = this.requireActiveHand();
    const next = this.nextActiveSeatFrom(hand.currentActorSeat ?? hand.dealerSeat);
    hand.currentActorSeat = next;
    this.normalizeCurrentActor();
  }

  private normalizeCurrentActor(): void {
    const hand = this.hand;
    if (!hand) {
      return;
    }
    if (hand.currentActorSeat === null) {
      return;
    }
    const current = this.mustSeat(hand.currentActorSeat);
    if (!current.inHand || current.folded || current.allIn) {
      hand.currentActorSeat = this.nextActiveSeatFrom(hand.currentActorSeat);
    }
  }

  private firstActorPostflop(): number | null {
    if (this.dealerSeat === null) {
      return null;
    }
    return this.nextActiveSeatFrom(this.dealerSeat);
  }

  private finishUncontested(winnerSeatIndex: number | null): void {
    const hand = this.requireActiveHand();
    if (winnerSeatIndex === null) {
      throw new Error("Cannot finish uncontested hand without winner");
    }
    const winner = this.mustSeat(winnerSeatIndex);
    const pot = this.totalCommitted();
    winner.stack += pot;
    hand.pot = pot;
    hand.street = "complete";
    hand.currentActorSeat = null;
    hand.completedAt = new Date().toISOString();
    hand.result = {
      board: cloneCards(hand.board),
      pots: [
        {
          amount: pot,
          eligiblePlayerIds: [winner.playerId]
        }
      ],
      winners: [{ playerId: winner.playerId, amount: pot, reason: "uncontested" }]
    };
    this.completeHand();
  }

  private finishShowdown(): void {
    const hand = this.requireActiveHand();
    while (hand.board.length < 5) {
      hand.board.push(this.drawCard(hand.deck));
    }

    const contenders = this.contenderSeats().map((seatIndex) => this.mustSeat(seatIndex));
    const pots = this.calculatePots();
    const payout = new Map<string, number>();

    for (const pot of pots) {
      const eligible = contenders.filter((seat) => pot.eligiblePlayerIds.includes(seat.playerId));
      if (eligible.length === 0) {
        continue;
      }
      let bestSeats: SeatState[] = [eligible[0]];
      let bestCards = [...eligible[0].holeCards, ...hand.board];
      for (let i = 1; i < eligible.length; i += 1) {
        const candidate = eligible[i];
        const candidateCards = [...candidate.holeCards, ...hand.board];
        const cmp = compareHands(candidateCards, bestCards);
        if (cmp > 0) {
          bestSeats = [candidate];
          bestCards = candidateCards;
        } else if (cmp === 0) {
          bestSeats.push(candidate);
        }
      }

      bestSeats.sort((a, b) => a.seatIndex - b.seatIndex);
      const share = Math.floor(pot.amount / bestSeats.length);
      let remainder = pot.amount % bestSeats.length;
      for (const seat of bestSeats) {
        const amount = share + (remainder > 0 ? 1 : 0);
        if (remainder > 0) {
          remainder -= 1;
        }
        payout.set(seat.playerId, (payout.get(seat.playerId) ?? 0) + amount);
      }
    }

    for (const seat of this.seats) {
      if (!seat) {
        continue;
      }
      const amount = payout.get(seat.playerId) ?? 0;
      seat.stack += amount;
    }

    const winners: WinnerRecord[] = Array.from(payout.entries()).map(([playerId, amount]) => ({
      playerId,
      amount,
      reason: "showdown"
    }));
    winners.sort((a, b) => b.amount - a.amount);

    hand.street = "showdown";
    hand.currentActorSeat = null;
    hand.completedAt = new Date().toISOString();
    hand.result = {
      board: cloneCards(hand.board),
      pots,
      winners
    };
    this.completeHand();
  }

  private completeHand(): void {
    const hand = this.requireActiveHand();
    hand.street = "complete";
    const completedAt = hand.completedAt ?? new Date().toISOString();
    hand.completedAt = completedAt;
    const result = hand.result;
    if (!result) {
      throw new Error("Hand completed without result");
    }

    this.history.push({
      tableId: this.id,
      handId: hand.handId,
      startedAt: hand.startedAt,
      completedAt,
      initialSeats: hand.initialSeats,
      actions: hand.actions.slice(),
      board: cloneCards(hand.board),
      result
    });

    this.lastCompletedHand = {
      handId: hand.handId,
      completedAt,
      board: cloneCards(hand.board),
      result: {
        board: cloneCards(result.board),
        pots: result.pots.map((pot) => ({
          amount: pot.amount,
          eligiblePlayerIds: pot.eligiblePlayerIds.slice()
        })),
        winners: result.winners.map((winner) => ({ ...winner }))
      }
    };

    for (const seat of this.seats) {
      if (!seat) {
        continue;
      }
      seat.inHand = false;
      seat.folded = false;
      seat.allIn = false;
      seat.betThisStreet = 0;
      seat.committed = 0;
      seat.actedThisStreet = false;
      seat.holeCards = [];
    }

    this.hand = null;
    this.status = "waiting";
  }

  private calculatePots(): PotSnapshot[] {
    const contributors = this.seats
      .filter((seat): seat is SeatState => seat !== null)
      .filter((seat) => seat.committed > 0)
      .map((seat) => ({ seatIndex: seat.seatIndex, playerId: seat.playerId, committed: seat.committed, folded: seat.folded }));
    if (contributors.length === 0) {
      return [];
    }

    const levels = Array.from(new Set(contributors.map((c) => c.committed))).sort((a, b) => a - b);
    const pots: PotSnapshot[] = [];
    let previous = 0;
    for (const level of levels) {
      const participants = contributors.filter((c) => c.committed >= level);
      const amount = (level - previous) * participants.length;
      const eligiblePlayerIds = participants
        .filter((c) => !c.folded)
        .sort((a, b) => a.seatIndex - b.seatIndex)
        .map((c) => c.playerId);
      if (amount > 0 && eligiblePlayerIds.length > 0) {
        pots.push({
          amount,
          eligiblePlayerIds
        });
      }
      previous = level;
    }
    return pots;
  }

  private totalCommitted(): number {
    return this.seats.reduce((sum, seat) => sum + (seat?.committed ?? 0), 0);
  }

  private contenderSeats(): number[] {
    return this.seats
      .filter((seat): seat is SeatState => Boolean(seat))
      .filter((seat) => seat.inHand && !seat.folded)
      .map((seat) => seat.seatIndex);
  }

  private activeNotAllInSeats(): number[] {
    return this.seats
      .filter((seat): seat is SeatState => Boolean(seat))
      .filter((seat) => seat.inHand && !seat.folded && !seat.allIn)
      .map((seat) => seat.seatIndex);
  }

  private commitToStreetTarget(seat: SeatState, target: number): void {
    const delta = target - seat.betThisStreet;
    if (delta < 0) {
      throw new Error("Cannot reduce committed chips");
    }
    const committed = this.commitChips(seat, delta);
    if (seat.betThisStreet !== target && seat.stack !== 0) {
      throw new Error("Insufficient chips for target action");
    }
    if (committed === 0 && delta > 0) {
      throw new Error("Unable to commit chips");
    }
    seat.actedThisStreet = true;
  }

  private commitChips(seat: SeatState, requested: number): number {
    const amount = Math.min(requested, seat.stack);
    if (amount <= 0) {
      return 0;
    }
    seat.stack -= amount;
    seat.betThisStreet += amount;
    seat.committed += amount;
    if (seat.stack === 0) {
      seat.allIn = true;
    }
    return amount;
  }

  private resetActedForOthers(actorSeat: number): void {
    for (const seat of this.seats) {
      if (!seat || !seat.inHand || seat.folded || seat.allIn) {
        continue;
      }
      seat.actedThisStreet = seat.seatIndex === actorSeat;
    }
  }

  private publicHand(hand: InternalHandState): PublicHandState {
    return {
      handId: hand.handId,
      street: hand.street,
      board: cloneCards(hand.board),
      pot: hand.pot,
      currentBet: hand.currentBet,
      minRaise: hand.minRaise,
      currentActorSeat: hand.currentActorSeat,
      dealerSeat: hand.dealerSeat,
      smallBlindSeat: hand.smallBlindSeat,
      bigBlindSeat: hand.bigBlindSeat,
      version: hand.version,
      startedAt: hand.startedAt,
      completedAt: hand.completedAt,
      actions: hand.actions.slice(),
      result: hand.result
    };
  }

  private publicSeats(viewerId: string | null, hidePrivateCards: boolean): Array<SeatSnapshot | null> {
    const revealAll = this.hand === null;
    return this.seats.map((seat) => {
      if (!seat) {
        return null;
      }
      const showPrivate = !hidePrivateCards || revealAll || viewerId === seat.playerId;
      return {
        seatIndex: seat.seatIndex,
        playerId: seat.playerId,
        playerName: seat.playerName,
        stack: seat.stack,
        sitOut: seat.sitOut,
        inHand: seat.inHand,
        folded: seat.folded,
        allIn: seat.allIn,
        betThisStreet: seat.betThisStreet,
        committed: seat.committed,
        holeCards: showPrivate ? cloneCards(seat.holeCards) : []
      };
    });
  }

  private nextDealerSeat(eligible: number[]): number {
    if (this.dealerSeat === null) {
      return eligible[0];
    }
    const sorted = eligible.slice().sort((a, b) => a - b);
    for (const seat of sorted) {
      if (seat > this.dealerSeat) {
        return seat;
      }
    }
    return sorted[0];
  }

  private blindSeatsForHand(eligible: number[], dealerSeat: number): [number, number] {
    const ordered = this.circularOrderedSeats(eligible, dealerSeat);
    if (eligible.length === 2) {
      return [dealerSeat, ordered[1]];
    }
    return [ordered[1], ordered[2]];
  }

  private firstActorSeatPreflop(eligible: number[], dealerSeat: number, bigBlindSeat: number): number {
    if (eligible.length === 2) {
      return dealerSeat;
    }
    const actor = this.nextSeatFromList(eligible, bigBlindSeat);
    if (actor === null) {
      throw new Error("Unable to determine first actor");
    }
    return actor;
  }

  private circularOrderedSeats(list: number[], startSeat: number): number[] {
    const sorted = list.slice().sort((a, b) => a - b);
    const startIdx = sorted.indexOf(startSeat);
    if (startIdx < 0) {
      throw new Error("startSeat not in list");
    }
    return [...sorted.slice(startIdx), ...sorted.slice(0, startIdx)];
  }

  private nextActiveSeatFrom(seatIndex: number): number | null {
    const active = this.activeNotAllInSeats();
    return this.nextSeatFromList(active, seatIndex);
  }

  private nextSeatFromList(list: number[], seatIndex: number): number | null {
    if (list.length === 0) {
      return null;
    }
    const sorted = list.slice().sort((a, b) => a - b);
    for (const seat of sorted) {
      if (seat > seatIndex) {
        return seat;
      }
    }
    return sorted[0];
  }

  private eligibleSeatIndexes(): number[] {
    return this.seats
      .filter((seat): seat is SeatState => Boolean(seat))
      .filter((seat) => seat.stack > 0 && !seat.sitOut)
      .map((seat) => seat.seatIndex)
      .sort((a, b) => a - b);
  }

  private drawCard(deck: Card[]): Card {
    const card = deck.pop();
    if (!card) {
      throw new Error("Deck exhausted unexpectedly");
    }
    return card;
  }

  private postBlind(seatIndex: number, blindAmount: number): void {
    const seat = this.mustSeat(seatIndex);
    this.commitChips(seat, blindAmount);
  }

  private mustSeat(seatIndex: number): SeatState {
    const seat = this.seats[seatIndex];
    if (!seat) {
      throw new Error(`Seat ${seatIndex} is not occupied`);
    }
    return seat;
  }

  private assertSeatIndex(seatIndex: number): void {
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= this.maxSeats) {
      throw new Error("Invalid seat index");
    }
  }

  private findSeatByPlayerId(playerId: string): number | null {
    for (const seat of this.seats) {
      if (seat?.playerId === playerId) {
        return seat.seatIndex;
      }
    }
    return null;
  }

  private seatedCount(): number {
    return this.seats.filter(Boolean).length;
  }

  private requireActionAmount(amount: number | undefined): number {
    if (!amount || !Number.isInteger(amount) || amount <= 0) {
      throw new Error("Action amount must be a positive integer");
    }
    return amount;
  }
}
