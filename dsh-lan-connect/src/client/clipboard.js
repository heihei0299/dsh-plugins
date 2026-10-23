/** Clipboard fallbacks for the read-only entry links. */

/**
 * Copy one URL through the Clipboard API.
 * @param value - URL text.
 * @returns 'copied', 'unavailable' (no API, e.g. plain HTTP), or 'rejected'.
 */
export async function writeLinkText(value) {
  if (typeof value !== 'string' || value === '') return 'rejected';
  let clipboard;
  try {
    clipboard = globalThis.navigator?.clipboard;
  } catch {
    return 'unavailable';
  }
  if (clipboard === undefined || clipboard === null || typeof clipboard.writeText !== 'function') return 'unavailable';
  try {
    await clipboard.writeText(value);
    return 'copied';
  } catch {
    return 'rejected';
  }
}

/**
 * Boolean form of {@link writeLinkText}.
 * @param value - URL text.
 * @returns true only when the write actually resolved.
 */
export async function copyLinkText(value) {
  return await writeLinkText(value) === 'copied';
}

/**
 * Select a read-only link field as the manual-copy fallback.
 * @param input - the field element, when mounted.
 * @returns true when the text was selected.
 */
export function selectLinkText(input) {
  if (input === null || input === undefined) return false;
  try {
    input.focus();
    input.select();
    if (typeof input.setSelectionRange === 'function') input.setSelectionRange(0, input.value.length);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy one link, or select it for manual copying when that is all the browser
 * allows. The returned key is the exact notice the row shows; success is never
 * claimed for a rejected Clipboard API write.
 * @param value - URL text.
 * @param input - the read-only field element, when mounted.
 * @returns the locale key describing the outcome.
 */
export async function copyEntryLink(value, input) {
  const outcome = await writeLinkText(value);
  if (outcome === 'copied') return 'copy.copied';
  if (!selectLinkText(input)) return 'copy.failed';
  return outcome === 'unavailable' ? 'copy.unavailable' : 'copy.manual';
}
