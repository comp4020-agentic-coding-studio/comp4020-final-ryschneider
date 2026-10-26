import { addHeatMark } from "./db";
import { bus } from "./events";
import { logFade, logJoin, logLeave, logNote } from "./log";

// Live state --- who's present, and notes that haven't faded yet --- lives
// only in process memory. Losing it on a crash or restart is an accepted
// simplification for this week: the only thing the spec requires to survive
// a restart/redeploy is the faded heat (persisted in SQLite, see db.ts).

export interface LiveNote {
  id: number;
  start: number;
  end: number;
  handle: string;
  text: string;
  // Fixed at write time --- everyone present the moment this was written,
  // author included. Never added to after creation: joining a room that
  // already has this note visible does NOT make you a carrier.
  carrierHandles: Set<string>;
}

interface RoomState {
  nextNoteId: number;
  presence: Map<string, Set<string>>; // handle -> connectionIds (dedupes same handle, 2 tabs)
  connectionHandles: Map<string, string>; // connectionId -> handle
  locations: Map<string, number>; // handle -> best-effort reading offset
  notes: Map<number, LiveNote>;
}

const roomStates = new Map<string, RoomState>();

function room(slug: string): RoomState {
  let r = roomStates.get(slug);
  if (!r) {
    r = {
      nextNoteId: 1,
      presence: new Map(),
      connectionHandles: new Map(),
      locations: new Map(),
      notes: new Map(),
    };
    roomStates.set(slug, r);
  }
  return r;
}

export interface Snapshot {
  type: "snapshot";
  presence: { handle: string; offset: number | null }[];
  notes: { id: number; start: number; end: number; handle: string; text: string }[];
}

// Whatever's currently in r.notes IS what's currently visible to anyone
// present, carrier or not --- a note that lost its last carrier was already
// deleted (see leave() below), so a snapshot can never show a faded note.
// No separate visibility flag is needed anywhere in this module.
export function getSnapshot(slug: string): Snapshot {
  const r = room(slug);
  return {
    type: "snapshot",
    presence: [...r.presence.keys()].map((handle) => ({
      handle,
      offset: r.locations.get(handle) ?? null,
    })),
    notes: [...r.notes.values()].map(({ id, start, end, handle, text }) => ({
      id,
      start,
      end,
      handle,
      text,
    })),
  };
}

// Distinct handles currently present, for the homepage's room list. Reads
// the same live map everything else here does --- a room with no open
// connections (never in roomStates, or removed once empty) is correctly 0,
// no separate "room exists" check needed.
export function presenceCount(slug: string): number {
  return roomStates.get(slug)?.presence.size ?? 0;
}

export function join(slug: string, connectionId: string, handle: string): void {
  const r = room(slug);
  r.connectionHandles.set(connectionId, handle);
  const conns = r.presence.get(handle);
  if (conns) {
    conns.add(connectionId);
  } else {
    r.presence.set(handle, new Set([connectionId]));
    bus.emit(`room:${slug}`, { type: "join", handle });
    logJoin(slug, handle);
  }
}

export function leave(slug: string, connectionId: string): void {
  const r = roomStates.get(slug);
  if (!r) return;
  const handle = r.connectionHandles.get(connectionId);
  r.connectionHandles.delete(connectionId);
  if (!handle) return;

  const conns = r.presence.get(handle);
  conns?.delete(connectionId);
  if (conns && conns.size > 0) return; // other tabs for this handle still open

  r.presence.delete(handle);
  r.locations.delete(handle);
  bus.emit(`room:${slug}`, { type: "leave", handle });
  logLeave(slug, handle);

  // The propagation rule, in full: this handle may have been the last
  // carrier of one or more live notes. Each one that loses its last carrier
  // fades --- permanently, right here, with no content or identity kept.
  for (const note of [...r.notes.values()]) {
    if (!note.carrierHandles.delete(handle)) continue;
    if (note.carrierHandles.size > 0) continue;
    addHeatMark(slug, note.start, note.end);
    r.notes.delete(note.id);
    bus.emit(`room:${slug}`, { type: "fade", id: note.id, start: note.start, end: note.end });
    logFade(slug, note.id, note.start, note.end);
  }

  if (r.presence.size === 0 && r.notes.size === 0) roomStates.delete(slug);
}

export function updateLocation(slug: string, connectionId: string, offset: number): boolean {
  const r = roomStates.get(slug);
  const handle = r?.connectionHandles.get(connectionId);
  if (!r || !handle) return false;
  r.locations.set(handle, offset);
  bus.emit(`room:${slug}`, { type: "location", handle, offset });
  return true;
}

export function writeNote(
  slug: string,
  connectionId: string,
  start: number,
  end: number,
  text: string,
): LiveNote | undefined {
  const r = room(slug);
  const handle = r.connectionHandles.get(connectionId);
  if (!handle) return undefined;
  const id = r.nextNoteId++;
  const note: LiveNote = { id, start, end, handle, text, carrierHandles: new Set(r.presence.keys()) };
  r.notes.set(id, note);
  bus.emit(`room:${slug}`, { type: "note", id, start, end, handle, text });
  logNote(slug, handle, id, start, end);
  return note;
}
