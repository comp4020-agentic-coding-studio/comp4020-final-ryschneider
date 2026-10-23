// Logging in just means giving yourself a name for the session, done once on
// the homepage --- not per room. sessionStorage, not localStorage: it's gone
// when the browser fully closes, which is the "until browser closes" half.
// For "across tabs": per spec, a tab opened BY a logged-in tab (a clicked
// link, middle-click, window.open) inherits its sessionStorage, so opening
// a room from the homepage's room list in a new tab carries the name over.
// A tab opened independently (URL typed/pasted fresh, not spawned from an
// already-logged-in tab) gets its own empty sessionStorage regardless --- no
// web storage primitive shares across independently-opened tabs --- which is
// exactly the case the room page's redirect-home handles, so it's covered
// either way (see src/pages/room/[slug]/index.astro).
const KEY = "margins:handle";

export function getHandle(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setHandle(handle: string): void {
  try {
    sessionStorage.setItem(KEY, handle);
  } catch {
    // sessionStorage can throw in a locked-down context (private mode with
    // storage blocked); the name just won't carry to other tabs there.
  }
}
