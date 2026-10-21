import type { SmartUIDocument } from '../shared/types.js';
import { readPresentationMeta } from '../shared/validation.js';
import type { ConversationMatchLike, ConversationNodeContextLike, ConversationNodeDefinition, SessionEventLike } from './contracts.js';

/** Chat Node kind published for one settled SmartUI document. */
export const DOCUMENT_NODE_KIND = 'smartui-document';
/** View target that owns this kind; the Chat view renders it. */
export const CHAT_TARGET = 'chat';

export interface SmartUIDocumentState {
  /** Durable tool-call identity every component action is scoped to. */
  callId: string;
  document: SmartUIDocument;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the recorded presentation payload of one settled `render_smart_ui` call.
 * Only the tool-owned `meta.smartui` envelope is trusted, and only when that call
 * succeeded: model-facing content and streaming arguments never become a card.
 * @param event - durable Session event from the loaded window.
 * @returns the call identity and validated document, or null for unrelated events.
 */
export function smartUICallResult(event: SessionEventLike): SmartUIDocumentState | null {
  if (event.type !== 'tool/result' && event.type !== 'tool/ptc-dispatch') return null;
  if (!record(event.data)) return null;
  const data = event.data;
  const native = event.type === 'tool/result';
  const message = native && record(data.message) ? data.message : undefined;
  const callId = native ? message?.toolCallId : data.subCallId;
  if (data.isError === true || data.error != null || message?.isError === true) return null;
  if (typeof callId !== 'string' || callId === '') return null;
  try {
    return { callId, document: readPresentationMeta(data.meta) };
  } catch {
    return null;
  }
}

/**
 * Publish one visible Chat row per settled document at the Turn level.
 * `groupTree: 'turn'` is what keeps the card outside the foldable process group,
 * so a completed Turn that folds its work details still shows this document.
 */
export const smartuiDocumentDefinition: ConversationNodeDefinition<SmartUIDocumentState> = {
  kind: DOCUMENT_NODE_KIND,
  target: CHAT_TARGET,
  match: (event) => {
    const result = smartUICallResult(event);
    return result === null ? null : { id: result.callId, role: 'start' };
  },
  start: (_context, match: ConversationMatchLike) => {
    const result = smartUICallResult(match.event);
    if (result === null) throw new Error('SmartUI document start requires a settled render_smart_ui result');
    return result;
  },
  update: (context) => context.state,
  buildViewNode: (context: ConversationNodeContextLike<SmartUIDocumentState>) => {
    const start = context.start ?? context.matches[0];
    const state = context.state;
    if (start === undefined || state === undefined) return null;
    return {
      key: context.key,
      kind: DOCUMENT_NODE_KIND,
      id: context.id,
      target: CHAT_TARGET,
      anchorSeq: start.event.seq,
      location: start.location,
      visibility: 'visible',
      groupTree: 'turn',
      data: state,
    };
  },
};
