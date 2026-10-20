import type { Context, Volatile } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-system-prompt';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { documentSchema } from '../shared/schema.js';
import { TOOL_NAME, type SmartUISettings } from '../shared/types.js';
import { validateDocument } from '../shared/validation.js';
import { SMARTUI_PROMPT } from './prompt.js';

export interface PluginConfig {
  appearance: Volatile<SmartUISettings['appearance']>;
  enableComponents: Volatile<boolean>;
}
export const Config = z.object({
  appearance: z.union(['chatgpt', 'native']).default('chatgpt').description('ChatGPT-inspired theme or native DSH appearance').volatile(),
  enableComponents: z.boolean().default(true).description('Allow new SmartUI documents and interactive component actions').volatile(),
});
export const inject = ['tools', 'systemPrompt'];
export function createSmartUITool(enabled: () => boolean = () => true) {
  return defineTool({
    name: TOOL_NAME,
    description: 'Display a safe declarative UI in this DSH conversation: cards, sortable tables, bar/line charts, forms or choices. No HTML/code execution. A user can fill reviewed selections into their native draft; this does not send automatically.',
    parameters: { document: { ...documentSchema, required: true } },
    output: {
      schema: documentSchema,
      render: (_args, value) => [{ type: 'text', text: `${value.title ? `${value.title}\n` : ''}${value.summary}\n\nSmartUI document recorded (${value.blocks.length} blocks). User actions fill the draft only; they are not sent automatically.` }],
      presentationMeta: (_args, value) => ({ smartui: value }),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      if (!enabled()) throw new Error('SmartUI components are disabled in this profile. Use an ordinary text response.');
      return validateDocument(args.document);
    },
  });
}
export function apply(ctx: Context, config: PluginConfig): void {
  ctx.effect(() => ctx.tools.register(createSmartUITool(() => config.enableComponents.get())));
  ctx.effect(() => ctx.systemPrompt.section({
    name: '@local/dsh-smartui', order: 9_910, interpolate: false,
    text: () => config.enableComponents.get() ? SMARTUI_PROMPT : 'SmartUI components are disabled. Do not call render_smart_ui; use ordinary text.',
  }));
}
