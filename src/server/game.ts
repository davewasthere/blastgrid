import {
  BASE_MOVE_SPEED,
  BOMB_FUSE_TICKS,
  CHAIN_DELAY_TICKS,
  COUNTDOWN_TICKS,
  CRATE_FILL_CHANCE,
  CRATE_POWERUP_CHANCE,
  DEFAULT_BOMBS,
  DEFAULT_FLAME,
  DEFAULT_SPEED,
  FLAME_LIFETIME_TICKS,
  MAP_HEIGHT,
  MAP_WIDTH,
  PLAYER_COLORS,
  RESULTS_TICKS,
  SPAWN_CORNERS,
  SPEED_DROP_SHARE,
  SPEED_STEP,
  TILE_CRATE,
  TILE_EMPTY,
  TILE_WALL,
  UPGRADE_CAP,
  type Dir,
  type PowerupKind,
  type RoomPhase,
  type Tile,
} from "../shared/constants.js";
import type {
  BombState,
  ExplosionCell,
  PlayerState,
  PowerupState,
  SnapshotMsg,
} from "../shared/types.js";

const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

interface Player {
  id: string;
  name: string;
  colorIndex: number;
  cornerIndex: number;
  // grid position: current tile, plus an in-progress move toward (tx,ty)
  gx: number;
  gy: number;
  ox: number;
  oy: number;
  tx: number;
  ty: number;
  progress: number; // 0..1 across the current move
  moving: boolean;
  dir: Dir; // facing
  alive: boolean;
  bombs: number;
  flame: number;
  speed: number;
  // held input
  heldDir: Dir | null;
  bombHeld: boolean;
}

interface Bomb {
  id: number;
  x: number;
  y: number;
  flame: number;
  fuse: number;
  ownerId: string;
  chained: boolean;
}

interface Powerup {
  id: number;
  x: number;
  y: number;
  kind: PowerupKind;
}

export class Game {
  phase: RoomPhase = "waiting";
  hostId = "";
  tick = 0;

  private map: Tile[] = [];
  private players = new Map<string, Player>();
  private bombs: Bomb[] = [];
  private explosions: ExplosionCell[] = [];
  private powerups: Powerup[] = [];

  private countdown = 0;
  private resultsTimer = 0;
  private winnerName: string | null = null;
  private playersAtStart = 0;

  private nextBombId = 1;
  private nextPowerupId = 1;

  constructor() {
    this.map = generateMap();
  }

  get playerCount(): number {
    return this.players.size;
  }

  private idx(x: number, y: number): number {
    return y * MAP_WIDTH + x;
  }

  private isSolid(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return true;
    const t = this.map[this.idx(x, y)];
    return t === TILE_WALL || t === TILE_CRATE;
  }

  private bombAt(x: number, y: number): Bomb | undefined {
    return this.bombs.find((b) => b.x === x && b.y === y);
  }

  // ---- player lifecycle ----

  addPlayer(id: string, name: string): void {
    const colorIndex = firstUnused(
      [...this.players.values()].map((p) => p.colorIndex),
      PLAYER_COLORS.length,
    );
    const cornerIndex = firstUnused(
      [...this.players.values()].map((p) => p.cornerIndex),
      SPAWN_CORNERS.length,
    );
    const corner = SPAWN_CORNERS[cornerIndex % SPAWN_CORNERS.length];
    const p: Player = {
      id,
      name,
      colorIndex,
      cornerIndex,
      gx: corner.x,
      gy: corner.y,
      ox: corner.x,
      oy: corner.y,
      tx: corner.x,
      ty: corner.y,
      progress: 0,
      moving: false,
      dir: "down",
      // players that join mid-match are spectators until the next round resets
      alive: this.phase !== "playing" && this.phase !== "countdown",
      bombs: DEFAULT_BOMBS,
      flame: DEFAULT_FLAME,
      speed: DEFAULT_SPEED,
      heldDir: null,
      bombHeld: false,
    };
    this.players.set(id, p);
    if (!this.hostId) this.hostId = id;
  }

