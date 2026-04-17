import { describe, expect, it } from "vitest";
import { shouldHighlightCompletedWinners, shouldShowCompletedWinners } from "./tableSummary";

describe("completed hand winner summary", () => {
  it("shows uncontested winners even when no board cards were dealt", () => {
    const tableState = {
      status: "waiting" as const,
      lastCompletedHand: {
        result: {
          winners: [{ playerId: "p2" }]
        }
      }
    };

    expect(shouldShowCompletedWinners(tableState)).toBe(true);
    expect(shouldHighlightCompletedWinners(tableState)).toBe(true);
  });

  it("hides completed winners during an active hand", () => {
    const tableState = {
      status: "active" as const,
      lastCompletedHand: {
        result: {
          winners: [{ playerId: "p2" }]
        }
      }
    };

    expect(shouldShowCompletedWinners(tableState)).toBe(false);
    expect(shouldHighlightCompletedWinners(tableState)).toBe(false);
  });
});
