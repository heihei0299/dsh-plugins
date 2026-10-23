import * as React from 'react';
import en from '../../locale/en.json' with { type: 'json' };
import zh from '../../locale/zh.json' with { type: 'json' };
import styles from './styles.css';
import { LOCALE_NS, SETTINGS_ID, TOOL_NAME } from '../shared/types.js';
import type { ChatNodeProps, ClientContext, SessionProps, ToolViewProps } from './contracts.js';
import { DOCUMENT_NODE_KIND, smartuiDocumentDefinition } from './definition.js';
import { createEnvironment, EnvironmentContext } from './environment.js';
import { installAppearance } from './theme.js';
import { ToolView } from './ToolView.js';
import { DocumentNode } from './DocumentNode.js';
import { Settings } from './Settings.js';
import { Launcher } from './Launcher.js';
import { installStyles } from './install-styles.js';

export const inject = ['slots', 'locale', 'theme', 'configForms', 'uiConversation'];
export function apply(ctx: ClientContext): void {
  // One stylesheet for the whole plugin lifetime, before any slot can render.
  ctx.effect(() => installStyles(styles));
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'en', en.ui));
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'zh', zh.ui));
  const form = ctx.configForms.get(SETTINGS_ID);
  const environment = createEnvironment(ctx, form);
  ctx.effect(() => installAppearance(ctx, form));
  /** Turn-level row: the recorded document stays outside the foldable process group. */
  ctx.effect(() => ctx.uiConversation.events.register(smartuiDocumentDefinition));
  function Surface({ children }: { children: React.ReactNode }) {
    return <EnvironmentContext.Provider value={environment}><div className="smartui-root">{children}</div></EnvironmentContext.Provider>;
  }
  function SmartTool(props: ToolViewProps) { return <Surface><ToolView {...props} /></Surface>; }
  function SmartDocument(props: ChatNodeProps) { return <Surface><DocumentNode {...props} /></Surface>; }
  function SmartSettings() { return <Surface><Settings /></Surface>; }
  function SmartLauncher(props: SessionProps) { return <Surface><Launcher {...props} /></Surface>; }
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: TOOL_NAME }, SmartTool));
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: DOCUMENT_NODE_KIND }, SmartDocument));
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'dsh-smartui', order: 80 }, SmartSettings));
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-smartui-suggestions', order: 80 }, SmartLauncher));
}
