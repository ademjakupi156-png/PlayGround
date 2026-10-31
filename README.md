# THE HOLLOW — 20 Pieces

A first-person browser horror game. You crash on a forest road, wake beside the wreck,
and have to recover twenty scattered car parts while something very tall follows you
between the trees.

Everything is procedural — forest, road, wreck, wolf, and audio. There are no external
assets or network requests, and no build step.

## Run

ES modules need to be served over HTTP:

```bash
python3 -m http.server 3002
# then open http://localhost:3002
```

## Controls

| Desktop | |
| --- | --- |
| WASD / arrows | Walk |
| Shift | Sprint (uses stamina) |
| Ctrl | Crouch (quiet) |
| F | Torch (uses battery) |
| Q | Sense the nearest part |
| Esc | Pause |

On touch devices a virtual stick, drag-to-look, and RUN / TORCH / SENSE buttons appear
automatically. Layouts adapt to portrait and landscape and respect safe-area insets.

## Rules

- Find all 20 parts, then return to the wreck to repair the car.
- Sprinting, torchlight, and staring draw the wolf in. It can be slowed by the beam.
- When it catches you, you keep the parts you have already found and wake up back at the car.

## Structure

- `index.html` — screens, HUD, mobile controls
- `styles.css` — interface, responsive and safe-area rules
- `src/main.js` — state machine, intro, pickups, repair, endings, input
- `src/world.js` — terrain, road, forest, wreck, parts
- `src/wolf.js` — wolf model and AI, close-up jumpscare
- `src/player.js` — movement, camera, torch, touch
- `src/audio.js` — synthesized ambience and effects
- `src/util.js` — noise, geometry, texture helpers
- `vendor/three.module.js` — vendored Three.js r160
- `assets/fonts/` — self-hosted fonts
