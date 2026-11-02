// The curated note-highlight palette a user picks one of on /profile/. Kept
// as plain hex here (not read from CSS) so the server can validate a
// submitted color is actually one of these --- enforcing "curated," not just
// suggesting it in the UI. Must stay in sync with the --note-* custom
// properties in src/styles/global.css; a mismatch means the swatch shown on
// /profile/ wouldn't match what notes.ts accepts.
export const NOTE_PALETTE = ["#e3b672", "#8fb8ae", "#c98f7c", "#a3b17e", "#b39bc4"] as const;

export type NoteColor = (typeof NOTE_PALETTE)[number];

export function isValidNoteColor(color: string): color is NoteColor {
  return (NOTE_PALETTE as readonly string[]).includes(color);
}

export const DEFAULT_NOTE_COLOR: NoteColor = NOTE_PALETTE[0];
