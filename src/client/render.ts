import {
  BOMB_FUSE_TICKS,
  TICK_RATE,
  TILE,
  TILE_CRATE,
  TILE_WALL,
  type Dir,
  type Tile,
} from "../shared/constants.js";
import type { SnapshotMsg } from "../shared/types.js";

const DIR_OFFSET: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

interface EyeState {
  ex: number;
  ey: number;
  seed: number;
}
const eyeStates = new Map<string, EyeState>();

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return (h / 997) * 4;
}

export interface Camera {
  x: number;
  y: number;
  vw: number;
  vh: number;
}

// Draws the visible window of the world. The whole world is rendered in
// world-pixel space under a camera translate; only the visible tile range is
// iterated so a large map stays cheap.
export function drawWorld(
  c: CanvasRenderingContext2D,
  snap: SnapshotMsg,
  map: Tile[] | null,
  cam: Camera,
): void {
  const time = performance.now() / 1000;

  // backdrop (screen space)
  c.fillStyle = "#0c111c";
  c.fillRect(0, 0, cam.vw, cam.vh);
  if (!map) return;

  c.save();
  c.translate(-cam.x, -cam.y);

  const sx0 = Math.max(0, Math.floor(cam.x / TILE));
  const sy0 = Math.max(0, Math.floor(cam.y / TILE));
  const sx1 = Math.min(snap.worldW - 1, Math.ceil((cam.x + cam.vw) / TILE));
  const sy1 = Math.min(snap.worldH - 1, Math.ceil((cam.y + cam.vh) / TILE));

  for (let y = sy0; y <= sy1; y++) {
    for (let x = sx0; x <= sx1; x++) {
      const px = x * TILE;
      const py = y * TILE;
      // floor
      c.fillStyle = (x + y) % 2 === 0 ? "#1b2230" : "#202a3c";
      c.fillRect(px, py, TILE, TILE);
      const t = map[y * snap.worldW + x];
      if (t === TILE_WALL) drawWall(c, px, py);
      else if (t === TILE_CRATE) drawCrate(c, px, py);
    }
  }

  for (const pu of snap.powerups) drawPowerup(c, pu.x, pu.y, pu.kind, time);
  for (const b of snap.bombs) drawBomb(c, b.x, b.y, b.fuse);
  for (const e of snap.explosions) drawFlame(c, e.x, e.y, e.life / e.maxLife, time);
  for (const p of snap.players) if (p.alive) drawPlayer(c, p, time);
  for (const p of snap.players) if (p.alive) drawName(c, p.name, p.x * TILE + TILE / 2, p.y * TILE);

  c.restore();
}

function drawWall(c: CanvasRenderingContext2D, x: number, y: number): void {
  c.fillStyle = "#3a4663";
  c.fillRect(x, y, TILE, TILE);
  c.fillStyle = "#4a587b";
  c.fillRect(x + 2, y + 2, TILE - 4, TILE - 6);
  c.fillStyle = "#2c3650";
  c.fillRect(x + 2, y + TILE - 6, TILE - 4, 4);
}

function drawCrate(c: CanvasRenderingContext2D, x: number, y: number): void {
  c.fillStyle = "#8a5a2b";
  c.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  c.fillStyle = "#a86c34";
  c.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
  c.strokeStyle = "#6b441f";
  c.lineWidth = 2;
  c.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
  c.beginPath();
  c.moveTo(x + 4, y + 4);
  c.lineTo(x + TILE - 4, y + TILE - 4);
  c.moveTo(x + TILE - 4, y + 4);
  c.lineTo(x + 4, y + TILE - 4);
  c.stroke();
}

