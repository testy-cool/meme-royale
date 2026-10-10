# Lessons

The worker appends short, durable lessons here: gotchas, decisions, and deploy steps.

## M1 (2026-10-09)

### Deploying to playground-voidxd
- The playground repo's `.gitignore` denies everything except an allowlist. Git tracks the
  apartment files, the `gemma2-*` Worker files (`src/gemma2-worker.ts` is the entry) and
  `wrangler.jsonc`, but not `src/index.ts`, most of `public/`, or `package.json`. A fresh
  worktree cannot build until you copy those in:
  `git ls-files -o -i --exclude-standard src public`, plus package.json, package-lock.json,
  tsconfig.json, and a symlink to the main checkout's node_modules.
- Never deploy from the main checkout. It holds uncommitted apartment edits that are not live,
  and a deploy there overwrites the live apartment assets (that already happened on 2026-10-07).
  Production = HEAD for tracked files + the main checkout's untracked files. Proof used for M1:
  the live script (`GET .../workers/scripts/playground-voidxd/content/v2`) was byte-identical
  to `wrangler deploy --dry-run --outdir` from the worktree, and the public
  `/george-apartment-01/*` files hash-matched.
- Deploy in two steps: `wrangler versions upload` prints exactly which assets are new. Check
  that only `meme-royale/*` files appear, then `wrangler versions deploy <id>@100% -y`.
- Every game update: `npm run build`, replace `public/meme-royale/` completely (file names are
  hashed), commit on the worktree branch `meme-royale`, then upload and deploy as above.
  Afterwards fast-forward master (see "Merging" below) so master matches production.
- Before each upload, check that nobody else deployed since (`wrangler deployments list`) and
  that the worktree's copies of the untracked runtime files still match the main checkout
  (`cmp` each file from `git ls-files -o -i --exclude-standard src public`). If either changed,
  re-sync before uploading, or the deploy rolls someone's work back.
- The wrangler OAuth token that works is in `~/.wrangler/config/default.toml`.
  `~/.config/.wrangler/` holds a stale one.
- With `routes` set, wrangler 4.103 defaults `workers_dev` to false, so deploys keep
  workers.dev off. Keep it that way: workers.dev would bypass Cloudflare Access.
- Cloudflare returns 403 to Python's default `Python-urllib` User-Agent. Send any other UA.

### Verifying in the browser
- playground.voidxd.cloud is behind Cloudflare Access ("WhatsApp Friends" OIDC broker or an
  email code). The user's Chrome (CDP port 9336) has no Access session, so live checks of
  `/meme-royale` need a one-time login. Without one, test the exact build with
  `wrangler dev --local` in the worktree.
- `BU_CDP_URL` in ~/.bashrc points at a dead port 9333. Use
  `BU_CDP_URL=http://127.0.0.1:9336 browser-harness ...`.
- Chrome pauses requestAnimationFrame in background tabs, so FPS checks need
  `activate_tab`. Close the tab afterwards; that also releases pointer lock.
- `npx vite preview &` records npx's PID, and killing it leaves the server running. Start
  `node_modules/.bin/vite preview` directly.
- `window.memeRoyale` exposes fps, state, fighters, player, fx and camera for browser checks.
  Setting `fx.freeze` to a large number pauses the simulation but keeps rendering, which is
  handy for posed screenshots.

### three.js / game
- three r186 removed PCFSoftShadowMap and logs a warning. Use PCFShadowMap.
- Chrome can report one huge mouse delta right after pointer lock engages. Ignore deltas
  over 300 px, or the camera snaps to the floor.
- Fighters step at a fixed 120 Hz, so a 35 m/s launch moves less than half a body width per
  step and cannot tunnel through a one-block wall. M1 claimed this for all physics, but debris
  moved once per rendered frame (up to 0.05 s) and sank into the ground. It now moves in hops
  of at most 0.2 blocks.
- Hit-stop on every bot-vs-bot hit made the game stutter. Full hit-stop applies only when the
  player is involved; distant bot fights get a short one or none.

### Making /meme-royale public (Cloudflare Access) — blocked 2026-10-10
- Access for playground.voidxd.cloud is managed only in the Cloudflare dashboard:
  https://dash.cloudflare.com/60aae2b0f601454b2f1a949e01882630/one/access-controls/apps
- The wrangler OAuth token cannot see Access. `GET /accounts/<id>/access/apps` returns an empty
  list and the zone-level endpoint returns error 10000. There is no other Cloudflare API token on
  this machine, so neither the token nor curl shows how `/stonks` and `/george-apartment-01` are
  made public.
