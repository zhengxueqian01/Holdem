interface WinnerLike {
  playerId: string;
}

interface TableSummaryState {
  status: "waiting" | "active";
  lastCompletedHand?: {
    result: {
      winners: WinnerLike[];
    };
  };
}

export const shouldShowCompletedWinners = (tableState?: TableSummaryState | null): boolean =>
  tableState?.status === "waiting" && (tableState.lastCompletedHand?.result.winners.length ?? 0) > 0;

export const shouldHighlightCompletedWinners = (tableState?: TableSummaryState | null): boolean =>
  shouldShowCompletedWinners(tableState);
