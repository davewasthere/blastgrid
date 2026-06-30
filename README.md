# blastgrid

A browser multiplayer Bomberman-like arcade game. TypeScript client + Canvas
renderer, authoritative Node/WebSocket server, single Docker node.

Reconstructed from the original development transcript after the build VM was
lost. See the design notes below for the rules that were tuned during play.

## Run it

```bash
npm install
npm run build
npm start          # http://localhost:3000/
```

Open a tab, enter a name, and **Join the world** — you're playing immediately,
in the same shared arena as everyone else. Open more tabs to add players.
Controls: **WASD / arrows** to move, **Space** to drop bombs.

### Useful scripts

```bash
npm run check            # typecheck (tsc --noEmit)
npm run build            # bundle client + server into dist/
npm run serve:detached   # run the server detached (survives the shell)
npm run serve:status     # is it running?
npm run serve:stop       # stop the detached server
```

### Docker

```bash
docker compose up --build      # http://localhost:3000/
```

## How it works

- **Authoritative server.** Clients send only held input
  (`{ dir, bomb }`); the server owns the whole simulation at **30 TPS** and
  broadcasts a snapshot each tick. One in-memory world, shared by everyone.
- **No lobby.** Enter a name (required, remembered in `localStorage`) and join
  the single shared world — no rooms, no host, no start button. Supports up to
  **100 players**.
- **A world that breathes.** Starts at 21×21 and gains a ring per connected
  player (up to 81×81). Growth is instant (a new player gets room immediately).
  As players leave it **shrinks gradually** — one ring every couple of seconds,
  shaved only from a side whose outer row/column is free of players, so a player
  near the edge holds that side open until they move inward. It never shrinks
  below the size the current count warrants, and resets to the minimum once
  everyone has left. Solid border + pillars on even coordinates, crates fill the
  rest.
- **Camera windowing.** The world is usually larger than the viewport, so the
  client renders a window that smoothly follows your player and clamps at the
  world edges. To keep bandwidth bounded the server sends the (potentially
  large) tile map only when it changes — the client caches it — while entity
  state streams every tick.

## Gameplay rules (as tuned)

- **Grid-committed movement.** You move tile-to-tile; once a move starts you're
  committed to the next tile. Holding a direction chains smoothly across tiles
  with no pause; blocked directions do nothing.
- **Bombs.** 3-second fuse. You can walk off your own bomb; once you've fully
  left the tile it's solid for you too. Can't place on a tile another player
  occupies. Dropping while moving places on the tile you're leaving (first half
  of the move) or entering (second half). Hold Space to keep dropping as you go.
- **Explosions.** Cross-shaped blast, stops at walls and the first crate it
  destroys. Chain reactions detonate neighbours after a short 0.1s delay. Flame
  lingers ~0.9s.
- **Powerups** (25% of crates drop one): **bomb** (more bombs, blue), **flame**
  (bigger blast, red), **speed** (rarer — ~20% of drops, green). All cap at 8 and
  reset to defaults (1 bomb / 2 flame / 0 speed) on death. A powerup sitting on a
  blast tile is destroyed.
- **Death & scoring.** No rounds — when you're blasted you respawn after ~3s at
  a fresh cleared spawn pocket with default gear. Kills are credited to the
  owner of the bomb (a self-blast counts as a death only). A live scoreboard
  tracks kills/deaths for everyone online.

## Sound

Synthesized via Web Audio (no asset files): a retro square-wave explosion sweep
(135→54 Hz) and a little pickup chime. Browsers require one key/click first to
unlock audio.

## Layout

```
src/
  shared/   # types + tunable constants shared by client and server
  server/   # http static server, websocket handling, world simulation (world.ts)
  client/   # net, input, camera renderer, audio, name-entry/game UI
public/     # index.html + styles.css (bundle.js is built into dist/public)
```
