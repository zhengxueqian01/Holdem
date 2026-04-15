import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { WebSocketServer, type WebSocket } from "ws";
import { HoldemTable, type ActionInput, type LegalAction, type PlayerProfile } from "@holdem/poker";

dotenv.config();

interface Session {
  token: string;
  playerId: string;
  playerName: string;
  createdAt: string;
}

interface ClientContext {
  session: Session;
  subscriptions: Set<string>;
}

interface AdminUserView {
  playerId: string;
  name: string;
  createdAt: string;
  sessionCount: number;
}

declare global {
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

const envSchema = z.object({
  SERVER_PORT: z.string().default("3001"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  ADMIN_USERNAMES: z.string().default("admin")
});

const env = envSchema.parse(process.env);
const port = Number.parseInt(env.SERVER_PORT, 10);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error("Invalid SERVER_PORT");
}

const app = express();
app.use(express.json({ limit: "512kb" }));
app.use(
  cors({
    origin: env.CORS_ORIGIN
  })
);

const sessions = new Map<string, Session>();
const tables = new Map<string, HoldemTable>();
const clients = new Map<WebSocket, ClientContext>();
const tableSubscribers = new Map<string, Set<WebSocket>>();
const tableTimeouts = new Map<string, NodeJS.Timeout>();

const authGuestSchema = z.object({
  name: z.string().trim().min(1).max(24).optional()
});

const createTableSchema = z.object({
  name: z.string().trim().min(1).max(64),
  smallBlind: z.number().int().min(1).max(10000),
  bigBlind: z.number().int().min(1).max(20000),
  maxSeats: z.number().int().min(2).max(10),
  minBuyIn: z.number().int().min(10).max(1000000),
  maxBuyIn: z.number().int().min(10).max(1000000),
  actionTimeoutSec: z.number().int().min(5).max(120)
});

const joinSeatSchema = z.object({
  seatIndex: z.number().int().min(0).max(9),
  buyIn: z.number().int().min(1)
});

const switchSeatSchema = z.object({
  seatIndex: z.number().int().min(0).max(9)
});

const actionSchema = z.object({
  type: z.enum(["fold", "check", "call", "bet", "raise", "all-in"]),
  amount: z.number().int().min(1).optional(),
  expectedVersion: z.number().int().min(1).optional()
});

const adminUserCreateSchema = z.object({
  name: z.string().trim().min(1).max(24)
});

const adminUserUpdateSchema = z.object({
  name: z.string().trim().min(1).max(24)
});

const normalizePlayerName = (name: string): string => name.trim().toLowerCase();
const adminNameSet = new Set(
  env.ADMIN_USERNAMES.split(",")
    .map((name) => normalizePlayerName(name))
    .filter((name) => name.length > 0)
);
if (adminNameSet.size === 0) {
  adminNameSet.add("admin");
}

const isAdminName = (name: string): boolean => adminNameSet.has(normalizePlayerName(name));

const isAdminSession = (session: Session | undefined): boolean => {
  if (!session) {
    return false;
  }
  return adminNameSet.has(normalizePlayerName(session.playerName));
};

const isPlayerNameTaken = (name: string, exceptPlayerId?: string, exceptPlayerIds?: Set<string>): boolean => {
  const normalized = normalizePlayerName(name);
  for (const session of sessions.values()) {
    if (exceptPlayerId && session.playerId === exceptPlayerId) {
      continue;
    }
    if (exceptPlayerIds && exceptPlayerIds.has(session.playerId)) {
      continue;
    }
    if (normalizePlayerName(session.playerName) === normalized) {
      return true;
    }
  }
  return false;
};

const findSessionByNormalizedName = (normalizedName: string): Session | null => {
  let found: Session | null = null;
  for (const session of sessions.values()) {
    if (normalizePlayerName(session.playerName) !== normalizedName) {
      continue;
    }
    if (!found || session.createdAt < found.createdAt) {
      found = session;
    }
  }
  return found;
};

const playerIdsByNormalizedName = (normalizedName: string): string[] => {
  const ids = new Set<string>();
  for (const session of sessions.values()) {
    if (normalizePlayerName(session.playerName) === normalizedName) {
      ids.add(session.playerId);
    }
  }
  return Array.from(ids);
};

const listAdminUsers = (): AdminUserView[] => {
  const userMap = new Map<string, AdminUserView>();
  for (const session of sessions.values()) {
    const key = isAdminName(session.playerName)
      ? `admin:${normalizePlayerName(session.playerName)}`
      : `player:${session.playerId}`;
    const existing = userMap.get(key);
    if (!existing) {
      userMap.set(key, {
        playerId: session.playerId,
        name: session.playerName,
        createdAt: session.createdAt,
        sessionCount: 1
      });
      continue;
    }
    existing.sessionCount += 1;
    if (session.createdAt < existing.createdAt) {
      existing.createdAt = session.createdAt;
      existing.playerId = session.playerId;
    }
    existing.name = session.playerName;
  }

  return Array.from(userMap.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

const touchTablesForPlayerRename = (playerId: string, newName: string): string[] => {
  const touched: string[] = [];
  for (const table of tables.values()) {
    const before = table.getPublicState(null).seats.some((seat) => seat?.playerId === playerId);
    if (!before) {
      continue;
    }
    table.renamePlayer(playerId, newName);
    touched.push(table.id);
  }
  return touched;
};

const removePlayerFromTables = (playerId: string): string[] => {
  const touched: string[] = [];
  for (const table of tables.values()) {
    try {
      table.leaveSeat(playerId);
      touched.push(table.id);
    } catch {
      // Player not seated at this table.
    }
  }
  return touched;
};

const asErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
};

const authMiddleware = (req: Request, res: Response, next: () => void): void => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const session = token ? sessions.get(token) : undefined;
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.session = session;
  next();
};

const adminOnlyMiddleware = (req: Request, res: Response, next: () => void): void => {
  if (!isAdminSession(req.session)) {
    res.status(403).json({ error: "Forbidden: admin only" });
    return;
  }
  next();
};

const ensureTable = (tableId: string): HoldemTable => {
  const table = tables.get(tableId);
  if (!table) {
    throw new Error("Table not found");
  }
  return table;
};

const sendJson = (ws: WebSocket, payload: unknown): void => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
};

