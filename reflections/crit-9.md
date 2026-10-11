# Crit 9 reflection

## What surprised me

- `curl` and vitest never caught the join-gate bug, where the room text and the join form rendered at the same time. Every check I had passed. Only a real headless-browser screenshot showed it.
- A second screenshot showed something worse. The `<mark>` and presence elements had never been styled at all. They were silently unstyled, and nothing in my test setup could have told me.
- Both bugs were already in the code before this week. I didn't introduce either one. I just hadn't looked at the app the way a reader does until now.

## A correction I made

- Fixing the `[hidden]` cascade bug had a side effect. It also hid the room text behind the join form.
- I caught that this broke something I care about: a stranger should see the text without joining.
- I reverted it so that only the live features are gated. Reading is never gated.

## A bug found live, after I thought I was finished

- When two people annotated the same or overlapping selections, the visible text was duplicated.
- It surfaced because someone actually tried it. Nothing I had written would have found it.
- The cause was the old approach: one mark per note, placed at a running cursor through the paragraph. That doesn't hold up once notes overlap.
- The fix is to segment the paragraph by the union of every note's boundaries. Each segment is emitted once, and each segment knows which notes cover it.
- This is also my answer to the crit's "what happens when two people change the same thing at once" question. Overlapping changes combine into the same text, split at every boundary. Neither one wins, and nothing is duplicated.

## A trade-off I considered and rejected

- The CSS Custom Highlight API would overlay each note's range independently without restructuring the DOM. That is closer to a pure overlay model.
- I rejected it because it gives no per-highlight DOM element. Without one there is nothing to hang a hover or click popover off, and the app has to show who wrote what.
- The cost of staying with real elements is that the paragraph gets restructured into segments (see above). I decided that is worth paying for the popover.

## What's still rough going into crit 10

- Live fan-out runs on a single machine through an in-process EventEmitter. Moving past one instance needs a shared pub/sub layer.
- There is no decay after a mark fades.
- The fade constants were tuned by eye, not derived from anything.
- Still not built: accounts beyond a display name, more than one text per club, moderation, and a considered mobile layout.

## What I'd warn a friend about

- Don't trust `curl` or unit tests to tell you a live, visual app works. Screenshot it in a real browser early. Both of my invisible bugs lived exactly where those tools can't see.
- Then get another person to use it at the same time as you. The overlapping-notes bug only showed up when someone tried to break it.
