/** Pocket and ChatGPT share one native callback listener and system authentication session. */
let active = false;
export function acquireOAuthSession(): () => void {
  if (active) throw new Error('Another sign-in is open. Finish or close it before trying again.');
  active = true;
  let released = false;
  return () => { if (!released) { active = false; released = true; } };
}
