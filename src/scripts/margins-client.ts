import { paragraphDensities, type Span } from "../lib/heat";

interface RoomData {
  slug: string;
  paragraphs: { start: number; end: number; text: string }[];
  heatMarks: Span[];
}

interface RoomUser {
  username: string;
  color: string;
}

interface LiveNoteView {
  id: number;
  start: number;
  end: number;
  handle: string;
  color: string;
  text: string;
}

interface PresenceEntry {
  handle: string;
  color: string;
  offset: number | null;
}

type ServerEvent =
  | {
      type: "snapshot";
      presence: { userId: number; handle: string; color: string; offset: number | null }[];
      notes: ({ userId: number } & LiveNoteView)[];
    }
  | { type: "join"; userId: number; handle: string; color: string }
  | { type: "leave"; userId: number }
  | { type: "location"; userId: number; offset: number }
  | ({ type: "note"; userId: number } & LiveNoteView)
  | { type: "fade"; id: number; start: number; end: number };

const LOCATION_THROTTLE_MS = 400;

export function initRoom(user: RoomUser): void {
  const dataEl = document.getElementById("room-data");
  const data = JSON.parse(dataEl?.textContent ?? "null") as RoomData | null;
  if (!data) return;

  const { slug, paragraphs } = data;
  const heatMarks: Span[] = [...data.heatMarks];
  // Presence and notes are keyed by userId server-side (a rename on
  // /profile/ must never relabel content tied to an old handle), but
  // display only ever needs the handle/color snapshotted at connect/write
  // time --- this map carries exactly that, nothing more.
  const presence = new Map<number, PresenceEntry>();
  const notes = new Map<number, LiveNoteView>();

  const presenceEl = document.getElementById("presence");
  const textEl = document.getElementById("room-text");
  if (!presenceEl || !textEl) return;

  const paragraphEls = [...textEl.querySelectorAll<HTMLElement>("[data-start]")];

  // Identity (username + session cookie) is already established server-side
  // --- this connection just needs a fresh per-tab id to distinguish it from
  // any other open tab for the same account.
  const connectionId = crypto.randomUUID();
  let joined = false;
  let lastSentOffset: number | null = null;
  let lastSentAt = 0;

  function paragraphIndexFor(offset: number): number {
    const i = paragraphs.findIndex((p) => offset >= p.start && offset < p.end);
    return i === -1 ? paragraphs.length - 1 : i;
  }

  function renderPresence(): void {
    presenceEl!.innerHTML = "";
    const list = document.createElement("ul");
    for (const entry of presence.values()) {
      // Usernames are unique per account, so comparing handles here is an
      // exact "is this me" check, same as before --- no need for the
      // client to know its own userId just to skip itself in the list.
      if (entry.handle === user.username) continue;
      const li = document.createElement("li");
      const where = entry.offset === null ? "just arrived" : `near paragraph ${paragraphIndexFor(entry.offset) + 1}`;
      li.textContent = `${entry.handle} — ${where}`;
      li.style.color = entry.color;
      list.appendChild(li);
    }
    presenceEl!.appendChild(list);
  }

  function notesForParagraph(index: number): LiveNoteView[] {
    const p = paragraphs[index];
    return [...notes.values()]
      .filter((n) => n.start < p.end && n.end > p.start)
      .sort((a, b) => a.start - b.start);
  }

  function renderParagraph(index: number): void {
    const p = paragraphs[index];
    const el = paragraphEls[index];
    if (!el) return;

    el.style.setProperty("--heat", String(paragraphDensities([p], heatMarks)[0]));

    const overlapping = notesForParagraph(index);
    el.textContent = "";

    if (overlapping.length === 0) {
      el.appendChild(document.createTextNode(p.text));
      return;
    }

    // Walk segments between every note's (clipped) start/end, rather than
    // appending one mark per note at its own cursor position --- two notes
    // on the same or overlapping span used to each re-render their own
    // copy of the covered text, visibly duplicating it. A segment covered
    // by more than one note renders as a single mark combining all of them.
    const bounds = new Set<number>([p.start, p.end]);
    for (const note of overlapping) {
      bounds.add(Math.max(note.start, p.start));
      bounds.add(Math.min(note.end, p.end));
    }
    const points = [...bounds].sort((a, b) => a - b);

    for (let i = 0; i < points.length - 1; i++) {
      const segStart = points[i];
      const segEnd = points[i + 1];
      if (segStart >= segEnd) continue;
      const segmentText = p.text.slice(segStart - p.start, segEnd - p.start);
      const covering = overlapping.filter((n) => n.start <= segStart && n.end >= segEnd);

      if (covering.length === 0) {
        el.appendChild(document.createTextNode(segmentText));
        continue;
      }

      const mark = document.createElement("mark");
      mark.dataset.noteId = covering.map((n) => n.id).join(",");
      // A segment more than one author has annotated renders in a neutral
      // shared color, not either individual author's --- it isn't "theirs",
      // it's everyone's. A single-author segment uses that author's own
      // chosen color.
      mark.style.backgroundColor = covering.length === 1 ? covering[0].color : "var(--note-overlap)";
      // title is the accessible fallback (screen readers, no-JS tooltip);
      // data-note drives the visible popover in CSS, since generated
      // ::after content isn't reliably announced. Multiple notes covering
      // the same segment are joined, not picked one-of.
      const summary = covering.map((n) => `${n.handle}: ${n.text}`).join(" / ");
      mark.title = summary;
      mark.dataset.note = summary;
      mark.tabIndex = 0;
      mark.textContent = segmentText;
      // Tap-to-toggle so the note is readable on touch, where :hover never
      // fires; mousedown (not click) so a drag-selection starting on an
      // existing mark doesn't also toggle it open.
      mark.addEventListener("mousedown", (e) => e.stopPropagation());
      mark.addEventListener("click", (e) => {
        e.stopPropagation();
        mark.classList.toggle("open");
      });
      el.appendChild(mark);
    }
  }

  function renderAllParagraphs(): void {
    for (let i = 0; i < paragraphs.length; i++) renderParagraph(i);
  }

  function paragraphsOverlapping(start: number, end: number): number[] {
    const indices: number[] = [];
    paragraphs.forEach((p, i) => {
      if (start < p.end && end > p.start) indices.push(i);
    });
    return indices;
  }

  function connect(): void {
    // No handle query param anymore --- identity comes from the session
    // cookie, read server-side (see src/pages/api/room/[slug]/events.ts).
    const es = new EventSource(`/api/room/${slug}/events?connectionId=${encodeURIComponent(connectionId)}`);
    es.onmessage = (ev) => {
      const event = JSON.parse(ev.data) as ServerEvent;
      switch (event.type) {
        case "snapshot": {
          presence.clear();
          for (const p of event.presence) presence.set(p.userId, { handle: p.handle, color: p.color, offset: p.offset });
          notes.clear();
          for (const n of event.notes) {
            notes.set(n.id, { id: n.id, start: n.start, end: n.end, handle: n.handle, color: n.color, text: n.text });
          }
          joined = true;
          renderPresence();
          renderAllParagraphs();
          break;
        }
        case "join":
          presence.set(event.userId, { handle: event.handle, color: event.color, offset: null });
          renderPresence();
          break;
        case "leave":
          presence.delete(event.userId);
          renderPresence();
          break;
        case "location": {
          const entry = presence.get(event.userId);
          if (entry) presence.set(event.userId, { ...entry, offset: event.offset });
          renderPresence();
          break;
        }
        case "note": {
          notes.set(event.id, {
            id: event.id,
            start: event.start,
            end: event.end,
            handle: event.handle,
            color: event.color,
            text: event.text,
          });
          for (const i of paragraphsOverlapping(event.start, event.end)) renderParagraph(i);
          break;
        }
        case "fade": {
          notes.delete(event.id);
          heatMarks.push({ start: event.start, end: event.end });
          for (const i of paragraphsOverlapping(event.start, event.end)) renderParagraph(i);
          break;
        }
      }
    };
  }

  connect();

  // Reading location: a loose, best-effort signal only --- throttled, and
  // never sent before the server has confirmed we've joined.
  textEl.addEventListener("pointermove", (e) => {
    if (!joined) return;
    const now = Date.now();
    if (now - lastSentAt < LOCATION_THROTTLE_MS) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-start]");
    if (!target) return;
    const offset = Number(target.dataset.start);
    if (offset === lastSentOffset) return;
    lastSentOffset = offset;
    lastSentAt = now;
    fetch(`/api/room/${slug}/location`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId, offset }),
    }).catch(() => {});
  });

  // Selection -> note: an explicit affordance, never auto-posted.
  function localOffsetInParagraph(container: HTMLElement, node: Node, localOffset: number): number {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let total = 0;
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if (n === node) return total + localOffset;
      total += n.textContent?.length ?? 0;
    }
    return total;
  }

  function resolveSelectionOffsets(): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const resolve = (node: Node | null, localOffset: number): number | null => {
      const container = node instanceof Element ? node : node?.parentElement;
      const p = container?.closest<HTMLElement>("[data-start]");
      if (!p) return null;
      return Number(p.dataset.start) + localOffsetInParagraph(p, node!, localOffset);
    };
    const a = resolve(sel.anchorNode, sel.anchorOffset);
    const b = resolve(sel.focusNode, sel.focusOffset);
    if (a === null || b === null) return null;
    return a < b ? { start: a, end: b } : { start: b, end: a };
  }

  textEl.addEventListener("mouseup", () => {
    if (!joined) return;
    const range = resolveSelectionOffsets();
    if (!range) return;
    const text = window.prompt("Add a note on this selection:");
    window.getSelection()?.removeAllRanges();
    if (!text?.trim()) return;
    fetch(`/api/room/${slug}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId, start: range.start, end: range.end, text: text.trim() }),
    }).catch(() => {});
  });
}
