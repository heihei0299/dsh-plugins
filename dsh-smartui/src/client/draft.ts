import type { InputActions } from './contracts.js';
import { LIMITS } from '../shared/types.js';
export type InsertResult = 'inserted' | 'selection' | 'changed' | 'unavailable' | 'tooLarge';
/** No await, root ctx, setDraft or submit: this can only insert into its scoped editor. */
export function insertReviewedText(actions: InputActions | undefined, text: string, editable: boolean): InsertResult {
  if (!actions || !editable) return 'unavailable';
  if (new TextEncoder().encode(text).byteLength > LIMITS.actionBytes) return 'tooLarge';
  try {
    const span = actions.captureInsertion();
    if (![span.start, span.end, span.draftRev].every(Number.isSafeInteger) || span.start < 0 || span.draftRev < 0) return 'unavailable';
    if (span.start !== span.end) return 'selection';
    return actions.insertText(`\n\n${text}\n`, span) ? 'inserted' : 'changed';
  } catch { return 'unavailable'; }
}
