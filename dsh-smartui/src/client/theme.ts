import { PACKAGE_NAME } from '../shared/types.js';
import type { ClientContext, ConfigForm, Disposer } from './contracts.js';
/** Only documented alias tokens; no selector reaches into the host's DOM. */
export const CHATGPT_TOKENS = {
  '--dsw-alias-bg-base': { light: '#ffffff', dark: '#212121' },
  '--dsw-alias-bg-layer-1': { light: '#f9f9f9', dark: '#171717' },
  '--dsw-alias-bg-layer-2': { light: '#f3f3f3', dark: '#2f2f2f' },
  '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#2f2f2f' },
  '--dsw-alias-label-primary': { light: '#171717', dark: '#ececec' },
  '--dsw-alias-label-secondary': { light: '#5d5d5d', dark: '#b4b4b4' },
  '--dsw-alias-border-l1': { light: '#eeeeee', dark: '#333333' },
  '--dsw-alias-border-l2': { light: '#dddddd', dark: '#484848' },
} satisfies Record<string, { light: string; dark: string }>;
export function installAppearance(ctx: Pick<ClientContext, 'theme'>, form: ConfigForm): Disposer {
  let disposeLayer: Disposer | undefined;
  const reconcile = () => {
    const snapshot = form.getSnapshot();
    const enabled = snapshot.status === 'ready' && snapshot.value?.appearance === 'chatgpt';
    if (enabled && !disposeLayer) disposeLayer = ctx.theme.overrideTokens(PACKAGE_NAME, CHATGPT_TOKENS);
    else if (!enabled && disposeLayer) { disposeLayer(); disposeLayer = undefined; }
  };
  const unsubscribe = form.subscribe(reconcile);
  try { reconcile(); } catch (error) { unsubscribe(); throw error; }
  return () => { unsubscribe(); disposeLayer?.(); disposeLayer = undefined; };
}
