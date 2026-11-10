/**
 * Declarative dsh-go views for the policy panel.
 *
 * The app owns rendering. This module only builds bounded JSON and never
 * touches host state.
 *
 * @module @local/dsh-mcp-skill-manager/dsh-go/view
 */

import { tr } from './text.js';

const PROJECTS = { $: 'data.projectRows' };
const SERVERS = { $: 'data.serverRows' };
const SKILLS = { $: 'data.skillRows' };
const STATS = { $: 'data.stats' };
const SUMMARY = { $: 'data.summary' };
const NOTICE = { $: 'data.notice' };
const MCP_MODE = { $: 'data.mcpMode' };
const SKILL_MODE = { $: 'data.skillMode' };

function modeOptions(locale) {
  return [
    { label: tr(locale, 'mode.all'), value: 'all' },
    { label: tr(locale, 'mode.selected'), value: 'selected' }
  ];
}

function actionsNode(locale, items) {
  return { type: 'actions', items };
}

function callout(locale, tone, text) {
  return { type: 'callout', tone, text };
}

function projectList(locale) {
  return { type: 'list', items: PROJECTS };
}

function serverList(locale) {
  return { type: 'list', items: SERVERS };
}

function skillList(locale) {
  return { type: 'list', items: SKILLS };
}

function modes(locale) {
  return [
    { type: 'options', id: 'mcp-mode', options: modeOptions(locale), selected: MCP_MODE },
    { type: 'options', id: 'skill-mode', options: modeOptions(locale), selected: SKILL_MODE }
  ];
}

function addForm(locale) {
  return {
    type: 'form',
    submit: { id: 'add-project' },
    submitLabel: tr(locale, 'projects.add'),
    children: [
      {
        type: 'textField',
        label: tr(locale, 'projects.path'),
        bind: 'data.form.path',
        placeholder: tr(locale, 'projects.pathPlaceholder'),
        required: true,
        maxLength: 2000,
        onChange: 'form-change'
      },
      {
        type: 'textField',
        label: tr(locale, 'projects.label'),
        bind: 'data.form.label',
        placeholder: tr(locale, 'projects.labelPlaceholder'),
        maxLength: 120,
        onChange: 'form-change'
      }
    ]
  };
}

function projectActions(locale) {
  return actionsNode(locale, [
    { label: tr(locale, 'projects.addCurrent'), action: { id: 'add-current' }, style: 'primary' },
    { label: tr(locale, 'action.refresh'), action: { id: 'refresh' } }
  ]);
}

function removeConfirm(locale) {
  return {
    type: 'confirm',
    id: 'remove-project',
    confirmLabel: tr(locale, 'projects.remove'),
    cancelLabel: tr(locale, 'action.cancel')
  };
}

function stats(locale) {
  return { type: 'keyValue', items: STATS };
}

function notice(locale) {
  return callout(locale, 'info', NOTICE);
}

/**
 * Build the full v2 panel.
 *
 * @param {{locale?: string, components?: readonly string[]}} [caps]
 */
export function buildV2View(caps = {}) {
  const locale = caps.locale;
  return {
    v: 2,
    type: 'stack',
    children: [
      { type: 'text', text: tr(locale, 'panel.description'), style: { size: 'caption' } },
      stats(locale),
      { type: 'divider' },
      { type: 'text', text: tr(locale, 'projects.title'), style: { weight: 'semibold' } },
      projectList(locale),
      addForm(locale),
      actionsNode(locale, [
        { label: tr(locale, 'projects.addCurrent'), action: { id: 'add-current' } },
        { label: tr(locale, 'action.refresh'), action: { id: 'refresh' } }
      ]),
      removeConfirm(locale),
      { type: 'divider' },
      { type: 'text', text: tr(locale, 'mcp.title'), style: { weight: 'semibold' } },
      ...modes(locale).slice(0, 1),
      serverList(locale),
      { type: 'divider' },
      { type: 'text', text: tr(locale, 'skills.title'), style: { weight: 'semibold' } },
      ...modes(locale).slice(1),
      skillList(locale),
      notice(locale),
      actionsNode(locale, [{ label: tr(locale, 'action.refresh'), action: { id: 'refresh' } }])
    ]
  };
}

/**
 * Build the v1 fallback. It keeps projects, toggles, and destructive actions
 * usable, but cannot render the add-project form.
 *
 * @param {{locale?: string}} [caps]
 */
export function buildV1View(caps = {}) {
  const locale = caps.locale;
  return {
    v: 1,
    type: 'stack',
    children: [
      { type: 'text', text: tr(locale, 'panel.description') },
      { type: 'text', text: tr(locale, 'v1.hint') },
      stats(locale),
      projectList(locale),
      projectActions(locale),
      removeConfirm(locale),
      { type: 'text', text: tr(locale, 'mcp.title') },
      modes(locale)[0],
      serverList(locale),
      { type: 'text', text: tr(locale, 'skills.title') },
      modes(locale)[1],
      skillList(locale),
      notice(locale),
      actionsNode(locale, [{ label: tr(locale, 'action.refresh'), action: { id: 'refresh' } }])
    ]
  };
}

/**
 * Choose the richest view the current app can render.
 *
 * @param {{locale?: string, components?: readonly string[]}} [caps]
 */
export function buildView(caps = {}) {
  const components = Array.isArray(caps.components) ? caps.components : undefined;
  const v2 = components === undefined || (components.includes('form') && components.includes('textField'));
  return v2 ? buildV2View(caps) : buildV1View(caps);
}
