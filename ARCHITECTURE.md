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

Rooms are created two ways: in bulk, by hand, via
`scripts/seed-from-library.ts`; or one at a time, by any logged-in user,
via a "Start a room" form on the homepage (`POST /api/rooms`). Either way,
a room is an instance of a fixed library text (`scripts/library/`) — not
arbitrary content. A seeded room is titled after its work and a per-work
instance number, e.g. "Macbeth #0001"; a room created through the form
instead shows the creator's own title. Creating the same work again (either
path) makes a separate, independent room ("Macbeth #0002") rather than
updating the first. See "The text library" below.

**Logging in happens once, on the homepage, not per room — and is now a real
account.** A visitor signs up or logs in with a username and password; the
server sets a signed, stateless session cookie that survives closing the
browser and follows the same account across devices (see "Accounts and
sessions" below for the mechanism). This replaced an earlier
`sessionStorage`-only scheme that was really just "a name for this browser
tab session" with no account, no password, and no cross-device persistence.
A room URL opened with no session yet (a fresh tab, a shared link opened
cold) redirects to `/` with `?next=<room path>`, and back again once logged
in — see "Routes" below.

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

Three tables, SQLite via `better-sqlite3` + `drizzle-orm`:

- **`rooms`**: `slug` (text, **primary key** — rooms are only ever addressed
  by slug, from the URL to the seed script's argument, so there's no surrogate
  id with nothing to join through), `text` (the room's content), `createdAt`.
  Three columns are **nullable**, set only for a room created through the
  app's form, null for every seeded room: `customTitle` (replaces the
  auto-generated "`<title>` #0001" as the display string when present —
  see `displayName()` in `src/lib/library.ts`), `maxSize` (a participant
  cap; null means no cap), `creatorUserId` (references `users.id`; recorded
  for provenance, nothing currently displays it). Nullable rather than
  backfilled specifically so adding them needed no `DELETE FROM`-style
  destructive migration against the real, non-empty production table —
  contrast with `drizzle/0001_*.sql` below, which could still afford to
  wipe the table when it held nothing worth keeping.
- **`heatMarks`**: `id` (autoincrement), `roomSlug` (references `rooms.slug`),
  `startOffset`/`endOffset` (a character span into `rooms.text`), `createdAt`.
  This is the **only** state the spec requires to survive a restart or
  redeploy, and the only thing this table is allowed to hold — no author, no
  note content, ever. If a future feature needs to persist more about a note,
  it does not belong in this table.
- **`users`**: `id` (autoincrement), `username`/`usernameLower` (display
  casing vs. the column signup/login actually match against — same
  identity-match/display split as `rooms`' `textSlug`/`instance`),
  `passwordHash`/`passwordSalt` (scrypt, see "Accounts and sessions" below),
  `color` (one of the curated palette's hex values, `src/lib/palette.ts`),
  `createdAt`. **No foreign key from `heatMarks` or `rooms` to `users`** —
  deliberately: a faded note carries no identity at all (see "The live
  engine" below), and accounts owning identity for live content doesn't
  change that rule for faded content.

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
  presence: Map<userId, Set<connectionId>>    // dedupes multiple tabs/devices per account
  connectionUsers: Map<connectionId, { userId, handle, color }>
  locations: Map<userId, offset>              // best-effort, not authoritative
  notes: Map<noteId, LiveNote>
}
LiveNote { start, end, userId, handle, color, text, carrierIds: Set<userId> }
```

**Keyed by `userId` (a stable account id), not by the display `handle`
string** — this changed when accounts were added specifically so that
renaming yourself on `/profile/` can never retroactively relabel or corrupt
bookkeeping for notes you already wrote under an old name. `handle`/`color`
are snapshotted onto a `LiveNote` at the moment `writeNote()` runs, and onto
a connection's presence entry at the moment `join()` runs — **not** looked
up live from `userId` on every render. This is a deliberate decision, the
same philosophy the carrier-set rule below already uses: a note's author
display, and a connection's presence display, are both fixed for the
lifetime of that note/connection. Editing your display name or color on
`/profile/` does **not** retroactively update an already-open tab's presence
list or any note you already wrote in it — only a fresh connection (reload,
or a new tab) picks up the new handle/color.

**The one invariant everything else depends on**: a note is visible to
whoever's present *iff it still exists in `notes`*. There is no separate
visibility flag anywhere. This works because:

- `writeNote()` snapshots `carrierIds = new Set(presence.keys())` **at
  the moment of writing** — the carrier set is fixed then and never grows.
  Someone joining later and seeing the note does **not** add them to it.
- `leave()` removes the departing `userId` from every live note's
  `carrierIds`; the instant a note's `carrierIds` is empty, it is
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

## Activity log — `src/lib/log.ts`

Plain `console.log` lines, one per event, called from the same four spots
in `src/lib/rooms.ts` that already call `bus.emit(...)`: join, leave, note,
fade. Nothing else is logged (not location updates, which fire continuously
as a pointer moves and would just be noise, and not a note's actual text,
which would make the log itself a comment archive the app's own fade rule
says shouldn't exist). This exists specifically for the crit 10 ("Fly by
instruments") requirement to narrate who did what from `flyctl logs -a
<repo>` while two people use the deployed app from its URL alone — before
this, the app produced **no application-level output at all**; everything
in `flyctl logs` was Astro's own boot message and Fly's machine/proxy
lines. "The logging outlives the crit" just means plain stdout, which Fly
already captures — no separate log store or persistence was added, since
Fly's own log retention is what "outlives" means here.

A faded note's log line carries no `handle` — by the time a note fades,
every original carrier (the only people who could be named as its author)
has already left, so logging one here would contradict the app's own rule
that a faded note carries no identity.

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

- `src/pages/index.astro` — SSR, the only place an account is signed up for
  or logged into. Renders a signup/login form with an explicit toggle
  between the two modes (not one smart form that guesses) and, hidden until
  `Astro.locals.user` is set (resolved server-side by `src/middleware.ts`,
  checked at render time — not just client-side as before), the room list in
  the same page. The inline script POSTs to `/api/auth/login` or
  `/api/auth/signup` depending on the toggle. Reads `?next=<room path>` and,
  once logged in (or already was), redirects there instead of showing the
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
  `timeAgo()`/`formatDate()` which already do. Also renders, inside the same
  `hidden`-until-logged-in block, a "Start a room" form (`#create-room`) —
  a `<select>` of `listLibraryEntries()` (`src/lib/library.ts`), a title
  input, and a max-size input, POSTing to `POST /api/rooms` and redirecting
  to the new room on success.
- `src/pages/room/[slug]/index.astro` — SSR. 404s if the room doesn't exist.
  Splits the room's text into offset-tracked paragraphs
  (`src/lib/paragraphs.ts`), renders the persisted heat density
  (`src/lib/heat.ts`) server-side. Checks `Astro.locals.user`; with no
  session, issues a **server-side** `Astro.redirect` to `/?next=<this path>`
  (previously a client-side `location.replace` after a page's worth of
  content had already rendered) rather than rendering anything live. If the
  room has a `maxSize` and is already at capacity (and this visitor isn't
  already present — `isPresent()`, `src/lib/rooms.ts`), renders a
  **room-full** branch instead: title and byline, no live content, HTTP
  403. Otherwise embeds the paragraph table + heat marks as JSON, plus the
  logged-in user's `username`/`color` (for `initRoom()`), for the client
  script to consume without re-deriving offsets from a DOM that notes will
  mutate.
- `src/pages/profile/` — SSR, requires a session (redirects to `/` with
  `?next=/profile/` if not). Reads `Astro.locals.user`. A form for the
  display name plus a color-swatch picker, one radio per
  `src/lib/palette.ts` entry — not a native `<input type=color>`, since the
  whole point is a *curated* set. POSTs to `/api/profile`.
- `src/middleware.ts` — runs once per request, resolves the session cookie
  into `Astro.locals.user` (`User | null`). Every page/layout above reads
  this instead of independently parsing the cookie.
- `POST /api/auth/signup`, `POST /api/auth/login` — body
  `{username, password}`. Signup: username 1–40 chars, password minimum 8
  characters, rejects an already-taken username (case-insensitive). Login:
  same generic error either way for "no such user" and "wrong password"
  (don't leak which), and **always** runs the scrypt comparison — against a
  fixed dummy hash when the username lookup misses — so response timing
  doesn't itself leak which usernames are registered. Both set the session
  cookie on success.
- `POST /api/auth/logout` — clears the session cookie, redirects to `/` (a
  plain `<form method="post">` submit from `Layout.astro`'s nav, not a fetch
  call, so it needs to redirect rather than return a bodyless response).
- `POST /api/profile` — requires a valid session (401 otherwise); body
  `{username?, color?}`. Validates `color` against `src/lib/palette.ts`'s
  exact hex values — this is the actual enforcement point for "curated
  palette," not just a UI suggestion.
- `POST /api/rooms` — requires a valid session (401 otherwise); body
  `{textSlug, title, maxSize}`. Validates `textSlug` against the actual
  library manifest (`getLibraryEntry()`, `src/lib/library.ts`) — same
  posture as `color`'s palette check above, never trust a submitted slug
  just because the client's `<select>` only offered valid ones — plus a
  title length cap and a `maxSize` range. Calls `createRoom()`
  (`src/lib/db.ts`), which retries the instance-number allocation on a
  unique-constraint conflict (see "Seeding" below) since, unlike the CLI
  script, this can be hit concurrently by multiple users. Responds
  `{ok:true, slug}` so the homepage can redirect straight into the new room.
- `GET /api/room/[slug]/events` — the SSE stream. Query param
  `connectionId` (client-generated, fresh per tab/connection — see
  "Client" below for why one tab is always one connection even though an
  account can have several open at once). Identity (`userId`/`handle`/
  `color`) is resolved server-side from `Astro.locals.user`, **not** a query
  param — an earlier version took `handle` straight off the URL with no
  authentication at all, which accounts specifically closed off. If the
  room is at its `maxSize` and this user isn't already present, responds
  `403` before ever opening the stream — this, not the room page's own
  check, is the real capacity boundary (see "Known limitations" for why
  both exist).
- `POST /api/room/[slug]/location` — body `{connectionId, offset}`. Identity
  is always resolved server-side from `connectionId` (which `join()` already
  mapped to a `userId` when the SSE connection opened); never trust a
  client-supplied identity on a per-request basis.
- `POST /api/room/[slug]/notes` — body `{connectionId, start, end, text}`.
  Validates offsets against the room's actual text length and caps note
  length (280 chars). Responds `{ok:true}` only — the posting client renders
  its own note the same way every other client does, off the SSE stream, so
  there is exactly one rendering path.

## Client — `src/scripts/margins-client.ts`

Imported directly by the room page's inline `<script>` (Vite bundles it, same
pattern as every other local-module import in this template).
`initRoom(user: {username, color})` takes the account's display name and
chosen color as a parameter — the room page's frontmatter already redirected
away if there was no session, so this module has no awareness of login at
all; it just connects immediately on load. No `userId` is needed
client-side: the server already knows who you are from the session cookie on
every request, including the SSE connection itself (`handle`/`color` on
inbound server events exist purely for rendering). `connectionId` is still
generated fresh per call (`crypto.randomUUID()`) — one account can have
several tabs open, but each tab is still its own SSE connection and needs
its own id, which is exactly what `src/lib/rooms.ts`'s presence dedupe
(`presence: Map<userId, Set<connectionId>>`) already expects: one account, a
set of connections.

**Per-author color.** Every presence entry and note carries a `color`
(snapshotted server-side at connect/write time — see "The live engine"
above), rendered as that author's own `--note-*` swatch. A text segment more
than one author has annotated renders in the neutral `--note-overlap` token
instead of either individual author's color — it isn't any one person's
note, so it shouldn't look like it belongs to one.

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

## Accounts and sessions — `src/lib/auth.ts` + `src/middleware.ts`

**Passwords**: `crypto.scryptSync(password, salt, 64)`, salt per-user
(`randomBytes(16)`), compared with `timingSafeEqual` (never `===`).
scrypt's default cost parameters use roughly 16–17MB of transient memory per
concurrent call — worth knowing given `fly.toml`'s 256MB ceiling, though
fine for this app's realistic concurrency (a handful of logins during a crit
demo, not a real login surge).

**Sessions** are a signed, stateless cookie — no server-side session table,
so nothing new needs to survive a restart beyond the `users` table itself
(already durable, being in SQLite on the volume). The cookie payload is
`<userId>.<issuedAt>.<hmac-of-both>`, HMAC-SHA256 over `userId.issuedAt` with
a secret from `SESSION_SECRET`. `verifySession()` recomputes the HMAC with
`timingSafeEqual`, then separately checks `issuedAt` against a 30-day max
age **on every request** — not just relying on the cookie's own `maxAge`,
which is a browser-only hint a copied/stolen cookie would otherwise ignore
forever. This is deliberately stateless (no in-memory session map) because
`fly.toml`'s `auto_stop_machines`/`min_machines_running = 0` means the
machine frequently cold-starts from zero — an in-memory session store would
silently log out every visitor on every cold start.

`src/middleware.ts` runs this check once per request and sets
`Astro.locals.user`, so no page independently parses the cookie.

**`SESSION_SECRET`**: a required env var outside local dev. Locally, a
hardcoded dev-only fallback is used (never in production — gated on
`import.meta.env.DEV`). In production, a **missing** `SESSION_SECRET`
throws at the point `src/lib/auth.ts` is first imported, failing the request
loudly, rather than silently falling back to a secret that would sit in
plaintext in this (eventually public) repo — that fallback would let anyone
forge a session for any `userId`. Set it with
`flyctl secrets set SESSION_SECRET=<random> -a <this-repo-name>`; never
commit it to `fly.toml`'s `[env]` block, which is tracked.

## Design system — `src/styles/global.css` + `src/layouts/Layout.astro`

Paper and ink, not software chrome: color is spent distinguishing the
product's own kinds of attention (warm `--ember` = faded/past, cool
`--presence` = live/present, and a third family, `--note-1` through
`--note-5` plus `--note-overlap` = *whose* note this is — a user picks one
of the five on `/profile/`; `--note-overlap` is reserved for text more than
one author has annotated and is never user-selectable). Each `--note-*`
value was checked for ≥5:1 contrast against `--ink` text on top of it,
matching the old static mark color's own ratio. This is a deliberately
separate token family from `--ember`/`--presence` — those two encode *kind*
of attention, not *who*, and a per-author palette is a third, different kind
of meaning. Tokens (colors, the two type families — **Literata** for the
text and headings, **Work Sans** for UI chrome — spacing scale) live in
`global.css`'s `:root`; `Layout.astro` loads the fonts and wraps every page
(`index.astro`, the room page, `/profile/`, `readme/index.astro`) so they
all stay visually consistent. Change a token in one place, not per-page.

**Three width tokens, each with one job.** `--measure` (34rem) is a reading
line length, for prose only. `--page-width` (56rem) is `.page`'s own outer
width on every page — room to breathe, *not* a reading measure. `--room-width`
(`--measure` + the sidebar's gap and width, ≈49rem) is wider still, used only
by the room page for its text+sidebar grid. `.site-nav` matches whichever of
`--page-width`/`--room-width` its page uses, via
`.site-nav:has(~ .room-page)` — the nav sits *before* the page content in the
DOM (the layout's nav, then `<slot />`), so a plain `~`/`+` combinator can't
reach forward to detect which page follows it; only `:has()` with a relative
selector can.

**The actual bug, and the wrong fix that preceded this one.** Several
elements that want `--measure` for readability (`.prose`, the room page's
`.room-description`) were given `max-width: var(--measure)` with no
`margin: auto` of their own, inside a `.page` that was *wider* than
`--measure` — so they sat flush-left with dead space to their right, instead
of either filling the page or centering as an island within it. The first
attempt at fixing this made `.page` itself `--measure` by default, which
*does* make flush-capped elements fill their container — but it also
shrank every other page (home, readme) to the reading measure, which was
too narrow, and it missed `.room-description`, which inherited the room
page's wider `--room-width` container and was still flush-left same as
before, just against a different number. The actual fix has two parts,
applied per element based on what it actually is:
- An element that's an **island of prose inside a wider page** (`.prose` on
  `/readme/`) gets `max-width: var(--measure)` **and** `margin: 0 auto`, so
  it centers.
- An element that's **just more body text at the same left edge as the
  heading above it** (`.room-description`, sitting directly under the room's
  title and byline) gets **no cap at all** — matching its siblings' width is
  more consistent than introducing a narrower, flush-left block beside them.
  (`.lede` and `.room-excerpt` on the homepage are a third, legitimate case:
  short one-line text that's fine flush-left at `--measure`, same as the
  headings above them, precisely because the page itself isn't drastically
  wider than that measure — don't generalize "always center" or "never cap"
  from this; it depends on whether the surrounding page width makes a bare
  cap look like a mistake.)

If you add a page wider than `--page-width`, or a new prose block inside an
existing wide page, decide explicitly which of these three shapes it is
rather than copying whichever nearby rule looks similar.

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

Every room is an instance of a fixed, curated **text**, not arbitrary
content. `scripts/library/manifest.json` is an array of entries
(`slug`, `title`, `author`, `kind` — `"poem" | "play" | "book"` —,
`sourceNote`, `description`, `file`), one per work; the actual excerpt text
for each lives alongside it in `scripts/library/texts/<file>`. This is a
build-time asset (committed to the repo), not a database table.

**Two separate claims, don't conflate them**: adding a new *text* to the
library (a new manifest entry + text file) is still CLI/hand-edit-manifest
only — there is deliberately no "add a text through the app" path for that.
Spinning up a new *room* from a text already in the library, by contrast,
is now in-app (`POST /api/rooms`, "Start a room" on the homepage) as well
as by hand (`scripts/seed-from-library.ts`) — see "What the app does" above.

A room is one **instance** of a library entry: creating a room from
`macbeth` the first time makes a room titled "Macbeth #0001" at
`/room/macbeth-0001/` (or the creator's own title, if made through the
form); doing so again makes a separate room, "Macbeth #0002", with its own
independent live state and heat — the two never share presence, notes, or
history. `rooms` stores a copy of the entry's
title/author/kind/sourceNote/description at creation time
(`src/lib/schema.ts`), not a foreign key to the manifest, so a room's
displayed metadata is exactly what it was created with even if the manifest
is edited afterward — editing `manifest.json` only affects rooms created
*after* the edit. `src/lib/library.ts`'s `displayName()` is the single
place a room's display name is computed (the creator's `customTitle` if
set, else `"<title> #<instance, zero-padded to 4>"`); use it rather than
reassembling the string elsewhere.

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

## Creating rooms — by hand (seeding) or through the app

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
`allowImportingTsExtensions` comment). This remains the only way to add a
new *text* to the library (see "The text library" above), and is still the
right tool for bulk/admin seeding.

