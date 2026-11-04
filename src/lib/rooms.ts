import { addHeatMark } from "./db";
import { bus } from "./events";
import { logFade, logJoin, logLeave, logNote } from "./log";

// Live state --- who's present, and notes that haven't faded yet --- lives
// only in process memory. Losing it on a crash or restart is an accepted
// simplification for this week: the only thing the spec requires to survive
// a restart/redeploy is the faded heat (persisted in SQLite, see db.ts).
//
// Identity is keyed by userId (a stable account id), not by the display
// handle --- a handle can change on /profile/ but must never let a rename
// retroactively relabel or break carrier-set bookkeeping for notes already
// written under the old name. handle/color are snapshotted onto presence
// and notes at the moment of join()/writeNote(), not looked up live from
// userId on every render: a note's (and a connection's) author display is
// deliberately stable for the lifetime of that note/connection, the same
// way carrierIds is already fixed at write time and never added to. Editing
// your display name or color on /profile/ does NOT retroactively update an
// already-open tab's presence list or any note you already wrote --- only a
// fresh connection (reload, or a new tab) picks up the new handle/color.

export interface LiveNote {
  id: number;
  start: number;
  end: number;
  userId: number;
  handle: string; // display name AT WRITE TIME, snapshotted
  color: string; // highlight color AT WRITE TIME, snapshotted
  text: string;
  // Fixed at write time --- everyone present the moment this was written,
  // author included. Never added to after creation: joining a room that
  // already has this note visible does NOT make you a carrier.
  carrierIds: Set<number>;
}

interface RoomState {
  nextNoteId: number;
  presence: Map<number, Set<string>>; // userId -> connectionIds (dedupes same user, 2 tabs)
  connectionUsers: Map<string, { userId: number; handle: string; color: string }>; // connectionId -> identity
  locations: Map<number, number>; // userId -> best-effort reading offset
  notes: Map<number, LiveNote>;
}

const roomStates = new Map<string, RoomState>();

function room(slug: string): RoomState {
  let r = roomStates.get(slug);
  if (!r) {
    r = {
      nextNoteId: 1,
      presence: new Map(),
      connectionUsers: new Map(),
      locations: new Map(),
      notes: new Map(),
    };
    roomStates.set(slug, r);
  }
  return r;
}

export interface Snapshot {
  type: "snapshot";
  presence: { userId: number; handle: string; color: string; offset: number | null }[];
  notes: { id: number; start: number; end: number; userId: number; handle: string; color: string; text: string }[];
}

// Whatever's currently in r.notes IS what's currently visible to anyone
// present, carrier or not --- a note that lost its last carrier was already
// deleted (see leave() below), so a snapshot can never show a faded note.
// No separate visibility flag is needed anywhere in this module.
export function getSnapshot(slug: string): Snapshot {
  const r = room(slug);
  // Resolve each present userId's current handle/color from whichever
  // connection is still open for them --- any one will do, since join()
  // snapshots the same handle/color onto every connection a user opens in
  // the same visit (it's resolved once per connect, from their account row
  // at that moment).
  const handleColorByUser = new Map<number, { handle: string; color: string }>();
  for (const identity of r.connectionUsers.values()) {
    if (!handleColorByUser.has(identity.userId)) {
      handleColorByUser.set(identity.userId, { handle: identity.handle, color: identity.color });
    }
  }
  return {
    type: "snapshot",
    presence: [...r.presence.keys()].map((userId) => {
      const identity = handleColorByUser.get(userId)!;
      return { userId, handle: identity.handle, color: identity.color, offset: r.locations.get(userId) ?? null };
    }),
    notes: [...r.notes.values()].map(({ id, start, end, userId, handle, color, text }) => ({
      id,
      start,
      end,
      userId,
      handle,
      color,
      text,
    })),
  };
}

// Distinct users currently present, for the homepage's room list. Reads the
// same live map everything else here does --- a room with no open
// connections (never in roomStates, or removed once empty) is correctly 0,
// no separate "room exists" check needed.
export function presenceCount(slug: string): number {
  return roomStates.get(slug)?.presence.size ?? 0;
}

// Whether this userId already has an open connection here --- so a capacity
// check (rooms.maxSize) never locks out someone already in, only a
// genuinely new occupant: a reload or a second tab must never be rejected
// as if it were a new person arriving.
export function isPresent(slug: string, userId: number): boolean {
  return roomStates.get(slug)?.presence.has(userId) ?? false;
}

export function join(slug: string, connectionId: string, userId: number, handle: string, color: string): void {
  const r = room(slug);
  r.connectionUsers.set(connectionId, { userId, handle, color });
  const conns = r.presence.get(userId);
  if (conns) {
    conns.add(connectionId);
  } else {
    r.presence.set(userId, new Set([connectionId]));
    bus.emit(`room:${slug}`, { type: "join", userId, handle, color });
    logJoin(slug, handle);
  }
}

export function leave(slug: string, connectionId: string): void {
  const r = roomStates.get(slug);
  if (!r) return;
  const identity = r.connectionUsers.get(connectionId);
  r.connectionUsers.delete(connectionId);
  if (!identity) return;
  const { userId, handle } = identity;

  const conns = r.presence.get(userId);
  conns?.delete(connectionId);
  if (conns && conns.size > 0) return; // other tabs for this user still open

  r.presence.delete(userId);
  r.locations.delete(userId);
  bus.emit(`room:${slug}`, { type: "leave", userId });
  logLeave(slug, handle);

  // The propagation rule, in full: this user may have been the last carrier
  // of one or more live notes. Each one that loses its last carrier fades
  // --- permanently, right here, with no content or identity kept.
  for (const note of [...r.notes.values()]) {
    if (!note.carrierIds.delete(userId)) continue;
    if (note.carrierIds.size > 0) continue;
    addHeatMark(slug, note.start, note.end);
    r.notes.delete(note.id);
    bus.emit(`room:${slug}`, { type: "fade", id: note.id, start: note.start, end: note.end });
    logFade(slug, note.id, note.start, note.end);
  }

  if (r.presence.size === 0 && r.notes.size === 0) roomStates.delete(slug);
}

export function updateLocation(slug: string, connectionId: string, offset: number): boolean {
  const r = roomStates.get(slug);
  const identity = r?.connectionUsers.get(connectionId);
  if (!r || !identity) return false;
  r.locations.set(identity.userId, offset);
  bus.emit(`room:${slug}`, { type: "location", userId: identity.userId, offset });
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
  const identity = r.connectionUsers.get(connectionId);
  if (!identity) return undefined;
  const { userId, handle, color } = identity;
  const id = r.nextNoteId++;
  const note: LiveNote = {
    id,
    start,
    end,
    userId,
    handle,
    color,
    text,
    carrierIds: new Set(r.presence.keys()),
  };
  r.notes.set(id, note);
  bus.emit(`room:${slug}`, { type: "note", id, start, end, userId, handle, color, text });
  logNote(slug, handle, id, start, end);
  return note;
}
