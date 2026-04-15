import { useEffect, useMemo, useRef, useState } from "react";

type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

interface Player {
  id: string;
  name: string;
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
  const [seatIndex, setSeatIndex] = useState(0);
  const [buyIn, setBuyIn] = useState(200);
  const [actionAmount, setActionAmount] = useState(50);
  const [statusText, setStatusText] = useState("未连接");
  const [errorText, setErrorText] = useState("");
  const [turnDeadlineMs, setTurnDeadlineMs] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [createForm, setCreateForm] = useState({
    name: "Beginner Table",
    smallBlind: 5,
    bigBlind: 10,
    maxSeats: 6,
    minBuyIn: 100,
    maxBuyIn: 1000,
    actionTimeoutSec: 20
  });
  const wsRef = useRef<WebSocket | null>(null);
  const lastTurnKeyRef = useRef("");

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
      connectWs();
    }
    return () => {
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !selectedTableId) {
      return;
    }
    socket.send(JSON.stringify({ type: "subscribe_table", tableId: selectedTableId }));
  }, [selectedTableId]);

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

  const loginGuest = async (): Promise<void> => {
    setErrorText("");
    const response = await fetch(`${API_URL}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameInput.trim() })
    });
    const data = await response.json();
    if (data.error) {
      setErrorText(data.error);
      return;
    }
    setToken(data.token);
    setPlayer(data.player);
  };

  const createTable = async (): Promise<void> => {
    setErrorText("");
    const response = await fetch(`${API_URL}/api/tables`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(createForm)
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

  const joinSeat = async (): Promise<void> => {
    if (!selectedTableId) {
      return;
    }
    setErrorText("");
    const response = await fetch(`${API_URL}/api/tables/${selectedTableId}/seats/join`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ seatIndex, buyIn })
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
    if (!selectedTableId) {
      return;
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
    const payload = {
      type: action.type,
      amount: action.type === "bet" || action.type === "raise" ? actionAmount : undefined,
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
  const board = currentBoard.length > 0 ? currentBoard : completedBoard;
  const boardLabel = currentBoard.length > 0 ? "公共牌" : completedBoard.length > 0 ? "上一手公共牌" : "公共牌";
  const actorSeatIndex = tableState?.hand?.currentActorSeat ?? null;
  const actorSeat = actorSeatIndex !== null && tableState ? tableState.seats[actorSeatIndex] : null;
  const turnDescription = describeTurn(tableState);
  const legalActionDescription = describeLegalActions(tableState?.legalActions ?? []);
  const countdownSec = Math.max(0, Math.ceil(remainingMs / 1000));

  if (!token || !player) {
    return (
      <main className="page">
        <section className="card login">
          <h1>Texas Hold'em MVP</h1>
          <p>先创建游客身份进入大厅。</p>
          <div className="row">
            <input value={nameInput} onChange={(event) => setNameInput(event.target.value)} placeholder="你的昵称" />
            <button onClick={() => void loginGuest()}>进入</button>
          </div>
          {errorText ? <p className="error">{errorText}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>Texas Hold'em MVP</h1>
          <p>
            当前玩家: {player.name} ({player.id.slice(0, 8)})
          </p>
        </div>
        <div className="status">{statusText}</div>
      </header>

      <section className="layout">
        <aside className="panel">
          <h2>大厅</h2>
          <button onClick={() => void refreshTables()}>刷新桌子</button>
          <ul className="table-list">
            {tables.map((table) => (
              <li key={table.id} className={selectedTableId === table.id ? "selected" : ""}>
                <button onClick={() => void selectTable(table.id)}>
                  {table.name} | {table.seatedCount}/{table.maxSeats} | {table.smallBlind}/{table.bigBlind}
                </button>
              </li>
            ))}
          </ul>

          <h3>创建桌子</h3>
          <label>
            名称
            <input
              value={createForm.name}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </label>
          <label>
            小盲
            <input
              type="number"
              value={createForm.smallBlind}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, smallBlind: Number(event.target.value) }))}
            />
          </label>
          <label>
            大盲
            <input
              type="number"
              value={createForm.bigBlind}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, bigBlind: Number(event.target.value) }))}
            />
          </label>
          <label>
            座位数
            <input
              type="number"
              value={createForm.maxSeats}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, maxSeats: Number(event.target.value) }))}
            />
          </label>
          <label>
            最小买入
            <input
              type="number"
              value={createForm.minBuyIn}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, minBuyIn: Number(event.target.value) }))}
            />
          </label>
          <label>
            最大买入
            <input
              type="number"
              value={createForm.maxBuyIn}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, maxBuyIn: Number(event.target.value) }))}
            />
          </label>
          <label>
            行动秒数
            <input
              type="number"
              value={createForm.actionTimeoutSec}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, actionTimeoutSec: Number(event.target.value) }))
              }
            />
          </label>
          <button onClick={() => void createTable()}>创建</button>
        </aside>

        <section className="panel">
          <h2>牌桌</h2>
          {!tableState ? <p>先在左侧选择或创建牌桌。</p> : null}
          {tableState ? (
            <>
              <p>
                {tableState.name} | {tableState.status} | SB/BB {tableState.smallBlind}/{tableState.bigBlind}
              </p>
              <p>
                Hand #{tableState.handCount} | 当前街: {tableState.hand?.street ?? "-"} | 底池:{" "}
                {tableState.hand?.pot ?? 0}
              </p>
              <p>
                当前行动: {actorSeat ? `${actorSeat.playerName} (#${actorSeat.seatIndex})` : "-"} | 倒计时:{" "}
                <span className={countdownSec <= 5 && tableState.status === "active" ? "countdown danger" : "countdown"}>
                  {tableState.status === "active" && actorSeat ? `${countdownSec}s` : "-"}
                </span>
              </p>
              <p>行动说明: {turnDescription}</p>
              <p>
                {boardLabel}: {board.length ? board.map(cardLabel).join(" ") : "(空)"}
              </p>

              <div className="row">
                <label>
                  Seat
                  <input type="number" value={seatIndex} onChange={(event) => setSeatIndex(Number(event.target.value))} />
                </label>
                <label>
                  Buy-in
                  <input type="number" value={buyIn} onChange={(event) => setBuyIn(Number(event.target.value))} />
                </label>
                <button onClick={() => void joinSeat()}>入座</button>
                <button onClick={() => void leaveSeat()}>离座</button>
                <button onClick={() => void startHand()}>开始一手</button>
              </div>

              <h3>座位</h3>
              <ul className="seat-list">
                {tableState.seats.map((seat, index) => (
                  <li key={index}>
                    {seat ? (
                      <span>
                        #{seat.seatIndex} {seat.playerName} | stack {seat.stack} | bet {seat.betThisStreet}{" "}
                        {seat.folded ? "| folded" : ""}
                        {seat.allIn ? "| all-in" : ""} | cards{" "}
                        {seat.holeCards.length ? seat.holeCards.map(cardLabel).join(" ") : "?? ??"}
                      </span>
                    ) : (
                      <span>#{index} Empty</span>
                    )}
                  </li>
                ))}
              </ul>

              <h3>可用动作</h3>
              <p>你的动作说明: {legalActionDescription}</p>
              <div className="row">
                <label>
                  金额
                  <input
                    type="number"
                    value={actionAmount}
                    onChange={(event) => setActionAmount(Number(event.target.value))}
                  />
                </label>
                {tableState.legalActions.map((action) => (
                  <button key={action.type} onClick={() => void sendAction(action)}>
                    {action.type}
                    {action.minAmount ? ` ${action.minAmount}-${action.maxAmount}` : ""}
                    {action.toCall ? ` (call ${action.toCall})` : ""}
                  </button>
                ))}
              </div>

              <p>{mySeat ? `你在座位 #${mySeat.seatIndex}` : "你当前是旁观者"}</p>
            </>
          ) : null}
          {errorText ? <p className="error">{errorText}</p> : null}
        </section>
      </section>
    </main>
  );
}
