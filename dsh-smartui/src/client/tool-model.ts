import type { SmartUIDocument } from '../shared/types.js';
import { readPresentationMeta } from '../shared/validation.js';
import type { ToolViewProps } from './contracts.js';
export type ToolModel = { state: 'preparing' | 'running' | 'failed' | 'fallback'; text: string; diagnostic?: string } | { state: 'document'; document: SmartUIDocument; text: string };
export function resultText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.filter((block): block is { type: 'text'; text: string } => typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('\n').slice(0, 8_000);
}
export function toolModel(props: Pick<ToolViewProps, 'phase' | 'block'>): ToolModel {
  if (props.phase !== 'result') return { state: props.phase === 'preparing' ? 'preparing' : 'running', text: '' };
  const text = resultText(props.block.content);
  if (props.block.isError || props.block.error != null) return { state: 'failed', text };
  try { return { state: 'document', document: readPresentationMeta(props.block.meta), text }; }
  catch (error) { return { state: 'fallback', text, diagnostic: error instanceof Error ? error.message : 'Invalid document' }; }
}
