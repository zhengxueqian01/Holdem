import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

interface Player {
  id: string;
  name: string;
  isAdmin: boolean;
}

interface Seat {
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
  holeCards: Array<{ rank: number; suit: string }>;
}

interface LegalAction {
  type: ActionType;
  minAmount?: number;
  maxAmount?: number;
  toCall?: number;
}

interface TableState {
  id: string;
  name: string;
  hostPlayerId: string | null;
  status: "waiting" | "active";
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  actionTimeoutSec: number;
  seatedCount: number;
  handCount: number;
  seats: Array<Seat | null>;
  hand?: {
    handId: string;
    street: string;
    board: Array<{ rank: number; suit: string }>;
    pot: number;
    currentBet: number;
    minRaise: number;
    currentActorSeat: number | null;
    dealerSeat: number;
    smallBlindSeat: number;
    bigBlindSeat: number;
    version: number;
  };
  lastCompletedHand?: {
    handId: string;
    completedAt: string;
    board: Array<{ rank: number; suit: string }>;
    result: {
      winners: Array<{
        playerId: string;
        amount: number;
        reason: "uncontested" | "showdown";
      }>;
    };
  };
  legalActions: LegalAction[];
}

interface TableSummary {
  id: string;
  name: string;
  status: "waiting" | "active";
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  actionTimeoutSec: number;
  seatedCount: number;
  handCount: number;
}

interface AdminUser {
  playerId: string;
  name: string;
  createdAt: string;
  sessionCount: number;
}

interface DealBurst {
  id: string;
  seatIndex: number;
  delayMs: number;
}