  setName(id: string, name: string): void {
    const p = this.players.get(id);
    if (p) p.name = name;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    // drop this player's bombs' ownership claim is fine; bombs stay live.
    if (this.hostId === id) {
      const next = this.players.keys().next();
      this.hostId = next.done ? "" : next.value;
    }
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  setInput(id: string, dir: Dir | null, bomb: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.heldDir = dir;
    p.bombHeld = bomb;
  }

  start(byId: string): void {
    if (byId !== this.hostId) return;
    if (this.phase !== "waiting" && this.phase !== "results") return;
    if (this.players.size < 1) return;
    this.resetRound();
    this.phase = "countdown";
    this.countdown = COUNTDOWN_TICKS;
  }

  private resetRound(): void {
    this.map = generateMap();
    this.bombs = [];
    this.explosions = [];
    this.powerups = [];
    this.winnerName = null;
    for (const p of this.players.values()) {
      const corner = SPAWN_CORNERS[p.cornerIndex % SPAWN_CORNERS.length];
      p.gx = corner.x;
      p.gy = corner.y;
      p.ox = corner.x;
      p.oy = corner.y;
      p.tx = corner.x;
      p.ty = corner.y;
      p.progress = 0;
      p.moving = false;
      p.dir = "down";
      p.alive = true;
      p.bombs = DEFAULT_BOMBS;
      p.flame = DEFAULT_FLAME;
      p.speed = DEFAULT_SPEED;
    }
  }

  // ---- main tick ----

  step(): void {
    this.tick++;

    if (this.phase === "countdown") {
      this.countdown--;
      if (this.countdown <= 0) {
        this.phase = "playing";
        this.playersAtStart = [...this.players.values()].filter((p) => p.alive)
          .length;
      }
      return;
    }

    if (this.phase === "results") {
      this.resultsTimer--;
      if (this.resultsTimer <= 0) {
        this.phase = "waiting";
        this.resetRound();
      }
      return;
    }

    if (this.phase !== "playing") return;

    for (const p of this.players.values()) {
      if (p.alive) this.movePlayer(p);
    }
    for (const p of this.players.values()) {
      if (p.alive && p.bombHeld) this.tryPlaceBomb(p);
    }
    this.updateBombs();
    this.updateExplosions();
    this.checkDeaths();
    this.checkWin();
  }

  private moveSpeed(p: Player): number {
    return BASE_MOVE_SPEED + p.speed * SPEED_STEP;
  }

  private passable(x: number, y: number): boolean {
    if (this.isSolid(x, y)) return false;
    if (this.bombAt(x, y)) return false; // bombs block entry for everyone
    return true;
  }

  private tryStartMove(p: Player): void {
    const d = p.heldDir;
    if (!d) return;
    p.dir = d;
    const { dx, dy } = DIR_VEC[d];
    const nx = p.gx + dx;
    const ny = p.gy + dy;
    if (this.passable(nx, ny)) {
      p.ox = p.gx;
      p.oy = p.gy;
      p.tx = nx;
      p.ty = ny;
      p.progress = 0;
      p.moving = true;
    }
  }

  private movePlayer(p: Player): void {
    let step = this.moveSpeed(p);
    if (!p.moving) this.tryStartMove(p);
    // consume the tick's movement budget, chaining across tiles seamlessly
    let guard = 0;
    while (p.moving && step > 0 && guard++ < 16) {
      const adv = Math.min(step, 1 - p.progress);
      p.progress += adv;
      step -= adv;
      if (p.progress >= 1 - 1e-9) {
        p.gx = p.tx;
        p.gy = p.ty;
        p.progress = 0;
        p.moving = false;
        this.pickupAt(p, p.gx, p.gy);
        this.tryStartMove(p); // continue if still held & open
      }
    }
  }

  private pickupAt(p: Player, x: number, y: number): void {
    const i = this.powerups.findIndex((pu) => pu.x === x && pu.y === y);
    if (i < 0) return;
    const pu = this.powerups[i];
    this.powerups.splice(i, 1);
    if (pu.kind === "bomb") p.bombs = Math.min(UPGRADE_CAP, p.bombs + 1);
    else if (pu.kind === "flame") p.flame = Math.min(UPGRADE_CAP, p.flame + 1);
    else if (pu.kind === "speed") p.speed = Math.min(UPGRADE_CAP, p.speed + 1);
  }

  private tryPlaceBomb(p: Player): void {
    // which tile? standing still -> current; moving -> leaving tile (first
    // half) or entering tile (second half).
    let tx = p.gx;
    let ty = p.gy;
    if (p.moving) {
      if (p.progress < 0.5) {
        tx = p.ox;
        ty = p.oy;
      } else {
        tx = p.tx;
        ty = p.ty;
      }
    }
    const active = this.bombs.filter((b) => b.ownerId === p.id).length;
    if (active >= p.bombs) return;
    if (this.bombAt(tx, ty)) return;
    if (this.isSolid(tx, ty)) return;
    // refuse to drop on a tile another (live) player occupies
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      const ox = Math.round(other.moving ? lerp(other.ox, other.tx, other.progress) : other.gx);
      const oy = Math.round(other.moving ? lerp(other.oy, other.ty, other.progress) : other.gy);
      if (ox === tx && oy === ty) return;
    }
    this.bombs.push({
      id: this.nextBombId++,
      x: tx,
      y: ty,
      flame: p.flame,
      fuse: BOMB_FUSE_TICKS,
      ownerId: p.id,
      chained: false,
    });
  }

  private updateBombs(): void {
    const toDetonate: Bomb[] = [];
    for (const b of this.bombs) {
      b.fuse--;
      if (b.fuse <= 0) toDetonate.push(b);
    }
    for (const b of toDetonate) this.detonate(b);
  }