- Vlad's Chrome (CDP 9336) is not signed in to dash.cloudflare.com. CDP 9335 belongs to the
  NanoClaw agent's Chrome profile; its launcher refuses cross-profile use, so do not drive it
  without permission.
- Once someone signs in, open the apps covering `/stonks` and `/george-apartment-01` and mirror
  their setup for `playground.voidxd.cloud/meme-royale` and `/meme-royale/*`. The likely shape is
  a self-hosted app per path with a Bypass policy, but nobody has seen it yet. Change nothing else.
- Signed-out proof: `curl -s -o /dev/null -w "%{http_code}" https://playground.voidxd.cloud/meme-royale/`
  returns 302 to voidxd.cloudflareaccess.com while gated, and 200 once the bypass works. The JS
  asset under `/meme-royale/assets/` must return 200 too.

### Merging the playground branch `meme-royale` into master
- master is checked out in the main checkout (`/home/vlad/Work/playground-voidxd`), next to
  someone's uncommitted apartment edits. Moving master from the worktree (`git update-ref`) changes
  the main checkout's HEAD but not its index or files. `git status` there then shows the merge as
  staged reversals, and the next commit made there silently undoes it. The main checkout's files
  would also still lack the game, so a deploy from there drops `/meme-royale` anyway. Do not do it.
- The safe merge needs the main checkout owner's OK:
  `git -C /home/vlad/Work/playground-voidxd merge --ff-only meme-royale`. It writes only
  `.gitignore`, `src/gemma2-worker.ts` and `public/meme-royale/*`, none of which overlap the
  apartment edits; git aborts instead of overwriting if they ever do.
- Vlad approved that exact command on 2026-10-10. Run it and nothing else in that checkout: no
  stash, add, commit or checkout. Record `git status --porcelain` and a hash of `git diff` before
  and after; both stayed identical at 24ca926 and at b423725.

## M1 review fixes (2026-10-10)

### Physics and combat
- Every position change outside `stepBody` must go through `sweep()`. Fighter separation wrote
  positions directly and nudged a body 0.03 into a wall. The next vertical resolve then "landed"
  it on the highest block it overlapped, 2 blocks per step: onto the roof in 42 ms.
- An axis resolver must ignore blocks the body already overlapped before the move: always when
  moving up or down, and sideways unless the block lies ahead. Otherwise it rescues a stuck
  body to the top or the far side of the wall.
- Punches need line of sight. Test at chest height and at head height and accept either, so a
  ledge underfoot does not block a punch downward. Bots use the same check before they stop
  to punch; otherwise they stand at a wall punching a target on the other side.
- The camera needs a box test sized to the near plane's reach (0.22 for near 0.1, fov 70,
  2:1 aspect), never a minimum distance. A 1.5 minimum put it inside walls.