function drawBomb(c: CanvasRenderingContext2D, gx: number, gy: number, fuse: number): void {
  const cx = gx * TILE + TILE / 2;
  const cy = gy * TILE + TILE / 2;
  // Throb is anchored to the bomb's OWN fuse, not wall-clock time, so every
  // bomb pulses identically from placement and accelerates toward detonation.
  const elapsed = Math.max(0, BOMB_FUSE_TICKS - fuse) / TICK_RATE; // seconds since placed
  const cycles = 1.2 * elapsed + 0.8 * elapsed * elapsed; // frequency ramps up over time
  const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * cycles);
  const r = TILE * 0.3 + pulse * TILE * 0.06;

  const glow = c.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2);
  glow.addColorStop(0, `rgba(255,170,40,${0.35 + pulse * 0.3})`);
  glow.addColorStop(1, "rgba(255,170,40,0)");
  c.fillStyle = glow;
  c.beginPath();
  c.arc(cx, cy, r * 2, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = "rgba(0,0,0,0.35)";
  c.beginPath();
  c.ellipse(cx, cy + r * 0.85, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  c.fill();

  const body = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
  body.addColorStop(0, "#ffe06a");
  body.addColorStop(0.6, "#ff9a2e");
  body.addColorStop(1, "#7a2d0a");
  c.fillStyle = body;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = "#3a1402";
  c.stroke();

  c.fillStyle = `rgba(255,60,40,${0.5 + pulse * 0.5})`;
  c.beginPath();
  c.arc(cx + r * 0.25, cy + r * 0.2, r * 0.22, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#fff6c0";
  c.beginPath();
  c.arc(cx - r * 0.3, cy - r * 0.35, r * 0.18, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#caa";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(cx, cy - r);
  c.lineTo(cx + r * 0.4, cy - r * 1.5);
  c.stroke();
}

function drawFlame(c: CanvasRenderingContext2D, gx: number, gy: number, frac: number, time: number): void {
  const x = gx * TILE;
  const y = gy * TILE;
  const a = Math.max(0, Math.min(1, frac));
  const flick = 0.85 + 0.15 * Math.sin(time * 25 + gx + gy);
  c.save();
  c.globalAlpha = a;
  const g = c.createRadialGradient(x + TILE / 2, y + TILE / 2, 2, x + TILE / 2, y + TILE / 2, TILE * 0.7 * flick);
  g.addColorStop(0, "#fff3b0");
  g.addColorStop(0.4, "#ffae33");
  g.addColorStop(0.8, "#ff5a1f");
  g.addColorStop(1, "rgba(255,60,20,0)");
  c.fillStyle = g;
  c.fillRect(x, y, TILE, TILE);
  c.restore();
}

function drawPowerup(c: CanvasRenderingContext2D, gx: number, gy: number, kind: string, time: number): void {
  const cx = gx * TILE + TILE / 2;
  const cy = gy * TILE + TILE / 2;
  const bob = Math.sin(time * 3 + gx + gy) * TILE * 0.04;
  const r = TILE * 0.28;
  const color = kind === "bomb" ? "#4fc3f7" : kind === "flame" ? "#ff6b4a" : "#7ee06a";

  c.fillStyle = "rgba(0,0,0,0.3)";
  c.beginPath();
  c.ellipse(cx, cy + r * 0.9, r * 0.8, r * 0.3, 0, 0, Math.PI * 2);
  c.fill();

  const body = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3 + bob, r * 0.2, cx, cy + bob, r);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.4, color);
  body.addColorStop(1, shade(color, -0.4));
  c.fillStyle = body;
  c.beginPath();
  c.arc(cx, cy + bob, r, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = shade(color, -0.5);
  c.stroke();

  c.fillStyle = "rgba(255,255,255,0.7)";
  c.beginPath();
  c.arc(cx - r * 0.35, cy - r * 0.4 + bob, r * 0.18, 0, Math.PI * 2);
  c.fill();

  c.save();
  c.translate(cx, cy + bob);
  if (kind === "bomb") {
    c.fillStyle = "#10243a";
    c.beginPath();
    c.arc(0, r * 0.05, r * 0.42, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#10243a";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -r * 0.35);
    c.lineTo(r * 0.25, -r * 0.6);
    c.stroke();
  } else if (kind === "flame") {
    c.fillStyle = "#5a1500";
    c.beginPath();
    c.moveTo(0, -r * 0.55);
    c.quadraticCurveTo(r * 0.5, 0, 0, r * 0.55);
    c.quadraticCurveTo(-r * 0.5, 0, 0, -r * 0.55);
    c.fill();
  } else {
    c.fillStyle = "#0c3a10";
    c.beginPath();
    c.moveTo(r * 0.15, -r * 0.55);
    c.lineTo(-r * 0.35, r * 0.05);
    c.lineTo(0, r * 0.05);
    c.lineTo(-r * 0.15, r * 0.55);
    c.lineTo(r * 0.4, -r * 0.1);
    c.lineTo(0, -r * 0.1);
    c.closePath();
    c.fill();
  }
  c.restore();
}

function drawPlayer(c: CanvasRenderingContext2D, p: SnapshotMsg["players"][number], time: number): void {
  const cx = p.x * TILE + TILE / 2;
  const cy = p.y * TILE + TILE / 2;
  const r = TILE * 0.36;

  let st = eyeStates.get(p.id);
  if (!st) {
    st = { ex: 0, ey: 0, seed: hashSeed(p.id) };
    eyeStates.set(p.id, st);
  }
  const target = p.moving ? DIR_OFFSET[p.dir] : { x: 0, y: 0 };
  st.ex += (target.x - st.ex) * 0.2;
  st.ey += (target.y - st.ey) * 0.2;

  c.fillStyle = "rgba(0,0,0,0.3)";
  c.beginPath();
  c.ellipse(cx, cy + r * 0.85, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
  c.fill();

  const body = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
  body.addColorStop(0, shade(p.color, 0.35));
  body.addColorStop(0.7, p.color);
  body.addColorStop(1, shade(p.color, -0.35));
  c.fillStyle = body;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = shade(p.color, -0.5);
  c.stroke();

  const blinkT = (time + st.seed) % 3.6;
  const blinking = blinkT < 0.12;
  const eyeDX = r * 0.34;
  const eyeY = cy - r * 0.1;
  const eyeR = r * 0.26;
  for (const side of [-1, 1]) {
    const x = cx + side * eyeDX;
    c.fillStyle = "#fff";
    if (blinking) {
      c.fillRect(x - eyeR, eyeY - 1.5, eyeR * 2, 3);
    } else {
      c.beginPath();
      c.arc(x, eyeY, eyeR, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#152033";
      c.beginPath();
      c.arc(x + st.ex * eyeR * 0.9, eyeY + st.ey * eyeR * 0.9, eyeR * 0.55, 0, Math.PI * 2);
      c.fill();
    }
  }
}

function drawName(c: CanvasRenderingContext2D, name: string, cx: number, top: number): void {
  c.font = "bold 12px system-ui, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "bottom";
  const text = name.length > 12 ? name.slice(0, 11) + "…" : name;
  const w = c.measureText(text).width + 8;
  c.fillStyle = "rgba(0,0,0,0.5)";
  c.fillRect(cx - w / 2, top - 16, w, 14);
  c.fillStyle = "#fff";
  c.fillText(text, cx, top - 3);
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.round(amt >= 0 ? r + (255 - r) * amt : r * (1 + amt));
  g = Math.round(amt >= 0 ? g + (255 - g) * amt : g * (1 + amt));
  b = Math.round(amt >= 0 ? b + (255 - b) * amt : b * (1 + amt));
  return `rgb(${r},${g},${b})`;
}
