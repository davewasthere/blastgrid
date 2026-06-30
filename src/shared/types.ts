import type { Dir, PowerupKind, RoomPhase, Tile } from "./constants.js";

// ---- Network: client -> server ----

export interface JoinMsg {
  type: "join";
  room: string;
  name: string;
}

export interface LeaveMsg {
  type: "leave";
}

export interface StartMsg {
  type: "start";
}

// Held-input model: client reports the currently held direction (or null) and
// whether the bomb key is held. seq is for debugging/echo only.
export interface InputMsg {
  type: "input";
  seq: number;
  dir: Dir | null;
  bomb: boolean;
}

export interface ListRoomsMsg {
  type: "listRooms";
}

export type ClientMsg = JoinMsg | LeaveMsg | StartMsg | InputMsg | ListRoomsMsg;

// ---- Network: server -> client ----

export interface RoomSummary {
  id: string;
  players: number;
  phase: RoomPhase;
  hostName: string;
}

export interface RoomListMsg {
  type: "rooms";
  rooms: RoomSummary[];
}

export interface JoinedMsg {
  type: "joined";
  room: string;
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
  // Smooth render position in tile units (e.g. 1.0, 1.5 ...).
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  alive: boolean;
  bombs: number; // capacity
  flame: number; // blast radius
  speed: number; // speed level
  isHost: boolean;
}

export interface BombState {
  id: number;
  x: number; // tile
  y: number; // tile
  flame: number;
  fuse: number; // ticks remaining (for client throb timing)
}

export interface ExplosionCell {
  x: number;
  y: number;
  life: number; // ticks remaining
  maxLife: number;
}

export interface PowerupState {
  id: number;
  x: number;
  y: number;
  kind: PowerupKind;
}

export interface SnapshotMsg {
  type: "snapshot";
  tick: number;
  phase: RoomPhase;
  countdown: number; // seconds remaining when in countdown
  hostId: string;
  winnerName: string | null;
  map: Tile[]; // row-major, length MAP_WIDTH*MAP_HEIGHT
  width: number;
  height: number;
  players: PlayerState[];
  bombs: BombState[];
  explosions: ExplosionCell[];
  powerups: PowerupState[];
}

export type ServerMsg =
  | RoomListMsg
  | JoinedMsg
  | ErrorMsg
  | SnapshotMsg;