interface BetBurst {
  id: string;
  seatIndex: number;
  delayMs: number;
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const cardLabel = (card: { rank: number; suit: string }): string => {
  const rankMap: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  const suitMap: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
  return `${rankMap[card.rank] ?? card.rank}${suitMap[card.suit] ?? card.suit}`;
};

const wsUrl = (token: string): string => {
  const base = API_URL.replace(/^http/, "ws");
  return `${base}/ws?token=${encodeURIComponent(token)}`;
};

const actionLabelMap: Record<ActionType, string> = {
  fold: "弃牌",
  check: "过牌",
  call: "跟注",
  bet: "下注",
  raise: "加注",
  "all-in": "全下"
};

const actionClassMap: Record<ActionType, string> = {
  fold: "action-fold",
  check: "action-check",
  call: "action-call",
  bet: "action-bet",
  raise: "action-raise",
  "all-in": "action-allin"
};

const CHIP_DENOMS = [1000, 500, 100, 25, 5, 1];

const chipBreakdown = (amount: number, denoms = [1000, 500, 100, 50, 25, 10, 5, 1]): Array<{ denom: number; count: number }> => {
  let remain = Math.max(0, Math.floor(amount));
  const result: Array<{ denom: number; count: number }> = [];
  for (const denom of denoms) {
    const count = Math.floor(remain / denom);
    if (count > 0) {
      result.push({ denom, count });
      remain -= count * denom;
    }
  }
  return result;
};

const seatAngleDeg = (index: number, totalSeats: number): number => {
  const safeTotal = Math.max(1, totalSeats);
  const startDeg = -170;
  const endDeg = -10;
  if (safeTotal === 1) {
    return (startDeg + endDeg) / 2;
  }
  return startDeg + ((endDeg - startDeg) * index) / (safeTotal - 1);
};

const seatRingStyle = (index: number, totalSeats: number): CSSProperties => {
  const angleDeg = seatAngleDeg(index, totalSeats);
  const angle = (angleDeg * Math.PI) / 180;
  const radiusX = 40;
  const radiusY = 21;
  const left = 50 + Math.cos(angle) * radiusX;
  const top = 46 + Math.sin(angle) * radiusY;
  return {
    left: `${left}%`,
    top: `${top}%`
  };
};

type SeatFacing = "top" | "right" | "bottom" | "left";

const seatFacingAt = (index: number, totalSeats: number): SeatFacing => {
  const angle = seatAngleDeg(index, totalSeats);
  if (angle > 45 && angle < 135) {
    return "bottom";
  }
  if (angle >= -45 && angle <= 45) {
    return "right";
  }
  if (angle > -135 && angle < -45) {
    return "top";
  }
  return "left";
};

const seatShellRotateDeg = (facing: SeatFacing): number => {
  switch (facing) {
    case "top":
      return 180;
    case "right":
    case "left":
      return 0;
    case "bottom":
    default:
      return 0;
  }
};

const seatBodyRotateDeg = (facing: SeatFacing): number => {
  switch (facing) {
    case "top":
      return 180;
    case "right":
    case "left":
      return 0;
    case "bottom":
    default:
      return 0;
  }
};

const buildChipStack = (amount: number, limit = 11): number[] => {
  let remain = Math.max(0, Math.floor(amount));
  const chips: number[] = [];
  for (const denom of CHIP_DENOMS) {
    while (remain >= denom && chips.length < limit) {
      chips.push(denom);
      remain -= denom;
    }
    if (chips.length >= limit) {
      break;
    }
  }
  if (chips.length === 0) {
    chips.push(1);
  }
  return chips;
};

const chipClassFor = (chip: number): string => {
  if (chip >= 1000) {
    return "chip-black";
  }
  if (chip >= 500) {
    return "chip-gold";
  }
  if (chip >= 100) {
    return "chip-green";
  }
  if (chip >= 25) {
    return "chip-blue";
  }
  if (chip >= 5) {
    return "chip-red";
  }
  return "chip-white";
};

const describeLegalActions = (legalActions: LegalAction[]): string => {
  if (legalActions.length === 0) {
    return "当前不是你的回合或暂无可执行动作。";
  }
  return legalActions
    .map((action) => {
      const label = actionLabelMap[action.type];
      if (action.type === "bet" || action.type === "raise") {
        return `${label}(${action.minAmount}-${action.maxAmount})`;
      }
      if (action.type === "call") {
        return `${label}(${action.toCall ?? 0})`;
      }
      return label;
    })
    .join(" / ");
};

const describeTurn = (state: TableState | null): string => {
  if (!state || !state.hand || state.hand.currentActorSeat === null) {
    return "当前无行动玩家。";
  }

  const actor = state.seats[state.hand.currentActorSeat];
  if (!actor) {
    return "当前行动席位为空。";
  }

  const toCall = Math.max(0, state.hand.currentBet - actor.betThisStreet);
  if (toCall === 0) {
    return `轮到 ${actor.playerName} 行动，可选择过牌、下注或全下。`;
  }
  if (actor.stack <= toCall) {
    return `轮到 ${actor.playerName} 行动，需至少投入 ${toCall} 才能继续（可全下）。`;
  }
  return `轮到 ${actor.playerName} 行动，需跟注 ${toCall}，也可加注或弃牌。`;
};

export function App(): JSX.Element {
  const [token, setToken] = useState<string>("");
  const [player, setPlayer] = useState<Player | null>(null);
  const [nameInput, setNameInput] = useState("Player");
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [tableState, setTableState] = useState<TableState | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [actionAmount, setActionAmount] = useState(50);
  const [statusText, setStatusText] = useState("未连接");
  const [errorText, setErrorText] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [turnDeadlineMs, setTurnDeadlineMs] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [hideOwnCards, setHideOwnCards] = useState(false);
  const [dealBursts, setDealBursts] = useState<DealBurst[]>([]);
  const [betBursts, setBetBursts] = useState<BetBurst[]>([]);
  const [boardDealSlots, setBoardDealSlots] = useState<number[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminQuery, setAdminQuery] = useState("");
  const [adminNewName, setAdminNewName] = useState("");
  const [adminNameDrafts, setAdminNameDrafts] = useState<Record<string, string>>({});
  const [adminBusy, setAdminBusy] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "Beginner Table",
    smallBlind: 5,
    bigBlind: 10,
    maxSeats: 6,
    initialStack: 200,
    actionTimeoutSec: 20
  });
  const wsRef = useRef<WebSocket | null>(null);
  const lastTurnKeyRef = useRef("");
  const lastHandIdRef = useRef("");
  const prevStreetBetRef = useRef<Record<number, number>>({});
  const dealClearTimerRef = useRef<number | null>(null);
  const betClearTimerRef = useRef<number | null>(null);
  const boardDealClearTimerRef = useRef<number | null>(null);
  const prevBoardStateRef = useRef<{ handId: string; boardLen: number }>({ handId: "", boardLen: 0 });

  const clearDealTimer = (): void => {
    if (dealClearTimerRef.current !== null) {
      window.clearTimeout(dealClearTimerRef.current);
      dealClearTimerRef.current = null;
    }
  };

  const clearBetTimer = (): void => {
    if (betClearTimerRef.current !== null) {
      window.clearTimeout(betClearTimerRef.current);
      betClearTimerRef.current = null;
    }
  };

  const clearBoardDealTimer = (): void => {
    if (boardDealClearTimerRef.current !== null) {
      window.clearTimeout(boardDealClearTimerRef.current);
      boardDealClearTimerRef.current = null;
    }
  };

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    [token]
  );

  const refreshTables = async (): Promise<void> => {
    if (!token) {
      return;
    }
    const response = await fetch(`${API_URL}/api/tables`, { headers: authHeaders });
    const data = await response.json();
    setTables(data.tables ?? []);
  };

  const refreshCurrentPlayer = async (): Promise<Player | null> => {
    if (!token) {
      return null;
    }
    const response = await fetch(`${API_URL}/api/me`, { headers: authHeaders });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    if (data.player?.id && data.player?.name) {
      const nextPlayer: Player = {
        id: String(data.player.id),
        name: String(data.player.name),
        isAdmin: Boolean(data.player.isAdmin)
      };
      setPlayer(nextPlayer);
      return nextPlayer;
    }
    return null;
  };

  const refreshAdminUsers = async (query = adminQuery): Promise<void> => {
    if (!token || !player?.isAdmin) {
      return;
    }
    const q = query.trim();
    const response = await fetch(`${API_URL}/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`, {
      headers: authHeaders
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: "加载用户列表失败" }));
      setErrorText(data.error ?? "加载用户列表失败");
      setAdminUsers([]);
      return;
    }
    const data = await response.json();
    const users = (data.users ?? []) as AdminUser[];
    setAdminUsers(users);
    setAdminNameDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const user of users) {
        next[user.playerId] = prev[user.playerId] ?? user.name;
      }
      return next;
    });
  };

  const loadTable = async (tableId: string): Promise<void> => {
    if (!token || !tableId) {
      return;
    }
    const response = await fetch(`${API_URL}/api/tables/${tableId}`, { headers: authHeaders });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    setTableState(data.table);
  };

  const connectWs = (): void => {
    if (!token) {
      return;
    }
    wsRef.current?.close();
    const socket = new WebSocket(wsUrl(token));
    wsRef.current = socket;
    socket.onopen = () => {
      setStatusText("WS 已连接");
      if (selectedTableId) {
        socket.send(JSON.stringify({ type: "subscribe_table", tableId: selectedTableId }));
      }
    };
    socket.onclose = () => {
      setStatusText("WS 已断开");
    };
    socket.onerror = () => {
      setStatusText("WS 异常");
    };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "table_state" && data.state && (!selectedTableId || data.tableId === selectedTableId)) {
          setTableState(data.state as TableState);
          setErrorText("");
        }
        if (data.type === "table_closed") {
          const closedTableId = String(data.tableId ?? "");
          if (closedTableId) {
            setTables((prev) => prev.filter((table) => table.id !== closedTableId));
            setSelectedTableId((prev) => (prev === closedTableId ? "" : prev));
            setTableState((prev) => (prev?.id === closedTableId ? null : prev));
          }
          if (typeof data.message === "string" && data.message.trim()) {
            setErrorText(data.message);
          }
          return;
        }
        if (data.type === "error") {
          setErrorText(data.message ?? "操作失败");
        }
      } catch {
        setErrorText("收到无法解析的实时消息");
      }
    };
  };

  useEffect(() => {
    if (token) {
      void refreshTables();
      if (player?.isAdmin) {
        void refreshAdminUsers("");
      } else {
        setAdminUsers([]);
      }
      connectWs();
    }
    return () => {
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, player?.isAdmin]);

  useEffect(() => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !selectedTableId) {
      return;
    }
    socket.send(JSON.stringify({ type: "subscribe_table", tableId: selectedTableId }));
  }, [selectedTableId]);

  useEffect(() => {
    return () => {
      clearDealTimer();
      clearBetTimer();
      clearBoardDealTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const hand = tableState?.hand;
    const isActiveTurn = tableState?.status === "active" && hand && hand.currentActorSeat !== null;
    if (!isActiveTurn) {
      setTurnDeadlineMs(null);
      setRemainingMs(0);
      lastTurnKeyRef.current = "";
      return;
    }

    const turnKey = `${hand.handId}:${hand.version}:${hand.currentActorSeat}`;
    if (lastTurnKeyRef.current !== turnKey) {
      const deadline = Date.now() + tableState.actionTimeoutSec * 1000;
      lastTurnKeyRef.current = turnKey;
      setTurnDeadlineMs(deadline);
      setRemainingMs(Math.max(0, deadline - Date.now()));
    }
  }, [
    tableState?.status,
    tableState?.hand?.handId,
    tableState?.hand?.version,
    tableState?.hand?.currentActorSeat,
    tableState?.actionTimeoutSec
  ]);

  useEffect(() => {
    if (!turnDeadlineMs) {
      setRemainingMs(0);
      return;
    }

    const update = (): void => {
      setRemainingMs(Math.max(0, turnDeadlineMs - Date.now()));
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [turnDeadlineMs]);

  useEffect(() => {
    const hand = tableState?.hand;
    const isNewHand =
      tableState?.status === "active" &&
      hand &&
      hand.street === "preflop" &&
      hand.handId !== lastHandIdRef.current;
    if (!isNewHand || !tableState) {
      if (!hand) {
        lastHandIdRef.current = "";
        prevStreetBetRef.current = {};
      }
      return;
    }

    lastHandIdRef.current = hand.handId;
    const inHandSeats = tableState.seats
      .filter((seat): seat is Seat => seat !== null && seat.inHand)
      .sort((a, b) => a.seatIndex - b.seatIndex);
    const bursts: DealBurst[] = [];
    for (let i = 0; i < inHandSeats.length; i += 1) {
      const seat = inHandSeats[i];
      bursts.push({
        id: `${hand.handId}-${seat.seatIndex}-c1`,
        seatIndex: seat.seatIndex,
        delayMs: i * 80
      });
      bursts.push({
        id: `${hand.handId}-${seat.seatIndex}-c2`,
        seatIndex: seat.seatIndex,
        delayMs: i * 80 + 90
      });
    }
    setDealBursts(bursts);
    clearDealTimer();
    dealClearTimerRef.current = window.setTimeout(() => {
      setDealBursts([]);
      dealClearTimerRef.current = null;
    }, 2200);

    const nextBetMap: Record<number, number> = {};
    for (const seat of tableState.seats) {
      if (seat && seat.inHand) {
        nextBetMap[seat.seatIndex] = seat.betThisStreet;
      }
    }
    prevStreetBetRef.current = nextBetMap;
  }, [tableState?.status, tableState?.hand?.handId, tableState?.hand?.street, tableState?.seats]);

  useEffect(() => {
    const hand = tableState?.hand;
    if (!tableState || tableState.status !== "active" || !hand) {
      return;
    }

    const nextBetMap: Record<number, number> = {};
    const bursts: BetBurst[] = [];
    const unit = Math.max(tableState.bigBlind, 1);

    for (let idx = 0; idx < tableState.seats.length; idx += 1) {
      const seat = tableState.seats[idx];
      if (!seat || !seat.inHand || seat.folded) {
        continue;
      }
      const currentBet = seat.betThisStreet;
      const prevBet = prevStreetBetRef.current[seat.seatIndex] ?? currentBet;
      const delta = currentBet - prevBet;
      if (delta > 0) {
        const burstCount = Math.min(4, Math.max(1, Math.ceil(delta / unit)));
        for (let i = 0; i < burstCount; i += 1) {
          bursts.push({
            id: `${hand.handId}-${seat.seatIndex}-b-${hand.version}-${i}`,
            seatIndex: seat.seatIndex,
            delayMs: i * 70
          });
        }
      }
      nextBetMap[seat.seatIndex] = currentBet;
    }

    prevStreetBetRef.current = nextBetMap;
    if (bursts.length === 0) {
      return;
    }
    setBetBursts(bursts);
    clearBetTimer();
    const maxDelay = bursts.reduce((m, b) => Math.max(m, b.delayMs), 0);
    betClearTimerRef.current = window.setTimeout(() => {
      setBetBursts([]);
      betClearTimerRef.current = null;
    }, 1100 + maxDelay);
  }, [tableState?.hand?.version, tableState?.status, tableState?.bigBlind, tableState?.seats, tableState?.hand?.handId]);

  useEffect(() => {
    const hand = tableState?.hand;
    if (!hand || tableState?.status !== "active") {
      prevBoardStateRef.current = { handId: "", boardLen: 0 };
      setBoardDealSlots([]);
      clearBoardDealTimer();
      return;
    }

    const nextLen = hand.board.length;
    const prev = prevBoardStateRef.current;
    const handChanged = prev.handId !== hand.handId;

    if (handChanged && prev.handId === "") {
      prevBoardStateRef.current = { handId: hand.handId, boardLen: nextLen };
      return;
    }

    const prevLen = handChanged ? 0 : prev.boardLen;
    if (nextLen > prevLen) {
      const slots = Array.from({ length: nextLen - prevLen }, (_, idx) => prevLen + idx);
      setBoardDealSlots(slots);
      clearBoardDealTimer();
      boardDealClearTimerRef.current = window.setTimeout(
        () => {
          setBoardDealSlots([]);
          boardDealClearTimerRef.current = null;
        },
        1000 + slots.length * 130
      );
    }

    prevBoardStateRef.current = { handId: hand.handId, boardLen: nextLen };
  }, [tableState?.status, tableState?.hand?.handId, tableState?.hand?.board.length]);

  const loginGuest = async (): Promise<void> => {
    if (loginBusy) {
      return;
    }
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setErrorText("请输入昵称");
      return;
    }
    setLoginBusy(true);
    setErrorText("");
    try {
      const response = await fetch(`${API_URL}/api/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName })
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || data.error) {
        setErrorText(String(data.error ?? "登录失败，请检查服务状态"));
        return;
      }
      setToken(String(data.token ?? ""));
      setPlayer({
        id: String((data.player as Record<string, unknown>)?.id ?? ""),
        name: String((data.player as Record<string, unknown>)?.name ?? trimmedName),
        isAdmin: Boolean((data.player as Record<string, unknown>)?.isAdmin)
      });
    } catch {
      setErrorText("无法连接后端，请先启动服务（npm run dev:server）");
    } finally {
      setLoginBusy(false);
    }
  };

  const returnToNameInput = (): void => {
    if (selectedTableId && tableState) {
      setErrorText("进入牌桌后不能切换用户，请先返回大厅");
      return;
    }
    wsRef.current?.close();
    setToken("");
    setPlayer(null);
    setSelectedTableId("");
    setTableState(null);
    setStatusText("未连接");
    setErrorText("");
    setAdminUsers([]);
    setAdminQuery("");
    setAdminNewName("");
    setAdminNameDrafts({});
    setHideOwnCards(false);
  };

  const createAdminUser = async (): Promise<void> => {
    const name = adminNewName.trim();
    if (!name) {
      setErrorText("请输入要创建的用户名");
      return;
    }
    setAdminBusy(true);
    setErrorText("");
    try {
      const response = await fetch(`${API_URL}/api/admin/users`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name })
      });
      const data = await response.json();
      if (data.error) {
        setErrorText(data.error);
        return;
      }
      setAdminNewName("");
      await refreshAdminUsers();
    } finally {
      setAdminBusy(false);
    }
  };

  const updateAdminUserName = async (playerId: string): Promise<void> => {
    const nextName = (adminNameDrafts[playerId] ?? "").trim();
    if (!nextName) {
      setErrorText("用户名不能为空");
      return;
    }
    setAdminBusy(true);
    setErrorText("");
    try {
      const response = await fetch(`${API_URL}/api/admin/users/${playerId}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ name: nextName })
      });
      const data = await response.json();
      if (data.error) {
        setErrorText(data.error);
        return;
      }
      const renamingSelf = player?.id === playerId;
      let currentPlayer = player;
      if (renamingSelf) {
        const refreshedPlayer = await refreshCurrentPlayer();
        if (refreshedPlayer) {
          currentPlayer = refreshedPlayer;
        }
      }

      if (!renamingSelf || currentPlayer?.isAdmin) {
        await refreshAdminUsers();
      } else {
        setAdminUsers([]);
      }
      if (selectedTableId) {
        await loadTable(selectedTableId);
      }
    } finally {
      setAdminBusy(false);
    }
  };

  const deleteAdminUser = async (targetUser: AdminUser): Promise<void> => {
    const confirmed = window.confirm(`确认删除用户 ${targetUser.name} 吗？`);
    if (!confirmed) {
      return;
    }
    setAdminBusy(true);
    setErrorText("");
    try {
      const response = await fetch(`${API_URL}/api/admin/users/${targetUser.playerId}`, {
        method: "DELETE",
        headers: authHeaders
      });
      const data = await response.json();
      if (data.error) {
        setErrorText(data.error);
        return;
      }
      if (player?.id === targetUser.playerId) {
        returnToNameInput();
        return;
      }
      await refreshAdminUsers();
      if (selectedTableId) {
        await loadTable(selectedTableId);
      }
    } finally {
      setAdminBusy(false);
    }
  };

  const createTable = async (): Promise<void> => {
    setErrorText("");
    const payload = {
      name: createForm.name,
      smallBlind: createForm.smallBlind,
      bigBlind: createForm.bigBlind,
      maxSeats: createForm.maxSeats,
      minBuyIn: createForm.initialStack,
      maxBuyIn: createForm.initialStack,
      actionTimeoutSec: createForm.actionTimeoutSec
    };
    const response = await fetch(`${API_URL}/api/tables`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.error) {
      setErrorText(data.error);
      return;
    }
    await refreshTables();
    setSelectedTableId(data.table.id);
    setTableState(data.table);
    wsRef.current?.send(JSON.stringify({ type: "subscribe_table", tableId: data.table.id }));
  };

  const selectTable = async (tableId: string): Promise<void> => {
    setSelectedTableId(tableId);
    await loadTable(tableId);
    wsRef.current?.send(JSON.stringify({ type: "subscribe_table", tableId }));
  };

  const closeTableByAdmin = async (tableId: string, tableName: string): Promise<void> => {
    if (!player?.isAdmin) {
      return;
    }
    const confirmed = window.confirm(`确认关闭牌桌 "${tableName}" 吗？`);
    if (!confirmed) {
      return;
    }
    setErrorText("");
    const response = await fetch(`${API_URL}/api/admin/tables/${tableId}`, {
      method: "DELETE",
      headers: authHeaders
    });
    const data = await response.json();
    if (data.error) {
      setErrorText(data.error);
      return;
    }
    if (selectedTableId === tableId) {
      setSelectedTableId("");
      setTableState(null);
    }
    await refreshTables();
  };

  const joinSeat = async (targetSeatIndex: number): Promise<void> => {
    if (!selectedTableId || !tableState || mySeat) {
      return;
    }
    setErrorText("");
    const response = await fetch(`${API_URL}/api/tables/${selectedTableId}/seats/join`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ seatIndex: targetSeatIndex, buyIn: tableState.minBuyIn })
    });
    const data = await response.json();
    if (data.error) {
      setErrorText(data.error);
      return;
    }
    setTableState(data.table);
  };

  const switchSeat = async (targetSeatIndex: number): Promise<void> => {
    if (!selectedTableId || !tableState || !mySeat || mySeat.seatIndex === targetSeatIndex) {
      return;
    }
    setErrorText("");
    const response = await fetch(`${API_URL}/api/tables/${selectedTableId}/seats/switch`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ seatIndex: targetSeatIndex })
    });
    const data = await response.json();
    if (data.error) {
      setErrorText(data.error);
      return;
    }
    setTableState(data.table);
  };

  const leaveSeat = async (): Promise<void> => {
    if (!selectedTableId) {
      return;
    }
    const response = await fetch(`${API_URL}/api/tables/${selectedTableId}/seats/leave`, {
      method: "POST",
      headers: authHeaders
    });
    const data = await response.json();
    if (data.error) {
      setErrorText(data.error);
      return;
    }
    setTableState(data.table);
  };

  const startHand = async (): Promise<void> => {
    if (!selectedTableId || !tableState) {
      return;
    }
    if (!tableState.hostPlayerId || player?.id !== tableState.hostPlayerId) {
      setErrorText("仅房主可以开始新一手");
      return;
    }
    if (tableState.status === "waiting" && tableState.lastCompletedHand) {
      const confirmed = window.confirm("上一手已结束，确认开始下一手吗？");
      if (!confirmed) {
        return;
      }
    }
    const response = await fetch(`${API_URL}/api/tables/${selectedTableId}/start-hand`, {
      method: "POST",
      headers: authHeaders
    });
    const data = await response.json();
    if (data.error) {
      setErrorText(data.error);
      return;
    }
    setTableState(data.table);
  };

  const sendAction = async (action: LegalAction): Promise<void> => {
    if (!tableState || !selectedTableId) {
      return;
    }
    const isSizing = action.type === "bet" || action.type === "raise";
    const boundedAmount = isSizing
      ? Math.max(action.minAmount ?? 0, Math.min(Math.floor(actionAmount || 0), action.maxAmount ?? Number.MAX_SAFE_INTEGER))
      : undefined;
    const payload = {
      type: action.type,
      amount: boundedAmount,
      expectedVersion: tableState.hand?.version
    };
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "action", tableId: selectedTableId, action: payload }));
      return;
    }
    const response = await fetch(`${API_URL}/api/tables/${selectedTableId}/actions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.error) {
      setErrorText(data.error);
      return;
    }
    setTableState(data.table);
  };

  const mySeat = tableState?.seats.find((seat) => seat?.playerId === player?.id) ?? null;
  const currentBoard = tableState?.hand?.board ?? [];
  const completedBoard = tableState?.lastCompletedHand?.board ?? [];
  const showingCompletedBoard = tableState?.status === "waiting" && currentBoard.length === 0 && completedBoard.length > 0;
  const board = currentBoard.length > 0 ? currentBoard : showingCompletedBoard ? completedBoard : [];
  const lastCompletedWinners = tableState?.lastCompletedHand?.result?.winners ?? [];
  const actorSeatIndex = tableState?.hand?.currentActorSeat ?? null;
  const dealerSeatIndex = tableState?.hand?.dealerSeat ?? null;
  const smallBlindSeatIndex = tableState?.hand?.smallBlindSeat ?? null;
  const bigBlindSeatIndex = tableState?.hand?.bigBlindSeat ?? null;
  const actorSeat = actorSeatIndex !== null && tableState ? tableState.seats[actorSeatIndex] : null;
  const turnDescription = describeTurn(tableState);
  const legalActionDescription = describeLegalActions(tableState?.legalActions ?? []);
  const betSizingAction = (tableState?.legalActions ?? []).find(
    (action) => action.type === "bet" || action.type === "raise"
  );
  const mySeatIndex = mySeat?.seatIndex ?? -1;
  const hostPlayerId = tableState?.hostPlayerId ?? null;
  const hostSeat = hostPlayerId ? tableState?.seats.find((seat) => seat?.playerId === hostPlayerId) ?? null : null;
  const isHostPlayer = Boolean(player && hostPlayerId && player.id === hostPlayerId);
  const hasHandStarted = (tableState?.handCount ?? 0) > 0;
  const myHoleCards = mySeat?.holeCards ?? [];
  const countdownSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const tableStatusClass = tableState?.status === "active" ? "active" : "waiting";
  const ringSeatCount = tableState?.maxSeats ?? 0;
  const inTableView = Boolean(selectedTableId && tableState);
  const hasLegalActions = (tableState?.legalActions.length ?? 0) > 0;
  const hasSizingActions = Boolean(betSizingAction);
  const nonSizingActions = (tableState?.legalActions ?? []).filter((action) => action.type !== "bet" && action.type !== "raise");
  const callAction = (tableState?.legalActions ?? []).find((action) => action.type === "call");
  const toCallAmount = callAction?.toCall ?? 0;
  const isMyTurn = Boolean(mySeat && actorSeat?.playerId === mySeat.playerId);
  const showTurnPanel = tableState?.status === "active" && Boolean(actorSeat);
  const actionAmountMin = betSizingAction?.minAmount ?? 0;
  const actionAmountMax = Math.max(
    0,
    Math.min(betSizingAction?.maxAmount ?? mySeat?.stack ?? 0, mySeat?.stack ?? 0)
  );
  const normalizedActionAmount = Math.max(0, Math.min(Math.floor(actionAmount || 0), actionAmountMax));
  const sizingActionAmount = hasSizingActions ? Math.max(actionAmountMin, normalizedActionAmount) : 0;
  const halfPotTarget = Math.max(
    actionAmountMin,
    Math.min(actionAmountMax, Math.floor((tableState?.hand?.pot ?? 0) / 2))
  );
  const potTarget = Math.max(
    actionAmountMin,
    Math.min(actionAmountMax, Math.floor(tableState?.hand?.pot ?? actionAmountMin))
  );
  const draftedBreakdown = chipBreakdown(normalizedActionAmount);
  const remainingChipBreakdown = chipBreakdown(Math.max(0, (mySeat?.stack ?? 0) - normalizedActionAmount));
  const boardDealOrder = new Map<number, number>();
  for (let idx = 0; idx < boardDealSlots.length; idx += 1) {
    boardDealOrder.set(boardDealSlots[idx], idx);
  }
  const winnerNameById = new Map<string, string>();
  for (const seat of tableState?.seats ?? []) {
    if (seat) {
      winnerNameById.set(seat.playerId, seat.playerName);
    }
  }
  const lastWinnerText = lastCompletedWinners
    .map((winner) => `${winnerNameById.get(winner.playerId) ?? `玩家${winner.playerId.slice(0, 6)}`} +${winner.amount}`)
    .join(" · ");
  const nonSizingActionText = (action: LegalAction): string => {
    if (action.type === "call") {
      return `${actionLabelMap[action.type]} ${action.toCall ?? 0}`;
    }
    if (action.type === "all-in") {
      const allInTarget = action.maxAmount ?? action.minAmount ?? 0;
      return `${actionLabelMap[action.type]} ${allInTarget}`;
    }
    return actionLabelMap[action.type];
  };

  const clampActionAmount = (nextAmount: number): void => {
    const bounded = Math.max(0, Math.min(Math.floor(nextAmount || 0), actionAmountMax));
    setActionAmount(bounded);
  };

  const leaveTableView = (): void => {
    if (hasHandStarted) {
      setErrorText("牌局开始后不能返回大厅");
      return;
    }
    setSelectedTableId("");
    setTableState(null);
    setHideOwnCards(false);
    void refreshTables();
  };

  if (!token || !player) {
    return (
      <main className="page page-login">
        <div className="bg-shape shape-a" />
        <div className="bg-shape shape-b" />
        <section className="card-surface login-shell">
          <p className="eyebrow">ONLINE HOLD'EM</p>
          <h1>进入牌桌大厅</h1>
          <p className="muted">创建游客身份后即可创建桌子、入座并开始对局。</p>
          <form
            className="auth-row"
            onSubmit={(event) => {
              event.preventDefault();
              void loginGuest();
            }}
          >
            <input
              className="text-input"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="你的昵称"
            />
            <button className="btn btn-primary" type="submit" disabled={loginBusy}>
              {loginBusy ? "进入中..." : "进入"}
            </button>
          </form>
          {errorText ? <p className="error">{errorText}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className={`page ${inTableView ? "page-table-mode" : ""}`}>
      {!inTableView ? <div className="bg-shape shape-a" /> : null}
      {!inTableView ? <div className="bg-shape shape-b" /> : null}
      {!inTableView ? (
        <header className="topbar card-surface">
          <div className="brand-block">
            <p className="eyebrow">ONLINE TEXAS HOLD'EM</p>
            <h1>牌桌控制台</h1>
            <p className="muted">
              当前玩家: {player.name} ({player.id.slice(0, 8)}) {player.isAdmin ? "· 管理员" : ""}
            </p>
          </div>
        </header>
      ) : null}

      <section className={`layout ${inTableView ? "layout-table-only" : ""}`}>
        {!inTableView ? (
          <aside className="sidebar">
            <section className="panel card-surface">
              <h2 className="create-table-title">创建桌子</h2>
              <div className="form-grid">
                <label>
                  名称
                  <input
                    className="text-input"
                    value={createForm.name}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </label>
                <label>
                  座位数
                  <input
                    className="text-input"
                    type="number"
                    value={createForm.maxSeats}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, maxSeats: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  小盲
                  <input
                    className="text-input"
                    type="number"
                    value={createForm.smallBlind}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, smallBlind: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  大盲
                  <input
                    className="text-input"
                    type="number"
                    value={createForm.bigBlind}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, bigBlind: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  初始筹码
                  <input
                    className="text-input"
                    type="number"
                    value={createForm.initialStack}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, initialStack: Number(event.target.value) }))
                    }
                  />
                </label>
                <label className="full-row">
                  行动秒数
                  <input
                    className="text-input"
                    type="number"
                    value={createForm.actionTimeoutSec}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, actionTimeoutSec: Number(event.target.value) }))
                    }
                  />
                </label>
              </div>
              <button className="btn btn-primary full-width" onClick={() => void createTable()}>
                创建牌桌
              </button>
            </section>

            {player.isAdmin ? (
              <section className="panel card-surface admin-panel">
                <div className="panel-head">
                  <h2>用户管理</h2>
                  <button className="btn btn-ghost" onClick={() => void refreshAdminUsers()} disabled={adminBusy}>
                    {adminBusy ? "处理中..." : "刷新"}
                  </button>
                </div>

                <div className="admin-search-row">
                  <input
                    className="text-input"
                    value={adminQuery}
                    onChange={(event) => setAdminQuery(event.target.value)}
                    placeholder="搜索用户名或ID"
                    disabled={adminBusy}
                  />
                  <button className="btn btn-ghost" onClick={() => void refreshAdminUsers()} disabled={adminBusy}>
                    搜索
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setAdminQuery("");
                      void refreshAdminUsers("");
                    }}
                    disabled={adminBusy}
                  >
                    清空
                  </button>
                </div>

                <div className="admin-create-row">
                  <input
                    className="text-input"
                    value={adminNewName}
                    onChange={(event) => setAdminNewName(event.target.value)}
                    placeholder="新增用户名"
                    disabled={adminBusy}
                  />
                  <button className="btn btn-primary" onClick={() => void createAdminUser()} disabled={adminBusy}>
                    新增用户
                  </button>
                </div>

                <ul className="admin-user-list">
                  {adminUsers.map((user) => (
                    <li key={user.playerId} className="admin-user-item">
                      <div className="admin-user-meta">
                        <strong>{user.name}</strong>
                        <span>ID {user.playerId.slice(0, 8)} · 会话 {user.sessionCount}</span>
                      </div>
                      <div className="admin-user-actions">
                        <input
                          className="text-input"
                          value={adminNameDrafts[user.playerId] ?? user.name}
                          onChange={(event) =>
                            setAdminNameDrafts((prev) => ({ ...prev, [user.playerId]: event.target.value }))
                          }
                          disabled={adminBusy}
                        />
                        <button
                          className="btn btn-ghost"
                          onClick={() => void updateAdminUserName(user.playerId)}
                          disabled={adminBusy}
                        >
                          改名
                        </button>
                        <button
                          className="btn btn-ghost danger"
                          onClick={() => void deleteAdminUser(user)}
                          disabled={adminBusy}
                        >
                          删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {adminUsers.length === 0 ? <p className="muted admin-empty">没有匹配的用户</p> : null}
              </section>
            ) : null}
          </aside>
        ) : null}

        <section className={inTableView ? "table-stage table-stage-full" : "panel card-surface table-stage lobby-stage"}>
          {!inTableView ? (
            <div className="table-stage-head">
              <h2>牌桌</h2>
              <button className="btn btn-ghost" onClick={() => void refreshTables()}>
                刷新大厅
              </button>
            </div>
          ) : null}
          {!tableState ? (
            <section className="lobby-empty">
              <div className="lobby-empty-head">
                <h3>大厅列表</h3>
                <p className="muted">选择一张牌桌进入。创建桌子请使用左侧面板。</p>
              </div>

              <ul className="table-list lobby-table-list">
                {tables.map((table) => (
                  <li key={`lobby-${table.id}`} className={selectedTableId === table.id ? "selected" : ""}>
                    <button className="table-btn" onClick={() => void selectTable(table.id)}>
                      <span className="table-name">{table.name}</span>
                      <span className="table-meta">
                        状态 {table.status === "active" ? "进行中" : "等待中"} · 在座 {table.seatedCount}/{table.maxSeats}
                      </span>
                      <span className="table-meta">
                        盲注 {table.smallBlind}/{table.bigBlind} · 手数 #{table.handCount}
                      </span>
                    </button>
                    {player.isAdmin ? (
                      <button
                        className="btn btn-ghost danger table-close-btn"
                        onClick={() => void closeTableByAdmin(table.id, table.name)}
                      >
                        关闭桌子
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {tables.length === 0 ? (
                <div className="lobby-empty-card">
                  <p className="muted">当前没有可用牌桌，请先在左侧创建一张新桌。</p>
                </div>
              ) : null}
            </section>
          ) : null}
          {tableState ? (
            <>
              <section className={`poker-table-shell ${inTableView ? "poker-table-shell-full" : ""}`}>
                <div className="table-wood">
                  <div className="table-felt">
                    {inTableView ? (
                      <div className="table-corner-ui">
                        <button
                          className="btn btn-ghost table-exit-btn"
                          onClick={leaveTableView}
                          disabled={hasHandStarted}
                          title={hasHandStarted ? "牌局开始后不能返回大厅" : "返回大厅"}
                        >
                          返回大厅
                        </button>
                      </div>
                    ) : null}

                    <div className="table-hud">
                      <div className="center-info-row">
                        <span className="center-pill">桌名 {tableState.name}</span>
                        <span className="center-pill host-pill">
                          房主 {hostSeat?.playerName ?? (hostPlayerId ? `玩家${hostPlayerId.slice(0, 6)}` : "待定")}
                        </span>
                        <span className={`center-pill state ${tableStatusClass}`}>
                          状态 {tableState.status === "active" ? "进行中" : "等待中"}
                        </span>
                        <span className="center-pill">
                          盲注 {tableState.smallBlind}/{tableState.bigBlind}
                        </span>
                        <span className="center-pill">在座 {tableState.seatedCount}/{tableState.maxSeats}</span>
                        {tableState.hand ? (
                          <span className="center-pill blind-flow">
                            庄 #{tableState.hand.dealerSeat} · 小盲 #{tableState.hand.smallBlindSeat} · 大盲 #{tableState.hand.bigBlindSeat}
                          </span>
                        ) : null}
                      </div>

                      {showTurnPanel ? (
                        <div className="center-turn-panel">
                          <div className="center-turn-top">
                            <span>当前行动: {actorSeat ? `${actorSeat.playerName} (#${actorSeat.seatIndex})` : "-"}</span>
                            <span className={countdownSec <= 5 ? "countdown danger" : "countdown"}>{countdownSec}s</span>
                          </div>
                          <p className="center-turn-desc">请在倒计时内完成动作</p>
                          {mySeat && hasLegalActions ? (
                            <p className="center-turn-legal">可执行: {legalActionDescription}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <ul className="seat-ring">
                      {Array.from({ length: ringSeatCount }, (_, index) => {
                        const seat = tableState.seats[index] ?? null;
                        const isActor = actorSeatIndex === index;
                        const isMine = mySeatIndex === index;
                        const isDealer = dealerSeatIndex === index;
                        const isSmallBlind = smallBlindSeatIndex === index;
                        const isBigBlind = bigBlindSeatIndex === index;
                        const facing = seatFacingAt(index, ringSeatCount);
                        const shellRotate = seatShellRotateDeg(facing);
                        const bodyRotate = seatBodyRotateDeg(facing);
                        const seatChips = buildChipStack(seat?.stack ?? 0);
                        const seatPos = seatRingStyle(index, ringSeatCount);
                        const canClickToJoin = !seat && mySeatIndex === -1;
                        const canClickToSwitch = !seat && mySeatIndex !== -1 && mySeatIndex !== index && !hasHandStarted;
                        const canClickEmpty = canClickToJoin || canClickToSwitch;
                        return (
                          <li
                            key={index}
                            className={`ring-seat ${seat ? "occupied" : "empty"} ${isActor ? "actor" : ""} ${isMine ? "me" : ""} ${canClickEmpty ? "clickable-empty" : ""} facing-${facing}`}
                            style={seatPos}
                            onClick={
                              canClickToJoin
                                ? () => void joinSeat(index)
                                : canClickToSwitch
                                  ? () => void switchSeat(index)
                                  : undefined
                            }
                          >
                            <div
                              className="ring-seat-shell"
                              style={
                                {
                                  "--seat-shell-rotate": `${shellRotate}deg`
                                } as CSSProperties
                              }
                            >
                              <div
                                className="ring-seat-body"
                                style={
                                  {
                                    "--seat-body-rotate": `${bodyRotate}deg`
                                  } as CSSProperties
                                }
                              >
                                {seat ? (
                                  <>
                                    <div className="ring-seat-head">
                                      <strong>
                                        #{seat.seatIndex} {seat.playerName}
                                      </strong>
                                      <div className="ring-seat-head-badges">
                                        {isDealer ? <span className="seat-role-badge dealer">D</span> : null}
                                        {isSmallBlind ? <span className="seat-role-badge small-blind">SB</span> : null}
                                        {isBigBlind ? <span className="seat-role-badge big-blind">BB</span> : null}
                                        {isActor ? <span className="actor-badge">行动中</span> : null}
                                      </div>
                                    </div>
                                    <div className="ring-chip-stack">
                                      {seatChips.map((chip, chipIndex) => (
                                        <span
                                          key={`${seat.seatIndex}-chip-${chip}-${chipIndex}`}
                                          className={`chip-token ${chipClassFor(chip)}`}
                                          style={{
                                            bottom: chipIndex * 3,
                                            left: chipIndex % 2 === 0 ? 0 : 2
                                          }}
                                        />
                                      ))}
                                    </div>
                                    <div className="ring-seat-meta">
                                      <span>筹码 {seat.stack}</span>
                                      <span>下注 {seat.betThisStreet}</span>
                                      {seat.folded ? <span className="badge muted-badge">folded</span> : null}
                                      {seat.allIn ? <span className="badge warn-badge">all-in</span> : null}
                                    </div>
                                    <div className="ring-cards">
                                      {seat.holeCards.length && !(isMine && hideOwnCards) ? seat.holeCards.map(cardLabel).join(" ") : "?? ??"}
                                    </div>
                                  </>
                                ) : (
                                  <span className="ring-empty">
                                    {canClickToSwitch ? `换到 #${index}` : `空位 #${index}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {dealBursts.length > 0 ? (
                      <div className="deal-overlay">
                        {dealBursts.map((burst) => {
                          const seatPos = seatRingStyle(burst.seatIndex, ringSeatCount);
                          return (
                            <span
                              key={burst.id}
                              className="deal-card-fly"
                              style={
                                {
                                  "--target-left": seatPos.left,
                                  "--target-top": seatPos.top,
                                  "--deal-delay": `${burst.delayMs}ms`
                                } as CSSProperties
                              }
                            />
                          );
                        })}
                      </div>
                    ) : null}

                    {betBursts.length > 0 ? (
                      <div className="bet-overlay">
                        {betBursts.map((burst) => {
                          const seatPos = seatRingStyle(burst.seatIndex, ringSeatCount);
                          return (
                            <span
                              key={burst.id}
                              className="bet-chip-fly chip-token chip-red"
                              style={
                                {
                                  "--from-left": seatPos.left,
                                  "--from-top": seatPos.top,
                                  "--bet-delay": `${burst.delayMs}ms`
                                } as CSSProperties
                              }
                            />
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="table-center">
                      <div className="pot-chip-zone">
                        <div className="pot-chip-stack">
                          {buildChipStack(tableState.hand?.pot ?? 0, 14).map((chip, chipIndex) => (
                            <span
                              key={`pot-chip-${chip}-${chipIndex}`}
                              className={`chip-token pot-chip ${chipClassFor(chip)}`}
                              style={{
                                bottom: chipIndex * 2,
                                left: chipIndex * 2
                              }}
                            />
                          ))}
                        </div>
                        <span className="pot-label">底池 {tableState.hand?.pot ?? 0}</span>
                      </div>
                      <div className="board-strip table-board">
                        {board.length ? (
                          board.map((card, idx) => {
                            const dealOrder = boardDealOrder.get(idx);
                            const dealingClass = dealOrder !== undefined && currentBoard.length > 0 ? "dealing" : "";
                            return (
                              <span
                                key={`${card.rank}-${card.suit}-${idx}`}
                                className={`board-card suit-${card.suit.toLowerCase()} ${dealingClass}`}
                                style={
                                  dealOrder !== undefined
                                    ? ({
                                        "--board-deal-delay": `${dealOrder * 120}ms`
                                      } as CSSProperties)
                                    : undefined
                                }
                              >
                                {cardLabel(card)}
                              </span>
                            );
                          })
                        ) : (
                          <span className="board-empty">(空)</span>
                        )}
                      </div>
                      {showingCompletedBoard && lastWinnerText ? (
                        <div className="winner-strip">
                          <span className="winner-title">上一手赢家</span>
                          <span className="winner-values">{lastWinnerText}</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="table-dock">
                      <div className="table-dock-row">
                        {!mySeat ? (
                          <>
                            <span className="dock-note">点击任意空位入座，自动买入 {tableState.minBuyIn} 筹码</span>
                          </>
                        ) : (
                          <>
                            <span className="stack-display">剩余筹码 {mySeat.stack}</span>
                            <button className="btn btn-ghost" onClick={() => void leaveSeat()}>
                              离座
                            </button>
                            <button
                              className="btn btn-primary start-hand-btn"
                              onClick={() => void startHand()}
                              disabled={!isHostPlayer || tableState.status === "active"}
                              title={isHostPlayer ? "由房主开始新一手" : "仅房主可以开始新一手"}
                            >
                              {tableState.lastCompletedHand ? "确认开始下一局" : "开始一手"}
                            </button>
                          </>
                        )}
                      </div>

                      {mySeat ? (
                        <div className="table-dock-row my-hand-row">
                          <span className="dock-note">我的手牌</span>
                          <div className="my-cards-strip">
                            {!hideOwnCards && myHoleCards.length > 0
                              ? myHoleCards.map((card, idx) => (
                                  <span key={`my-hole-${card.rank}-${card.suit}-${idx}`} className="my-card">
                                    {cardLabel(card)}
                                  </span>
                                ))
                              : [0, 1].map((idx) => (
                                  <span key={`my-hole-hidden-${idx}`} className="my-card hidden">
                                    ??
                                  </span>
                                ))}
                          </div>
                          <button className="btn btn-ghost anti-peek-btn" onClick={() => setHideOwnCards((prev) => !prev)}>
                            {hideOwnCards ? "显示手牌" : "防窥屏"}
                          </button>
                        </div>
                      ) : null}

                      {mySeat && hasLegalActions ? (
                        <div className="table-dock-row action-row">
                          <div className="action-row-head">
                            <span className="action-row-mode">
                              {toCallAmount > 0 ? `当前需跟注 ${toCallAmount}` : "当前可自由下注"}
                            </span>
                            {isMyTurn ? (
                              <span className={countdownSec <= 5 ? "action-row-deadline danger" : "action-row-deadline"}>
                                倒计时 {countdownSec}s
                              </span>
                            ) : null}
                          </div>
                          {hasSizingActions ? (
                            <div className="chip-amount-block">
                              <label className="dock-field">
                                金额
                                <input
                                  className="text-input"
                                  type="number"
                                  min={actionAmountMin}
                                  max={actionAmountMax}
                                  value={normalizedActionAmount}
                                  onChange={(event) => clampActionAmount(Number(event.target.value))}
                                />
                              </label>
                              <div className="amount-slider-wrap">
                                <input
                                  className="amount-slider"
                                  type="range"
                                  min={actionAmountMin}
                                  max={actionAmountMax}
                                  step={1}
                                  value={sizingActionAmount}
                                  onChange={(event) => clampActionAmount(Number(event.target.value))}
                                  disabled={actionAmountMax <= actionAmountMin}
                                />
                                <div className="amount-slider-scale">
                                  <span>{actionAmountMin}</span>
                                  <strong>{sizingActionAmount}</strong>
                                  <span>{actionAmountMax}</span>
                                </div>
                              </div>
                              <div className="chip-picker-row">
                                <button
                                  type="button"
                                  className="chip-pick-btn chip-blue"
                                  onClick={() => clampActionAmount(actionAmountMin)}
                                >
                                  最小
                                </button>
                                <button
                                  type="button"
                                  className="chip-pick-btn chip-red"
                                  onClick={() => clampActionAmount(halfPotTarget)}
                                >
                                  1/2池
                                </button>
                                <button
                                  type="button"
                                  className="chip-pick-btn chip-green"
                                  onClick={() => clampActionAmount(potTarget)}
                                >
                                  底池
                                </button>
                                <button
                                  type="button"
                                  className="chip-pick-btn chip-gold"
                                  onClick={() => clampActionAmount(actionAmountMax)}
                                >
                                  最大
                                </button>
                              </div>
                              <div className="chip-breakdown-row">
                                <span className="chip-break-label">下注构成</span>
                                <span className="chip-break-values">
                                  {draftedBreakdown.length
                                    ? draftedBreakdown.map((item) => `${item.denom}x${item.count}`).join(" · ")
                                    : "0"}
                                </span>
                              </div>
                              <div className="chip-breakdown-row">
                                <span className="chip-break-label">剩余筹码</span>
                                <span className="chip-break-values">
                                  {remainingChipBreakdown.length
                                    ? remainingChipBreakdown.map((item) => `${item.denom}x${item.count}`).join(" · ")
                                    : "0"}
                                </span>
                              </div>
                              {betSizingAction ? (
                                <button
                                  className={`btn action-btn action-size-confirm ${actionClassMap[betSizingAction.type]}`}
                                  onClick={() => {
                                    const actionWithBound: LegalAction = {
                                      ...betSizingAction,
                                      minAmount: actionAmountMin,
                                      maxAmount: actionAmountMax
                                    };
                                    setActionAmount(sizingActionAmount);
                                    void sendAction(actionWithBound);
                                  }}
                                >
                                  {betSizingAction.type === "raise" ? "确认加注" : "确认下注"} {sizingActionAmount}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {nonSizingActions.map((action) => (
                            <button
                              key={action.type}
                              className={`btn action-btn ${actionClassMap[action.type]}`}
                              onClick={() => void sendAction(action)}
                            >
                              {nonSizingActionText(action)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
            </>
          ) : null}
          {errorText ? <p className="error">{errorText}</p> : null}
        </section>
      </section>
    </main>
  );
}
