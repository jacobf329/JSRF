# JET SET RADIO FUTURE

A browser-based, cel-shaded inline-skating game built with [three.js](https://threejs.org/)
and Vite. Skate the streets of Shibuya Terminal, grind every rail in sight, chain
combos, and tag the district before the Rokkaku police catch up with you.

Everything you see and hear is generated at runtime — there are no model, texture,
or audio files in this repository. The city, the character, the graffiti and the
soundtrack are all built from code.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # production bundle in dist/
npm run preview  # serve the production bundle
```

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / left stick | Skate |
| `Space` / `A` | Jump — press again in the air to pull a trick |
| `Shift` / right trigger | Boost |
| `E` / `X` | Tag the wall in front of you, then match the arrows |
| Mouse / right stick | Look around (click the canvas to capture the mouse) |
| `C` / `B` | Snap the camera behind you |
| `Esc` / Start | Pause |
| `M` | Mute the radio |
| `]` | Next radio track |
| `F3` / `F4` | Toggle the perf readout / the ink outlines |

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

## Architecture

```
src/
  core/       game loop, input, event bus, math helpers
  render/     cel renderer, sky, palette and toon materials
  world/      collision, rails, geometry primitives, batching builder, the level
  player/     skater controller, procedural character rig, chase camera
  gameplay/   graffiti, pickups, score, police, particles, mission rules
  ui/         HUD and menu screens
  audio/      procedural radio and SFX
tools/        headless Playwright smoke test
```

A few pieces worth calling out:

**`render/CelRenderer.js`** renders the scene twice — once with a normal-material
override, once lit with a depth texture attached — then runs a Roberts-cross edge
detect over depth and normals in a composite pass. That draws ink lines on
silhouettes *and* interior creases without the per-mesh cost of inverted-hull
outlines, and it's where the poster grade, boost smear and damage tint live.

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
