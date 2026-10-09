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