const subscribeSocketToTable = (ws: WebSocket, tableId: string): void => {
  const ctx = clients.get(ws);
  if (!ctx) {
    return;
  }
  ctx.subscriptions.add(tableId);
  if (!tableSubscribers.has(tableId)) {
    tableSubscribers.set(tableId, new Set<WebSocket>());
  }
  tableSubscribers.get(tableId)?.add(ws);
};

const unsubscribeSocketFromTable = (ws: WebSocket, tableId: string): void => {
  const ctx = clients.get(ws);
  if (ctx) {
    ctx.subscriptions.delete(tableId);
  }
  const set = tableSubscribers.get(tableId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) {
      tableSubscribers.delete(tableId);
    }
  }
};

const broadcastTableState = (tableId: string): void => {
  const table = tables.get(tableId);
  if (!table) {
    return;
  }
  const subscribers = tableSubscribers.get(tableId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }
  for (const ws of subscribers) {
    const ctx = clients.get(ws);
    if (!ctx) {
      continue;
    }
    const state = table.getPublicState(ctx.session.playerId);
    sendJson(ws, { type: "table_state", tableId, state });
  }
};

const pickTimeoutAction = (legal: LegalAction[]): ActionInput | null => {
  if (legal.some((item) => item.type === "check")) {
    return { type: "check" };
  }
  if (legal.some((item) => item.type === "fold")) {
    return { type: "fold" };
  }
  return null;
};

const clearTimer = (tableId: string): void => {
  const timer = tableTimeouts.get(tableId);
  if (timer) {
    clearTimeout(timer);
    tableTimeouts.delete(tableId);
  }
};

const scheduleTurnTimeout = (tableId: string): void => {
  clearTimer(tableId);
  const table = tables.get(tableId);
  if (!table) {
    return;
  }
  const actorPlayerId = table.getCurrentActorPlayerId();
  if (!actorPlayerId) {
    return;
  }
  const timeoutMs = table.actionTimeoutSec * 1000;
  const timer = setTimeout(() => {
    const current = tables.get(tableId);
    if (!current) {
      return;
    }
    const actorNow = current.getCurrentActorPlayerId();
    if (!actorNow || actorNow !== actorPlayerId) {
      return;
    }
    const legal = current.getLegalActions(actorNow);
    const action = pickTimeoutAction(legal);
    if (!action) {
      return;
    }
    try {
      current.act(actorNow, action);
      broadcastTableState(tableId);
      scheduleTurnTimeout(tableId);
    } catch {
      // Ignore timeout race if state already advanced.
    }
  }, timeoutMs);
  tableTimeouts.set(tableId, timer);
};

