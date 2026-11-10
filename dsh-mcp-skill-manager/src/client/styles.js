/**
 * Scoped stylesheet for the MCP & Skill settings section.
 *
 * @module @local/dsh-mcp-skill-manager/client/styles
 */

export const CSS = String.raw`
.msm-root {
  --msm-border: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  --msm-border-strong: var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.38));
  --msm-text: var(--dsw-alias-label-primary, #1f2329);
  --msm-muted: var(--dsw-alias-label-secondary, #5c6370);
  --msm-faint: var(--dsw-alias-label-tertiary, #8a919c);
  --msm-surface: var(--dsw-alias-bg-layer-1, #ffffff);
  --msm-surface-soft: var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, 0.06));
  --msm-accent: var(--dsw-alias-button-primary-fill, #4f7cff);
  --msm-accent-text: var(--dsw-alias-label-primary-foreground, #ffffff);
  --msm-danger: var(--dsw-alias-state-error-primary, #d33a3a);
  --msm-success: var(--dsw-alias-state-success-primary, #1f8a4c);
  --msm-warn: var(--dsw-alias-state-warning-primary, #a56a00);
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 920px;
  color: var(--msm-text);
  font-size: 14px;
  line-height: 1.45;
}

.msm-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.msm-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.msm-description {
  margin: 4px 0 0;
  color: var(--msm-muted);
  font-size: 13px;
}

.msm-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.msm-toolbar--project {
  padding: 10px;
  border: 1px solid var(--msm-border);
  border-radius: 10px;
  background: var(--msm-surface-soft);
}

.msm-button {
  appearance: none;
  border: 1px solid var(--msm-border-strong);
  border-radius: 8px;
  background: var(--msm-surface);
  color: var(--msm-text);
  padding: 6px 11px;
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
}

.msm-button:hover:not(:disabled) {
  border-color: var(--msm-accent);
}

.msm-button:focus-visible,
.msm-select:focus-visible,
.msm-input:focus-visible,
.msm-search:focus-visible,
.msm-row:focus-within {
  outline: 2px solid color-mix(in srgb, var(--msm-accent) 65%, transparent);
  outline-offset: 2px;
}

.msm-button:disabled,
.msm-select:disabled,
.msm-input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.msm-button--primary {
  border-color: transparent;
  background: var(--msm-accent);
  color: var(--msm-accent-text);
  font-weight: 600;
}

.msm-button--primary:hover:not(:disabled) {
  filter: brightness(1.05);
}

.msm-button--danger {
  border-color: color-mix(in srgb, var(--msm-danger) 45%, transparent);
  color: var(--msm-danger);
}

.msm-button--ghost {
  border-color: transparent;
  background: transparent;
  color: var(--msm-muted);
}

.msm-select,
.msm-input {
  min-width: 0;
  border: 1px solid var(--msm-border-strong);
  border-radius: 8px;
  background: var(--msm-surface);
  color: var(--msm-text);
  padding: 6px 9px;
  font: inherit;
  font-size: 13px;
}

.msm-select {
  flex: 1 1 260px;
  max-width: 520px;
}

.msm-input {
  flex: 1 1 320px;
}

.msm-add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.msm-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.msm-suggestion {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px dashed var(--msm-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--msm-muted);
  padding: 3px 9px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.msm-suggestion:hover {
  border-color: var(--msm-accent);
  color: var(--msm-text);
}

.msm-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--msm-border);
  border-radius: 12px;
  background: var(--msm-surface);
}

.msm-card__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}

.msm-card__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.msm-card__description {
  margin: 3px 0 0;
  color: var(--msm-muted);
  font-size: 12px;
}

.msm-project-head {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.msm-project-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.msm-label-input {
  flex: 0 1 240px;
}

.msm-path {
  color: var(--msm-faint);
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.msm-mode {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--msm-border);
  border-radius: 8px;
  background: var(--msm-surface-soft);
}

.msm-mode__button {
  appearance: none;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--msm-muted);
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.msm-mode__button[aria-pressed="true"] {
  background: var(--msm-surface);
  color: var(--msm-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  font-weight: 600;
}

.msm-mode__button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--msm-accent) 65%, transparent);
  outline-offset: 1px;
}

.msm-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--msm-border);
}

.msm-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--msm-border);
  cursor: pointer;
}

.msm-row:last-child {
  border-bottom: 0;
}

.msm-row input[type="checkbox"] {
  flex: none;
  width: 16px;
  height: 16px;
  margin: 2px 0 0;
  accent-color: var(--msm-accent);
  cursor: pointer;
}

.msm-row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.msm-row__name {
  font-weight: 500;
  overflow-wrap: anywhere;
}

.msm-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--msm-faint);
  font-size: 12px;
}

.msm-row__description {
  color: var(--msm-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.msm-badge {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--msm-border);
  border-radius: 999px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  color: var(--msm-muted);
  background: var(--msm-surface-soft);
  white-space: nowrap;
}

.msm-badge--warn {
  border-color: color-mix(in srgb, var(--msm-warn) 45%, transparent);
  color: var(--msm-warn);
}

.msm-badge--muted {
  color: var(--msm-faint);
}

.msm-notice {
  padding: 8px 10px;
  border: 1px solid var(--msm-border);
  border-radius: 8px;
  background: var(--msm-surface-soft);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.msm-notice--error {
  border-color: color-mix(in srgb, var(--msm-danger) 45%, transparent);
  color: var(--msm-danger);
}

.msm-notice--warn {
  border-color: color-mix(in srgb, var(--msm-warn) 45%, transparent);
  color: var(--msm-warn);
}

.msm-notice--success {
  border-color: color-mix(in srgb, var(--msm-success) 45%, transparent);
  color: var(--msm-success);
}

.msm-empty {
  padding: 18px;
  border: 1px dashed var(--msm-border-strong);
  border-radius: 10px;
  color: var(--msm-muted);
  font-size: 13px;
  text-align: center;
}

.msm-search {
  flex: 0 1 260px;
}

.msm-muted {
  color: var(--msm-muted);
  font-size: 12px;
}

.msm-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 2px;
}

.msm-footer__spacer {
  flex: 1;
}

.msm-loading {
  padding: 22px;
  color: var(--msm-muted);
  font-size: 13px;
}

@media (max-width: 720px) {
  .msm-header {
    flex-direction: column;
  }

  .msm-toolbar,
  .msm-add {
    width: 100%;
  }

  .msm-select,
  .msm-input,
  .msm-search {
    max-width: none;
    flex-basis: 100%;
  }

  .msm-footer__spacer {
    display: none;
  }
}
`;

let styleNode = null;
let references = 0;

/** Install the stylesheet once and return a reference-counted disposer. */
export function installStyles() {
  if (typeof document === 'undefined') return () => {};
  if (styleNode === null) {
    styleNode = document.createElement('style');
    styleNode.setAttribute('data-dsh-plugin', 'mcp-skill-manager');
    styleNode.appendChild(document.createTextNode(CSS));
    document.head.appendChild(styleNode);
  }
  references += 1;
  return () => {
    references = Math.max(0, references - 1);
    if (references === 0 && styleNode !== null) {
      styleNode.remove();
      styleNode = null;
    }
  };
}
