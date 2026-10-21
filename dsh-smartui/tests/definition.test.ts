import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_NODE_KIND, smartUICallResult, smartuiDocumentDefinition, type SmartUIDocumentState } from '../src/client/definition.js';
import type { ConversationLocationLike, ConversationMatchLike, ConversationNodeContextLike, SessionEventLike } from '../src/client/contracts.js';
import type { SmartUIDocument } from '../src/shared/types.js';

const document: SmartUIDocument = { schemaVersion: 1, summary: 'Recorded summary', blocks: [{ id: 'card', type: 'card', body: 'Real card' }] };
const location: ConversationLocationLike = { kind: 'turn', turn: { turn: 1, status: 'closed', steps: [], data: {} } };

function nativeResult(meta: unknown, extra: Record<string, unknown> = {}): SessionEventLike {
  return { type: 'tool/result', seq: 12, data: { message: { toolCallId: 'call-1', isError: false }, meta, ...extra } };
}
function ptcResult(extra: Record<string, unknown> = {}): SessionEventLike {
  return { type: 'tool/ptc-dispatch', seq: 21, data: { subCallId: 'parent:ptc:2', name: 'render_smart_ui', isError: false, meta: { smartui: document }, ...extra } };
}
function startMatch(event: SessionEventLike): ConversationMatchLike { return { event, role: 'start', location }; }

test('a settled render_smart_ui result becomes one Turn-level document row', () => {
  const event = nativeResult({ smartui: document });
  assert.deepEqual(smartUICallResult(event), { callId: 'call-1', document });
  assert.deepEqual(smartuiDocumentDefinition.match(event), { id: 'call-1', role: 'start' });
  const context: ConversationNodeContextLike<SmartUIDocumentState> = {
    key: 'chat:smartui:call-1', kind: DOCUMENT_NODE_KIND, id: 'call-1',
    matches: [startMatch(event)], start: startMatch(event), state: { callId: 'call-1', document }, current: new Map(),
  };
  const node = smartuiDocumentDefinition.buildViewNode(context);
  assert.ok(node);
  assert.equal(node.kind, DOCUMENT_NODE_KIND);
  assert.equal(node.target, 'chat');
  assert.equal(node.visibility, 'visible');
  // Turn level is what exempts the card from whole-Turn process folding.
  assert.equal(node.groupTree, 'turn');
  assert.equal(node.anchorSeq, 12);
  assert.deepEqual(node.location, location);
  assert.deepEqual(node.data, { callId: 'call-1', document });
});

test('PTC sub-dispatches publish the same row under their sub-call identity', () => {
  const event = ptcResult();
  assert.deepEqual(smartUICallResult(event), { callId: 'parent:ptc:2', document });
  assert.deepEqual(smartuiDocumentDefinition.match(event), { id: 'parent:ptc:2', role: 'start' });
});

test('failed, malformed, unrelated and unsupported results never become cards', () => {
  for (const event of [
    nativeResult({ smartui: document }, { error: { code: 'CANCELLED' } }),
    nativeResult({ smartui: document }, { message: { toolCallId: 'call-1', isError: true } }),
    nativeResult({ smartui: { schemaVersion: 2 } }),
    nativeResult({ smartui: { schemaVersion: 1, summary: 'x', blocks: [{ id: 'card', type: 'card', body: 'x', extra: true }] } }),
    nativeResult(undefined),
    nativeResult({ other: document }),
    { type: 'tool/result', seq: 3, data: { message: { toolCallId: 'call-2' }, meta: { smartui: document }, isError: true } } as SessionEventLike,
    { type: 'tool/call', seq: 4, data: { callId: 'call-3', name: 'render_smart_ui', arguments: { document } } } as SessionEventLike,
    { type: 'assistant/message', seq: 5, data: {} } as SessionEventLike,
    { type: 'tool/result', seq: 6, data: null } as SessionEventLike,
    ptcResult({ isError: true }),
  ]) {
    assert.equal(smartUICallResult(event), null, JSON.stringify(event));
    assert.equal(smartuiDocumentDefinition.match(event), null, JSON.stringify(event));
  }
});

test('a context without state publishes nothing instead of an empty row', () => {
  const event = nativeResult({ smartui: document });
  const context: ConversationNodeContextLike<SmartUIDocumentState> = {
    key: 'chat:smartui:call-1', kind: DOCUMENT_NODE_KIND, id: 'call-1',
    matches: [startMatch(event)], start: startMatch(event), state: undefined, current: new Map(),
  };
  assert.equal(smartuiDocumentDefinition.buildViewNode(context), null);
});