const closeTable = (tableId: string, message = "牌桌已关闭"): boolean => {
  if (!tables.has(tableId)) {
    return false;
  }
  clearTimer(tableId);
  const subscribers = Array.from(tableSubscribers.get(tableId) ?? []);
  for (const ws of subscribers) {
    sendJson(ws, { type: "table_closed", tableId, message });
    unsubscribeSocketFromTable(ws, tableId);
  }
  tableSubscribers.delete(tableId);
  tables.delete(tableId);
  return true;
};

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "holdem-server", at: new Date().toISOString() });
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "holdem-server",
    message: "Backend is running.",
    endpoints: {
      health: "/health",
      guestAuth: "/api/auth/guest",
      websocket: "/ws?token=<token>"
    }
  });
});

app.post("/api/auth/guest", (req, res) => {
  const body = authGuestSchema.parse(req.body ?? {});
  // Allow admin username re-login even if an admin session with same name already exists.
  if (body.name && !isAdminName(body.name) && isPlayerNameTaken(body.name)) {
    res.status(409).json({ error: "该昵称已被占用，请换一个昵称" });
    return;
  }

  const playerId = randomUUID();
  let playerName = body.name ?? `Player-${playerId.slice(0, 6)}`;
  if (!body.name) {
    while (isPlayerNameTaken(playerName)) {
      playerName = `Player-${randomUUID().slice(0, 6)}`;
    }
  }
  const token = randomUUID();
  const normalizedName = body.name ? normalizePlayerName(body.name) : "";
  const existingAdmin = body.name && isAdminName(body.name) ? findSessionByNormalizedName(normalizedName) : null;
  const session: Session =
    existingAdmin !== null
      ? {
          token,
          playerId: existingAdmin.playerId,
          playerName: existingAdmin.playerName,
          createdAt: existingAdmin.createdAt
        }
      : {
          token,
          playerId,
          playerName,
          createdAt: new Date().toISOString()
        };
  sessions.set(token, session);
  res.json({
    token,
    player: {
      id: session.playerId,
      name: session.playerName,
      isAdmin: isAdminSession(session)
    }
  });
});

app.use("/api", authMiddleware);

app.get("/api/me", (req, res) => {
  res.json({
    player: {
      id: req.session?.playerId,
      name: req.session?.playerName,
      isAdmin: isAdminSession(req.session)
    }
  });
});

app.use("/api/admin", adminOnlyMiddleware);

app.get("/api/admin/users", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const users = listAdminUsers().filter((user) => {
    if (!q) {
      return true;
    }
    return user.name.toLowerCase().includes(q) || user.playerId.toLowerCase().includes(q);
  });
  res.json({ users });
});

app.post("/api/admin/users", (req, res) => {
  try {
    const body = adminUserCreateSchema.parse(req.body ?? {});
    if (isPlayerNameTaken(body.name)) {
      res.status(409).json({ error: "该昵称已被占用，请换一个昵称" });
      return;
    }
    const playerId = randomUUID();
    const token = randomUUID();
    const session: Session = {
      token,
      playerId,
      playerName: body.name,
      createdAt: new Date().toISOString()
    };
    sessions.set(token, session);
    res.status(201).json({
      user: {
        playerId: session.playerId,
        name: session.playerName,
        createdAt: session.createdAt,
        sessionCount: 1
      }
    });
  } catch (error) {
    res.status(400).json({ error: asErrorMessage(error) });
  }
});

app.patch("/api/admin/users/:playerId", (req, res) => {
  try {
    const playerId = req.params.playerId;
    const body = adminUserUpdateSchema.parse(req.body ?? {});
    const existing = listAdminUsers().find((user) => user.playerId === playerId);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const isAdminUserGroup = isAdminName(existing.name);
    const targetPlayerIds = isAdminUserGroup
      ? playerIdsByNormalizedName(normalizePlayerName(existing.name))
      : [playerId];
    const targetPlayerIdSet = new Set(targetPlayerIds);

    if (isPlayerNameTaken(body.name, undefined, targetPlayerIdSet)) {
      res.status(409).json({ error: "该昵称已被占用，请换一个昵称" });
      return;
    }

    const touchedTableSet = new Set<string>();
    for (const session of sessions.values()) {
      if (targetPlayerIdSet.has(session.playerId)) {
        session.playerName = body.name;
      }
    }
    for (const targetPlayerId of targetPlayerIdSet) {
      const touchedTables = touchTablesForPlayerRename(targetPlayerId, body.name);
      for (const tableId of touchedTables) {
        touchedTableSet.add(tableId);
      }
    }
    for (const tableId of touchedTableSet) {
      broadcastTableState(tableId);
    }

    res.json({
      user: {
        playerId,
        name: body.name,
        createdAt: existing.createdAt,
        sessionCount: existing.sessionCount
      }
    });
  } catch (error) {
    res.status(400).json({ error: asErrorMessage(error) });
  }
});

