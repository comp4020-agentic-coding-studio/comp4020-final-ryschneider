import type { Span } from "./heat";

export interface Paragraph extends Span {
  text: string;
}

// Splits on blank lines but keeps the separators in the split so offsets
// stay exact against the original string --- every paragraph's start/end is
// a real index into room.text, which is what note/location offsets are
// measured against.
export function splitParagraphs(source: string): Paragraph[] {
  const parts = source.split(/(\n{2,})/);
  const paragraphs: Paragraph[] = [];
  let offset = 0;
  for (const part of parts) {
    if (!/^\n{2,}$/.test(part) && part.length > 0) {
      paragraphs.push({ start: offset, end: offset + part.length, text: part });
    }
    offset += part.length;
  }
  return paragraphs;
}
