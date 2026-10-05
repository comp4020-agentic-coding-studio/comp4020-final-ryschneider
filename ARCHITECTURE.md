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

Rooms are **seeded by hand** (`scripts/seed-room.ts`), never created through
the app itself.

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

- `src/pages/room/[slug]/index.astro` — SSR. 404s if the room doesn't exist.
  Splits the room's text into offset-tracked paragraphs
  (`src/lib/paragraphs.ts`), renders the persisted heat density
  (`src/lib/heat.ts`) server-side — **this is what makes the "trace" visible
  to a stranger with no JS at all**, which matters for the course's actual
  proof-of-life bar. Embeds the paragraph table + heat marks as JSON for the
  client script to consume without re-deriving offsets from a DOM that notes
  will mutate.
- `GET /api/room/[slug]/events` — the SSE stream. Query params
  `connectionId` (client-generated, per-tab), `handle` (typed fresh each
  visit, never persisted).
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
pattern as every other local-module import in this template). Key choices,
not obvious from the code alone:

- **Offset math** walks `Selection.anchorNode`/`focusNode` up to the nearest
  `[data-start]` paragraph ancestor, then uses a `TreeWalker` scoped to just
  that paragraph to find the local character offset — never derived from the
  whole document, since paragraphs get rewritten as notes attach to them.
- **Rendering a paragraph with notes** fully rebuilds that paragraph's
  content from the **original stored text** (the embedded JSON, never the
  live DOM) every time its overlapping-notes set changes, alternating text
  nodes and `<mark>` elements. This was chosen over incremental
  `Range.surroundContents()` DOM surgery specifically because that approach
  breaks on overlapping/partial selections — don't reintroduce it without
  solving that.
- **Location/presence is deliberately de-emphasized**: a paragraph-level,
  throttled signal, rendered as a muted text list, not a cursor. If you're
  asked to make this "more precise" or "more real-time," check with whoever's
  directing the work first — it was intentionally kept loose.

## Seeding — local and production, same command

`node scripts/seed-room.ts <slug> <path-to-text-file>`, upserts a room.
This script deliberately does **not** import `src/lib/db.ts` (which is only
ever imported through Astro's Vite bundler, and runs `migrate()` as an
import-time side effect) — it sets up its own tiny better-sqlite3/drizzle
connection, importing `src/lib/schema.ts` directly with an **explicit `.ts`
extension**, because this script runs under plain Node, where relative
imports need the extension spelled out (see `tsconfig.json`'s
`allowImportingTsExtensions` comment).

For production: the Dockerfile copies `scripts/seed-room.ts`,
`src/lib/schema.ts`, and `fixtures/demo.txt` into the runtime image
specifically so this works unchanged against the real Fly volume via
`flyctl ssh console -a <app-name> -C "node scripts/seed-room.ts <slug> <path>"`.
If you add a script that needs to run against the production database, this
is the pattern to copy — don't invent an admin HTTP endpoint for it; rooms
are seeded by hand on purpose.

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

## Where to look

| Need to... | Look at |
|---|---|
| Change the schema | `src/lib/schema.ts`, then `pnpm db:generate` |
| Touch presence/notes/propagation/fade logic | `src/lib/rooms.ts` — read the invariant above first |
| Add a route | `src/pages/api/room/[slug]/` for API shape, `src/pages/room/[slug]/index.astro` for the page |
| Change how notes/heat render | `src/scripts/margins-client.ts` (client), `src/lib/heat.ts` (shared density math) |
| Seed or reseed a room | `scripts/seed-room.ts`; production via `flyctl ssh console` (see above) |
| Know what's mechanically checked vs. judged by a person | `spec/README.md` |
| Know what's fixed about the deploy vs. what's this app's choice | `fly.toml`, `Dockerfile` (both have comments marking the line) |
| The published brief/spec for this week | the course site — CLAUDE.md links it |
| Why the stack is Astro+Node+SSE+SQLite specifically | PROCESS.md's decision record, once written |
