import assert from "node:assert/strict";
import { HoldemTable, type PlayerProfile } from "../src/index.js";

const players: PlayerProfile[] = [
  { id: "p1", name: "Alice" },
  { id: "p2", name: "Bob" },
  { id: "p3", name: "Carol" }
];

const cases: Array<{ name: string; run: () => void }> = [];

cases.push({
  name: "rejects action from non-acting player",
  run: () => {
    const table = new HoldemTable({
      name: "Unit Test",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 6,
      minBuyIn: 50,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 100);
    table.joinSeat(players[1], 1, 100);
    table.joinSeat(players[2], 2, 100);
    table.startHand();
    assert.throws(() => table.act(players[1].id, { type: "call" }), /not this player's turn/i);
  }
});

cases.push({
  name: "settles uncontested pot when others fold",
  run: () => {
    const table = new HoldemTable({
      name: "Heads Up",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 2,
      minBuyIn: 50,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 100);
    table.joinSeat(players[1], 1, 100);

    table.startHand();
    table.act(players[0].id, { type: "fold" });
    const state = table.getPublicState(players[1].id);

    assert.equal(state.status, "waiting");
    const history = table.getHandHistory(1)[0];
    assert.equal(history.result.winners[0].reason, "uncontested");
    assert.equal(history.result.winners[0].playerId, players[1].id);
  }
});

cases.push({
  name: "keeps only viewer hole cards visible after uncontested hand",
  run: () => {
    const table = new HoldemTable({
      name: "Visibility Uncontested",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 2,
      minBuyIn: 50,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 100);
    table.joinSeat(players[1], 1, 100);

    table.startHand();
    const myCardsBeforeFold = table.getPublicState(players[1].id).seats[1]?.holeCards ?? [];
    assert.equal(myCardsBeforeFold.length, 2);

    table.act(players[0].id, { type: "fold" });

    const winnerView = table.getPublicState(players[1].id);
    const foldedView = table.getPublicState(players[0].id);
    assert.equal(winnerView.lastCompletedHand?.revealedPlayerIds.length, 0);
    assert.equal(winnerView.seats[1]?.holeCards.length, 2);
    assert.equal(winnerView.seats[0]?.holeCards.length, 0);
    assert.equal(foldedView.seats[0]?.holeCards.length, 2);
    assert.equal(foldedView.seats[1]?.holeCards.length, 0);
  }
});

cases.push({
  name: "creates side pots and preserves total chips",
  run: () => {
    const table = new HoldemTable({
      name: "Side Pot",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 6,
      minBuyIn: 50,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 200);
    table.joinSeat(players[1], 1, 120);
    table.joinSeat(players[2], 2, 60);

    table.startHand();
    table.act(players[0].id, { type: "all-in" });
    table.act(players[1].id, { type: "all-in" });
    table.act(players[2].id, { type: "all-in" });

    const state = table.getPublicState();
    assert.equal(state.status, "waiting");
    assert.ok((state.lastCompletedHand?.board.length ?? 0) === 5);
    const history = table.getHandHistory(1)[0];
    assert.ok(history.result.pots.length >= 2);

    const seats = table.getPublicState().seats.filter((seat) => seat !== null);
    const total = seats.reduce((sum, seat) => sum + seat.stack, 0);
    assert.equal(total, 380);
  }
});

cases.push({
  name: "refunds unmatched heads-up all-in chips without marking bigger stack as winner",
  run: () => {
    const table = new HoldemTable({
      name: "Heads Up All-In Refund",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 2,
      minBuyIn: 50,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 50);
    table.joinSeat(players[1], 1, 200);

    table.startHand();

    const internalTable = table as unknown as {
      hand: { deck: Array<{ rank: number; suit: "C" | "D" | "H" | "S" }> };
      seats: Array<
        | {
            holeCards: Array<{ rank: number; suit: "C" | "D" | "H" | "S" }>;
          }
        | null
      >;
    };

    if (!internalTable.seats[0] || !internalTable.seats[1]) {
      throw new Error("Expected both seats to be occupied");
    }

    internalTable.seats[0].holeCards = [
      { rank: 14, suit: "S" },
      { rank: 14, suit: "H" }
    ];
    internalTable.seats[1].holeCards = [
      { rank: 13, suit: "S" },
      { rank: 12, suit: "S" }
    ];
    internalTable.hand.deck = [
      { rank: 2, suit: "C" },
      { rank: 3, suit: "D" },
      { rank: 7, suit: "H" },
      { rank: 9, suit: "C" },
      { rank: 11, suit: "D" }
    ];

    table.act(players[0].id, { type: "all-in" });
    table.act(players[1].id, { type: "call" });

    const history = table.getHandHistory(1)[0];
    assert.deepEqual(history.result.pots, [
      {
        amount: 100,
        eligiblePlayerIds: [players[0].id, players[1].id]
      }
    ]);
    assert.deepEqual(history.result.winners, [
      {
        playerId: players[0].id,
        amount: 100,
        reason: "showdown"
      }
    ]);

    const seats = table.getPublicState().seats.filter((seat) => seat !== null);
    assert.equal(seats[0]?.stack, 100);
    assert.equal(seats[1]?.stack, 150);
  }
});

cases.push({
  name: "reveals showdown players until next hand starts",
  run: () => {
    const table = new HoldemTable({
      name: "Visibility Showdown",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 3,
      minBuyIn: 15,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 15);
    table.joinSeat(players[1], 1, 15);
    table.joinSeat(players[2], 2, 100);

    table.startHand();
    table.act(players[0].id, { type: "all-in" });
    table.act(players[1].id, { type: "all-in" });
    table.act(players[2].id, { type: "fold" });

    const showdownView = table.getPublicState(players[2].id);
    assert.deepEqual(
      showdownView.lastCompletedHand?.revealedPlayerIds.slice().sort(),
      [players[0].id, players[1].id].sort()
    );
    assert.equal(showdownView.seats[0]?.holeCards.length, 2);
    assert.equal(showdownView.seats[1]?.holeCards.length, 2);

    table.startHand();
    const nextHandView = table.getPublicState(players[2].id);
    assert.equal(nextHandView.status, "active");
    assert.equal(nextHandView.lastCompletedHand?.revealedPlayerIds.length, 2);
    assert.equal(nextHandView.seats[0]?.holeCards.length, 0);
    assert.equal(nextHandView.seats[1]?.holeCards.length, 0);
    assert.equal(nextHandView.seats[2]?.holeCards.length, 2);
  }
});

cases.push({
  name: "reveals opted-in player cards after uncontested hand",
  run: () => {
    const table = new HoldemTable({
      name: "Opt In Reveal",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 2,
      minBuyIn: 50,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 100);
    table.joinSeat(players[1], 1, 100);
    table.setRevealOnHandComplete(players[0].id, true);

    table.startHand();
    table.act(players[0].id, { type: "fold" });

    const viewerState = table.getPublicState(players[1].id);
    assert.deepEqual(viewerState.lastCompletedHand?.revealedPlayerIds, [players[0].id]);
    assert.equal(viewerState.seats[0]?.holeCards.length, 2);
    assert.equal(viewerState.seats[1]?.holeCards.length, 2);
  }
});

cases.push({
  name: "preflop big blind can raise after callers",
  run: () => {
    const table = new HoldemTable({
      name: "Big Blind Raise",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 6,
      minBuyIn: 50,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 100);
    table.joinSeat(players[1], 1, 100);
    table.joinSeat(players[2], 2, 100);

    table.startHand();
    table.act(players[0].id, { type: "call" });
    table.act(players[1].id, { type: "call" });

    const legal = table.getLegalActions(players[2].id);
    assert.deepEqual(
      legal.map((action) => action.type),
      ["fold", "check", "raise", "all-in"]
    );

    const raiseAction = legal.find((action) => action.type === "raise");
    assert.equal(raiseAction?.minAmount, 20);
    assert.equal(raiseAction?.maxAmount, 100);
  }
});

cases.push({
  name: "short stack all-in uses own remaining chips when facing oversized bet",
  run: () => {
    const table = new HoldemTable({
      name: "Short Stack All-In Amount",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 2,
      minBuyIn: 50,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 50);
    table.joinSeat(players[1], 1, 200);

    table.startHand();
    table.act(players[0].id, { type: "call" });
    table.act(players[1].id, { type: "all-in" });

    const legal = table.getLegalActions(players[0].id);
    assert.deepEqual(
      legal.map((action) => action.type),
      ["fold", "all-in"]
    );

    const callAction = legal.find((action) => action.type === "call");
    const allInAction = legal.find((action) => action.type === "all-in");
    assert.equal(callAction, undefined);
    assert.equal(allInAction?.toCall, 40);
    assert.equal(allInAction?.minAmount, 50);
    assert.equal(allInAction?.maxAmount, 50);
  }
});

cases.push({
  name: "cannot raise when every other contender is already all-in",
  run: () => {
    const table = new HoldemTable({
      name: "No Raise Against All-In Players",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 3,
      minBuyIn: 50,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 60);
    table.joinSeat(players[1], 1, 60);
    table.joinSeat(players[2], 2, 200);

    table.startHand();
    table.act(players[0].id, { type: "all-in" });
    table.act(players[1].id, { type: "all-in" });

    const legal = table.getLegalActions(players[2].id);
    assert.deepEqual(
      legal.map((action) => action.type),
      ["fold", "call"]
    );

    const callAction = legal.find((action) => action.type === "call");
    assert.equal(callAction?.toCall, 50);

    table.act(players[2].id, { type: "call" });

    const state = table.getPublicState(players[2].id);
    assert.equal(state.status, "waiting");
    assert.equal(state.lastCompletedHand?.board.length, 5);
  }
});

cases.push({
  name: "updates completed hand reveals when player opts in after hand ends",
  run: () => {
    const table = new HoldemTable({
      name: "Late Opt In Reveal",
      smallBlind: 5,
      bigBlind: 10,
      maxSeats: 2,
      minBuyIn: 50,
      maxBuyIn: 500,
      actionTimeoutSec: 20
    });
    table.joinSeat(players[0], 0, 100);
    table.joinSeat(players[1], 1, 100);

    table.startHand();
    table.act(players[0].id, { type: "fold" });

    const before = table.getPublicState(players[1].id);
    assert.deepEqual(before.lastCompletedHand?.revealedPlayerIds, []);
    assert.equal(before.seats[0]?.holeCards.length, 0);

    table.setRevealOnHandComplete(players[0].id, true);

    const after = table.getPublicState(players[1].id);
    assert.deepEqual(after.lastCompletedHand?.revealedPlayerIds, [players[0].id]);
    assert.equal(after.seats[0]?.holeCards.length, 2);
  }
});

let failed = 0;
for (const testCase of cases) {
  try {
    testCase.run();
    console.log(`PASS ${testCase.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${testCase.name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`All tests passed: ${cases.length}`);
