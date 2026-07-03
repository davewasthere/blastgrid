import {
  BASE_MOVE_SPEED,
  BOMB_FUSE_TICKS,
  CHAIN_DELAY_TICKS,
  CRATE_FILL_CHANCE,
  CRATE_POWERUP_CHANCE,
  CRATE_REGEN_BATCH,
  CRATE_REGEN_INTERVAL_TICKS,
  CRATE_REGEN_SAFE_RADIUS,
  CRATE_TARGET_FRACTION,
  DEFAULT_BOMBS,
  DEFAULT_FLAME,
  DEFAULT_SPEED,
  FLAME_LETHAL_TICKS,
  FLAME_LIFETIME_TICKS,
  MAX_WORLD,
  MIN_WORLD,
  PLAYER_COLORS,
  RESPAWN_TICKS,
  SCORE_BOMB,
  SCORE_CRATE,
  SCORE_KILL,
  SCORE_POWERUP,
  SCORE_STREAK_BONUS,
  SHRINK_INTERVAL_TICKS,
  SHRINK_SAFE_DIST,
  STREAK_BONUS_MIN,
  SPEED_DROP_SHARE,
  SPEED_STEP,
  TILE_CRATE,
  TILE_EMPTY,
  TILE_WALL,
  UPGRADE_CAP,
  WORLD_STEP,
  type Dir,
  type PowerupKind,
  type Tile,
} from "../shared/constants.js";
import type {
  BombState,
  ExplosionCell,
  PlayerState,
  PowerupState,
} from "../shared/types.js";

const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

type Side = "right" | "left" | "bottom" | "top";

interface Player {
  id: string;
  name: string;
  colorIndex: number;
  gx: number;
  gy: number;
  ox: number;
  oy: number;
  tx: number;
  ty: number;
  progress: number;
  moving: boolean;
  dir: Dir;
  alive: boolean;
  respawnAt: number;
  bombs: number;
  flame: number;
  speed: number;
  kills: number;
  deaths: number;
  score: number;
  streak: number;
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

interface Explosion {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  ownerId: string;
}

interface Powerup {
  id: number;
  x: number;
  y: number;
  kind: PowerupKind;
}

export class World {
  tick = 0;
  W = MIN_WORLD;
  H = MIN_WORLD;
  mapVersion = 1;

  private map: Tile[] = [];
  private players = new Map<string, Player>();
  private bombs: Bomb[] = [];
  private explosions: Explosion[] = [];
  private powerups: Powerup[] = [];
  private nextBombId = 1;
  private nextPowerupId = 1;
  private colorCursor = 0;
  private shrinkTimer = 0;
  private regenTimer = 0;

  constructor() {
    this.map = freshMap(this.W, this.H);
  }

  get playerCount(): number {
    return this.players.size;
  }

  private idx(x: number, y: number): number {
    return y * this.W + x;
  }

  private isSolid(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return true;
    const t = this.map[this.idx(x, y)];
    return t === TILE_WALL || t === TILE_CRATE;
  }

  private bombAt(x: number, y: number): Bomb | undefined {
    return this.bombs.find((b) => b.x === x && b.y === y);
  }

  private occupied(x: number, y: number, exceptId?: string): boolean {
    for (const p of this.players.values()) {
      if (!p.alive || p.id === exceptId) continue;
      if (this.tileX(p) === x && this.tileY(p) === y) return true;
    }
    return false;
  }

  private tileX(p: Player): number {
    return Math.round(p.moving ? lerp(p.ox, p.tx, p.progress) : p.gx);
  }
  private tileY(p: Player): number {
    return Math.round(p.moving ? lerp(p.oy, p.ty, p.progress) : p.gy);
  }

  // ---- world growth ----

  private targetSide(): number {
    const side = MIN_WORLD + WORLD_STEP * Math.max(0, this.players.size - 1);
    return Math.min(MAX_WORLD, side);
  }

  /** Grow (only) the world to fit the current player count. Grows from the
   *  right/bottom so existing coordinates and the played-in interior are kept
   *  intact. Growth is instant; shrinking (see maybeShrink) is gradual. */
  ensureSize(): void {
    const target = this.targetSide();
    let changed = false;
    while (this.W < target) {
      this.growRight();
      changed = true;
    }
    while (this.H < target) {
      this.growBottom();
      changed = true;
    }
    if (changed) this.mapVersion++;
  }

