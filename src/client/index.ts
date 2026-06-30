import { playExplosion, playPickup, unlockAudio } from "./audio.js";
import { InputTracker } from "./input.js";
import { Net } from "./net.js";
import { render } from "./render.js";
import type { PlayerState, RoomSummary, ServerMsg, SnapshotMsg } from "../shared/types.js";

const NAME_KEY = "blastgrid.playerName";
const TILE = 40;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const lobby = $("lobby");
const game = $("game");
const nameInput = $<HTMLInputElement>("name");
const roomList = $("roomList");
const noRooms = $("noRooms");
const newRoom = $<HTMLInputElement>("newRoom");
const createBtn = $<HTMLButtonElement>("createBtn");
const lobbyError = $("lobbyError");
const canvas = $<HTMLCanvasElement>("canvas");
const overlay = $("overlay");
const hud = $("hud");
const startBtn = $<HTMLButtonElement>("startBtn");
const leaveBtn = $<HTMLButtonElement>("leaveBtn");
const roomLabel = $("roomLabel");
const cctx = canvas.getContext("2d")!;

let youId = "";
let roomId = "";
let latest: SnapshotMsg | null = null;
let seq = 0;
let inputDir: PlayerState["dir"] | null = null;
let inputBomb = false;

// sound-trigger memory
let prevOwn: { bombs: number; flame: number; speed: number } | null = null;
let hudSig = "";

// ---- persisted name ----
nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
nameInput.addEventListener("input", () => {
  const v = nameInput.value.trim();
  if (v) localStorage.setItem(NAME_KEY, v);
  else localStorage.removeItem(NAME_KEY);
});

// ---- networking ----
const net = new Net(onMessage);

function onMessage(msg: ServerMsg): void {
  switch (msg.type) {
    case "rooms":
      if (!roomId) renderRoomList(msg.rooms);
      break;
    case "joined":
      youId = msg.youId;
      roomId = msg.room;
      prevOwn = null;
      showGame();
      break;
    case "error":
      lobbyError.textContent = msg.message;
      break;
    case "snapshot":
      latest = msg;
      handleSnapshotSounds(msg);
      break;
  }
}

// ---- lobby ----
function renderRoomList(rooms: RoomSummary[]): void {
  roomList.innerHTML = "";
  noRooms.hidden = rooms.length > 0;
  for (const r of rooms) {
    const li = document.createElement("li");
    const info = document.createElement("span");
    info.className = "roominfo";
    info.textContent = `${r.id} — ${r.players} player${r.players === 1 ? "" : "s"} · ${r.phase}`;
    const join = document.createElement("button");
    join.textContent = "Join";
    join.onclick = () => joinRoom(r.id);
    li.append(info, join);
    roomList.append(li);
  }
}

function joinRoom(room: string): void {
  const name = nameInput.value.trim();
  if (!name) {
    lobbyError.textContent = "Enter a name first.";
    nameInput.focus();
    return;
  }
  lobbyError.textContent = "";
  unlockAudio();
  net.send({ type: "join", room, name });
}

createBtn.onclick = () => {
  const room = newRoom.value.trim();
  if (!room) {
    lobbyError.textContent = "Name your new room.";
    newRoom.focus();
    return;
  }
  joinRoom(room);
};
newRoom.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createBtn.click();
});

leaveBtn.onclick = () => {
  net.send({ type: "leave" });
  roomId = "";
  youId = "";
  latest = null;
  input.setEnabled(false);
  game.hidden = true;
  lobby.hidden = false;
  net.send({ type: "listRooms" });
};

startBtn.onclick = () => net.send({ type: "start" });

function showGame(): void {
  lobby.hidden = true;
  game.hidden = false;
  roomLabel.textContent = `Room: ${roomId}`;
  canvas.width = 15 * TILE;
  canvas.height = 13 * TILE;
  input.setEnabled(true);
}

// ---- input ----
const input = new InputTracker(
  (s) => {
    inputDir = s.dir;
    inputBomb = s.bomb;
    net.send({ type: "input", seq: seq++, dir: inputDir, bomb: inputBomb });
  },
  () => unlockAudio(),
);