app.delete("/api/admin/users/:playerId", (req, res) => {
  try {
    const playerId = req.params.playerId;
    const existing = listAdminUsers().find((user) => user.playerId === playerId);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const isAdminUserGroup = isAdminName(existing.name);
    const targetPlayerIds = isAdminUserGroup
      ? playerIdsByNormalizedName(normalizePlayerName(existing.name))
      : [playerId];
    const targetPlayerIdSet = new Set(targetPlayerIds);

    let removedSessions = 0;
    for (const [token, session] of sessions.entries()) {
      if (targetPlayerIdSet.has(session.playerId)) {
        sessions.delete(token);
        removedSessions += 1;
      }
    }

    const touchedTableSet = new Set<string>();
    for (const targetPlayerId of targetPlayerIdSet) {
      const touchedTables = removePlayerFromTables(targetPlayerId);
      for (const tableId of touchedTables) {
        touchedTableSet.add(tableId);
      }
    }
    for (const tableId of touchedTableSet) {
      broadcastTableState(tableId);
      scheduleTurnTimeout(tableId);
    }

    res.json({
      ok: true,
      removedSessions,
      removedFromTables: touchedTableSet.size
    });
  } catch (error) {
    res.status(400).json({ error: asErrorMessage(error) });
  }
});

app.delete("/api/admin/tables/:tableId", (req, res) => {
  const tableId = req.params.tableId;
  const closed = closeTable(tableId);
  if (!closed) {
    res.status(404).json({ error: "Table not found" });
    return;
  }
  res.json({ ok: true, tableId });
});

app.get("/api/tables", (_req, res) => {
  res.json({
    tables: Array.from(tables.values()).map((table) => table.summary())
  });
});

app.post("/api/tables", (req, res) => {
  try {
    const body = createTableSchema.parse(req.body ?? {});
    if (body.smallBlind > body.bigBlind) {
      res.status(400).json({ error: "smallBlind cannot exceed bigBlind" });
      return;
    }
    if (body.minBuyIn > body.maxBuyIn) {
      res.status(400).json({ error: "minBuyIn cannot exceed maxBuyIn" });
      return;
    }
    const table = new HoldemTable(body);
    tables.set(table.id, table);
    res.status(201).json({ table: table.getPublicState(req.session?.playerId ?? null) });
  } catch (error) {
    res.status(400).json({ error: asErrorMessage(error) });
  }
});

app.get("/api/tables/:tableId", (req, res) => {
  try {
    const table = ensureTable(req.params.tableId);
    res.json({ table: table.getPublicState(req.session?.playerId ?? null) });
  } catch (error) {
    res.status(404).json({ error: asErrorMessage(error) });
  }
});

app.post("/api/tables/:tableId/seats/join", (req, res) => {
  try {
    const session = req.session as Session;
    const body = joinSeatSchema.parse(req.body ?? {});
    const table = ensureTable(req.params.tableId);
    if (body.seatIndex >= table.maxSeats) {
      throw new Error("seatIndex out of table range");
    }
    const player: PlayerProfile = { id: session.playerId, name: session.playerName };
    table.joinSeat(player, body.seatIndex, body.buyIn);
    const state = table.getPublicState(session.playerId);
    res.status(201).json({ table: state });
    broadcastTableState(table.id);
  } catch (error) {
    res.status(400).json({ error: asErrorMessage(error) });
  }
});

app.post("/api/tables/:tableId/seats/leave", (req, res) => {
  try {
    const session = req.session as Session;
    const table = ensureTable(req.params.tableId);
    table.leaveSeat(session.playerId);
    res.json({ table: table.getPublicState(session.playerId) });
    broadcastTableState(table.id);
    scheduleTurnTimeout(table.id);
  } catch (error) {
    res.status(400).json({ error: asErrorMessage(error) });
  }
});

