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
  ENEMY_MAX,
  ENEMY_SPEED,
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
  SPAWN_IMMUNE_TICKS,
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
  EnemyState,
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

type Side = "right" | "bottom";

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
  isBot: boolean;
  botNextDecision: number;
  botBombAt: number;
  immuneUntil: number;
  deathCause: "bomb" | "enemy" | null;
}

interface Enemy {
  id: number;
  gx: number;
  gy: number;
  ox: number;
  oy: number;
  tx: number;
  ty: number;
  progress: number;
  moving: boolean;
  flameImmuneUntil: number; // survive the blast that spawned it, then vulnerable
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
  private enemies: Enemy[] = [];
  private nextBombId = 1;
  private nextPowerupId = 1;
  private nextEnemyId = 1;
  private nextBotId = 1;
  private colorCursor = 0;
  private shrinkTimer = 0;
  private regenTimer = 0;
  private botTarget = 0;
  private botNames: string[] = [];

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

  /** Called on a timer from step(). Closes in ONE wall per tick — from the right
   *  or bottom only (the same directions the world grows), so no coordinate shift
   *  is ever needed and the resize stays smooth. Only closes a wall with no living
   *  player within SHRINK_SAFE_DIST of it. Crates are never cleared; only the
   *  pillars on the outer ring are trimmed so the closing edge isn't a choppy
   *  line of pillars (boxes-with-gaps). */
  private maybeShrink(): void {
    const target = this.targetSide();
    const cands: { side: Side; clearance: number }[] = [];
    if (this.W > target) cands.push({ side: "right", clearance: this.edgeClearance("right") });
    if (this.H > target) cands.push({ side: "bottom", clearance: this.edgeClearance("bottom") });

    // only walls where nobody is within SHRINK_SAFE_DIST
    const eligible = cands.filter((c) => c.clearance >= SHRINK_SAFE_DIST);
    if (eligible.length === 0) return;

    // close in the emptier eligible wall, one ring
    eligible.sort((a, b) => b.clearance - a.clearance);
    if (eligible[0].side === "right") this.shrinkRight();
    else this.shrinkBottom();
    this.trimPerimeterPillars();
    this.mapVersion++;
  }

  /** Perpendicular distance from the nearest living player to the given wall
   *  (Infinity if nobody's around). */
  private edgeClearance(side: Side): number {
    let min = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = side === "right" ? this.W - 2 - this.tileX(p) : this.H - 2 - this.tileY(p);
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

  /** Drop bombs/powerups/explosions that ended up on or outside the new border. */
  private cullOutside(): void {
    const outside = (x: number, y: number) => x < 1 || y < 1 || x > this.W - 2 || y > this.H - 2;
    this.bombs = this.bombs.filter((b) => !outside(b.x, b.y));
    this.powerups = this.powerups.filter((pu) => !outside(pu.x, pu.y));
    this.explosions = this.explosions.filter((e) => !outside(e.x, e.y));
    this.enemies = this.enemies.filter((e) => !outside(this.enemyTileX(e), this.enemyTileY(e)));
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
      isBot: false,
      botNextDecision: 0,
      botBombAt: 0,
      immuneUntil: this.tick + SPAWN_IMMUNE_TICKS,
      deathCause: null,
    };
    // Register first so the world is sized for the new count, then place them.
    this.players.set(id, p);
    this.ensureSize();
    const spawn = this.findSpawn();
    p.gx = p.ox = p.tx = spawn.x;
    p.gy = p.oy = p.ty = spawn.y;
  }

  /** Add an always-on, server-driven bot player. */
  private addBot(name: string): void {
    const id = `bot${this.nextBotId++}`;
    this.addPlayer(id, name);
    const p = this.players.get(id);
    if (p) {
      p.isBot = true;
      p.botBombAt = this.tick + Math.floor(Math.random() * 90); // stagger first bomb
    }
  }

  /** Configure the bot fill: how many bots to keep, and their name pool. */
  configureBots(count: number, names: string[]): void {
    this.botTarget = count;
    this.botNames = names;
    this.syncBots();
  }