// ---- sound triggers ----
function handleSnapshotSounds(snap: SnapshotMsg): void {
  // a fresh blast: any flame cell that just spawned this tick
  if (snap.explosions.some((e) => e.life === e.maxLife)) playExplosion();
  // own pickup: a stat went up since last snapshot
  const me = snap.players.find((p) => p.id === youId);
  if (me) {
    if (prevOwn && (me.bombs > prevOwn.bombs || me.flame > prevOwn.flame || me.speed > prevOwn.speed)) {
      playPickup();
    }
    prevOwn = { bombs: me.bombs, flame: me.flame, speed: me.speed };
  }
}

// ---- HUD ----
function icon(kind: "bomb" | "flame" | "speed"): string {
  if (kind === "bomb")
    return `<svg viewBox="0 0 16 16" class="ic"><circle cx="8" cy="9" r="5" fill="#10243a"/><circle cx="6" cy="7" r="1.4" fill="#7fd1ff"/><path d="M8 4 L10 2" stroke="#caa" stroke-width="1.5"/></svg>`;
  if (kind === "flame")
    return `<svg viewBox="0 0 16 16" class="ic"><path d="M8 2 Q13 8 8 14 Q3 8 8 2Z" fill="#ff6b4a"/><path d="M8 6 Q10 9 8 12 Q6 9 8 6Z" fill="#ffd27f"/></svg>`;
  return `<svg viewBox="0 0 16 16" class="ic"><path d="M9 1 L3 9 H7 L6 15 L13 6 H9 Z" fill="#7ee06a" stroke="#0c3a10" stroke-width="0.8"/></svg>`;
}

function renderHud(players: PlayerState[]): void {
  const sig = players
    .map((p) => `${p.id}:${p.name}:${p.alive}:${p.bombs}:${p.flame}:${p.speed}:${p.isHost}`)
    .join("|");
  if (sig === hudSig) return;
  hudSig = sig;

  hud.innerHTML = "";
  for (const p of players) {
    const row = document.createElement("div");
    row.className = "hudrow" + (p.alive ? "" : " dead") + (p.id === youId ? " you" : "");
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = p.color;
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = (p.isHost ? "★ " : "") + p.name;
    const icons = document.createElement("span");
    icons.className = "icons";
    icons.innerHTML =
      icon("bomb").repeat(p.bombs) + icon("flame").repeat(p.flame) + icon("speed").repeat(p.speed);
    row.append(sw, nm, icons);
    hud.append(row);
  }
}

// ---- overlay (countdown / waiting / results) ----
function renderOverlay(snap: SnapshotMsg): void {
  const me = snap.players.find((p) => p.id === youId);
  const isHost = !!me?.isHost;
  let html = "";

  if (snap.phase === "waiting") {
    html = isHost
      ? `<div class="ov-msg">You're the host. Press <b>Start</b> when ready.</div>`
      : `<div class="ov-msg">Waiting for the host to start…</div>`;
  } else if (snap.phase === "countdown") {
    html = `<div class="ov-count">${snap.countdown}</div>`;
  } else if (snap.phase === "results") {
    const who = snap.winnerName ? `${esc(snap.winnerName)} wins!` : "Draw!";
    html = `<div class="ov-msg"><div class="ov-win">${who}</div>${
      isHost ? "Starting again — or press Start." : "Next round soon…"
    }</div>`;
  }
  overlay.innerHTML = html;
  overlay.style.display = snap.phase === "playing" ? "none" : "flex";

  // start button: host only, when a round isn't running
  const canStart = isHost && (snap.phase === "waiting" || snap.phase === "results");
  startBtn.hidden = !canStart;
  startBtn.classList.toggle("pulse", canStart && snap.players.length >= 2);
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ---- render loop ----
function frame(): void {
  if (latest && !game.hidden) {
    render(cctx, latest, TILE);
    renderHud(latest.players);
    renderOverlay(latest);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
