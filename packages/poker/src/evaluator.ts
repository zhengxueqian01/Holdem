import type { Card } from "./types.js";

export type HandScore = number[];

const sortDesc = (values: number[]): number[] => values.slice().sort((a, b) => b - a);

const straightHigh = (ranks: number[]): number | null => {
  const unique = Array.from(new Set(ranks)).sort((a, b) => b - a);
  if (unique[0] === 14) {
    unique.push(1);
  }

  for (let i = 0; i <= unique.length - 5; i += 1) {
    const window = unique.slice(i, i + 5);
    let run = true;
    for (let j = 0; j < 4; j += 1) {
      if (window[j] - 1 !== window[j + 1]) {
        run = false;
        break;
      }
    }
    if (run) {
      return window[0] === 1 ? 5 : window[0];
    }
  }
  return null;
};

export const evaluateFiveCardHand = (cards: Card[]): HandScore => {
  if (cards.length !== 5) {
    throw new Error("evaluateFiveCardHand requires exactly 5 cards");
  }

  const ranks = cards.map((c) => c.rank);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);
  const straight = straightHigh(ranks);

  const rankCounts = new Map<number, number>();
  for (const rank of ranks) {
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
  }

  const groups = Array.from(rankCounts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return b[0] - a[0];
  });

  if (isFlush && straight !== null) {
    return [8, straight];
  }

  if (groups[0][1] === 4) {
    const quad = groups[0][0];
    const kicker = groups[1][0];
    return [7, quad, kicker];
  }

  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return [6, groups[0][0], groups[1][0]];
  }

  if (isFlush) {
    return [5, ...sortDesc(ranks)];
  }

  if (straight !== null) {
    return [4, straight];
  }

  if (groups[0][1] === 3) {
    const trip = groups[0][0];
    const kickers = sortDesc(groups.slice(1).map((g) => g[0]));
    return [3, trip, ...kickers];
  }

  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairHigh = Math.max(groups[0][0], groups[1][0]);
    const pairLow = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups[2][0];
    return [2, pairHigh, pairLow, kicker];
  }

  if (groups[0][1] === 2) {
    const pair = groups[0][0];
    const kickers = sortDesc(groups.slice(1).map((g) => g[0]));
    return [1, pair, ...kickers];
  }

  return [0, ...sortDesc(ranks)];
};

const compareScore = (a: HandScore, b: HandScore): number => {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) {
      return av - bv;
    }
  }
  return 0;
};

const chooseFive = (cards: Card[]): Card[][] => {
  if (cards.length < 5) {
    throw new Error("chooseFive requires at least 5 cards");
  }

  const result: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a += 1) {
    for (let b = a + 1; b < n - 3; b += 1) {
      for (let c = b + 1; c < n - 2; c += 1) {
        for (let d = c + 1; d < n - 1; d += 1) {
          for (let e = d + 1; e < n; e += 1) {
            result.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return result;
};

export const evaluateSevenCardHand = (cards: Card[]): HandScore => {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error("evaluateSevenCardHand requires 5 to 7 cards");
  }

  let best: HandScore | null = null;
  for (const combo of chooseFive(cards)) {
    const score = evaluateFiveCardHand(combo);
    if (!best || compareScore(score, best) > 0) {
      best = score;
    }
  }
  if (!best) {
    throw new Error("Unable to evaluate hand");
  }
  return best;
};

export const compareHands = (a: Card[], b: Card[]): number => {
  return compareScore(evaluateSevenCardHand(a), evaluateSevenCardHand(b));
};