  /** Keep bots around only while there's a lone human (0 or 1); remove them
   *  once a second human joins, re-add them when it drops back. */
  syncBots(): void {
    const humans = [...this.players.values()].filter((p) => !p.isBot).length;
    const bots = [...this.players.values()].filter((p) => p.isBot);
    const want = humans <= 1 ? this.botTarget : 0;
    if (bots.length < want) {
      for (let i = bots.length; i < want; i++) {
        this.addBot(this.botNames[i % this.botNames.length] ?? `Bot${i + 1}`);
      }
    } else {
      for (let i = want; i < bots.length; i++) this.players.delete(bots[i].id);
    }
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
    this.stepBots(); // fill in bot inputs before movement
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
    this.killEnemiesInFlame(); // blasts destroy chasers (except newborns)
    this.stepEnemies(); // chasers hunt the nearest player
    this.checkDeaths();
    this.checkEnemyContact(); // a chaser touching a player is lethal

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
    p.immuneUntil = this.tick + SPAWN_IMMUNE_TICKS;
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
    // a powerup caught in the blast turns into a chaser enemy
    const pi = this.powerups.findIndex((pu) => pu.x === x && pu.y === y);
    if (pi >= 0) {
      this.powerups.splice(pi, 1);
      this.spawnEnemy(x, y);
    }
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
      if (flame) this.killPlayer(p, flame.ownerId, "bomb");
    }
  }

  /** Kill a player; credit the killer (a bomb owner) unless it was self/environmental. */
  private killPlayer(p: Player, killerId: string | null, cause: "bomb" | "enemy"): void {
    if (!p.alive || this.tick < p.immuneUntil) return; // spawn protection
    p.alive = false;
    p.moving = false;
    p.deaths++;
    p.deathCause = cause;
    p.streak = 0; // dying ends your kill streak
    p.respawnAt = this.tick + RESPAWN_TICKS;
    p.bombs = DEFAULT_BOMBS;
    p.flame = DEFAULT_FLAME;
    p.speed = DEFAULT_SPEED;
    if (killerId && killerId !== p.id) {
      const killer = this.players.get(killerId);
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

  // ---- bots ----

  private stepBots(): void {
    for (const p of this.players.values()) {
      if (!p.isBot || !p.alive) continue;

      // wander: (re)pick a direction when idle and the timer's up or we're blocked
      if (!p.moving) {
        const opens = this.openDirs(p.gx, p.gy);
        const blocked = !p.heldDir || !opens.includes(p.heldDir);
        if (this.tick >= p.botNextDecision || blocked) {
          p.heldDir = opens.length ? opens[Math.floor(Math.random() * opens.length)] : null;
          p.botNextDecision = this.tick + 12 + Math.floor(Math.random() * 30);
        }
      }

      // bomb occasionally, but only with a real escape lane, then flee
      p.bombHeld = false;
      if (this.tick >= p.botBombAt && !this.bombs.some((b) => b.ownerId === p.id)) {
        const escape = this.escapeDir(p.gx, p.gy);
        if (escape && (this.botNearTarget(p) || Math.random() < 0.5)) {
          p.bombHeld = true;
          p.heldDir = escape; // run away from the bomb
          p.botNextDecision = this.tick + 45; // commit to fleeing for ~1.5s
          p.botBombAt = this.tick + 90 + Math.floor(Math.random() * 90);
        }
      }
    }
  }

  private openDirs(x: number, y: number): Dir[] {
    return (Object.keys(DIR_VEC) as Dir[]).filter((d) =>
      this.passable(x + DIR_VEC[d].dx, y + DIR_VEC[d].dy),
    );
  }

  /** A direction with at least two open tiles ahead — a lane to flee a bomb down. */
  private escapeDir(x: number, y: number): Dir | null {
    for (const d of Object.keys(DIR_VEC) as Dir[]) {
      const { dx, dy } = DIR_VEC[d];
      if (this.passable(x + dx, y + dy) && this.passable(x + 2 * dx, y + 2 * dy)) return d;
    }
    return null;
  }

  private botNearTarget(p: Player): boolean {
    for (const d of Object.keys(DIR_VEC) as Dir[]) {
      const nx = p.gx + DIR_VEC[d].dx;
      const ny = p.gy + DIR_VEC[d].dy;
      if (nx >= 0 && ny >= 0 && nx < this.W && ny < this.H && this.map[this.idx(nx, ny)] === TILE_CRATE) {
        return true;
      }
    }
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      if (Math.abs(this.tileX(other) - p.gx) + Math.abs(this.tileY(other) - p.gy) <= 1) return true;
    }
    return false;
  }

  // ---- chaser enemies ----

  private spawnEnemy(x: number, y: number): void {
    if (this.enemies.length >= ENEMY_MAX) return;
    this.enemies.push({
      id: this.nextEnemyId++,
      gx: x,
      gy: y,
      ox: x,
      oy: y,
      tx: x,
      ty: y,
      progress: 0,
      moving: false,
      flameImmuneUntil: this.tick + SPAWN_IMMUNE_TICKS,
    });
  }

  private enemyTileX(e: Enemy): number {
    return Math.round(e.moving ? lerp(e.ox, e.tx, e.progress) : e.gx);
  }
  private enemyTileY(e: Enemy): number {
    return Math.round(e.moving ? lerp(e.oy, e.ty, e.progress) : e.gy);
  }

  private enemyPassable(x: number, y: number): boolean {
    return !this.isSolid(x, y) && !this.bombAt(x, y); // walls, crates and bombs block
  }

  private stepEnemies(): void {
    for (const e of this.enemies) {
      if (!e.moving) {
        const target = this.nearestPlayer(e.gx, e.gy);
        if (!target) continue;
        let best: { x: number; y: number } | null = null;
        let bestDist = Infinity;
        for (const d of Object.keys(DIR_VEC) as Dir[]) {
          const nx = e.gx + DIR_VEC[d].dx;
          const ny = e.gy + DIR_VEC[d].dy;
          if (!this.enemyPassable(nx, ny)) continue;
          const dist = Math.abs(nx - target.x) + Math.abs(ny - target.y);
          if (dist < bestDist) {
            bestDist = dist;
            best = { x: nx, y: ny };
          }
        }
        if (!best) continue;
        e.ox = e.gx;
        e.oy = e.gy;
        e.tx = best.x;
        e.ty = best.y;
        e.progress = 0;
        e.moving = true;
      }
      e.progress += ENEMY_SPEED;
      if (e.progress >= 1) {
        e.gx = e.tx;
        e.gy = e.ty;
        e.progress = 0;
        e.moving = false;
      }
    }
  }

  private nearestPlayer(x: number, y: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const px = this.tileX(p);
      const py = this.tileY(p);
      const dist = Math.abs(px - x) + Math.abs(py - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: px, y: py };
      }
    }
    return best;
  }

  private checkEnemyContact(): void {
    for (const e of this.enemies) {
      const ex = this.enemyTileX(e);
      const ey = this.enemyTileY(e);
      for (const p of this.players.values()) {
        if (p.alive && this.tileX(p) === ex && this.tileY(p) === ey) this.killPlayer(p, null, "enemy");
      }
    }
  }

  private killEnemiesInFlame(): void {
    this.enemies = this.enemies.filter((e) => {
      if (this.tick < e.flameImmuneUntil) return true; // still surviving its birth blast
      const ex = this.enemyTileX(e);
      const ey = this.enemyTileY(e);
      return !this.explosions.some(
        (fl) => fl.x === ex && fl.y === ey && fl.maxLife - fl.life < FLAME_LETHAL_TICKS,
      );
    });
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
      isBot: p.isBot,
      immune: p.alive && this.tick < p.immuneUntil,
      deathCause: p.deathCause,
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

  enemies_(): EnemyState[] {
    return this.enemies.map((e) => ({
      id: e.id,
      x: e.moving ? lerp(e.ox, e.tx, e.progress) : e.gx,
      y: e.moving ? lerp(e.oy, e.ty, e.progress) : e.gy,
    }));
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
