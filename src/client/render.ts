import { TILE_CRATE, TILE_WALL, type Dir } from "../shared/constants.js";
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
  return (h / 997) * 4; // 0..4s stagger
}

export function render(
  c: CanvasRenderingContext2D,
  snap: SnapshotMsg,
  ts: number,
): void {
  const time = performance.now() / 1000;
  const w = snap.width * ts;
  const h = snap.height * ts;

  // floor
  c.fillStyle = "#1b2230";
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#202a3c";
  for (let y = 0; y < snap.height; y++) {
    for (let x = 0; x < snap.width; x++) {
      if ((x + y) % 2 === 0) c.fillRect(x * ts, y * ts, ts, ts);
    }
  }

  // walls & crates
  for (let y = 0; y < snap.height; y++) {
    for (let x = 0; x < snap.width; x++) {
      const t = snap.map[y * snap.width + x];
      if (t === TILE_WALL) drawWall(c, x * ts, y * ts, ts);
      else if (t === TILE_CRATE) drawCrate(c, x * ts, y * ts, ts);
    }
  }

  for (const pu of snap.powerups) drawPowerup(c, pu.x, pu.y, pu.kind, ts, time);
  for (const b of snap.bombs) drawBomb(c, b.x, b.y, b.fuse, ts, time);
  for (const e of snap.explosions) drawFlame(c, e.x, e.y, e.life / e.maxLife, ts, time);

  for (const p of snap.players) {
    if (!p.alive) continue;
    drawPlayer(c, p, ts, time);
  }
  // names on top so blobs don't cover them
  for (const p of snap.players) {
    if (!p.alive) continue;
    drawName(c, p.name, p.x * ts + ts / 2, p.y * ts);
  }
}

function drawWall(c: CanvasRenderingContext2D, x: number, y: number, ts: number): void {
  c.fillStyle = "#3a4663";
  c.fillRect(x, y, ts, ts);
  c.fillStyle = "#4a587b";
  c.fillRect(x + 2, y + 2, ts - 4, ts - 6);
  c.fillStyle = "#2c3650";
  c.fillRect(x + 2, y + ts - 6, ts - 4, 4);
}

function drawCrate(c: CanvasRenderingContext2D, x: number, y: number, ts: number): void {
  c.fillStyle = "#8a5a2b";
  c.fillRect(x + 1, y + 1, ts - 2, ts - 2);
  c.fillStyle = "#a86c34";
  c.fillRect(x + 4, y + 4, ts - 8, ts - 8);
  c.strokeStyle = "#6b441f";
  c.lineWidth = 2;
  c.strokeRect(x + 4, y + 4, ts - 8, ts - 8);
  c.beginPath();
  c.moveTo(x + 4, y + 4);
  c.lineTo(x + ts - 4, y + ts - 4);
  c.moveTo(x + ts - 4, y + 4);
  c.lineTo(x + 4, y + ts - 4);
  c.stroke();
}

function drawBomb(
  c: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  fuse: number,
  ts: number,
  time: number,
): void {
  const cx = gx * ts + ts / 2;
  const cy = gy * ts + ts / 2;
  // throb faster as the fuse runs down
  const speed = 6 + (1 - Math.min(fuse, 90) / 90) * 10;
  const pulse = 0.5 + 0.5 * Math.sin(time * speed);
  const r = ts * 0.30 + pulse * ts * 0.06;

  // glow
  const glow = c.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2);
  glow.addColorStop(0, `rgba(255,170,40,${0.35 + pulse * 0.3})`);
  glow.addColorStop(1, "rgba(255,170,40,0)");
  c.fillStyle = glow;
  c.beginPath();
  c.arc(cx, cy, r * 2, 0, Math.PI * 2);
  c.fill();

  // shadow
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.beginPath();
  c.ellipse(cx, cy + r * 0.85, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  c.fill();

  // body, yellow/orange with strong contrast
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

  // red highlight + spark
  c.fillStyle = `rgba(255,60,40,${0.5 + pulse * 0.5})`;
  c.beginPath();
  c.arc(cx + r * 0.25, cy + r * 0.2, r * 0.22, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#fff6c0";
  c.beginPath();
  c.arc(cx - r * 0.3, cy - r * 0.35, r * 0.18, 0, Math.PI * 2);
  c.fill();
  // fuse
  c.strokeStyle = "#caa";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(cx, cy - r);
  c.lineTo(cx + r * 0.4, cy - r * 1.5);
  c.stroke();
}

function drawFlame(
  c: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  frac: number,
  ts: number,
  time: number,
): void {
  const x = gx * ts;
  const y = gy * ts;
  const a = Math.max(0, Math.min(1, frac));
  const flick = 0.85 + 0.15 * Math.sin(time * 25 + gx + gy);
  c.save();
  c.globalAlpha = a;
  const g = c.createRadialGradient(
    x + ts / 2,
    y + ts / 2,
    2,
    x + ts / 2,
    y + ts / 2,
    ts * 0.7 * flick,
  );
  g.addColorStop(0, "#fff3b0");
  g.addColorStop(0.4, "#ffae33");
  g.addColorStop(0.8, "#ff5a1f");
  g.addColorStop(1, "rgba(255,60,20,0)");
  c.fillStyle = g;
  c.fillRect(x, y, ts, ts);
  c.restore();
}

function drawPowerup(
  c: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  kind: string,
  ts: number,
  time: number,
): void {
  const cx = gx * ts + ts / 2;
  const cy = gy * ts + ts / 2;
  const bob = Math.sin(time * 3 + gx + gy) * ts * 0.04;
  const r = ts * 0.28;
  const color = kind === "bomb" ? "#4fc3f7" : kind === "flame" ? "#ff6b4a" : "#7ee06a";

  // shadow
  c.fillStyle = "rgba(0,0,0,0.3)";
  c.beginPath();
  c.ellipse(cx, cy + r * 0.9, r * 0.8, r * 0.3, 0, 0, Math.PI * 2);
  c.fill();

  // glowing body
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

  // highlight spot
  c.fillStyle = "rgba(255,255,255,0.7)";
  c.beginPath();
  c.arc(cx - r * 0.35, cy - r * 0.4 + bob, r * 0.18, 0, Math.PI * 2);
  c.fill();

  // tiny icon
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

function drawPlayer(
  c: CanvasRenderingContext2D,
  p: SnapshotMsg["players"][number],
  ts: number,
  time: number,
): void {
  const cx = p.x * ts + ts / 2;
  const cy = p.y * ts + ts / 2;
  const r = ts * 0.36;

  let st = eyeStates.get(p.id);
  if (!st) {
    st = { ex: 0, ey: 0, seed: hashSeed(p.id) };
    eyeStates.set(p.id, st);
  }
  // ease pupils toward the travel direction (or back to center when stopped)
  const target = p.moving ? DIR_OFFSET[p.dir] : { x: 0, y: 0 };
  st.ex += (target.x - st.ex) * 0.2;
  st.ey += (target.y - st.ey) * 0.2;

  // shadow
  c.fillStyle = "rgba(0,0,0,0.3)";
  c.beginPath();
  c.ellipse(cx, cy + r * 0.85, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
  c.fill();

  // blob body
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

  // eyes — blink occasionally, staggered per player
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

// lighten (>0) or darken (<0) a hex color
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
