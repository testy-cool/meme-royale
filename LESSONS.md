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
- The `meme-royale` branch is not merged into the playground's master. A later deploy from any
  other checkout drops `/meme-royale` until someone merges it.
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
- `window.memeRoyale` exposes fps, state, fighters, player and fx for browser checks.
  Setting `fx.freeze` to a large number pauses the simulation but keeps rendering, which is
  handy for posed screenshots.

### three.js / game
- three r186 removed PCFSoftShadowMap and logs a warning. Use PCFShadowMap.
- Chrome can report one huge mouse delta right after pointer lock engages. Ignore deltas
  over 300 px, or the camera snaps to the floor.
- Physics runs at a fixed 120 Hz, so a 35 m/s launch moves less than half a body width per
  step and cannot tunnel through a one-block wall.
- Hit-stop on every bot-vs-bot hit made the game stutter. Full hit-stop applies only when the
  player is involved; distant bot fights get a short one or none.
