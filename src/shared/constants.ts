// Core tunables for blastgrid. Kept in one place so client and server agree.

export const TICK_RATE = 30; // ticks per second (server simulation)

// World: a single shared arena that grows as players connect. Grow-only during
// a session so the ground never shifts under live players; it resets to the
// minimum once empty. Dimensions are kept odd so the pillar lattice lines up.
export const MIN_WORLD = 21;
export const MAX_WORLD = 81; // comfortably holds ~100 players
export const WORLD_STEP = 2; // world side grows by this per extra player
export const MAX_PLAYERS = 100;
// As players leave, the world shrinks back toward the size the current count
// warrants — one wall (side) at a time, every this-many ticks, and only a wall
// with no living player within SHRINK_SAFE_DIST tiles of it.
export const SHRINK_INTERVAL_TICKS = TICK_RATE * 2;
// A wall only closes if the nearest player is at least this many tiles away.
// Kept larger than the on-screen view radius (~9.5 tiles) so the one-tile
// "hop" as a wall closes always happens off-screen — nobody sees it move.
export const SHRINK_SAFE_DIST = 12;

// Client viewport (in tiles). The world can be far larger; the camera windows
// it and follows the player.
export const VIEW_W = 19;
export const VIEW_H = 15;
export const TILE = 40; // px per tile on the client

// Bombs
export const BOMB_FUSE_TICKS = 90; // 3.0s at 30 TPS
export const CHAIN_DELAY_TICKS = 3; // 0.1s before a chained bomb detonates
export const FLAME_LIFETIME_TICKS = 27; // ~0.9s flame/explosion visibility
// Only the initial bright blast kills; the rest of the flame's life is a
// harmless fading tail you can walk through.
export const FLAME_LETHAL_TICKS = 9; // ~0.3s lethal window after a blast appears

// Movement: grid-committed. progress 0..1 across a tile per tick.
export const BASE_MOVE_SPEED = 0.16; // ~6.25 ticks per tile at speed 0
export const SPEED_STEP = 0.035; // added per speed level

// Powerups
export const CRATE_POWERUP_CHANCE = 0.25; // chance a destroyed crate drops one
export const SPEED_DROP_SHARE = 0.2; // of those drops, share that are speed
export const UPGRADE_CAP = 8; // max bombs / flame / speed level

// Player defaults (also the reset values on death / respawn)
export const DEFAULT_BOMBS = 1;
export const DEFAULT_FLAME = 2;
export const DEFAULT_SPEED = 0;

// Scoring (cumulative per player; persists across deaths).
export const SCORE_BOMB = 1; // dropping a bomb
export const SCORE_CRATE = 5; // blowing up a crate (credited to the bomb's owner)
export const SCORE_POWERUP = 20; // grabbing a powerup
export const SCORE_KILL = 100; // killing another player
export const STREAK_HIGHLIGHT = 2; // kill streak at which a player is "on fire" (🔥 in scoreboard)
export const STREAK_BONUS_MIN = 3; // streak at which bonus points + a red aura kick in
export const SCORE_STREAK_BONUS = 25; // extra per kill while on a streak, scaling with length

// Respawn
export const RESPAWN_TICKS = TICK_RATE * 3; // dead for 3s, then respawn
export const SPAWN_IMMUNE_TICKS = TICK_RATE * 3; // invulnerable for 3s after spawning

// Bots: server-driven players that are always present. Count is env-overridable
// (BOT_COUNT) in the server; this is the default.
export const BOT_COUNT = 2;

// Chaser enemies: a powerup blown up by an explosion becomes a slow dark block
// that hunts the nearest player. Blocked by bombs/walls; kills on contact;
// destroyed if caught in a blast.
export const ENEMY_SPEED = 0.07; // tiles/tick — slower than a player's 0.16
export const ENEMY_MAX = 24; // safety cap on simultaneous chasers

// Crate fill: probability an interior (non-pillar) tile starts as a crate.
export const CRATE_FILL_CHANCE = 0.72;

// Crate regeneration: crates slowly grow back so powerups keep flowing and the
// arena never goes stale once everything's been blown up.
export const CRATE_REGEN_INTERVAL_TICKS = TICK_RATE; // attempt roughly once a second
export const CRATE_TARGET_FRACTION = 0.5; // keep ~half the open interior as crates
export const CRATE_REGEN_BATCH = 3; // max crates added per attempt (gradual)
// Don't regrow crates within this Chebyshev radius of a living player, so nobody
// gets boxed in by regen (radius 5 => an 11x11 exclusion around each player).
export const CRATE_REGEN_SAFE_RADIUS = 5;

// Distinct player colors; spawn assigns the first unused one (wraps past 8).
export const PLAYER_COLORS = [
  "#4fc3f7", // blue
  "#ff7043", // orange
  "#9ccc65", // green
  "#ba68c8", // purple
  "#ffd54f", // yellow
  "#f06292", // pink
  "#4db6ac", // teal
  "#a1887f", // brown
  "#7986cb", // indigo
  "#ff8a65", // coral
  "#aed581", // lime
  "#4dd0e1", // cyan
];

export type Tile = 0 | 1 | 2; // 0 empty, 1 solid wall, 2 crate
export const TILE_EMPTY: Tile = 0;
export const TILE_WALL: Tile = 1;
export const TILE_CRATE: Tile = 2;

export type Dir = "up" | "down" | "left" | "right";
export type PowerupKind = "bomb" | "flame" | "speed";
