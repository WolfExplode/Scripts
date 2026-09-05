# TierForge

A tier list maker that is actually searchable, and that can swallow any TierMaker list whole.

- **`TierForge.cmd`** — start here. Runs the helper and opens the app.
- **`tierforge.html`** — the whole app. One file, no build, no dependencies.
- **`scrape_tiermaker.py`** — the TierMaker importer: a CLI, and the `--serve` helper the app talks to.

## The two design requirements

### 1. Every item carries searchable text

Each tile renders a caption node holding its **name, tags and notes**. In the default
*Ctrl+F only* label mode that caption sits at `opacity:0` — invisible on screen, but still
laid out and painted, which is exactly what the browser's native find needs. Press
<kbd>Ctrl</kbd>+<kbd>F</kbd>, type a card name, and Chrome/Edge/Firefox scrolls to the tile
and highlights it. (`display:none` and `visibility:hidden` would break this; opacity does not.)

Switch the **Labels** dropdown to *Always visible* or *On hover* when you want to read them.

There is also an in-app search box (<kbd>/</kbd>) that dims non-matches, counts hits, and can
select every match at once:

| syntax | meaning |
|---|---|
| `strike block` | both terms (AND) |
| `"ashen strike"` | phrase |
| `-ashen` | exclude |
| `tag:starter` | tag field only |
| `note:vuln` | notes only |
| `tier:"Bad Cards"` | current tier |

Names, tags and notes are all editable — double-click a tile to open the inspector.

### 2. Paste a TierMaker link, get the whole list

**Import → TierMaker URL** takes any `tiermaker.com/list/…` or `tiermaker.com/create/…` link and
rebuilds tier names, TierMaker's row colours, every item image and every placement.

Verified against the reference list (`ironclad-cards-slay-the-spire-ii-19230513`):
**90 items, 5 tiers, 82 ranked, 8 unranked** — identical through all three import paths below.

Tick **Download & embed images** if you want the board to survive TierMaker going away (and to
make PNG export bulletproof).

## Start it with the helper

```
TierForge.cmd                       (or)  python scrape_tiermaker.py --serve
```

That serves the app at `http://127.0.0.1:8777/tierforge.html` and opens it. The import box then
talks to the helper, which does the fetching from your machine — no proxy, no Cloudflare, nothing
to configure. The app shows **Local helper connected** when it finds it.

You can still open `tierforge.html` by double-clicking it; everything except URL import works
exactly the same, and the bookmarklet covers import.

## Why import needs help

A TierMaker `/create/` page ships an **empty** carousel and fills it from

```
/api/?type=templates-v2&id=<template>&lastEdited=<ts>&variation=<n>
  -> ["<template>", {"src": "...aggression.png", "id": "1"}, ...]
```

That endpoint sends CORS headers only for `bracketfights.com` and `403`s anything that doesn't look
like a browser, so a web page can't call it and public proxies get `403`/`522`. Reader proxies that
*render* the page (r.jina.ai) work when they feel like it — when rate-limited they quietly return
the raw HTML instead, whose carousel is empty. That is also why **view-source → paste doesn't
work**: the items simply aren't in the page source.

A saved list's row assignments live in an inline string on the `/list/` page, where the numbers are
those same item ids:

```
template-name==Broken Cards|0|8|7|16|…==A|1|5|9|20|…
                            ^ colour index into TierMaker's stock 10-colour palette
```

So there are three ways in, in order of reliability:

| path | how | needs |
|---|---|---|
| **Local helper** | paste the link in the app | Python running `--serve` |
| **Bookmarklet** (Grab from page tab) | click it on the TierMaker page, paste back | nothing |
| Public proxies | automatic fallback | luck |

The bookmarklet is the one that can't be blocked: it runs **inside your TierMaker tab**, where
`/create/` and `/api/` are same-origin. It reads the **tier rows that are actually on screen** —
label text, the row's real background colour, and the item ids in it — then asks the API for the
full item catalogue.

