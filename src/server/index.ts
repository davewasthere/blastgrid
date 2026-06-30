import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { TICK_RATE } from "../shared/constants.js";
import type { ClientMsg, RoomSummary, ServerMsg } from "../shared/types.js";
import { Game } from "./game.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const PORT = Number(process.env.PORT ?? 3000);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ---- static file server ----
const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    // prevent path traversal
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(PUBLIC_DIR, safe);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});

// ---- websocket / rooms ----
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

interface Conn {
  id: string;
  ws: WebSocket;
  roomId: string | null;
}

const conns = new Set<Conn>();
const rooms = new Map<string, Game>();
let nextConnId = 1;

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function roomSummaries(): RoomSummary[] {
  const out: RoomSummary[] = [];
  for (const [id, game] of rooms) {
    const host = [...game.snapshot().players].find((p) => p.isHost);
    out.push({
      id,
      players: game.playerCount,
      phase: game.phase,
      hostName: host?.name ?? "",
    });
  }
  return out;
}

function broadcastRoomList(): void {
  const msg: ServerMsg = { type: "rooms", rooms: roomSummaries() };
  for (const c of conns) {
    if (c.roomId === null) send(c.ws, msg);
  }
}

function leaveRoom(conn: Conn): void {
  if (conn.roomId === null) return;
  const game = rooms.get(conn.roomId);
  if (game) {
    game.removePlayer(conn.id);
    if (game.playerCount === 0) rooms.delete(conn.roomId);
  }
  conn.roomId = null;
  broadcastRoomList();
}

wss.on("connection", (ws) => {
  const conn: Conn = { id: `p${nextConnId++}`, ws, roomId: null };
  conns.add(conn);
  send(ws, { type: "rooms", rooms: roomSummaries() });

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString()) as ClientMsg;
    } catch {
      return;
    }
    handle(conn, msg);
  });

  ws.on("close", () => {
    leaveRoom(conn);
    conns.delete(conn);
  });
});

function handle(conn: Conn, msg: ClientMsg): void {
  switch (msg.type) {
    case "listRooms":
      send(conn.ws, { type: "rooms", rooms: roomSummaries() });
      break;

    case "join": {
      const name = (msg.name ?? "").trim();
      const roomId = (msg.room ?? "").trim();
      if (!name) {
        send(conn.ws, { type: "error", message: "A name is required to join." });
        return;
      }
      if (!roomId) {
        send(conn.ws, { type: "error", message: "Pick or name a room." });
        return;
      }
      // already in this room? just rename, keep position/color/spawn
      if (conn.roomId === roomId) {
        rooms.get(roomId)?.setName(conn.id, name);
        return;
      }
      // switching rooms: leave the old one first
      if (conn.roomId !== null) leaveRoom(conn);

      let game = rooms.get(roomId);
      if (!game) {
        game = new Game();
        rooms.set(roomId, game);
      }
      game.addPlayer(conn.id, name);
      conn.roomId = roomId;
      send(conn.ws, { type: "joined", room: roomId, youId: conn.id });
      broadcastRoomList();
      break;
    }

    case "leave":
      leaveRoom(conn);
      break;

    case "start":
      if (conn.roomId) rooms.get(conn.roomId)?.start(conn.id);
      break;

    case "input":
      if (conn.roomId) rooms.get(conn.roomId)?.setInput(conn.id, msg.dir, msg.bomb);
      break;
  }
}

// ---- simulation + broadcast loop ----
// Fixed-timestep with an accumulator so real-time pacing holds even when the
// host timer is coarse (Windows' ~15.6ms granularity would otherwise make a
// plain setInterval(33ms) run the sim ~25% slow).
const STEP_MS = 1000 / TICK_RATE;
let lastTime = Date.now();
let acc = 0;

setInterval(() => {
  const now = Date.now();
  acc += now - lastTime;
  lastTime = now;

  let steps = 0;
  // cap catch-up so a long stall can't spiral
  while (acc >= STEP_MS && steps < 5) {
    for (const game of rooms.values()) game.step();
    acc -= STEP_MS;
    steps++;
  }
  if (steps === 0) return;

  for (const [id, game] of rooms) {
    if (game.playerCount === 0) {
      rooms.delete(id);
      continue;
    }
    const payload = JSON.stringify(game.snapshot());
    for (const c of conns) {
      if (c.roomId === id && c.ws.readyState === c.ws.OPEN) c.ws.send(payload);
    }
  }
}, 8);

// refresh the lobby list periodically so player counts/phases stay current
setInterval(broadcastRoomList, 1000);

httpServer.listen(PORT, () => {
  console.log(`blastgrid listening on http://localhost:${PORT}/`);
});
