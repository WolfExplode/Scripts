# TierForge

TierForge is a local-first tier-list builder. It imports TierMaker lists and supported game wikis,
keeps boards as ordinary JSON files, caches images locally, and exports PNG, Markdown, CSV, or a
TierMaker remix.

## Start

Double-click `TierForge.cmd`, or run:

```powershell
npm run serve
```

TierForge requires Node.js 20 or newer and has no package dependencies. It opens
<http://127.0.0.1:8777/> and stores data beside the application:

```text
Saved/                  named boards and _autosave.tierforge.json
Images/sts2/            downloaded wiki images
Images/tiermaker/       downloaded TierMaker images
```

Use `npm run serve -- --no-browser` to avoid opening a browser, or
`npm run serve -- --port 9000` to choose another port.

## Importing

Open **Import**, paste a TierMaker `/list/` or `/create/` URL, and select how images should be kept:

- **Remote**: leave image URLs online. Fastest, but requires the source host.
- **Local files**: download into `Images/`. Best for normal use; re-import manually to refresh.
- **Embedded**: put base64 image data inside the Board. Portable, but produces large JSON files.

The **Slay the Spire 2: import all cards/relics** shortcuts read the wiki's Cards List or Relics
List and default to local files. The Neow relic TierMaker list is detected automatically and
relinks against the Relics List, including TierMaker's filename-style tile labels. **Merge into
current board** adds only new entries. **Relink items** inventories the
current board and `Images/` first, keeps items that are already saved locally, then checks only the
unresolved names against the wiki. It preserves tiers, tags, and notes and downloads only matching
wiki images that are still missing.

TierMaker remix links keep placements in that site's browser storage rather than in the URL. Use
the bookmarklet under **Import → Grab from page** when a remix cannot be read directly. Drag the
bookmarklet link to the bookmarks bar, or use **Copy bookmark code** and paste it into a new
bookmark's URL field. Run it on the loaded TierMaker page, then paste its output back into TierForge.

## Everyday controls

- Click tiles to select; Shift-click selects a range.
- Drag one selected tile to move the full selection.
- Hold `Ctrl` while dropping before another item to make the same relative move on every sub-board.
- Press `1`–`9` to move selected items to a tier, or `0` for the pool.
- Press `/` to search, `Ctrl+A` to select matches, `Delete` to remove, and `Ctrl+Z` to undo.
- Double-click a tile to edit its name, image, tags, and notes.
- `Ctrl+S` saves a named Board using its title. Autosave runs after every edit.

Search terms are ANDed. Filters include `tag:starter`, `tier:A`, `note:vulnerable`, `-word`, and
quoted phrases.

## Development

```powershell
npm test
npm run check
```

The modules are deliberately framework-free:

- `app.js` and `app.css` implement the browser experience.
- `src/importer.js` fetches sources, parses items and materializes images.
- `src/server.js` serves files, manages import jobs, and persists Boards atomically.
- `test/` verifies the stable parser and HTTP interfaces.

The Board format remains version 1 for compatibility with existing `.tierforge.json` files.
Architectural vocabulary is recorded in `CONTEXT.md`; decisions live in `docs/adr/`.
