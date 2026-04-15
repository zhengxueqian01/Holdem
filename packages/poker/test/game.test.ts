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
    table.act(players[1].id, { type: "call" });
    table.act(players[2].id, { type: "call" });

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