- The punch already accepts targets up to 66 degrees off the facing, so aim assist that only
  snaps facing would change nothing. The lock-on (20 degrees either side of the camera's aim)
  also extends reach from 2.7 to 3.4 for the locked target, which is what lands on Nyan Cat.
- Reduce motion scales the shake amplitude, not trauma. Amplitude grows with trauma squared,
  so a quarter of the trauma would leave about 6% of the shake.
- There were no FOV kicks to turn off: the FOV is a constant 70.

### Probing without a browser
- `npm run probe` replays the reviewers' reproductions in Node with the game's own modules
  and exits 1 on any FAIL. It loads them with Vite's `runnerImport`, because the imports are
  extensionless and Node's own type stripping cannot resolve them. A do-nothing canvas stands
  in for the textures the modules paint when they load.
- To show a probe catches the bug, run it against the old commit in a throwaway
  `git worktree add --detach` with node_modules symlinked, then remove the worktree.
- Under `vite` dev, `await import('/meme-royale/src/combat.ts')` in the page returns the same
  module instance the game uses, so a browser check can call `canPunch` on live fighters. That
  is how the "missed" punches in the scripted playtest turned out to be correct wall blocks.

### Local servers on this machine
- Port 4173, vite preview's default, belongs to an unrelated long-running
  `python3 -m http.server`. Leave it alone and use `--port 4319 --strictPort`.
- `npx wrangler dev` runs npm → sh → node → workerd. Killing the recorded npm PID leaves the
  rest serving; kill the whole tree (`pgrep -P`).
- `Emulation.setEmulatedMedia` with `prefers-reduced-motion` tests the reduce-motion default.

## M2 boss, storm and match loop (2026-10-10)

### Match length is a tuning problem: simulate it headless
- `Match` holds the whole simulation with no DOM, so the probe can run bot-only matches at 60
  steps a second in about a second each. Logging every knockout's cause and position found each
  problem below in minutes; a browser play-through would have needed hours.
- With permanent eliminations, M1's knockback ended matches in under a minute, mostly by ring-outs.
  What fixed it: bot-vs-bot hits launch less far (8 instead of 15) and do 7 damage (punches
  involving the player are unchanged); tumbling bodies grind to a halt faster on the ground;
  bots ignore targets near the island's edge, wander around the village, lose interest after a few
  seconds of fighting, run when below 30 HP, and recover 2.5 HP a second after 8 s without damage.
- The boss was the top killer. Each quake stunned bots just long enough for the next landing to
  crush them. Fixes: quake throws go up, not out; the next landing is chosen at the start of
  the pause and shown on the ground, about 3 s of warning; bots treat anything within 22 blocks of
  the landing as danger, because the tank's corners reach 21; it stops to sing every 4 to 6 hops;
  and it flushes itself away after 65 s of rampage.
- A next circle of radius 0 made every bot "outside" it, so in the final stage they all walked to
  the centre point and none fought. Once the next circle is tiny, bots stay inside the current one.
- Result over 24 bot-only matches: median 3:40, 20 of 24 between 2:56 and 3:55.

### Rendering the colossus
- Build a static voxel model as one mesh of only the faces that touch air, not an InstancedMesh of
  whole cubes. The 3,000-cube version cost 10 fps on the UHD 620 while it moved. The face mesh is
  8,700 triangles and costs nothing measurable.
- A voxel surface must not receive shadows: each step shades the next, a checkerboard.
- Shaded sides and undersides go blue-grey and olive under the hemisphere light. A faint emissive
  keeps porcelain white and skin from going dark brown.
- `clippingPlanes` at ground level with `renderer.localClippingEnabled` hides the body while it
  rises through the ground. Set `clipShadows` too, or its underground shadow shows.
- To see a white model through pale fog, cap the fog's share in its materials: replace
  `#include <fog_fragment>` in `onBeforeCompile` and multiply `fogFactor` by 0.4.
- Run any blast that pushes loose chunks before the stomp creates new ones, or the new debris is
  thrown twice, up to 45 blocks.
- Lit dust looks like floating rocks. Dust must be unlit (MeshBasicMaterial).
- Chunk pools sized for the biggest stomp should upload only their live range each frame
  (`addUpdateRange(0, n * 16)` on `instanceMatrix`, then `needsUpdate`).
- A camera placed by angle blending can hit opposite vectors. Blend yaw and pitch instead.
- Any orbiting spectator camera must clear the boss's full height (44 blocks mid-hop), or it ends
  up inside the bowl.

### Browser checks for timed events
- Screenshots take about a second each through browser-harness, so a "mid-rise" shot can land
  after the camera beat is over. Pose shots instead: a requestAnimationFrame watcher sets
  `fx.freeze` the moment the condition holds, and the script takes the shot and then unfreezes.
- A promise that runs longer than the harness's call timeout kills the call. Store the result
  on `window` and poll for it.
- This machine is often loaded (load average 10, swap in use), so frame rates are noisy. Compare
  on and off in the same run, several times, before believing a difference.
- Never clear output directories with `rm`: a safety hook blocks it. Give each run its own
  timestamped directory.
- `memeRoyale.isSolid` exists so scripts can pick camera spots with a clear view.

## M2 review fixes (2026-10-10)
- A scan over a shape that turns must take its bounds from the turned shape. The stomp scanned 18
  blocks around its centre, enough at 0 or 90 degrees, but at 45 degrees the tank's corners reach
  21.5 blocks out and 92 blocks survived. Turn the shape's corners (and the oval's extents) into a
  box, then keep the exact footprint test inside it. Probe every heading, not only the easy one.
- Knockouts that land in the same step need an order before they get places. Count down from the
  fighters still in plus this step's knockouts, the player first on a tie, so a loser is never #1.
- A posed screenshot does not prove an automatic camera shows the payoff. Sample the camera's angle
  off the target every frame, and project the model's vertices with `Vector3.project(camera)` to
  check it is all in frame. The probe does both headlessly with the real `Player.updateCamera`.
- To frame a 37-block model from 26 blocks away (vertical FOV 70), aim at the middle of what stands
  above the ground, not at the head; aiming at the head cut off its base.
- Reduce motion covers every camera move the player did not make: the orbits behind the menus too,
  not only shake and tilt.
- CDP `Input.dispatchMouseEvent` moves under pointer lock arrive with `movementX`, so a browser
  check can test "a mouse move cancels the shot" with real input.
- To make a random spawn choice deterministic in the probe, stub `Math.random` around the one call.

## M3 character kits, part 1 (2026-10-10)

