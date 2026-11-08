# Process overview

*Current as of submission. Rewritten from scratch, not patched from crit 9.*

## Current state

Margins is a shared reading room for a text. A reader signs up, picks a text or opens an existing room, selects a passage and leaves a short note. Every other connected reader sees the mark appear in that author's colour, spread along the page, and cool. Notes persist as heat once they fade; it's deployed on Fly.io from a Docker image.

Since crit 9, three things changed what the app actually is, not just how it looks:

- **Real accounts.** Logging in used to mean typing a name into `sessionStorage`, gone the moment the tab closed, no password, no identity beyond one browser. It's now a real username-and-password account with a signed session cookie that survives closing the browser and follows you across devices. A profile page lets you rename yourself and pick a highlight colour from a curated set, and every note and presence entry now renders in its author's own colour.
- **Rooms made by readers, not just by me.** Every room used to come from a script I ran by hand. Now any logged-in reader can start one: pick a text, give it a title that replaces the auto-generated name, set how many people it's for. The script still exists for bulk seeding, but it's no longer the only way a room comes to exist.
- **A capacity the room can actually enforce.** A room with a cap rejects a new occupant once full, both in what the page shows and what the server will let connect — someone already present is never treated as new on a reload.

Still not built: moderation, a considered mobile layout beyond basic responsiveness, rich text, and anything that works across more than one machine. Known-rough: the fade constants were tuned by eye, not derived from anything; there's no rate limit on logins or on room creation.

## The carrier-set decision, carried forward

A mark's reach is fixed at the moment it's written: it belongs to the readers present then, its *carriers*, and it's gone the instant the last carrier leaves. Adding accounts meant the live engine's identity key had to move from a bare display-name string to a stable account id, so renaming yourself on the profile page could never retroactively corrupt which notes you'd written or who was carrying them. The rule itself didn't change — a note's name and colour are now snapshotted onto it at write time, the same way the carrier set already was, instead of looked up live from the account. Editing your name mid-session doesn't rewrite a note you already wrote, for the same reason the carrier set was never rewritable after the fact.

## This week's decision: who opens a room, and how full is full

**Question.** Letting readers create rooms raises two things a seed script never answered: two people creating a room from the same text at once, and what "full" actually does.

**Decision.** Creation reuses the seed script's instance-numbering, wrapped in a retry loop — a collision re-reads and retries rather than failing. Capacity is checked twice: once when the room page renders, so a full room shows a plain message, and again by the server when a connection tries to open, since the two moments aren't atomic and the second check is the one that can't be talked around.

**Alternative I didn't pick.** Treat "max size" as a number on the page, not a rule anyone actually enforces. I rejected it because a cap that doesn't cap anything isn't a decision about size, it's a label.

**How it traces back to "good."** If I enforce size but not creation, a room is still something only I can start; if anyone can start one but nothing caps it, "max people" is decoration. Both halves had to be real.

## Stack decision (unchanged)

Astro with Node SSR, SSE for push, SQLite via better-sqlite3 and drizzle, one Fly machine and one volume. Accounts added a `users` table and a signed cookie; room creation added three *nullable* columns to `rooms`, specifically so adding them needed no destructive migration against the table's real, permanent, reader-created rows — unlike an earlier schema change against a table that held nothing worth keeping.

## Workflow / harness

CLAUDE.md's rules held through this stretch, plus one addition: "production code stays honest" originally meant no demo data or auto-seeding, written when a script was the only way a room existed. Once readers could create rooms themselves, the rule needed a line saying a reader-created room is real data, not a fixture — the agent proposed the exact wording and waited for my yes before touching the file, which is the harness's own "corrections that apply to a pattern" rule working on itself.

**Decided by me:** real cross-device accounts over a longer-lived cookie; a creator's title replacing the auto-generated one rather than sitting beside it; a full room rejecting outright rather than just displaying a number. **Delegated:** the session design, password hashing, the room-instance retry logic, and the two-layer capacity check.

**Moments worth recording:**

1. **CI never had a session secret.** The app refuses to start without one in production, a deliberate fail-loud choice against a guessable fallback — and that same check caught the checks workflow itself, which never supplied one. Fixed with a throwaway CI-only secret, not by loosening the real check.
2. **Reversing a standing rule required asking first.** "Rooms are seeded by hand" was a deliberate constraint in both CLAUDE.md and ARCHITECTURE.md. Asked for in-app creation, the agent flagged the conflict and asked three separate questions before writing anything, rather than picking an answer and building around it.
3. **A UI change surfaced a stale document, not just stale code.** A pre-submission check caught this document and README.md both still describing crit-9 state after accounts and room creation had shipped on top of it — README's own "not trying to be good at accounts" line had gone false. That's the gap this rewrite closes.

## Evidence

Since crit 9 (Nov 3–5):

- Real accounts, session cookies, profile page, per-author colour: [c2d1c05](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/c2d1c055cce6940509b5ef3ec49d10577363c670)
- Fixing CI's missing session secret: [4e4dea5](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/4e4dea5f81c23b082d006e0cb13520d0b70be480)
- In-app room creation, retry-safe instance allocation, two-layer capacity check: [398124e](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/398124e7cdf9fa920b966e95d87f9c7bb651feee)
- Room creation behind a button and modal, fields stacked vertically: [4d5cdb6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/4d5cdb65a6e22cf7702b020fd2af9e171bb453ba)
- Room list sorted by creation time, stats stacked: [3c0a042](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/3c0a04264af25e1008359eccf8063627bf5a5de0)

Carried over:

- Carrier-set rule, first built in: [cb788fe](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/cb788fe10afeafa7a4c5a4f33bd282623d792f17)
- Login moved to the homepage: [f5df116](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/f5df116bfee9e0eda781805d41ab7d91690e092f)
- The curated 30-text library: [b37c636](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/b37c6360bbf3e4fcc06ee003011603948916970e)
- Astro with server output as the stack: [848d501](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/848d50159584d86c1a13c0b6437e99cb69f8f248)
- ARCHITECTURE.md, kept current with every structural change: [23f34c4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/23f34c45107e304aa78ea8a42c73c5ffb50ce095)
