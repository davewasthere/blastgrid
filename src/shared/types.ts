import type { Dir, Tile } from "./constants.js";

// ---- Network: client -> server ----

export interface JoinMsg {
  type: "join";
  name: string;
}

// Held-input model: client reports the currently held direction (or null) and
// whether the bomb key is held. seq is for debugging/echo only.
export interface InputMsg {
  type: "input";
  seq: number;
  dir: Dir | null;
  bomb: boolean;
}

export type ClientMsg = JoinMsg | InputMsg;

// ---- Network: server -> client ----

export interface WelcomeMsg {
  type: "welcome";
  youId: string;
}

export interface ErrorMsg {
  type: "error";
  message: string;
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  // Smooth render position in world tile units.
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  alive: boolean;
  bombs: number; // capacity
  flame: number; // blast radius
  speed: number; // speed level
  kills: number;
  deaths: number;
}

export interface BombState {
  id: number;
  x: number;
  y: number;
  flame: number;
  fuse: number;
}

export interface ExplosionCell {
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

export interface PowerupState {
  id: number;
  x: number;
  y: number;
  kind: "bomb" | "flame" | "speed";
}

export interface SnapshotMsg {
  type: "snapshot";
  tick: number;
  worldW: number;
  worldH: number;
  mapVersion: number;
  // The full tile array is only included when it changed since this client last
  // saw it (grow / crate destroyed). Otherwise the client reuses its cache.
  map: Tile[] | null;
  players: PlayerState[];
  bombs: BombState[];
  explosions: ExplosionCell[];
  powerups: PowerupState[];
}

export type ServerMsg = WelcomeMsg | ErrorMsg | SnapshotMsg;