  private detonate(bomb: Bomb): void {
    const i = this.bombs.indexOf(bomb);
    if (i < 0) return; // already gone (chained)
    this.bombs.splice(i, 1);

    this.addFlame(bomb.x, bomb.y);
    for (const d of Object.keys(DIR_VEC) as Dir[]) {
      const { dx, dy } = DIR_VEC[d];
      for (let step = 1; step <= bomb.flame; step++) {
        const x = bomb.x + dx * step;
        const y = bomb.y + dy * step;
        if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) break;
        const t = this.map[this.idx(x, y)];
        if (t === TILE_WALL) break; // solid wall blocks the blast
        this.addFlame(x, y);
        // chain any bomb caught in the blast (after a short delay)
        const other = this.bombAt(x, y);
        if (other && !other.chained) {
          other.chained = true;
          other.fuse = Math.min(other.fuse, CHAIN_DELAY_TICKS);
        }
        if (t === TILE_CRATE) {
          this.map[this.idx(x, y)] = TILE_EMPTY;
          this.maybeDropPowerup(x, y);
          break; // flame stops at the first crate it destroys
        }
      }
    }
  }

  private addFlame(x: number, y: number): void {
    // pre-existing powerups sitting on a blast tile are destroyed
    const pi = this.powerups.findIndex((pu) => pu.x === x && pu.y === y);
    if (pi >= 0) this.powerups.splice(pi, 1);
    this.explosions.push({
      x,
      y,
      life: FLAME_LIFETIME_TICKS,
      maxLife: FLAME_LIFETIME_TICKS,
    });
  }

  private maybeDropPowerup(x: number, y: number): void {
    if (rand() >= CRATE_POWERUP_CHANCE) return;
    let kind: PowerupKind;
    if (rand() < SPEED_DROP_SHARE) kind = "speed";
    else kind = rand() < 0.5 ? "bomb" : "flame";
    this.powerups.push({ id: this.nextPowerupId++, x, y, kind });
  }

  private updateExplosions(): void {
    for (const e of this.explosions) e.life--;
    this.explosions = this.explosions.filter((e) => e.life > 0);
  }

  private checkDeaths(): void {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const px = Math.round(p.moving ? lerp(p.ox, p.tx, p.progress) : p.gx);
      const py = Math.round(p.moving ? lerp(p.oy, p.ty, p.progress) : p.gy);
      const inFlame = this.explosions.some((e) => e.x === px && e.y === py);
      if (inFlame) {
        p.alive = false;
        p.moving = false;
        // upgrades reset to defaults on death
        p.bombs = DEFAULT_BOMBS;
        p.flame = DEFAULT_FLAME;
        p.speed = DEFAULT_SPEED;
      }
    }
  }

  private checkWin(): void {
    const alive = [...this.players.values()].filter((p) => p.alive);
    const ended =
      (this.playersAtStart >= 2 && alive.length <= 1) || alive.length === 0;
    if (!ended) return;
    this.winnerName = alive.length === 1 ? alive[0].name : null;
    this.phase = "results";
    this.resultsTimer = RESULTS_TICKS;
  }

  // ---- snapshot ----

  snapshot(): SnapshotMsg {
    const players: PlayerState[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length],
      x: p.moving ? lerp(p.ox, p.tx, p.progress) : p.gx,
      y: p.moving ? lerp(p.oy, p.ty, p.progress) : p.gy,
      dir: p.dir,
      moving: p.moving,
      alive: p.alive,
      bombs: p.bombs,
      flame: p.flame,
      speed: p.speed,
      isHost: p.id === this.hostId,
    }));
    const bombs: BombState[] = this.bombs.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      flame: b.flame,
      fuse: b.fuse,
    }));
    const explosions: ExplosionCell[] = this.explosions.map((e) => ({ ...e }));
    const powerups: PowerupState[] = this.powerups.map((pu) => ({
      id: pu.id,
      x: pu.x,
      y: pu.y,
      kind: pu.kind,
    }));
    return {
      type: "snapshot",
      tick: this.tick,
      phase: this.phase,
      countdown: Math.ceil(this.countdown / 30),
      hostId: this.hostId,
      winnerName: this.winnerName,
      map: this.map,
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      players,
      bombs,
      explosions,
      powerups,
    };
  }
}

// ---- helpers ----

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rand(): number {
  return Math.random();
}

function firstUnused(used: number[], max: number): number {
  const set = new Set(used);
  for (let i = 0; i < max; i++) if (!set.has(i)) return i;
  return used.length % max;
}

function generateMap(): Tile[] {
  const map: Tile[] = new Array(MAP_WIDTH * MAP_HEIGHT).fill(TILE_EMPTY);
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = y * MAP_WIDTH + x;
      const border = x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) {
        map[i] = TILE_WALL;
        continue;
      }
      // keep the four spawn corners (and their elbows) clear
      if (isSpawnSafe(x, y)) continue;
      if (rand() < CRATE_FILL_CHANCE) map[i] = TILE_CRATE;
    }
  }
  return map;
}

function isSpawnSafe(x: number, y: number): boolean {
  for (const c of SPAWN_CORNERS) {
    const dx = Math.abs(c.x - x);
    const dy = Math.abs(c.y - y);
    if (dx + dy <= 1) return true; // the corner tile and its immediate neighbors
  }
  return false;
}