Because it reads the live page rather than the URL, it captures things a link can't:

| you are on | you get |
|---|---|
| a `/list/…` page | that list, as published |
| `/create/<tpl>?ref=list-remix` | the cloned list, exactly as TierMaker rebuilt it |
| `/create/<tpl>` you've been dragging on | your arrangement so far, unsaved |

Verified on all three: 90 items, 5 tiers, correct colours — and a card dragged between tiers before
grabbing came across in its new tier.

### About `?ref=list-remix` links

Those are TierMaker's own "clone this list" links, and they carry **no list id**. The Clone button
writes the list into `localStorage["<template>TierListMakerCode"]` and the create page rebuilds the
rows from it, so the arrangement exists only inside your browser. Nothing server-side — not the
helper, not a proxy — can read it, and pasting such a link into the URL box gets you the template
with empty tiers (the app says so when it spots one). Click the bookmarklet on that page instead
and you get the whole thing.

## Sending a board back to TierMaker

**Export → Back to TierMaker** regenerates TierMaker's own `templateCode` from your board and gives
you a second bookmarklet that writes it to that same localStorage key and opens the remix page —
the identical mechanism their Clone button uses. Verified end to end: a board edited in TierForge
reappeared in TierMaker with every placement intact.

Two limits, both inherent: only items that came from the TierMaker template can go back (it has no
way to know about images you added yourself), and tier colours snap to TierMaker's ten stock rows.

## scrape_tiermaker.py

```bash
python scrape_tiermaker.py https://tiermaker.com/list/video-games/foo-123/456789
python scrape_tiermaker.py https://tiermaker.com/create/foo-123 -o cards.json --embed
python scrape_tiermaker.py <url> --images ./pics --tags "slay the spire, ironclad"
```

| flag | effect |
|---|---|
| `-o FILE` | output path (default `<template>.tierforge.json`) |
| `--embed` | base64 every image into the JSON — one self-contained file |
| `--images DIR` | download images to `DIR` and link them relatively |
| `--tags a,b` | pre-tag every item |
| `--serve` | run the local helper instead of writing a file |
| `--port N` | helper port (default 8777) |

Drag the resulting `.json` onto the app window, or use **Import → JSON pack**.

## Other things it does

- Drag one tile, or click to build a selection (<kbd>Shift</kbd>-click for a range,
  <kbd>Ctrl</kbd>-click to toggle) and drag the whole set at once.
- With a selection, <kbd>1</kbd>…<kbd>9</kbd> flings it into that tier, <kbd>0</kbd> returns it
  to the pool.
- Add your own images by dropping files on the window or **+ Add images…** — the filename
  becomes the searchable name.
- **Plain text** import: `Name | tag, tag | note` per line, for image-less lists.
- Tiers: rename in place, recolour, reorder, empty, delete.
- Export to **JSON** (round-trips), **back to TierMaker**, **PNG** (drawn on a canvas; remote images are routed through
  `images.weserv.nl` so the canvas stays untainted), **Markdown**, or **CSV**.
- Autosaves to `localStorage`; **Boards** keeps several named lists. <kbd>Ctrl</kbd>+<kbd>Z</kbd>
  undoes the last ~40 structural changes.

## Keys

<kbd>/</kbd> search · <kbd>Esc</kbd> clear / deselect · <kbd>Ctrl</kbd>+<kbd>A</kbd> select
matches · <kbd>1</kbd>-<kbd>9</kbd> / <kbd>0</kbd> move selection · <kbd>Del</kbd> delete
selection · <kbd>Ctrl</kbd>+<kbd>S</kbd> save board · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo ·
double-click a tile for the inspector.

## Notes

- Everything runs locally; nothing is uploaded. The only outbound calls are the import proxy and
  the image hosts.
- Imported item names come from TierMaker's image filenames (`ashenstrike.png` → "Ashenstrike"),
  since its templates carry no separate labels. Rename anything in the inspector.
- `localStorage` caps out around 5 MB, so embedded-image boards are best kept as exported JSON.
