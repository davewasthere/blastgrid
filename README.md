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

Open two browser tabs, enter a name, create/join the same room, and have the
host press **Start**. Controls: **WASD / arrows** to move, **Space** to drop
bombs.

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
  broadcasts a snapshot each tick. Rooms are in-memory.
- **Lobby first.** You land on a room browser, not a map. Pick a name (required,
  remembered in `localStorage`), join a room or create one. The room creator is
  host and starts the round; if the host leaves, host passes to another player;
  an empty room is deleted.
- **Map.** 15×13 arena, solid border + pillars on even coordinates, crates fill
  the rest (spawn corners kept clear).

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
  reset to defaults (1 bomb / 2 flame / 0 speed) on death or round reset. A
  powerup sitting on a blast tile is destroyed.
- **Win.** Last player standing wins; results show for a few seconds, then the
  room returns to the lobby for a rematch.

## Sound

Synthesized via Web Audio (no asset files): a retro square-wave explosion sweep
(135→54 Hz) and a little pickup chime. Browsers require one key/click first to
unlock audio.

## Layout

```
src/
  shared/   # types + tunable constants shared by client and server
  server/   # http static server, websocket rooms, game simulation
  client/   # net, input, renderer, audio, lobby/game UI
public/     # index.html + styles.css (bundle.js is built into dist/public)
```