**The same instance-allocation logic, made concurrency-safe for the app.**
`createRoom()` (`src/lib/db.ts`) reuses the identical
read-max-then-insert-at-`+1` scheme, but a CLI script run by one operator
can never race itself the way concurrent HTTP requests to `POST /api/rooms`
can. `createRoom()` wraps the read-then-insert in a bounded retry loop (5
attempts): if two requests for the same `textSlug` compute the same
`instance` and one insert loses on `rooms_text_slug_instance_idx`, it
re-reads the now-current max and retries, rather than surfacing a raw
constraint error to the user. No transaction/locking scheme is needed —
better-sqlite3 is synchronous, so each attempt is atomic with respect to
JS's single-threaded execution; the loop only exists for the case where a
*different* request's insert already committed between this request's read
and its own insert.

For production: the Dockerfile copies `scripts/seed-from-library.ts`,
`scripts/library/`, and `src/lib/schema.ts` into the runtime image
specifically so this works unchanged against the real Fly volume via
`flyctl ssh console -a <app-name> -C "node scripts/seed-from-library.ts <text-slug>"`.
If you add a script that needs to run against the production database, this
is the pattern to copy — don't invent an admin HTTP endpoint for it just
because `POST /api/rooms` now exists for the *user-facing* creation path;
admin/bulk operations are deliberately kept as hand-run scripts, not app
routes.

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
- No server-side session revocation list: a session cookie remains valid
  until its own 30-day expiry even if the account's password changes in the
  meantime. Changing a password does not invalidate previously issued
  session cookies, since the signed payload covers only `userId` + issue
  time, not a password version. Deliberate scope boundary for this app's
  size, not an oversight.