app.post("/api/tables/:tableId/seats/switch", (req, res) => {
  try {
    const session = req.session as Session;
    const body = switchSeatSchema.parse(req.body ?? {});
    const table = ensureTable(req.params.tableId);
    if (body.seatIndex >= table.maxSeats) {
      throw new Error("seatIndex out of table range");
    }
    table.switchSeat(session.playerId, body.seatIndex);
    res.json({ table: table.getPublicState(session.playerId) });
    broadcastTableState(table.id);
  } catch (error) {
    res.status(400).json({ error: asErrorMessage(error) });
  }
});

app.post("/api/tables/:tableId/start-hand", (req, res) => {
  try {
    const session = req.session as Session;
    const table = ensureTable(req.params.tableId);
    const state = table.startHand();
    res.json({ table: table.getPublicState(session.playerId), started: state.hand?.handId });
    broadcastTableState(table.id);
    scheduleTurnTimeout(table.id);
  } catch (error) {
    res.status(400).json({ error: asErrorMessage(error) });
  }
});

app.post("/api/tables/:tableId/actions", (req, res) => {
  try {
    const session = req.session as Session;
    const body = actionSchema.parse(req.body ?? {});
    const table = ensureTable(req.params.tableId);
    const state = table.act(session.playerId, body);
    res.json({ table: state });
    broadcastTableState(table.id);
    scheduleTurnTimeout(table.id);
  } catch (error) {
    res.status(400).json({ error: asErrorMessage(error) });
  }
});

app.get("/api/tables/:tableId/history", (req, res) => {
  try {
    const table = ensureTable(req.params.tableId);
    const limitRaw = req.query.limit;
    const parsed = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : 20;
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
    res.json({ handHistory: table.getHandHistory(limit) });
  } catch (error) {
    res.status(404).json({ error: asErrorMessage(error) });
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: () => void) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Validation error", details: error.flatten() });
    return;
  }
  res.status(500).json({ error: asErrorMessage(error) });
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const onActionMessage = (ctx: ClientContext, payload: { tableId: string; action: ActionInput }): void => {
  const table = ensureTable(payload.tableId);
  table.act(ctx.session.playerId, payload.action);
  broadcastTableState(table.id);
  scheduleTurnTimeout(table.id);
};

server.on("upgrade", (request, socket, head) => {
  const host = request.headers.host ?? "localhost";
  const requestUrl = new URL(request.url ?? "", `http://${host}`);
  if (requestUrl.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const token = requestUrl.searchParams.get("token") ?? "";
  const session = sessions.get(token);
  if (!session) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    clients.set(ws, { session, subscriptions: new Set<string>() });
    sendJson(ws, {
      type: "connected",
      player: {
        id: session.playerId,
        name: session.playerName,
        isAdmin: isAdminSession(session)
      }
    });

    ws.on("message", (raw) => {
      try {
        const text = raw.toString();
        const data = JSON.parse(text) as Record<string, unknown>;
        const type = data.type;
        if (type === "subscribe_table") {
          const tableId = String(data.tableId ?? "");
          if (!tableId) {
            throw new Error("tableId is required");
          }
          const table = ensureTable(tableId);
          subscribeSocketToTable(ws, tableId);
          sendJson(ws, {
            type: "table_state",
            tableId,
            state: table.getPublicState(session.playerId)
          });
          return;
        }
        if (type === "unsubscribe_table") {
          const tableId = String(data.tableId ?? "");
          if (tableId) {
            unsubscribeSocketFromTable(ws, tableId);
          }
          return;
        }
        if (type === "action") {
          const tableId = String(data.tableId ?? "");
          const action = actionSchema.parse(data.action ?? {});
          const ctx = clients.get(ws);
          if (!ctx) {
            throw new Error("Connection context missing");
          }
          onActionMessage(ctx, { tableId, action });
          return;
        }
        if (type === "ping") {
          sendJson(ws, { type: "pong", at: Date.now() });
          return;
        }
      } catch (error) {
        sendJson(ws, {
          type: "error",
          message: asErrorMessage(error)
        });
      }
    });

    ws.on("close", () => {
      const ctx = clients.get(ws);
      if (ctx) {
        for (const tableId of ctx.subscriptions) {
          unsubscribeSocketFromTable(ws, tableId);
        }
      }
      clients.delete(ws);
    });
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Holdem server running on http://localhost:${port}`);
});
