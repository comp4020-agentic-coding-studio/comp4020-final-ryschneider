# Margins — architecture

Technical reference for this codebase: what exists, why it's shaped this way,
and the invariants a change must not silently break. This is documentation of
what's built, not an argument about whether it's good (that's README.md) or
an account of how it was built (that's PROCESS.md). Read this before making a
structural change; update it in the same commit as the change if it goes
stale.

## What the app does

A small group reads one short text together, live, in a **room**. While
present, people see roughly where others are reading and can write a note
anchored to a text selection. A note is visible to everyone currently present
for as long as at least one person who was present *when it was written*
remains connected. The moment the last such person disconnects, the note
fades: it's deleted from memory and replaced by a permanent, anonymous,
position-only "heat" contribution — no content, no author. There is no
decay after that; a heat mark, once created, never changes.

Rooms are **seeded by hand** (`scripts/seed-from-library.ts`), never created
through the app itself, and each one is an instance of a fixed library text
(`scripts/library/`) — not arbitrary content. A room is titled after its
work and a per-work instance number, e.g. "Macbeth #0001"; seeding the same
work again makes a separate, independent room ("Macbeth #0002") rather than
updating the first. See "The text library" below.

**Logging in happens once, on the homepage, not per room.** "Logging in" is
giving yourself a name for the session — no account, no password. The name is
stored in `sessionStorage` (`src/lib/session.ts`) and carries to any room
visited afterwards without asking again. A room URL opened with no name
stored yet (a fresh tab, a shared link opened cold) redirects to `/` with
`?next=<room path>`, and back again once a name is given — see "Routes"
below. This is a deliberate reversal from this app's earlier state, where a
stranger could read a room's text with no name at all; now reading requires
having named yourself on the homepage first, same as everything else.

## Deploy shape (fixed by the course, not by this app)

One Fly machine (`shared-cpu-1x`, 256MB), one persistent volume at `/data`,
built from `Dockerfile`, `auto_stop_machines = "stop"` / `min_machines_running
= 0` (the machine fully stops when idle and cold-starts on the next request —
confirmed ~4s cold start in testing). `fly.toml` and the Dockerfile document
what's fixed; don't fight those constraints, work within them (see
"Known limitations" below for what this specifically rules out).

Astro runs **SSR, server output**, via `@astrojs/node` in `standalone` mode
(`astro.config.ts`) — the adapter runs its own Node HTTP server; there is no
custom server entry anywhere, and there shouldn't need to be (see "Real-time"
below for why).

## Data model — `src/lib/schema.ts` + `src/lib/db.ts`

Two tables, SQLite via `better-sqlite3` + `drizzle-orm`:

- **`rooms`**: `slug` (text, **primary key** — rooms are only ever addressed
  by slug, from the URL to the seed script's argument, so there's no surrogate
  id with nothing to join through), `text` (the room's content), `createdAt`.
- **`heatMarks`**: `id` (autoincrement), `roomSlug` (references `rooms.slug`),
  `startOffset`/`endOffset` (a character span into `rooms.text`), `createdAt`.
  This is the **only** state the spec requires to survive a restart or
  redeploy, and the only thing this table is allowed to hold — no author, no
  note content, ever. If a future feature needs to persist more about a note,
  it does not belong in this table.

**Migrations**: edit `schema.ts`, run `pnpm db:generate`, commit the new file
under `drizzle/` (plus its `meta/` updates). `src/lib/db.ts` calls `migrate()`
synchronously at import time — this runs automatically at boot, in every
environment (dev, CI's throwaway container, the real Fly volume), with no
separate migration step. Never edit `drizzle/*.sql` by hand; never apply
schema changes directly against a running database.

`DATABASE_PATH` env var points at the file (`/data/app.db` on Fly, via
`fly.toml`'s `[env]`; defaults to `./.data/app.db` locally, gitignored).

## The live engine — `src/lib/rooms.ts` (read this before touching anything real-time)

All *live* state — who's connected, notes that haven't faded yet — is
**in-process memory only**, keyed by room slug. It is not persisted, and
losing it on a crash or restart is an accepted, deliberate simplification
(see "Known limitations"). Only the final, faded heat is durable.

```
RoomState {
  presence: Map<handle, Set<connectionId>>   // dedupes multiple tabs/devices per handle
  connectionHandles: Map<connectionId, handle>
  locations: Map<handle, offset>              // best-effort, not authoritative
  notes: Map<noteId, LiveNote>
}
LiveNote { start, end, handle, text, carrierHandles: Set<handle> }
```

**The one invariant everything else depends on**: a note is visible to
whoever's present *iff it still exists in `notes`*. There is no separate
visibility flag anywhere. This works because:

- `writeNote()` snapshots `carrierHandles = new Set(presence.keys())` **at
  the moment of writing** — the carrier set is fixed then and never grows.
  Someone joining later and seeing the note does **not** add them to it.
- `leave()` removes the departing handle from every live note's
  `carrierHandles`; the instant a note's `carrierHandles` is empty, it is
  deleted from `notes` **and** persisted to `heat_marks` in the same step.
- A newly-connecting client's snapshot (`getSnapshot()`) just reads whatever
  is currently in `notes`. A note that lost its last carrier was already
  gone before the snapshot was built, so a new joiner can never see it; an
  existing note stays visible to everyone present (new joiners included) for
  exactly as long as any original carrier remains.

**If you change this logic, preserve that property or rewrite this section.**
It was deliberately built to need zero special-casing for "is this visible
to a new joiner" — don't reintroduce a visibility flag or a separate
propagation check; if you find yourself wanting one, something upstream of
this file has probably drifted from the rule.

## Real-time — SSE, not WebSockets

`src/lib/events.ts` is a single in-process `EventEmitter`, events namespaced
per room (`room:${slug}`). `src/pages/api/room/[slug]/events.ts` is a GET
route returning a `ReadableStream` with `content-type: text/event-stream`;
`start()` joins the room and subscribes, `cancel()` (fires on client
disconnect) unsubscribes and calls `leave()`. This is one-directional
(server→client) plain HTTP — deliberately chosen over WebSockets because it
needs no custom server or adapter "middleware" mode, and it's sufficient:
client→server actions (location updates, note writes) are ordinary POST
routes that mutate state via `src/lib/rooms.ts` then let the bus broadcast
the result.

**This only works on exactly one machine.** The EventEmitter bus has no
cross-machine fan-out. `fly.toml`'s single-VM config is why — if this app
ever needs to scale beyond one machine, the in-memory room engine and the
single-file SQLite DB break down together, and that's a real rearchitecture
(e.g. a shared pub/sub + a networked database), not a tweak.

## Routes

- `src/pages/index.astro` — SSR, the only place a name is given. Renders a
  login form and (hidden until a name exists) the room list in the same
  page; a tiny inline script checks `getHandle()` (`src/lib/session.ts`) on
  load and shows whichever half applies. Reads `?next=<room path>` and, once
  a name is set (or already was), redirects there instead of showing the
  room list — this is how a cold visit to a room URL completes. `next` is
  validated against `^/room/[^/]+/$` before ever reaching
  `location.replace`; it's attacker-controlled (anyone can craft a link to
  this page with any `?next`), so an unvalidated value would be an open
  redirect. Each listed room also shows a live presence count
  (`presenceCount()`, `src/lib/rooms.ts` — reads the same in-memory map the
  SSE layer does, so it's exact at the moment of the request, snapshot-only:
  it does **not** update while the page stays open, matching the rest of
  this page's SSR-once behavior), its creation date, and when it was last
  annotated (`listRoomsWithActivity()`, `src/lib/db.ts` — the latest
  `heat_marks.createdAt` for that room, falling back to the room's own
  `createdAt` if it's never had a note fade; **not** derived from mere
  presence/joining/moving, by design). `src/lib/library.ts`'s
  `parseSqliteTimestamp()` is load-bearing here: SQLite's `datetime('now')`
  writes `"YYYY-MM-DD HH:MM:SS"` with no timezone marker, and `new
  Date(...)` on that string parses it as **local** time, not the UTC it
  actually is — silently wrong by the server's UTC offset. Every place that
  turns a stored timestamp into a `Date` goes through that function, or
  `timeAgo()`/`formatDate()` which already do.
- `src/pages/room/[slug]/index.astro` — SSR. 404s if the room doesn't exist.
  Splits the room's text into offset-tracked paragraphs
  (`src/lib/paragraphs.ts`), renders the persisted heat density
  (`src/lib/heat.ts`) server-side. A room-page inline script checks
  `getHandle()`; with no name stored it redirects to `/?next=<this path>`
  rather than rendering anything live. **This means the SSR'd text is only
  reachable past a name prompt now** — see the note in "What the app does"
  above; it's a deliberate product change, not an oversight, but it's worth
  knowing this file no longer hands a stranger the text with zero
  interaction, which an earlier version of this document took as settled.
  Embeds the paragraph table + heat marks as JSON for the client script to
  consume without re-deriving offsets from a DOM that notes will mutate.
- `GET /api/room/[slug]/events` — the SSE stream. Query params
  `connectionId` (client-generated, fresh per tab/connection — see
  "Client" below for why one tab is always one connection even though the
  name is shared across tabs), `handle` (read from the query string, sourced
  client-side from `sessionStorage`, not re-prompted per room).
- `POST /api/room/[slug]/location` — body `{connectionId, offset}`. Handle is
  always resolved server-side from `connectionId`; never trust a
  client-supplied handle on a per-request basis.
- `POST /api/room/[slug]/notes` — body `{connectionId, start, end, text}`.
  Validates offsets against the room's actual text length and caps note
  length (280 chars). Responds `{ok:true}` only — the posting client renders
  its own note the same way every other client does, off the SSE stream, so
  there is exactly one rendering path.

## Client — `src/scripts/margins-client.ts`

Imported directly by the room page's inline `<script>` (Vite bundles it, same
pattern as every other local-module import in this template). `initRoom(handle)`
takes the name as a parameter — it's resolved (and the redirect-home decision
made) by the room page's own inline script before `initRoom` is ever called,
so this module has no awareness of login at all; it just connects
immediately on load with whatever name it was given, where it used to wait
for a per-room join form submit. `connectionId` is still generated fresh per
call (`crypto.randomUUID()`) — a name is shared across every tab via
`sessionStorage`, but each open tab is still its own SSE connection and
needs its own id, which is exactly what `src/lib/rooms.ts`'s presence dedupe
(`presence: Map<handle, Set<connectionId>>`) already expects: one handle, a
set of connections.

Key choices, not obvious from the code alone:

- **Offset math** walks `Selection.anchorNode`/`focusNode` up to the nearest
  `[data-start]` paragraph ancestor, then uses a `TreeWalker` scoped to just
  that paragraph to find the local character offset — never derived from the
  whole document, since paragraphs get rewritten as notes attach to them.
- **Rendering a paragraph with notes** fully rebuilds that paragraph's
  content from the **original stored text** (the embedded JSON, never the
  live DOM) every time its overlapping-notes set changes. This was chosen
  over incremental `Range.surroundContents()` DOM surgery specifically
  because that approach breaks on overlapping/partial selections — don't
  reintroduce it without solving that. It walks the **union of every
  overlapping note's start/end** as cut points and renders one segment per
  gap, rather than one mark per note at a running cursor — the latter was
  shipped first and silently duplicated the covered text whenever two
  notes shared or overlapped a span, since each note appended its own copy
  of that text regardless of what an earlier note already rendered there.
  A segment covered by several notes becomes one `<mark>` whose title/popover
  joins all of them (`"A: ... / B: ..."`), not just the first.
- **Location/presence is deliberately de-emphasized**: a paragraph-level,
  throttled signal, rendered as a muted text list, not a cursor. If you're
  asked to make this "more precise" or "more real-time," check with whoever's
  directing the work first — it was intentionally kept loose.

## Design system — `src/styles/global.css` + `src/layouts/Layout.astro`

Paper and ink, not software chrome: color is spent distinguishing the
product's own two kinds of attention (warm `--ember` = faded/past, cool
`--presence` = live/present) rather than decorating the interface. Tokens
(colors, the two type families — **Literata** for the text and headings,
**Work Sans** for UI chrome — spacing scale) live in `global.css`'s `:root`;
`Layout.astro` loads the fonts and wraps every page (`index.astro`, the room
page, `readme/index.astro`) so the three stay visually consistent. Change a
token in one place, not per-page.

**Page width is one token, widened only where needed.** `.page` (every
page's outer container) is `max-width: var(--measure)` — the reading width,
not a wider generic "page" width — so prose fills it instead of floating
flush-left inside extra space. `--room-width` (`--measure` + the sidebar's
gap and width) exists only for the room page, which is the one page with a
genuine reason to be wider: `.room-page` sets its own `max-width:
var(--room-width)`, and `.site-nav:has(~ .room-page)` widens the nav to
match, since the nav sits *before* the page content in the DOM (the
layout's nav, then `<slot />`) — a plain `~`/`+` combinator can't reach
forward like that, only `:has()` with a relative selector can. If you add
another page that genuinely needs more than `--measure`, follow this
pattern (a page-specific class widening both `.page` and matching the nav
via `:has()`) rather than hand-rolling a new `max-width` on some inner
element — that's exactly the bug this fixed: several elements independently
capped themselves at `--measure` *inside* an outer container that was wider
still (`56rem`, hardcoded, matching nothing else), so they sat flush-left
with dead space to their right instead of actually filling or centering in
the page.

Two real bugs this surfaced, both easy to reintroduce:

- **An author `display` always beats the `[hidden]` UA default.** Any
  selector that sets `display` on an element also toggled via the `hidden`
  property/attribute needs an explicit `selector[hidden] { display: none; }`
  rule, or both states render at once the moment that selector's `display`
  declaration exists. This bit the old per-room `#join-gate` form silently
  until a real headless-browser screenshot caught it —
  `curl`/`astro check`/`vitest` never would, since none of them execute CSS
  cascade + the `hidden` IDL property together. (`#join-gate` no longer
  exists — login moved to the homepage, see "What the app does" — but
  `#login-gate` on `src/pages/index.astro` is the same pattern and needs the
  same rule if it's ever touched.)
- **Historical note, no longer applicable as described:** an earlier version
  briefly hid the room text behind the per-room join form, which contradicted
  this app's original "a stranger can visit and see the trace with zero
  interaction" proof-of-life requirement; that version was reverted so the
  text rendered unconditionally again. Login has since moved to the homepage
  entirely (see "What the app does"), which supersedes that requirement on
  purpose: reading a room now does require having named yourself first,
  homepage-first. Mentioned here only so the history makes sense — don't
  resurrect the old "text visible with zero interaction" behavior based on
  this paragraph alone.
- **`margins-client.ts` creates `<mark>` and the presence `<ul>`/`<li>` via
  `document.createElement`, not Astro's template** — so they never receive
  Astro's scoped-style attribute, and a plain scoped selector
  (`.room-text mark`, `.margin-notes ul`) silently never matches them. Wrap
  the part of the selector that targets JS-inserted content in `:global()`
  (`.room-text :global(mark)`). Anything new that margins-client.ts builds
  with `createElement` needs the same treatment.

Both were only found by actually driving the page with a headless browser
(screenshot + a real join via dispatched form submit, not a hand-edited HTML
fixture — an early attempt to fake the "joined" state by string-replacing the
`hidden` attribute out of raw HTML silently also stripped the scoping
attribute and produced a phantom bug that didn't exist in the real app).
`curl`-based checks (including the ones in `spec/`) cannot catch either
class of bug, since both depend on the browser's CSS cascade and the DOM
actually being built by JS. Trust a real rendered page over a static HTML
diff when touching anything `hidden`-toggled or client-rendered.

## The text library — `scripts/library/`

Every room is an instance of a fixed, curated **text**, not an arbitrary
file. `scripts/library/manifest.json` is an array of entries
(`slug`, `title`, `author`, `kind` — `"poem" | "play" | "book"` —,
`sourceNote`, `description`, `file`), one per work; the actual excerpt text
for each lives alongside it in `scripts/library/texts/<file>`. This is a
build-time asset (committed to the repo, read by the seed script), not a
database table — there is deliberately no "add a text through the app" path,
matching the existing "rooms are seeded by hand" rule.

A room is one **instance** of a library entry: seeding `macbeth` the first
time makes a room titled "Macbeth #0001" at `/room/macbeth-0001/`; seeding it
again makes a separate room, "Macbeth #0002", with its own independent live
state and heat — the two never share presence, notes, or history. `rooms`
stores a copy of the entry's title/author/kind/sourceNote/description at
seed time (`src/lib/schema.ts`), not a foreign key to the manifest, so a
room's displayed metadata is exactly what it was seeded with even if the
manifest is edited afterward — editing `manifest.json` only affects rooms
seeded *after* the edit. `src/lib/library.ts`'s `displayName()` is the single
place the `"<title> #<instance, zero-padded to 4>"` format is computed; use
it rather than reassembling the string elsewhere.

**Line breaks matter and differ by `kind`.** The room page renders `text`
verbatim with `white-space: pre-line` (see the room page's styles) and
`src/lib/paragraphs.ts` splits on blank lines only — every `\n` already in
the stored text becomes a visible line break, and nothing reflows at render
time (offsets in `heat_marks` and live notes are measured against the exact
stored string, so reflowing after the fact would desync them from what a
viewer sees). That's correct and wanted for `"poem"` and `"play"` entries,
where the line breaks ARE the content's real structure. It is wrong for
`"book"` entries: Project Gutenberg's plain-text editions hard-wrap prose at
~70 characters with no paragraph-internal structure to preserve, and copying
that straight into a text file renders every wrap as a spurious line break
mid-sentence. Every `"book"` entry in this library had its hard-wrapped
lines rejoined into flowing paragraphs (one `\n` is still a stated line
break, so only genuine blank-line-separated blocks were touched; dialogue
that Gutenberg already set off with blank lines was left as separate
blocks) before being committed — if you add a new `"book"` entry, reflow it
the same way before saving the file, not after it's already live in a room.

## Seeding — local and production, same command

`node scripts/seed-from-library.ts <text-slug>` (slugs come from
`manifest.json`; running the script with no argument lists them). It looks
up the entry, reads its text file, computes the next instance number for
that `text-slug` (one more than the highest existing `instance` for it, or 1
if none exist — `rooms` has a unique index on `(textSlug, instance)` so this
can never collide), and inserts a brand-new room — never updates an existing
one, unlike the retired single-file version of this script. This script
deliberately does **not** import `src/lib/db.ts` (which is only ever
imported through Astro's Vite bundler, and runs `migrate()` as an
import-time side effect) — it sets up its own tiny better-sqlite3/drizzle
connection, importing `src/lib/schema.ts` directly with an **explicit `.ts`
extension**, because this script runs under plain Node, where relative
imports need the extension spelled out (see `tsconfig.json`'s
`allowImportingTsExtensions` comment).

For production: the Dockerfile copies `scripts/seed-from-library.ts`,
`scripts/library/`, and `src/lib/schema.ts` into the runtime image
specifically so this works unchanged against the real Fly volume via
`flyctl ssh console -a <app-name> -C "node scripts/seed-from-library.ts <text-slug>"`.
If you add a script that needs to run against the production database, this
is the pattern to copy — don't invent an admin HTTP endpoint for it; rooms
are seeded by hand on purpose.

**Migration note** (`drizzle/0001_*.sql`): adding the metadata columns as
`NOT NULL` with no default meant the migration itself had to `DELETE FROM
heat_marks` and `DELETE FROM rooms` first — SQLite's `ALTER TABLE ADD COLUMN`
refuses a `NOT NULL` column with no default on a non-empty table, and the
one room that could exist before this migration (the old ad-hoc `demo` room
from the retired single-file seed script) predates the library and has no
real values to backfill those columns with. This was verified against a
simulated pre-migration database (an existing room + a heat mark) before
shipping, specifically so it wouldn't crash `migrate()` at boot against the
real production volume, which had exactly that old row. If you're ever
tempted to add another `NOT NULL`-no-default column to a table that might
already hold rows, this is the failure mode to check for first.

## Known limitations (deliberate, not bugs)

- Live presence and not-yet-faded notes are lost on a crash or an untimely
  restart. Only faded heat marks are guaranteed to survive. This was an
  explicit simplification for the proof-of-life week, not an oversight —
  don't "fix" it without checking whether the product requirements have
  actually changed.
- Single machine only (see "Real-time" above).
- No decay after a note fades — heat marks are permanent once written.
- No automated test covers the propagation/fade state machine itself (two
  concurrent SSE clients, timing-dependent disconnects). This was a
  deliberate call, not an oversight: `spec/README.md`'s own framing treats
  live, multi-person, timing-dependent behavior as something a person judges
  at the crit, not something CI should simulate. It was verified by hand
  (raw SSE connections, scripted join/write/leave sequences) against both a
  local build and the actual deployed Fly app before shipping — see
  PROCESS.md for how, if that's been written up.
- **Possible gap, not confirmed as a real bug**: while testing the homepage's
  room-stats feature, a `curl`-based SSE client killed via `pkill` left its
  handle showing as present indefinitely (no `leave()` ever fired), while
  the same scenario driven through a real browser tab closed via DevTools'
  `Page.close` triggered `cancel()`/`leave()` correctly within about a
  second. This may just be `pkill`'s SIGTERM not producing a clean stream
  close the way a browser's connection teardown does, rather than anything
  wrong in `src/pages/api/room/[slug]/events.ts` itself — it wasn't chased
  further since it's outside what was asked for here. If "a room that looks
  occupied forever" ever gets reported for real, start by checking whether
  the departing client's connection closed cleanly (network drop, tab
  killed by the OS, etc. — not just "navigated away" or "closed the tab").

## Where to look

| Need to... | Look at |
|---|---|
| Change the schema | `src/lib/schema.ts`, then `pnpm db:generate` |
| Touch presence/notes/propagation/fade logic | `src/lib/rooms.ts` — read the invariant above first |
| Touch login / the session name | `src/lib/session.ts`, `src/pages/index.astro` — not the room page, login lives on the homepage only |
| Add a route | `src/pages/api/room/[slug]/` for API shape, `src/pages/room/[slug]/index.astro` for the page |
| Change how notes/heat render | `src/scripts/margins-client.ts` (client), `src/lib/heat.ts` (shared density math) |
| Change colors, type, or spacing | `src/styles/global.css` tokens — not per-page overrides |
| Touch the homepage's per-room stats (presence/created/last-annotated) | `presenceCount()` in `src/lib/rooms.ts`, `listRoomsWithActivity()` in `src/lib/db.ts`, formatting in `src/lib/library.ts` — always go through `parseSqliteTimestamp()` for any stored timestamp, never `new Date(stored)` directly |
| Style something margins-client.ts builds with `createElement` | needs `:global()` in that page's `<style>` — see "Design system" above |
| Add, edit, or remove a library text | `scripts/library/manifest.json` + `scripts/library/texts/` — editing an existing entry only affects rooms seeded afterward |
| Seed a new room from the library | `scripts/seed-from-library.ts <text-slug>`; production via `flyctl ssh console` (see above) |
| Know what's mechanically checked vs. judged by a person | `spec/README.md` |
| Know what's fixed about the deploy vs. what's this app's choice | `fly.toml`, `Dockerfile` (both have comments marking the line) |
| The published brief/spec for this week | the course site — CLAUDE.md links it |
| Why the stack is Astro+Node+SSE+SQLite specifically | PROCESS.md's decision record, once written |
