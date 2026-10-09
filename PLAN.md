# Meme Royale v0.1 — plan

Goal: the smallest browser game that makes Vlad say "wow", live at
https://playground.voidxd.cloud/meme-royale

Roles: the architect session owns this plan. The worker in the Herdr tab
`meme-royale` implements one milestone at a time and appends to LESSONS.md.

## The wow (what must land)
1. You punch someone and they fly: big knockback, hit-stop, screen shake, and
   they smash through a wall that bursts into tumbling voxel chunks.
2. Something enormous arrives: a colossal Skibidi Toilet rises at the map
   edge, stomps through the village, and flattens buildings and contestants.
3. It is a real match: bots fight each other, a storm ring shrinks, and the
   last one alive wins. Play Again restarts it at once.

## Stack (deliberately small)
- Vite + TypeScript + three.js. No physics engine: simple custom velocity,
  gravity, and AABB physics. Debris is InstancedMesh cubes with a lifetime.
- Meme faces are drawn procedurally on canvas textures (Gigachad, Doge,
  Trollface, Pepe, Wojak, Nyan Cat). No external image assets.
- Static build with `base: '/meme-royale/'`, served by the playground Worker.

## Milestones
- M1 core feel: voxel village, third-person Gigachad (WASD, mouse look, jump,
  click punch, Q ground slam), 5 bots that fight anyone nearby, destructible
  walls, juice. Deploy it, then verify it in a real browser.
- M2 spectacle and match: boss event at about 40 s, shrinking storm, kill
  feed, win and lose screens, Play Again. Deploy it and verify it.
- M3 polish only if M1 and M2 feel good.

## UI rules (non-negotiable)
- No text below 12px. HUD shows only what you play with: HP, players left,
  slam cooldown, a short kill feed. No decorative labels, dots, or scanlines.
- Run `/home/vlad/bin/ui-safety-check` on the changed UI files before you
  call a milestone done.
