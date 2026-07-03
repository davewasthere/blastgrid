import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { BOT_COUNT, MAX_PLAYERS, TICK_RATE } from "../shared/constants.js";
import type { ClientMsg, PlayerState, ServerMsg } from "../shared/types.js";
import { World } from "./world.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const PORT = Number(process.env.PORT ?? 3000);
const BOTS = Number(process.env.BOT_COUNT ?? BOT_COUNT);

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

// ---- websocket / single shared world ----
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
const world = new World();

// bots fill in only while there's a lone human (see world.syncBots)
const BOT_NAMES = ["Botly", "Zap-9", "Krunch", "Fuse", "Nimbus", "Ember", "Volt", "Pixl"];
world.configureBots(BOTS, BOT_NAMES);

interface Conn {
  id: string;
  ws: WebSocket;
  joined: boolean;
  lastMapVersion: number; // last map version this client has been sent
}

const conns = new Set<Conn>();
let nextConnId = 1;

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on("connection", (ws) => {
  const conn: Conn = { id: `p${nextConnId++}`, ws, joined: false, lastMapVersion: 0 };
  conns.add(conn);

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
    if (conn.joined) world.removePlayer(conn.id);
    conns.delete(conn);
    world.syncBots(); // dropping back to a lone human brings bots back
    world.resetIfEmpty();
  });
});

function handle(conn: Conn, msg: ClientMsg): void {
  switch (msg.type) {
    case "join": {
      const name = (msg.name ?? "").trim().slice(0, 16);
      if (!name) {
        send(conn.ws, { type: "error", message: "A name is required to join." });
        return;
      }
      if (conn.joined) {
        world.setName(conn.id, name); // already in — just rename
        return;
      }
      if (world.playerCount >= MAX_PLAYERS) {
        send(conn.ws, { type: "error", message: "The world is full — try again shortly." });
        return;
      }
      world.addPlayer(conn.id, name);
      conn.joined = true;
      conn.lastMapVersion = 0; // force a full map on the next snapshot
      world.syncBots(); // a 2nd human clears the bots out
      send(conn.ws, { type: "welcome", youId: conn.id });
      break;
    }
    case "input":
      if (conn.joined) world.setInput(conn.id, msg.dir, msg.bomb);
      break;
  }
}

// ---- simulation + broadcast loop (fixed timestep) ----
const STEP_MS = 1000 / TICK_RATE;
let lastTime = Date.now();
let acc = 0;

setInterval(() => {
  const now = Date.now();
  acc += now - lastTime;
  lastTime = now;

  let steps = 0;
  while (acc >= STEP_MS && steps < 5) {
    world.step();
    acc -= STEP_MS;
    steps++;
  }
  if (steps === 0) return;

  // entity state is shared across clients; only the map slice differs (sent
  // when a given client's cached version is stale).
  const players: PlayerState[] = world.players_();
  const bombs = world.bombs_();
  const explosions = world.explosions_();
  const powerups = world.powerups_();
  const enemies = world.enemies_();
  const version = world.mapVersion;
  let mapJson: string | null = null; // serialize the (large) map at most once per tick

  for (const c of conns) {
    if (!c.joined || c.ws.readyState !== c.ws.OPEN) continue;
    let map: string;
    if (c.lastMapVersion !== version) {
      if (mapJson === null) mapJson = JSON.stringify(world.mapCopy());
      map = mapJson;
      c.lastMapVersion = version;
    } else {
      map = "null";
    }
    c.ws.send(
      `{"type":"snapshot","tick":${world.tick},"worldW":${world.W},"worldH":${world.H},` +
        `"mapVersion":${version},"map":${map},` +
        `"players":${JSON.stringify(players)},"bombs":${JSON.stringify(bombs)},` +
        `"explosions":${JSON.stringify(explosions)},"powerups":${JSON.stringify(powerups)},` +
        `"enemies":${JSON.stringify(enemies)}}`,
    );
  }
}, 8);

httpServer.listen(PORT, () => {
  console.log(`blastgrid listening on http://localhost:${PORT}/`);
});
