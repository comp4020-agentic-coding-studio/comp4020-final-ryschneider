// Server-side activity log: who did what, in which room, when. Plain
// stdout --- Fly captures every container's stdout as `flyctl logs`, so this
// needs no separate storage or log shipping to "outlive the crit"; the log
// is exactly as durable as Fly's own log retention.
//
// One line per event, human-readable first (this is read live in a
// terminal during a crit, not parsed by a log pipeline), with a leading ISO
// timestamp so entries can be correlated with when something happened on
// screen. `handle` is the only identity this app has --- the name a visitor
// typed for this session --- so it's what "who" means here.
function timestamp(): string {
  return new Date().toISOString();
}

export function logJoin(slug: string, handle: string): void {
  console.log(`${timestamp()} join room=${slug} handle=${JSON.stringify(handle)}`);
}

export function logLeave(slug: string, handle: string): void {
  console.log(`${timestamp()} leave room=${slug} handle=${JSON.stringify(handle)}`);
}

export function logNote(slug: string, handle: string, noteId: number, start: number, end: number): void {
  console.log(
    `${timestamp()} note room=${slug} handle=${JSON.stringify(handle)} id=${noteId} span=${start}-${end}`,
  );
}

export function logFade(slug: string, noteId: number, start: number, end: number): void {
  // No handle: by the time a note fades, the carrier set that could name an
  // author is already gone --- see src/lib/rooms.ts. Logging one here would
  // contradict the app's own privacy rule for faded notes.
  console.log(`${timestamp()} fade room=${slug} id=${noteId} span=${start}-${end}`);
}