- No login rate-limiting or lockout. Same reasoning as above.
- No rate-limiting on room creation either — one account can create as many
  rooms as it likes. Same deliberate scope boundary.
- **A room-full rejection can race.** The room page's SSR check and the SSE
  endpoint's own check (`src/pages/api/room/[slug]/events.ts`) aren't
  atomic with each other — a room can fill in the gap between page render
  and the client opening its `EventSource`. If that happens, the SSE
  endpoint's `403` is the one that actually fires, but `EventSource` gives
  no access to a failed connection's HTTP status in `onmessage`, and its
  default behavior is to retry silently and indefinitely. The visible
  result in that rare case: the static server-rendered text stays fully
  readable, but live presence/notes never populate and no explicit "this
  room filled up" message appears. Not chased further since the common
  case (checked at page-load) is handled and this race is both rare and
  non-adversarial here.
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
| Add or change what's logged server-side | `src/lib/log.ts` — keep it to real activity (join/leave/note/fade), not continuous signals like location, and never a note's own text |
| Touch login/signup/sessions | `src/lib/auth.ts`, `src/middleware.ts`, `src/pages/index.astro` — not the room page, login/signup lives on the homepage only |
| Touch the profile page (name, color) | `src/pages/profile/index.astro`, `src/pages/api/profile.ts`, `src/lib/palette.ts` |
| Add a route | `src/pages/api/room/[slug]/` for API shape, `src/pages/room/[slug]/index.astro` for the page |
| Change how notes/heat render | `src/scripts/margins-client.ts` (client), `src/lib/heat.ts` (shared density math) |
| Change colors, type, or spacing | `src/styles/global.css` tokens — not per-page overrides |
| Touch the homepage's per-room stats (presence/created/last-annotated) | `presenceCount()` in `src/lib/rooms.ts`, `listRoomsWithActivity()` in `src/lib/db.ts`, formatting in `src/lib/library.ts` — always go through `parseSqliteTimestamp()` for any stored timestamp, never `new Date(stored)` directly |
| Style something margins-client.ts builds with `createElement` | needs `:global()` in that page's `<style>` — see "Design system" above |
| Add, edit, or remove a library text | `scripts/library/manifest.json` + `scripts/library/texts/` — editing an existing entry only affects rooms created afterward |
| Seed a room from the library by hand | `scripts/seed-from-library.ts <text-slug>`; production via `flyctl ssh console` (see above) |
| Create a room through the app | `src/pages/api/rooms.ts`, `createRoom()` in `src/lib/db.ts`, `listLibraryEntries()`/`getLibraryEntry()`/`readLibraryText()` in `src/lib/library.ts` |
| Touch room capacity / "this room is full" | `isPresent()` in `src/lib/rooms.ts`, the room page's frontmatter, `src/pages/api/room/[slug]/events.ts` |
| Know what's mechanically checked vs. judged by a person | `spec/README.md` |
| Know what's fixed about the deploy vs. what's this app's choice | `fly.toml`, `Dockerfile` (both have comments marking the line) |
| The published brief/spec for this week | the course site — CLAUDE.md links it |
| Why the stack is Astro+Node+SSE+SQLite specifically | PROCESS.md's decision record, once written |
