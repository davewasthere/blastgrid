import { playExplosion, playPickup, unlockAudio } from "./audio.js";
import { TILE, VIEW_H, VIEW_W, type Tile } from "../shared/constants.js";
import { InputTracker } from "./input.js";
import { Net } from "./net.js";
import { drawWorld } from "./render.js";
import type { PlayerState, ServerMsg, SnapshotMsg } from "../shared/types.js";

const NAME_KEY = "blastgrid.playerName";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const enter = $("enter");
const gameView = $("game");
const nameInput = $<HTMLInputElement>("name");
const joinBtn = $<HTMLButtonElement>("joinBtn");
const enterError = $("enterError");
const canvas = $<HTMLCanvasElement>("canvas");
const hud = $("hud");
const scoreboard = $("scoreboard");
const status = $("status");
const cctx = canvas.getContext("2d")!;

canvas.width = VIEW_W * TILE;
canvas.height = VIEW_H * TILE;

let youId = "";
let latest: SnapshotMsg | null = null;
let cachedMap: Tile[] | null = null;
let mapW = 0;
let mapH = 0;
let seq = 0;

// smooth camera (pixel space)
const cam = { x: 0, y: 0 };
let camReady = false;

// sound-trigger memory
let prevOwn: { bombs: number; flame: number; speed: number } | null = null;
let hudSig = "";
let boardSig = "";

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
    case "welcome":
      youId = msg.youId;
      prevOwn = null;
      camReady = false;
      enter.hidden = true;
      gameView.hidden = false;
      input.setEnabled(true);
      break;
    case "error":
      enterError.textContent = msg.message;
      break;
    case "snapshot":
      if (msg.map) {
        cachedMap = msg.map;
        mapW = msg.worldW;
        mapH = msg.worldH;
      }
      latest = msg;
      handleSnapshotSounds(msg);
      break;
  }
}

// ---- join ----
function join(): void {
  const name = nameInput.value.trim();
  if (!name) {
    enterError.textContent = "Enter a name first.";
    nameInput.focus();
    return;
  }
  enterError.textContent = "";
  unlockAudio();
  net.send({ type: "join", name });
}
joinBtn.onclick = join;
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") join();
});

// ---- input ----
const input = new InputTracker(
  (s) => {
    net.send({ type: "input", seq: seq++, dir: s.dir, bomb: s.bomb });
  },
  () => unlockAudio(),
);

// ---- sound triggers ----
function handleSnapshotSounds(snap: SnapshotMsg): void {
  const me = snap.players.find((p) => p.id === youId);
  // a fresh blast (flame at full life) within earshot of the player's view
  if (me) {
    const rx = VIEW_W / 2 + 3;
    const ry = VIEW_H / 2 + 3;
    const nearBlast = snap.explosions.some(
      (e) => e.life === e.maxLife && Math.abs(e.x - me.x) <= rx && Math.abs(e.y - me.y) <= ry,
    );
    if (nearBlast) playExplosion();
    if (prevOwn && (me.bombs > prevOwn.bombs || me.flame > prevOwn.flame || me.speed > prevOwn.speed)) {
      playPickup();
    }
    prevOwn = { bombs: me.bombs, flame: me.flame, speed: me.speed };
  }
}

// ---- camera ----
function updateCamera(me: PlayerState | undefined): void {
  if (!me) return;
  const worldPxW = mapW * TILE;
  const worldPxH = mapH * TILE;
  const tx = clamp(me.x * TILE + TILE / 2 - canvas.width / 2, 0, Math.max(0, worldPxW - canvas.width));
  const ty = clamp(me.y * TILE + TILE / 2 - canvas.height / 2, 0, Math.max(0, worldPxH - canvas.height));
  if (!camReady) {
    cam.x = tx;
    cam.y = ty;
    camReady = true;
  } else {
    cam.x += (tx - cam.x) * 0.15;
    cam.y += (ty - cam.y) * 0.15;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---- HUD (own gear) ----
function icon(kind: "bomb" | "flame" | "speed"): string {
  if (kind === "bomb")
    return `<svg viewBox="0 0 16 16" class="ic"><circle cx="8" cy="9" r="5" fill="#10243a"/><circle cx="6" cy="7" r="1.4" fill="#7fd1ff"/><path d="M8 4 L10 2" stroke="#caa" stroke-width="1.5"/></svg>`;
  if (kind === "flame")
    return `<svg viewBox="0 0 16 16" class="ic"><path d="M8 2 Q13 8 8 14 Q3 8 8 2Z" fill="#ff6b4a"/><path d="M8 6 Q10 9 8 12 Q6 9 8 6Z" fill="#ffd27f"/></svg>`;
  return `<svg viewBox="0 0 16 16" class="ic"><path d="M9 1 L3 9 H7 L6 15 L13 6 H9 Z" fill="#7ee06a" stroke="#0c3a10" stroke-width="0.8"/></svg>`;
}

function renderHud(me: PlayerState | undefined): void {
  if (!me) return;
  const sig = `${me.bombs}:${me.flame}:${me.speed}`;
  if (sig === hudSig) return;
  hudSig = sig;
  hud.innerHTML =
    icon("bomb").repeat(me.bombs) + icon("flame").repeat(me.flame) + icon("speed").repeat(me.speed);
}

// ---- scoreboard ----
function renderScoreboard(players: PlayerState[]): void {
  const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const sig = sorted.map((p) => `${p.id}:${p.name}:${p.kills}:${p.deaths}`).join("|");
  if (sig === boardSig) return;
  boardSig = sig;

  scoreboard.innerHTML = `<div class="sb-head">${players.length} online</div>`;
  for (const p of sorted.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "sb-row" + (p.id === youId ? " you" : "");
    row.innerHTML =
      `<span class="sw" style="background:${p.color}"></span>` +
      `<span class="sb-name">${esc(p.name)}</span>` +
      `<span class="sb-kd">${p.kills}/${p.deaths}</span>`;
    scoreboard.append(row);
  }
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ---- status (respawn notice) ----
function renderStatus(me: PlayerState | undefined): void {
  if (me && !me.alive) {
    status.textContent = "💥 You were blasted — respawning…";
    status.hidden = false;
  } else {
    status.hidden = true;
  }
}

// ---- render loop ----
function frame(): void {
  if (latest && !gameView.hidden) {
    const me = latest.players.find((p) => p.id === youId);
    updateCamera(me);
    drawWorld(cctx, latest, cachedMap, { x: cam.x, y: cam.y, vw: canvas.width, vh: canvas.height });
    renderHud(me);
    renderScoreboard(latest.players);
    renderStatus(me);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