  private growRight(): void {
    const oldW = this.W;
    const newW = oldW + 1;
    const next: Tile[] = new Array(newW * this.H);
    for (let y = 0; y < this.H; y++) {
      for (let nx = 0; nx < newW; nx++) {
        const onBorder = nx === 0 || y === 0 || nx === newW - 1 || y === this.H - 1;
        if (onBorder) next[y * newW + nx] = TILE_WALL;
        else if (nx <= oldW - 2 && y <= this.H - 2) next[y * newW + nx] = this.map[y * oldW + nx];
        else next[y * newW + nx] = interiorTile(nx, y); // freshly exposed column
      }
    }
    this.W = newW;
    this.map = next;
  }

  private growBottom(): void {
    const oldH = this.H;
    const newH = oldH + 1;
    const next: Tile[] = new Array(this.W * newH);
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < this.W; x++) {
        const onBorder = x === 0 || y === 0 || x === this.W - 1 || y === newH - 1;
        if (onBorder) next[y * this.W + x] = TILE_WALL;
        else if (y <= oldH - 2 && x <= this.W - 2) next[y * this.W + x] = this.map[y * this.W + x];
        else next[y * this.W + x] = interiorTile(x, y); // freshly exposed row
      }
    }
    this.H = newH;
    this.map = next;
  }

  // ---- gradual shrink toward the player-count target ----

  /** Called on a timer from step(). Closes in ONE wall per tick — the emptiest
   *  side that still needs to shrink and has no player within SHRINK_SAFE_DIST of
   *  it. Crates are never cleared; only the indestructible pillars on the very
   *  outer ring are trimmed so the closing edge doesn't become a choppy line of
   *  pillars (boxes-with-gaps). */
  private maybeShrink(): void {
    const target = this.targetSide();
    const cands: { side: Side; clearance: number }[] = [];
    if (this.W > target) {
      cands.push({ side: "right", clearance: this.edgeClearance("right") });
      cands.push({ side: "left", clearance: this.edgeClearance("left") });
    }
    if (this.H > target) {
      cands.push({ side: "bottom", clearance: this.edgeClearance("bottom") });
      cands.push({ side: "top", clearance: this.edgeClearance("top") });
    }
    // only sides where nobody is within SHRINK_SAFE_DIST of that wall
    const eligible = cands.filter((c) => c.clearance >= SHRINK_SAFE_DIST);
    if (eligible.length === 0) return;

    // close in the emptiest eligible wall, one ring
    eligible.sort((a, b) => b.clearance - a.clearance);
    switch (eligible[0].side) {
      case "right":
        this.shrinkRight();
        break;
      case "left":
        this.shrinkLeft();
        break;
      case "bottom":
        this.shrinkBottom();
        break;
      case "top":
        this.shrinkTop();
        break;
    }
    this.trimPerimeterPillars();
    this.mapVersion++;
  }

  /** Perpendicular distance from the nearest living player to the given wall
   *  (Infinity if nobody's around). */
  private edgeClearance(side: Side): number {
    let min = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const px = this.tileX(p);
      const py = this.tileY(p);
      const d =
        side === "right" ? this.W - 2 - px
        : side === "left" ? px - 1
        : side === "bottom" ? this.H - 2 - py
        : py - 1;
      if (d < min) min = d;
    }
    return min;
  }

  /** Convert only the pillars (walls) on the outer interior ring to empty,
   *  leaving crates and floor untouched — keeps the closing edge tidy without
   *  clearing the corridor of crates. */
  private trimPerimeterPillars(): void {
    const trim = (x: number, y: number) => {
      const i = this.idx(x, y);
      if (this.map[i] === TILE_WALL) this.map[i] = TILE_EMPTY;
    };
    for (let x = 1; x <= this.W - 2; x++) {
      trim(x, 1);
      trim(x, this.H - 2);
    }
    for (let y = 1; y <= this.H - 2; y++) {
      trim(1, y);
      trim(this.W - 2, y);
    }
  }

  /** Slowly grow crates back toward a target density so powerups keep flowing
   *  and the arena never runs dry once everything's been blown up. */
  private regenCrates(): void {
    // survey the inner interior (excludes the perimeter hallway + pillars)
    let crates = 0;
    let open = 0;
    for (let y = 2; y <= this.H - 3; y++) {
      for (let x = 2; x <= this.W - 3; x++) {
        if (x % 2 === 0 && y % 2 === 0) continue; // pillar
        open++;
        if (this.map[this.idx(x, y)] === TILE_CRATE) crates++;
      }
    }
    const target = Math.floor(open * CRATE_TARGET_FRACTION);
    let toAdd = Math.min(CRATE_REGEN_BATCH, target - crates);
    if (toAdd <= 0) return;

    let changed = false;
    let attempts = 0;
    while (toAdd > 0 && attempts++ < 80) {
      const x = 2 + Math.floor(Math.random() * (this.W - 4));
      const y = 2 + Math.floor(Math.random() * (this.H - 4));
      if (x % 2 === 0 && y % 2 === 0) continue; // pillar
      if (this.map[this.idx(x, y)] !== TILE_EMPTY) continue;
      if (this.bombAt(x, y)) continue;
      if (this.powerups.some((pu) => pu.x === x && pu.y === y)) continue;
      // keep a clear buffer around living players so nobody gets boxed in
      let nearPlayer = false;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (
          Math.abs(this.tileX(p) - x) <= CRATE_REGEN_SAFE_RADIUS &&
          Math.abs(this.tileY(p) - y) <= CRATE_REGEN_SAFE_RADIUS
        ) {
          nearPlayer = true;
          break;
        }
      }
      if (nearPlayer) continue;
      this.map[this.idx(x, y)] = TILE_CRATE;
      toAdd--;
      changed = true;
    }
    if (changed) this.mapVersion++;
  }

  private shrinkRight(): void {
    const oldW = this.W;
    const newW = oldW - 1;
    const next: Tile[] = new Array(newW * this.H);
    for (let y = 0; y < this.H; y++) {
      for (let nx = 0; nx < newW; nx++) {
        next[y * newW + nx] = nx === newW - 1 ? TILE_WALL : this.map[y * oldW + nx];
      }
    }
    this.W = newW;
    this.map = next;
    this.cullOutside();
  }

  private shrinkBottom(): void {
    const newH = this.H - 1;
    const next: Tile[] = new Array(this.W * newH);
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < this.W; x++) {
        next[y * this.W + x] = y === newH - 1 ? TILE_WALL : this.map[y * this.W + x];
      }
    }
    this.H = newH;
    this.map = next;
    this.cullOutside();
  }

  private shrinkLeft(): void {
    const oldW = this.W;
    const newW = oldW - 1;
    const next: Tile[] = new Array(newW * this.H);
    for (let y = 0; y < this.H; y++) {
      for (let nx = 0; nx < newW; nx++) {
        next[y * newW + nx] = nx === 0 ? TILE_WALL : this.map[y * oldW + (nx + 1)];
      }
    }
    this.W = newW;
    this.map = next;
    this.shiftEntities(-1, 0); // everything moves inward; visually nothing jumps
    this.cullOutside();
  }

  private shrinkTop(): void {
    const newH = this.H - 1;
    const next: Tile[] = new Array(this.W * newH);
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < this.W; x++) {
        next[y * this.W + x] = y === 0 ? TILE_WALL : this.map[(y + 1) * this.W + x];
      }
    }
    this.H = newH;
    this.map = next;
    this.shiftEntities(0, -1);
    this.cullOutside();
  }

  private shiftEntities(dx: number, dy: number): void {
    for (const p of this.players.values()) {
      p.gx += dx;
      p.ox += dx;
      p.tx += dx;
      p.gy += dy;
      p.oy += dy;
      p.ty += dy;
    }
    for (const b of this.bombs) {
      b.x += dx;
      b.y += dy;
    }
    for (const pu of this.powerups) {
      pu.x += dx;
      pu.y += dy;
    }
    for (const e of this.explosions) {
      e.x += dx;
      e.y += dy;
    }
  }

  /** Drop bombs/powerups/explosions that ended up on or outside the new border. */
  private cullOutside(): void {
    const outside = (x: number, y: number) => x < 1 || y < 1 || x > this.W - 2 || y > this.H - 2;
    this.bombs = this.bombs.filter((b) => !outside(b.x, b.y));
    this.powerups = this.powerups.filter((pu) => !outside(pu.x, pu.y));
    this.explosions = this.explosions.filter((e) => !outside(e.x, e.y));
  }

  /** When everyone leaves, shrink back to the minimum for the next session. */
  resetIfEmpty(): void {
    if (this.players.size > 0) return;
    this.W = MIN_WORLD;
    this.H = MIN_WORLD;
    this.map = freshMap(this.W, this.H);
    this.bombs = [];
    this.explosions = [];
    this.powerups = [];
    this.mapVersion++;
  }

  // ---- player lifecycle ----

  addPlayer(id: string, name: string): void {
    const p: Player = {
      id,
      name,
      colorIndex: this.colorCursor++ % PLAYER_COLORS.length,
      gx: 1,
      gy: 1,
      ox: 1,
      oy: 1,
      tx: 1,
      ty: 1,
      progress: 0,
      moving: false,
      dir: "down",
      alive: true,
      respawnAt: 0,
      bombs: DEFAULT_BOMBS,
      flame: DEFAULT_FLAME,
      speed: DEFAULT_SPEED,
      kills: 0,
      deaths: 0,
      score: 0,
      streak: 0,
      heldDir: null,
      bombHeld: false,
    };
    // Register first so the world is sized for the new count, then place them.
    this.players.set(id, p);
    this.ensureSize();
    const spawn = this.findSpawn();
    p.gx = p.ox = p.tx = spawn.x;
    p.gy = p.oy = p.ty = spawn.y;
  }

  setName(id: string, name: string): void {
    const p = this.players.get(id);
    if (p) p.name = name;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
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

  private findSpawn(): { x: number; y: number } {
    // prefer odd/odd tiles (never pillars), empty and unoccupied, then clear a
    // small pocket so the player isn't boxed in on arrival.
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = 1 + 2 * Math.floor(Math.random() * Math.floor((this.W - 2) / 2));
      const y = 1 + 2 * Math.floor(Math.random() * Math.floor((this.H - 2) / 2));
      if (this.map[this.idx(x, y)] !== TILE_EMPTY) continue;
      if (this.occupied(x, y)) continue;
      this.clearPocket(x, y);
      return { x, y };
    }
    // fallback: first empty unoccupied tile
    for (let y = 1; y < this.H - 1; y++) {
      for (let x = 1; x < this.W - 1; x++) {
        if (this.map[this.idx(x, y)] === TILE_EMPTY && !this.occupied(x, y)) {
          return { x, y };
        }
      }
    }
    return { x: 1, y: 1 };
  }

  private clearPocket(x: number, y: number): void {
    let changed = false;
    for (const { dx, dy } of [{ dx: 0, dy: 0 }, ...Object.values(DIR_VEC)]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx <= 0 || ny <= 0 || nx >= this.W - 1 || ny >= this.H - 1) continue;
      if (this.map[this.idx(nx, ny)] === TILE_CRATE) {
        this.map[this.idx(nx, ny)] = TILE_EMPTY;
        changed = true;
      }
    }
    if (changed) this.mapVersion++;
  }

  // ---- main tick ----

  step(): void {
    this.tick++;
    for (const p of this.players.values()) {
      if (p.alive) this.movePlayer(p);
      else if (this.tick >= p.respawnAt) this.respawn(p);
    }
    for (const p of this.players.values()) {
      if (p.alive && p.bombHeld) this.tryPlaceBomb(p);
    }
    // Age existing flames first, then detonate — so flames created this tick
    // reach the snapshot at full life (lets clients detect a *fresh* blast).
    this.updateExplosions();
    this.updateBombs();
    this.checkDeaths();

    if (++this.shrinkTimer >= SHRINK_INTERVAL_TICKS) {
      this.shrinkTimer = 0;
      this.maybeShrink();
    }
    if (++this.regenTimer >= CRATE_REGEN_INTERVAL_TICKS) {
      this.regenTimer = 0;
      this.regenCrates();
    }
  }

  private respawn(p: Player): void {
    const spawn = this.findSpawn();
    p.gx = spawn.x;
    p.gy = spawn.y;
    p.ox = spawn.x;
    p.oy = spawn.y;
    p.tx = spawn.x;
    p.ty = spawn.y;
    p.progress = 0;
    p.moving = false;
    p.alive = true;
    p.bombs = DEFAULT_BOMBS;
    p.flame = DEFAULT_FLAME;
    p.speed = DEFAULT_SPEED;
  }

  private moveSpeed(p: Player): number {
    return BASE_MOVE_SPEED + p.speed * SPEED_STEP;
  }

  private passable(x: number, y: number): boolean {
    if (this.isSolid(x, y)) return false;
    if (this.bombAt(x, y)) return false;
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
        this.tryStartMove(p);
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
    else p.speed = Math.min(UPGRADE_CAP, p.speed + 1);
    p.score += SCORE_POWERUP;
  }

  private tryPlaceBomb(p: Player): void {
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
    if (this.occupied(tx, ty, p.id)) return;
    this.bombs.push({
      id: this.nextBombId++,
      x: tx,
      y: ty,
      flame: p.flame,
      fuse: BOMB_FUSE_TICKS,
      ownerId: p.id,
      chained: false,
    });
    p.score += SCORE_BOMB;
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
    if (i < 0) return;
    this.bombs.splice(i, 1);

    this.addFlame(bomb.x, bomb.y, bomb.ownerId);
    for (const d of Object.keys(DIR_VEC) as Dir[]) {
      const { dx, dy } = DIR_VEC[d];
      for (let step = 1; step <= bomb.flame; step++) {
        const x = bomb.x + dx * step;
        const y = bomb.y + dy * step;
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) break;
        const t = this.map[this.idx(x, y)];
        if (t === TILE_WALL) break;
        this.addFlame(x, y, bomb.ownerId);
        const other = this.bombAt(x, y);
        if (other && !other.chained) {
          other.chained = true;
          other.fuse = Math.min(other.fuse, CHAIN_DELAY_TICKS);
        }
        if (t === TILE_CRATE) {
          this.map[this.idx(x, y)] = TILE_EMPTY;
          this.mapVersion++;
          const owner = this.players.get(bomb.ownerId);
          if (owner) owner.score += SCORE_CRATE;
          this.maybeDropPowerup(x, y);
          break;
        }
      }
    }
  }

  private addFlame(x: number, y: number, ownerId: string): void {
    const pi = this.powerups.findIndex((pu) => pu.x === x && pu.y === y);
    if (pi >= 0) this.powerups.splice(pi, 1);
    this.explosions.push({
      x,
      y,
      life: FLAME_LIFETIME_TICKS,
      maxLife: FLAME_LIFETIME_TICKS,
      ownerId,
    });
  }

  private maybeDropPowerup(x: number, y: number): void {
    if (Math.random() >= CRATE_POWERUP_CHANCE) return;
    let kind: PowerupKind;
    if (Math.random() < SPEED_DROP_SHARE) kind = "speed";
    else kind = Math.random() < 0.5 ? "bomb" : "flame";
    this.powerups.push({ id: this.nextPowerupId++, x, y, kind });
  }

  private updateExplosions(): void {
    for (const e of this.explosions) e.life--;
    this.explosions = this.explosions.filter((e) => e.life > 0);
  }

  private checkDeaths(): void {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const px = this.tileX(p);
      const py = this.tileY(p);
      // only the fresh blast is lethal — the fading tail is safe to walk through
      const flame = this.explosions.find(
        (e) => e.x === px && e.y === py && e.maxLife - e.life < FLAME_LETHAL_TICKS,
      );
      if (!flame) continue;
      p.alive = false;
      p.moving = false;
      p.deaths++;
      p.streak = 0; // dying ends your kill streak
      p.respawnAt = this.tick + RESPAWN_TICKS;
      p.bombs = DEFAULT_BOMBS;
      p.flame = DEFAULT_FLAME;
      p.speed = DEFAULT_SPEED;
      // credit the kill to the bomb owner (unless it was a self-blast)
      if (flame.ownerId !== p.id) {
        const killer = this.players.get(flame.ownerId);
        if (killer) {
          killer.kills++;
          killer.streak++;
          killer.score += SCORE_KILL;
          // rampage bonus, escalating with streak length (3->+1x, 4->+2x, ...)
          if (killer.streak >= STREAK_BONUS_MIN) {
            killer.score += SCORE_STREAK_BONUS * (killer.streak - (STREAK_BONUS_MIN - 1));
          }
        }
      }
    }
  }

  // ---- snapshot ----

  mapCopy(): Tile[] {
    return this.map.slice();
  }

  players_(): PlayerState[] {
    return [...this.players.values()].map((p) => ({
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
      kills: p.kills,
      deaths: p.deaths,
      score: p.score,
      streak: p.streak,
    }));
  }

  bombs_(): BombState[] {
    return this.bombs.map((b) => ({ id: b.id, x: b.x, y: b.y, flame: b.flame, fuse: b.fuse }));
  }

  explosions_(): ExplosionCell[] {
    return this.explosions.map((e) => ({ x: e.x, y: e.y, life: e.life, maxLife: e.maxLife }));
  }

  powerups_(): PowerupState[] {
    return this.powerups.map((pu) => ({ id: pu.id, x: pu.x, y: pu.y, kind: pu.kind }));
  }
}

// ---- helpers ----

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interiorTile(x: number, y: number): Tile {
  if (x % 2 === 0 && y % 2 === 0) return TILE_WALL; // pillar lattice
  return Math.random() < CRATE_FILL_CHANCE ? TILE_CRATE : TILE_EMPTY;
}

function freshMap(W: number, H: number): Tile[] {
  const map: Tile[] = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      map[y * W + x] = border ? TILE_WALL : interiorTile(x, y);
    }
  }
  return map;
}