### The kit system
- A character is one module in `src/kits/` whose default export is a `Kit`: body size, movement
  (walk, fly or roll), stats, a model builder and per-fighter powers with a bot `wants()`. The roster
  finds them with `import.meta.glob('./kits/*.ts', { eager: true })`, so adding one touches nothing
  else. The probe checks that no shared module names a character.
- Shared behaviour is data on the fighter, not per-character code in combat: `busy` (a power steers
  the body), `stun` and `flat` (pancaked), `timeScale` (the cow's own slow motion: scale the
  integration step, keep timers on world time), `ram` (bowl over whoever you hit above a speed),
  `friends` (allies), `heldBy`/`lifting`. `hurt()` and `hit()` refuse allies and self-hits.
- Flyers must not shove other bodies. Nyan Cat pushed its target along in front of it, so its trail
  never touched anyone.

### Probing
- Vite's `runnerImport` deadlocks on a circular import between probe modules. Keep shared helpers in
  a module both import (`scripts/probe-lib.ts`).
- `import.meta.glob(..., { query: '?raw', import: 'default', eager: true })` lets the probe read the
  game's sources as text with no Node types.
- Put the whole probe under a fixed seed, and give each scene its own too: two runs are now
  byte-identical. Seeded runs over several spawn spots exposed real bugs a single random spot hid.
- Write probe output to a file. A killed process lost its piped output, and in `a && OUT=...; grep x $OUT`
  a failed `a` leaves `$OUT` empty, so grep reads stdin and hangs. Quote paths and give grep `< /dev/null`.

### Bots getting about
- `respawn()` must clear `grounded` and `blocked`. A bot respawned in mid-air read the last match's
  flags on its first frame and hopped in mid-air (1 run in 40).
- A rolling ball bounces off a wall instead of pressing on it, so a "blocked for 0.3 s" timer never
  fires. Count bumps. Its collision box must also be under 1 block wide, or 1-block gaps are walls.
- Random left/right detours could not get a bot out of the stone wall and hay corner east of the
  village. When stuck, bots now run a breadth-first search over the island's columns (`src/paths.ts`)
  and follow it, skipping ahead only where the body's whole footprint, not its centre line, is clear.
- Hop only up a one-block step: hopping into a two-high wall just wastes the bot's time in the air.

### Posed browser screenshots
- Arm the freeze watcher before the action and wait afterwards. A helper that armed and waited in one
  call blocked the action until Gigachad's arms got tired and threw on their own.
- `memeRoyale.shot = { from, at }` holds the camera for a screenshot. Pick `from` by searching yaws
  around the subject for a clear line of sight: the chase camera ended up behind trees and through
  the well. Hide the player's model only when the player is not the subject.
- Hold bystanders with `stun` (it does not change how they look), and look bots up by `kit.name`:
  Wojak's display name changes when he snaps.
- The bow's crosshair sits over the right shoulder, parallel to the player's facing, so a script must
  aim from the camera's position to put the crosshair on a target.
- A thrown body starts inside the thrower's box and bowled him over, halving the throw. The browser
  caught it; the probe now checks the throw speed and the thrower's health.

### Balance
- Allies drawn as a pair dominated: Orang's rolling hits and Meme Man's crater ended 3 of 16
  bot-only matches before 2:00. Tallying knockouts by killer and verb over 16 to 24 seeded matches
  pointed straight at them. Softer rolling hits (5 damage, needing speed 6), a rarer, weaker strike
  and crater, and allies ganging up less brought the median back to about 3:20.

## M3 part 1 review fixes (2026-10-10)
- Anything a kit puts in the world outside its fighter (the cow's ghosts, Meme Man's charts and
  scorch mark, a carried block) needs a way to go when the fighter does. A benched or knocked-out
  fighter is not stepped or rendered, so effects that age in its step or animation froze in place
  and lasted into the next match. `Gear.clear()` now runs on `hide()` and `respawn()`, and each kit
  puts its things away there without letting them act.
- Clear projectiles after everyone is respawned, not before. Respawning the player interrupted the
  grab, which dropped its block as a new projectile into the fresh match.
- A function handed a module's scratch vector must copy it before using that scratch vector itself.
  The chart built its points with `v1` while its caller passed `v1` as an endpoint, so the red chart
  ended at (0, 0, 0). Copy the endpoints first, and give helpers their own temporaries.
- To probe "a restart leaves nothing behind" without knowing what each kit owns, snapshot the set
  of visible top-level scene objects right after a clean start, run every power, restart with the
  same seed, and diff the two sets. Re-running the probe on the unfixed code (`git stash push -- src`)
  showed the check catching all three bugs.
