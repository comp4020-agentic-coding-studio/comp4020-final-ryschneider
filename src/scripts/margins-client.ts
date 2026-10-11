import { paragraphDensities, type Span } from "../lib/heat";

interface RoomData {
  slug: string;
  paragraphs: { start: number; end: number; text: string }[];
  heatMarks: Span[];
}

interface LiveNoteView {
  id: number;
  start: number;
  end: number;
  handle: string;
  text: string;
}

type ServerEvent =
  | { type: "snapshot"; presence: { handle: string; offset: number | null }[]; notes: LiveNoteView[] }
  | { type: "join"; handle: string }
  | { type: "leave"; handle: string }
  | { type: "location"; handle: string; offset: number }
  | ({ type: "note" } & LiveNoteView)
  | { type: "fade"; id: number; start: number; end: number };

const LOCATION_THROTTLE_MS = 400;

export function initRoom(): void {
  const dataEl = document.getElementById("room-data");
  const data = JSON.parse(dataEl?.textContent ?? "null") as RoomData | null;
  if (!data) return;

  const { slug, paragraphs } = data;
  const heatMarks: Span[] = [...data.heatMarks];
  const presence = new Map<string, number | null>();
  const notes = new Map<number, LiveNoteView>();

  const gate = document.getElementById("join-gate") as HTMLFormElement | null;
  const roomEl = document.getElementById("room");
  const presenceEl = document.getElementById("presence");
  const textEl = document.getElementById("room-text");
  if (!gate || !roomEl || !presenceEl || !textEl) return;

  const paragraphEls = [...textEl.querySelectorAll<HTMLElement>("[data-start]")];

  let connectionId = "";
  let handle = "";
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
    for (const [h, offset] of presence) {
      if (h === handle) continue;
      const li = document.createElement("li");
      const where = offset === null ? "just arrived" : `near paragraph ${paragraphIndexFor(offset) + 1}`;
      li.textContent = `${h} — ${where}`;
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
    let cursor = p.start;
    for (const note of overlapping) {
      const start = Math.max(note.start, p.start);
      const end = Math.min(note.end, p.end);
      if (start > cursor) {
        el.appendChild(document.createTextNode(p.text.slice(cursor - p.start, start - p.start)));
      }
      const mark = document.createElement("mark");
      mark.dataset.noteId = String(note.id);
      // title is the accessible fallback (screen readers, no-JS tooltip);
      // data-note drives the visible popover in CSS, since generated
      // ::after content isn't reliably announced.
      mark.title = `${note.handle}: ${note.text}`;
      mark.dataset.note = `${note.handle}: ${note.text}`;
      mark.tabIndex = 0;
      mark.textContent = p.text.slice(start - p.start, end - p.start);
      // Tap-to-toggle so the note is readable on touch, where :hover never
      // fires; mousedown (not click) so a drag-selection starting on an
      // existing mark doesn't also toggle it open.
      mark.addEventListener("mousedown", (e) => e.stopPropagation());
      mark.addEventListener("click", (e) => {
        e.stopPropagation();
        mark.classList.toggle("open");
      });
      el.appendChild(mark);
      cursor = end;
    }
    if (cursor < p.end) {
      el.appendChild(document.createTextNode(p.text.slice(cursor - p.start)));
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
    const es = new EventSource(
      `/api/room/${slug}/events?connectionId=${encodeURIComponent(connectionId)}&handle=${encodeURIComponent(handle)}`,
    );
    es.onmessage = (ev) => {
      const event = JSON.parse(ev.data) as ServerEvent;
      switch (event.type) {
        case "snapshot": {
          presence.clear();
          for (const p of event.presence) presence.set(p.handle, p.offset);
          notes.clear();
          for (const n of event.notes) notes.set(n.id, n);
          joined = true;
          renderPresence();
          renderAllParagraphs();
          break;
        }
        case "join":
          presence.set(event.handle, null);
          renderPresence();
          break;
        case "leave":
          presence.delete(event.handle);
          renderPresence();
          break;
        case "location":
          presence.set(event.handle, event.offset);
          renderPresence();
          break;
        case "note": {
          notes.set(event.id, { id: event.id, start: event.start, end: event.end, handle: event.handle, text: event.text });
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

  gate.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = gate.querySelector<HTMLInputElement>('input[name="handle"]');
    const value = input?.value.trim();
    if (!value) return;
    handle = value;
    connectionId = crypto.randomUUID();
    gate.hidden = true;
    connect();
  });

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
