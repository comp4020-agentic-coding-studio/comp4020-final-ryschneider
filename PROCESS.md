# Process overview

*Current as of crit 9. Rewritten from scratch, not patched from crit 8.*

## Current state (crit 9)

Margins is a shared reading room for a single text. A reader opens the room, selects a passage and leaves a short note. Every other connected reader sees the mark appear, spread along the page and cool. Notes are persisted. Heat is derived from them, not stored. It is deployed on Fly.io from a Docker image.

Since crit 8:

- **Redesign.** The app had been unstyled HTML. It now has a real visual identity.
- **Join-gate fix.** The room text had ended up gated behind joining, so a visitor couldn't read the text until they had joined. The fix stops gating the text. Joining is now only about taking part.
- **Note-text visibility.** A mark used to show only who had left a note. It now shows the note's actual text.

Still not built: accounts beyond a display name, more than one text per club, moderation, a considered mobile layout, and anything that works across more than one machine. Known-rough: the fade constants were tuned by eye, not derived from anything.

## The crit 9 decision: who a mark reaches

**Question.** When a reader leaves a note, who sees it live, and what happens to the mark afterwards?

**Decision.** A mark's reach is fixed at the moment it is written. It belongs to the readers present in the room at that instant, its *carriers*. The mark stays visible while at least one carrier is still in the room, and it is gone the instant the last carrier leaves. Readers who arrive later do not inherit it.

**Alternative I didn't pick.** Extend every mark to every later viewer, so anyone who opens the room sees all the marks written so far. That is the more familiar behaviour, and it is what most annotation tools do. It treats the margin as a document that grows, not as a shared moment.

**What my choice costs.**
- A reader who joins late sees a quieter page than the people who were there earlier. They miss marks that were real and that other people are still looking at.
- A mark can disappear from view while the evening is still going, if its carriers happen to leave before others do.
- It is harder to explain to a first-time visitor than "everything anyone ever wrote is here".

I accept these because the room is meant to feel like attention that is happening now, not an archive. The notes themselves are still persisted, so nothing the group wrote is lost across sessions. What the rule controls is what is live in front of readers, not what is kept.

**How it traces back to "good".** My argument is that a fixed carrier set is the only one of the two options where a mark's visibility depends on who was actually there together. Extend-to-every-viewer would make the room an archive, and thatw is not what I said "good" means.

## Stack decision

I chose Astro with Node SSR over a plain SPA with a separate API server, and over a heavier full-stack framework. Astro gives server-rendered text pages, which suits an app whose main content is a document, and I ship client code only in the live islands. A separate API server would have meant two deploys and two sets of types for an app this size.

The transport trade-off matters most. I used server-sent events for pushing updates and ordinary POSTs for writes, not WebSockets. Readers mostly receive and write occasionally and briefly. SSE reconnects on its own, passes through Fly's proxy without special handling, and keeps the write path as plain, testable HTTP.

The cost is a scaling ceiling. Fan-out runs through an in-process EventEmitter, so live updates only reach clients on the same machine. That is fine for a club of a dozen people on one instance. Going past it would need a shared pub/sub layer, which is out of scope.

On persistence, I rejected both extremes: keeping everything in memory (a reading club returns to the same text across evenings, so losing the margins would defeat the point) and persisting every transient event (writing constantly for no benefit). Durable facts are stored. Anything that can be recomputed is not. Live state can be rebuilt after a restart.

## Workflow / harness

CLAUDE.md holds rules I hold the agent to, each closing off a specific failure I saw or nearly saw:

- Flag a mismatch between a literal instruction and the platform instead of forcing it through.
- Surface assumptions the moment the agent would otherwise pick one silently, tied to choices that change what a reader sees.
- Keep production code free of side effects that exist only for demos.
- Cite commits only after they exist.

Added or tightened this week: One harness-adjacent moment: the agent flagged the factual error in the carrier-set paragraph of this document and I fixed it ([commit](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/b8e1798fcc82277e819a7a688c0a88c298462af6)). That is the "surface assumptions" rule working on the writing as well as the code.

Still missing: a rule for when a correction should change the harness itself rather than one file, and a standing expectation about commit granularity so this document's evidence section can be built from the history.

## Directing the agent this week

**Decided by me:** the redesign direction (a real visual identity in place of unstyled HTML); the propagation/fade rule and its fixed carrier set; and that a note should show its actual text and not just its author.

**Delegated:** implementation, the wiring between the event stream and the rendering, and most scaffolding. The redesign build and the two fixes below were committed jointly by me and the agent.

**Moments worth recording:**

1. **The carrier-set question.** Writing a mark meant choosing between fixing its reach to the readers present at that moment, or extending it to everyone who views the room later. The agent didn't default to either. It asked me directly as an either/or. I chose the fixed set, for the reasons in the decision above. I'm recording this because the choice changes what every reader sees, which is exactly the kind of assumption the harness says should be surfaced and not picked silently.
2. **The gate regression.** The room text had been gated behind joining. I caught it and had it removed, since reading should never require joining first ([commit](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/0847400f6114441e1cebff044613553a17871fd6)).
3. **Demo seeding (carried from crit 8).** The agent proposed seeding a demo room automatically so the deployed app never looks empty. I declined: production code shouldn't silently create data to flatter a first impression. Seeding is a separate, deliberate script, and the agent had to make it import the app's real modules instead of copying the rule into the script, since a copy would drift.
4. **The deploy-script flag (carried from crit 8).** The agent declined to run a GitHub Pages-style setup script against a Docker and Fly repo and said why. I'd rather get that flag than a working-looking mismatch.

## Evidence

This week (Oct 12):

- Redesign, a real visual identity instead of unstyled HTML: [c65dfb4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/c65dfb4bf28ecd92f6cc7cfb1c48573610d2ce22)
- Join-gate fix, stop gating the room text behind joining: [0847400](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/0847400f6114441e1cebff044613553a17871fd6)
- Note-text visibility, show a note's actual text and not just who left it: [f60be17](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/f60be17bbe25677b470ec201969e1094a87e29d1)
- Correction of the carrier-set account in this document: [b8e1798](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/b8e1798fcc82277e819a7a688c0a88c298462af6)
- Carrier-set rule (fixed reach, fade-to-heat), first built in: [cb788fe](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/cb788fe10afeafa7a4c5a4f33bd282623d792f17)

Earlier, for the carried-over decisions:

- Astro with server output as the stack: [848d501](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/848d50159584d86c1a13c0b6437e99cb69f8f248)
- Technical reference for the codebase (ARCHITECTURE.md): [23f34c4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/23f34c45107e304aa78ea8a42c73c5ffb50ce095)
- Seeding as a separate step: homepage links to actual seeded rooms, [cd82846](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/cd828469000f21661e28fb1b11fc2cc15aa37fe0), and the demo room's placeholder text replaced with a Macbeth excerpt, [9e76e6f](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/9e76e6fd03219f546ef9bc0236ff1d7088859572)
- Crit 8 write-up of README, PROCESS, CLAUDE.md: [02b6c68](https://github.com/comp4020-agentic-coding-studio/comp4020-final-ryschneider/commit/02b6c6810291fc3e41d34fdcbba27d8f573705d2)
