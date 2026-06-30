// Core tunables for blastgrid. Kept in one place so client and server agree.

export const TICK_RATE = 30; // ticks per second (server simulation)

// Map: classic odd-sized arena with a solid border and solid pillars on even
// interior coordinates. 15 wide x 13 tall.
export const MAP_WIDTH = 15;
export const MAP_HEIGHT = 13;

// Bombs
export const BOMB_FUSE_TICKS = 90; // 3.0s at 30 TPS
export const CHAIN_DELAY_TICKS = 3; // 0.1s before a chained bomb detonates
export const FLAME_LIFETIME_TICKS = 27; // ~0.9s flame/explosion visibility

// Movement: grid-committed. progress 0..1 across a tile per tick.
export const BASE_MOVE_SPEED = 0.16; // ~6.25 ticks per tile at speed 0
export const SPEED_STEP = 0.035; // added per speed level

// Powerups
export const CRATE_POWERUP_CHANCE = 0.25; // chance a destroyed crate drops one
export const SPEED_DROP_SHARE = 0.2; // of those drops, share that are speed
export const UPGRADE_CAP = 8; // max bombs / flame / speed level

// Player defaults (also the reset values on death / round reset)
export const DEFAULT_BOMBS = 1;
export const DEFAULT_FLAME = 2;
export const DEFAULT_SPEED = 0;

// Round lifecycle
export const COUNTDOWN_TICKS = TICK_RATE * 3; // 3s countdown before play
export const RESULTS_TICKS = TICK_RATE * 5; // show results for 5s, then reset

// Crate fill: probability an empty interior tile starts as a crate.
export const CRATE_FILL_CHANCE = 0.72;

// Distinct player colors; spawn assigns the first unused one.
export const PLAYER_COLORS = [
  "#4fc3f7", // blue
  "#ff7043", // orange
  "#9ccc65", // green
  "#ba68c8", // purple
  "#ffd54f", // yellow
  "#f06292", // pink
  "#4db6ac", // teal
  "#a1887f", // brown
];

// Spawn corners (tile coords), assigned first-unused so two players never share.
export const SPAWN_CORNERS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 1, y: 1 },
  { x: MAP_WIDTH - 2, y: MAP_HEIGHT - 2 },
  { x: MAP_WIDTH - 2, y: 1 },
  { x: 1, y: MAP_HEIGHT - 2 },
];

export type Tile = 0 | 1 | 2; // 0 empty, 1 solid wall, 2 crate
export const TILE_EMPTY: Tile = 0;
export const TILE_WALL: Tile = 1;
export const TILE_CRATE: Tile = 2;

export type Dir = "up" | "down" | "left" | "right";
export type PowerupKind = "bomb" | "flame" | "speed";
export type RoomPhase = "waiting" | "countdown" | "playing" | "results";
