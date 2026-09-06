# JET SET RADIO FUTURE

A browser-based, cel-shaded inline-skating game built with [three.js](https://threejs.org/)
and Vite. Skate the streets of Shibuya Terminal, grind every rail in sight, chain
combos, and tag the district before the Rokkaku police catch up with you.

Everything you see and hear is generated at runtime — there are no model, texture,
or audio files in this repository. The city, the character, the graffiti and the
soundtrack are all built from code.

## Play it

The game ships as **one self-contained HTML file**. There is no engine to
download and no runtime to install — everything it needs is inside that file,
and your browser opens it.

### Install on a desktop

**Windows** — open PowerShell and paste:

```powershell
irm https://raw.githubusercontent.com/jacobf329/JSRF/claude/jet-set-radio-future-hd1kfg/tools/install.ps1 | iex
```

**macOS / Linux** — open Terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/jacobf329/JSRF/claude/jet-set-radio-future-hd1kfg/tools/install.sh | bash
```

Either one downloads the game to a folder of its own, puts a **Jet Set Radio
Future** icon on your Desktop with an **Update Jet Set Radio Future** icon next
to it, and starts the game. Nothing is installed system-wide; deleting the
folder and the two icons removes it completely.

If you would rather not paste a command: download the folder from GitHub, then
run `Setup.bat` (Windows) or `./setup.sh` (macOS/Linux) inside it.

### Updates

Launching checks for a new version first and updates itself if there is one —
usually a fraction of a second, and it plays the copy you have if you are
offline. To stop that, put an empty file called `no_update_check.txt` next to
the launcher.

The **Update** icon does the same thing on demand, and also replaces the
launcher scripts themselves (a launcher cannot safely rewrite itself while it is
running, so the automatic update leaves those alone).

### Running from source

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # production bundle in dist/
npm run build:single  # the distributable game/JetSetRadioFuture.html
```

`game/JetSetRadioFuture.html` is a build artifact that is committed on purpose:
it is what the launcher downloads, and committing it is what lets the game
install with no toolchain on the player's machine. Re-run `npm run build:single`
and commit the result whenever the game changes.

## Controls

| Action | Player 1 (keyboard) | Player 2 (shared keyboard) | Gamepad |
| --- | --- | --- | --- |
| Skate | `W` `A` `S` `D` | Arrow keys | Left stick |
| Jump / air trick | `Space` | `Numpad 0`, `Right Shift` | `A` |
| Boost | `Left Shift`, right mouse | `Right Ctrl`, `Numpad 1` | Right trigger / bumper |
| Tag a wall | `E`, `F`, left mouse | `.`, `/`, `Numpad 2` | `X` |
| Look around | Mouse (click to capture) | `Numpad 4` / `6` | Right stick |
| Camera behind | `C` | `Numpad 5` | `Y` |
| Pause | `Esc`, `P` | — | Start |

Global keys: `M` mutes the radio, `]` skips to the next track, `1`–`4` on the
title screen picks the player count, `F3` toggles the perf readout, `F4` toggles
the ink outlines.

## Local multiplayer

Up to four skaters share one screen. Pick the count on the title screen — it
shows which device will drive each seat.

- Player 1 always gets keyboard + mouse.
- Players 2–4 get gamepads in connection order.
- If no gamepad is free, player 2 falls back to a second keyboard scheme
  (arrows + number pad) so two people can play on one keyboard.

Layouts are full screen for one, stacked halves for two, and a 2×2 grid for
three or four; the spare cell in a three-player game shows live standings. Every
skater has their own colours, camera, score, cans and heat, and the walls are
shared — the run ends when the last one is painted and the highest score wins.

## How it plays

- **Momentum matters.** Steering tightens at walking pace and widens at speed, so
  fast lines need to be planned. Boost drains a meter that refills from tricks and
  grinding.
- **Grind everything.** Rails, kerbs, planters, rooftop parapets and the sagging
  wires strung between buildings are all grindable. Jumping off one rail into
  another keeps the chain alive.
- **Wall ride.** Hit a wall with enough speed while pushing into it and you'll run
  along it; jump to kick off.
- **Tag the district.** Fifteen walls need painting. Each costs spray cans, which
  are scattered around the map — the good ones are on rooftops and the expressway.
  Tagging spawns a directional prompt you have to match before the can runs dry.
- **Heat.** Every tag draws police. They patrol, chase and swing; run one down at
  speed and they go over.
- **Combos** bank when you stop doing anything interesting. Getting hit banks them
  at a quarter rate.
- **Split-screen is a race.** The tag count is shared, so the wall you are lining
  up may be gone before you reach it. Solo, a bust pauses the run; with company
  it just costs you 20% of your score and you are back on your feet.

## Assets

Everything you see is generated from code — no model, texture or audio files.
To replace any of it with real assets, see **[`docs/ASSETS.md`](docs/ASSETS.md)**:

```bash
npm run add-model -- ~/Downloads/character.glb   # copy in and check
npm run inspect-model -- public/assets/characters/character.glb
```

The game adopts a model only if it has a skeleton and clips, and otherwise
keeps the procedural rudie — so a missing or unrigged asset is never a crash.

## Architecture

```
src/
  core/       game loop, player slots, input devices, event bus, math helpers
  render/     cel renderer, sky, split-screen layouts, palette and materials
  world/      collision, rails, geometry primitives, batching builder, the level
  player/     skater controller, procedural character rig, chase camera
  gameplay/   graffiti, pickups, score, police, particles, mission rules
  ui/         HUD and menu screens
  audio/      procedural radio and SFX
scripts/      icon generator, single-file bundler
tools/        installers, launcher, updater, headless smoke tests
game/         the distributable single-file build
```

A few pieces worth calling out:

**`render/CelRenderer.js`** renders the scene twice — once with a normal-material
override, once lit with a depth texture attached — then runs a Roberts-cross edge
detect over depth and normals in a composite pass. That draws ink lines on
silhouettes *and* interior creases without the per-mesh cost of inverted-hull
outlines, and it's where the poster grade, boost smear and damage tint live.

Split-screen views share those buffers: each player's camera renders into its own
scissored rect and one composite pass covers the lot, so a second player costs an
extra scene draw rather than an extra post chain. The composite knows where each
pane is, so per-player effects stay inside their own view. One trap worth knowing:
the viewport has to be set on the *render target*, not just on the renderer —
three's shadow pass swaps render targets mid-`render()` and restores the viewport
and scissor from whatever it comes back to.

**`world/Collision.js`** is a static triangle soup in a uniform XZ spatial hash,
with capsule depenetration and Möller–Trumbore raycasts. The whole district bakes
once at load; the skater sub-steps its movement through it so nothing tunnels at
speed.

**`world/Builder.js`** merges level geometry into one mesh per
(material, surface, shadow) combination, which keeps a city of a few thousand
solids inside a couple of hundred draw calls.

**`world/Rail.js`** stores each grind line arc-length parameterised, so grinding is
"advance N metres along the rail" and speed stays consistent through corners.

**`player/Player.js`** is a small state machine — skate, air, grind, wall ride, tag,
hit — over a shared momentum integrator, with coyote time, jump buffering and
ground snapping so stairs don't launch you.

**`player/Tricks.js`** is the trick catalogue — 43 of them, chosen by the
direction held when the button goes down, with repeated presses stepping
through the variants for that direction so a long air is a different string
every time. Each names a pose in `player/Poses.js` and a clip name a rigged
model may provide; the procedural rig blends the pose over the locomotion
animation, so a grab reshapes the arms without flattening the skating stride
underneath it.

**`gameplay/TagArt.js`** draws each piece of graffiti to a canvas from scratch:
bubble letters with wobble, drips, splatter and a backdrop blob. The decal reveals
through a noise-thresholded shader as you nail the input prompts.

**`audio/Audio.js`** is a step sequencer over Web Audio voices — synthesised kick,
snare, hat, filtered bass, chord stabs and a delayed lead — plus one-shot SFX and
two looping sources (grind whir, wind) that track the skater's speed.

## Testing

`tools/smoke.mjs` boots the built game in headless Chromium, plays through
skating, grinding and a full tag, spawns police, and reports state plus any console
errors alongside screenshots.

```bash
node tools/smoke.mjs scratch
```

Note that it waits on *game* time rather than wall-clock time: the loop clamps its
delta, so a software renderer advances the simulation far more slowly than real time.

## Credits

An original homage — no assets from the Sega game are used or reproduced here.
