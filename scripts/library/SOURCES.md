# Sources and verification

Every excerpt in this library was extracted from a Project Gutenberg plain-text
edition downloaded via `curl`, located with `grep`/`sed`, and copied out
verbatim — nothing was typed from memory. This file records the exact source
for each entry.

The 10 `"book"` entries were additionally reflowed after extraction: Gutenberg's
plain-text editions hard-wrap prose at ~70 characters, and the room page
renders every `\n` in the stored text as a real line break (see
ARCHITECTURE.md's "The text library" section) — so the as-downloaded wrapping
would have shown as broken mid-sentence line breaks. Each book excerpt's
hard-wrapped lines were rejoined into flowing paragraphs (verified by comparing
the sorted word set before and after, to confirm nothing was added, dropped, or
reordered); poems and plays were left untouched, since their line breaks are
real content. The table and per-entry notes below describe only the sourcing,
not this later reflow step.

All 30 entries are confirmed public domain in the US: either the author died
well over 70 years ago (all entries here), or (for the Gutenberg transcriptions
themselves) the US-hosted plain-text edition is explicitly released into the
public domain by Project Gutenberg's own license terms.

| # | Title | Gutenberg ebook | URL |
|---|---|---|---|
| 001 | Macbeth | 1533 | https://www.gutenberg.org/ebooks/1533 |
| 002 | Hope is the thing with feathers (Dickinson) | 12242 | https://www.gutenberg.org/ebooks/12242 |
| 003 | The Tyger (Blake) | 1934 | https://www.gutenberg.org/ebooks/1934 |
| 004 | Death, be not proud (Donne) | 66619 (The Oxford Book of English Verse) | https://www.gutenberg.org/ebooks/66619 |
| 005 | The Road Not Taken (Frost) | 29345 | https://www.gutenberg.org/ebooks/29345 |
| 006 | Ode to a Nightingale (Keats) | 23684 | https://www.gutenberg.org/ebooks/23684 |
| 007 | Annabel Lee (Poe) | 25525 | https://www.gutenberg.org/ebooks/25525 |
| 008 | O Captain! My Captain! (Whitman) | 1322 (Leaves of Grass) | https://www.gutenberg.org/ebooks/1322 |
| 009 | Ulysses (Tennyson) | 8601 (The Early Poems of Alfred Lord Tennyson) | https://www.gutenberg.org/ebooks/8601 |
| 010 | Remember (Rossetti) | 19188 | https://www.gutenberg.org/ebooks/19188 |
| 011 | Ozymandias (Shelley) | 4800 | https://www.gutenberg.org/ebooks/4800 |
| 012 | Hamlet | 1524 | https://www.gutenberg.org/ebooks/1524 |
| 013 | Romeo and Juliet | 47960 | https://www.gutenberg.org/ebooks/47960 |
| 014 | Othello | 1793 | https://www.gutenberg.org/ebooks/1793 |
| 015 | Twelfth Night | 1526 | https://www.gutenberg.org/ebooks/1526 |
| 016 | The Importance of Being Earnest (Wilde) | 844 | https://www.gutenberg.org/ebooks/844 |
| 017 | Doctor Faustus (Marlowe) | 779 | https://www.gutenberg.org/ebooks/779 |
| 018 | A Doll's House (Ibsen) | 2542 | https://www.gutenberg.org/ebooks/2542 |
| 019 | Julius Caesar | 1785 | https://www.gutenberg.org/ebooks/1785 |
| 020 | As You Like It | 1786 | https://www.gutenberg.org/ebooks/1786 |
| 021 | Pride and Prejudice (Austen) | 1342 | https://www.gutenberg.org/ebooks/1342 |
| 022 | Moby-Dick (Melville) | 2701 | https://www.gutenberg.org/ebooks/2701 |
| 023 | Jane Eyre (Brontë) | 1260 | https://www.gutenberg.org/ebooks/1260 |
| 024 | Frankenstein (Shelley) | 84 | https://www.gutenberg.org/ebooks/84 |
| 025 | The Picture of Dorian Gray (Wilde) | 174 | https://www.gutenberg.org/ebooks/174 |
| 026 | A Tale of Two Cities (Dickens) | 98 | https://www.gutenberg.org/ebooks/98 |
| 027 | Heart of Darkness (Conrad) | 219 | https://www.gutenberg.org/ebooks/219 |
| 028 | The Yellow Wallpaper (Gilman) | 1952 | https://www.gutenberg.org/ebooks/1952 |
| 029 | Wuthering Heights (Brontë) | 768 | https://www.gutenberg.org/ebooks/768 |
| 030 | Dracula (Stoker) | 345 | https://www.gutenberg.org/ebooks/345 |

## Notes on individual sources

- **Shakespeare plays (001, 012–015, 019, 020)**: several Shakespeare plays on
  Gutenberg are First Folio-spelling transcriptions ("haue", "Iuliet",
  "enuious"). Each one used here was checked for modern spelling before use;
  where the first-tried ebook ID turned out to be archaic-spelling (this
  happened for Othello, Julius Caesar, and As You Like It), a different,
  modern-spelling edition was located and used instead. Hamlet, Macbeth, and
  Twelfth Night's first-tried editions were already modern-spelling.
- **004, Donne's "Death, be not proud"**: the first source tried (ebook 48688,
  "The Poems of John Donne") is a scholarly edition preserving 1633 spelling
  ("dreadfull", "soe", "poyson"). Used ebook 66619 (The Oxford Book of English
  Verse) instead, which modernizes the spelling.
- **009, Tennyson's "Ulysses"**: extracted from "The Early Poems of Alfred Lord
  Tennyson" (ebook 8601) rather than a dedicated single-poem edition, since no
  standalone Gutenberg ebook for this poem was found by search.
- **014, Othello**: ebook 1793's file header contains unusual "World Library"
  boilerplate language that reads ambiguously about licensing; the text itself
  is confirmed public domain by Gutenberg's own ebook page
  (https://www.gutenberg.org/ebooks/1793), which also notes it predates an
  "improved edition" (ebook 1531) — 1793 was used anyway since it was already
  confirmed to be modern-spelling and the PD status is confirmed by the
  Gutenberg page metadata, not the file's own header text.
- **030, Dracula**: the excerpt starts partway into Chapter 2 rather than at
  the novel's very first diary entry (3 May, Bistritz), since the opening
  entry is a travelogue without the atmosphere the rest of the library aims
  for; the scene used (Harker's first meeting with the Count at the castle
  door) was chosen instead for tonal fit.

## Not independently verified

None. All 30 entries above were downloaded and grepped/sed-extracted from the
live Gutenberg source in this session.

## Description policy

Each entry's `description` is **context for reading the excerpt, never a
summary of what happens in it** — authorship, period, publication or
performance history, biography, textual sources, reception. The excerpt is
there to be read, not previewed; a description that gives away its content
defeats that. The 30 descriptions in `manifest.json` were deliberately
rewritten to this standard (an earlier version summarized plot instead — see
the repo's commit history for that correction). If you add a new entry or
edit an existing one, hold its description to the same rule: it should be
useful to someone *before* they read the passage, and say nothing a reader
would prefer to discover for themselves.
