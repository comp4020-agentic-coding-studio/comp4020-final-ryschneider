// Shared, Node-free: used both server-side (SSR, from persisted heat_marks)
// and client-side (incrementally, appending each "fade" event's span). No
// canvas, no decay, no per-note identity --- just overlapping spans turned
// into a density a stylesheet can use directly.
export interface Span {
  start: number;
  end: number;
}

export function paragraphDensities(paragraphs: Span[], marks: Span[]): number[] {
  return paragraphs.map((p) => {
    let overlap = 0;
    for (const m of marks) {
      overlap += Math.max(0, Math.min(m.end, p.end) - Math.max(m.start, p.start));
    }
    const ratio = overlap / Math.max(1, p.end - p.start);
    return Math.min(1, ratio * 2); // tunable, non-load-bearing constant
  });
}
