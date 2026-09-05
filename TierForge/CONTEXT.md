# TierForge domain

## Board

The durable tier-list document. A board owns tiers, the unranked pool, items, display options,
its title, and its source URL. Boards use the versioned `.tierforge.json` format and are stored in
`Saved/` by the local runtime.

## Item

One rankable entry. An item has a stable board-local ID, a name, tags, notes, an image reference,
and optionally a source image reference and TierMaker key.

## Import

The process that turns a supported TierMaker or game-wiki URL into a Board-compatible pack.
Imports may leave image references remote, embed bytes in the board, or materialize image files in
`Images/`.

## Local runtime

The Node process started by `TierForge.cmd` or `npm run serve`. It serves the browser application,
performs Imports, materializes images, and persists Boards. The browser discovers it through the
`/import` interface.

## Autosave

The reserved `_autosave.tierforge.json` Board written after edits and restored at startup. Named
Boards are explicit snapshots and are not replaced by Autosave.
