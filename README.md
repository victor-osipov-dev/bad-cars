# RoadRage: Wasteland Survival

Top-down 2D pixel-art survival driving game built with TypeScript, Babylon.js and
Vite. Drive a weaponized car through a post-apocalyptic wasteland, harvest
scrap, fuel and water, build and supply bases, install garage upgrades and
defend your depots against raids.

**Current state: MVP complete — roadmap stages 2–15 accepted.**
Simulation is deterministic at a fixed 60 Hz tick, rendering is a snapshot-only
Babylon layer, and progress survives reloads through three versioned save slots.

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

## Isolated manual-test scenes

Append `?scene=<id>` to the dev-server URL to jump straight into a prepared
situation. Scene mode uses an in-memory save store, hides the save tab, shows a
banner with the scene name and restarts from the exact opening state on `T`
(`F2` also works). The full test card (goal, start state, steps, expected result
and limits) is shown in-game and collapses/expands with `I` or a click on its
header. `P` (or the banner button) opens the scene picker to switch scenes or
return to the normal game. Unknown ids are reported with the list of valid ones.

| URL | Scene | What is ready |
| --- | --- | --- |
| `?scene=driving` | Steering and impacts | Open arena, rocks and a wreck ahead, no enemies or raids |
| `?scene=combat` | Weapons and cover | Three stationary enemies, crates for cover, full ammo |
| `?scene=base` | Harvest, build, garage | Resource nodes, stocked depot, depot + workshop, 240 scrap in the trunk |
| `?scene=raid` | Base defence | Wealthy base with two turrets and a generator, raid starts after 2 s |
| `?scene=tutorial` | Step-by-step tutorial | Four phases, nine short actions, resources and a target outside turret range |

The tutorial is also reachable from the normal game: **МЕНЮ → НАЧАТЬ ОБУЧЕНИЕ**.
It has no test-scene UI at all: no banner, no scene switcher, no test guide and
no restart hotkeys. The long one-line control hint was replaced by this guided
tutorial card.

See `docs/MANUAL_SCENES.md` for the manual test plan of each scene.

## Controls

- `A` / `D` or `←` / `→` — steer; `S` / `↓` / `X` — reverse/brake. Reverse
  works while held even with the **ДВИЖЕНИЕ** toggle off, and does not switch
  the automatic forward throttle on.
- `Shift` — handbrake drift. The car starts parked: the on-screen **ДВИЖЕНИЕ**
  toggle is off by default; press `W` or tap it to enable the automatic
  throttle, and press again to hold the brake. The same switch works on desktop
  and touch.
- `Space` — pause/resume. `Tab` — cycle bases.
- `E` — harvest a resource node or unload at a depot.
- `B` — found a base; `V` — build the next structure.
- `1` / `2` — select a weapon; aim with the mouse; hold mouse / `F` — fire;
  `R` — reload. `3` / `4` — select garage utility slots.
- `G` / `H` — install/remove the selected garage module; `N` / `M` / `,` —
  upgrade engine/chassis/workshop.
- Touch devices: on-screen steering, brake, fire and interact buttons, plus
  weapon-slot and garage-action buttons while the garage is open. Portrait and
  landscape phone layouts are supported; the HUD hides debug telemetry to keep
  controls unobstructed.
- The in-game menu offers save slots, the map, base selection and graphics
  quality (`low` / `medium` / `high`). Opening it pauses the simulation.

## Implemented systems

- Deterministic `Simulation` with seeded RNG and tick-stamped command queues.
- Vehicle physics, smooth top-down camera, chunked procedural world.
- Swept-circle projectile combat, destructible cover, enemies and vehicle HP.
- Resource harvesting/haulage, base construction and per-structure upkeep.
- Patrol/attack AI, sensor contacts, turrets and mines.
- Timed raids with live or remote-resolved outcomes.
- Remote simulation with bounded catch-up and raid reports.
- Garage loadouts, upgrade tracks, reversible stat modifiers and armour.
- Three save slots, migration chain (`v1 → … → v7`), validation, backups and
  auto-save; frame profiler, mesh pools and render-quality presets.

## Project structure

```
src/
  app/       composition root, input adapters and frame profiling
  core/      fixed-step clock, math, seeded RNG (no DOM/Babylon)
  data/      typed gameplay configuration
  platform/  browser-only persistence adapters
  render/    Babylon.js scene, orthographic camera, procedural pixel art
  save/      save contract, validation, migrations and auto-save
  sim/       deterministic simulation (no DOM/Babylon)
  ui/        DOM HUD, touch controls and menu
docs/        GDD, architecture, roadmap, tasks, test plan
e2e/         Playwright smoke tests
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
