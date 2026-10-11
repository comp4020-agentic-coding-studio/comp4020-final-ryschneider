# Process overview

## Current state (crit 8)

Built: a shared reading room for a single text, with live annotations pushed to every connected reader, persisted annotations, and the propagation/fade rule that turns individual notes into attention marks along the page. It is deployed on Fly.io from a Docker image.

Not built: accounts beyond a display name, more than one text per club, moderation, a considered mobile layout, and anything that works across more than one machine.

The core loop works end to end: a reader opens the room, selects a passage, leaves a short note, and every other connected reader sees the mark appear and then watch it spread and cool. That loop is the thing I'm judging this crit against, and it is the part I'm least willing to leave rough.

Known-rough: the fade constants were tuned by eye rather than derived from anything; heat is rendered at a coarser granularity than I would choose with more time; and the empty-room state, which is what a first-time visitor sees, is plainer than it should be.

## Stack decision

I chose Astro with Node SSR over the alternatives I actually weighed: a plain SPA with a separate API server, and a heavier full-stack framework. Astro gives me server-rendered text pages, which suits an app whose main content is a document, and lets me ship small islands of client code only where the page is live. A separate API server would have meant two deploys and two sets of types for an app this size.

The trade-off that matters most is transport. I went with server-sent events for pushing updates and ordinary POST requests for writes, rather than WebSockets. Readers mostly receive; they write occasionally and briefly. SSE reconnects on its own, passes through Fly's proxy without special handling, and keeps the write path as plain, testable HTTP. WebSockets would buy bidirectional chatter I don't need.

The cost is a scaling ceiling. Fan-out runs through an in-process EventEmitter, so live updates only reach clients connected to the same machine. That is acceptable for a club of a dozen people and a single instance, and I'd rather state the ceiling than hide it. Moving past it would mean a shared pub/sub layer, which is out of scope this week.

I also considered keeping everything in memory and persisting nothing, since a live room feels ephemeral. I rejected that because a reading club returns to the same text across several evenings, and losing the margins between sessions would defeat the point. The opposite extreme, persisting every transient event including each fade tick, would have written constantly for no benefit. So the line sits between them: durable facts are stored, and anything that can be recomputed is not.

On state: annotations are persisted, and the derived heat is computed from them rather than stored as its own source of truth. Live state can be rebuilt after a restart; nothing the group cares about lives only in memory.

## Workflow / harness

CLAUDE.md holds the rules I actually hold the agent to rather than general good practice. The ones that earn their place are: flag a mismatch between a literal instruction and the platform instead of forcing it through; surface assumptions the moment the agent would otherwise pick one silently; keep production code free of side effects that exist only for demos; and cite commits only after they exist.

The common thread is that each rule closes off a specific failure I saw or nearly saw, rather than guarding against failure in general. A rule about flagging assumptions is only useful if the agent can tell which assumptions count, so I tied it to choices that change what a reader sees.

What I'd still like it to cover: a clearer rule for when a correction should change the harness itself rather than just a single file, and a standing expectation about how finely to split commits so the evidence section writes itself.

## Directing the agent this week

I decided the shape of the product, the stack, the SSE choice, and the rule for how attention spreads and fades. I delegated the implementation, the wiring between the event stream and the rendering, and most of the scaffolding.

Three corrections are worth recording.

First, the carrier-set call. [FACT CORRECTED, REWRITE IN YOUR OWN WORDS: the shipped behaviour is the opposite of what this paragraph said — a mark's reach is FIXED to whoever was present the moment it was written, not extended to every later viewer. The agent asked this as a direct either/or question rather than defaulting to one side; this paragraph's "agent's instinct vs. I pushed back" framing doesn't match what happened and needs rewriting alongside the fix.]

Second, the demo room. The agent proposed seeding a demo room automatically so the deployed app would never look empty. I said no: production code shouldn't silently create data to flatter a first impression. Seeding is a deliberate, separate step.

Third, the seeding script. Once seeding was a separate script, it couldn't import the app's modules cleanly, and the agent had to solve that properly instead of duplicating logic into the script. That mattered because a copy of the rule would drift from the real one.

A fourth, smaller moment: a setup script written for a GitHub Pages style deploy was available, and the agent declined to run it against a Docker and Fly repo where it didn't fit, and said so instead of bending the repo to match. I'd rather get that flag than a working-looking mismatch.