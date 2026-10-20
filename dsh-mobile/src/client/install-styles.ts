import { ROOT_ATTRIBUTE } from '../shared/types.js';
import { STYLE_TAG_ID, buildStyles, type StyleOptions } from './styles.js';
import type { Disposer } from './contracts.js';

/**
 * Install the mobile stylesheet and the root-scope attribute together.
 *
 * The module loader inventories `<style>` tags a factory injects and removes
 * them when the plugin unloads, so the tag is created plain (no `data-plugin`
 * of our own) and left for the loader to claim. The attribute is removed here
 * because it belongs to this effect, not to the loader.
 * @param options - resolved settings for this activation.
 * @returns a disposer restoring the document exactly.
 */
export function installStyles(options: StyleOptions): Disposer {
  const root = document.documentElement;
  const tag = document.createElement('style');
  tag.setAttribute('data-plugin-css', STYLE_TAG_ID);
  tag.textContent = buildStyles(options);
  document.head.appendChild(tag);
  root.setAttribute(ROOT_ATTRIBUTE, options.drawerNavigation ? 'drawer' : 'rail');
  return () => {
    tag.remove();
    root.removeAttribute(ROOT_ATTRIBUTE);
  };
}
