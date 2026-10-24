# RoadRage: Wasteland Survival

Top-down 2D pixel-art survival driving game built with TypeScript, Babylon.js and
Vite. You drive a weaponized car through a post-apocalyptic wasteland, gather
resources, build bases and defend them against raids.

**Current state: stage 2 complete — driving on a test range.**
The player car accelerates automatically, steers with keyboard or touch,
drifts with the handbrake, collides with props and is followed by a smooth
top-down camera.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e   # builds, then runs Playwright smoke tests
npm run check      # typecheck + unit + build + e2e
```

The scripts set `NODE_OPTIONS=--max-old-space-size=1024` because Babylon's type
definitions and production build exceed the default Node heap in constrained
environments. Playwright requires `npx playwright install chromium` and, on
Linux, `npx playwright install-deps chromium` once.

## Controls (stage 2)

- `A` / `D` or `←` / `→` — steer.
- `S` / `↓` — brake (the car always accelerates by itself).
- `Shift` — handbrake drift.
- `Space` — pause/resume simulation.
- Touch devices: on-screen ◀ ▶ and ТОРМОЗ buttons.
- Pause button — same as Space, useful on touch devices.

## Project structure

```
src/
  app/      composition root and frame loop
  core/     fixed-step clock, math, seeded RNG (no DOM/Babylon)
  data/     typed gameplay configuration
  render/   Babylon.js scene, orthographic camera, procedural pixel art
  sim/      deterministic simulation (no DOM/Babylon)
  ui/       DOM HUD
docs/       GDD, architecture, roadmap, tasks, test plan
e2e/        Playwright smoke tests
```

Simulation and rendering are strictly separated. Gameplay state advances only
through `Simulation.step()` at a fixed 60 Hz tick, while Babylon renders
snapshots. See `docs/ARCHITECTURE.md` for the full design.

## Documentation

- [Original brief](docs/BRIEF.md)
- [Game design](docs/GDD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Tasks and acceptance criteria](docs/TASKS.md)
- [Test plan](docs/TEST_PLAN.md)
- [Progress log](PROGRESS.md)
- [Working rules for agents](AGENTS.md)
