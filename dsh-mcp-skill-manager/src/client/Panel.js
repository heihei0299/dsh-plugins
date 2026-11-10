/**
 * Presentational MCP & Skill settings panel.
 *
 * The component is intentionally hook-free so it can be rendered with
 * `react-dom/server` in tests and kept independent from the host UI kit.
 *
 * @module @local/dsh-mcp-skill-manager/client/Panel
 */

import * as React from 'react';

const h = React.createElement;

/** Join conditional class names. */
function cx(...values) {
  return values.filter((value) => typeof value === 'string' && value.length > 0).join(' ');
}

/** Render one badge. */
function badge(text, tone) {
  return h('span', { className: cx('msm-badge', tone === undefined ? undefined : `msm-badge--${tone}`) }, text);
}

/** Render one notice. */
function noticeBox(text, tone) {
  return h('div', { className: cx('msm-notice', tone === undefined ? undefined : `msm-notice--${tone}`) }, text);
}

/** Build the union of configured servers and saved names. */
function serverRows(project, servers) {
  const known = new Map();
  for (const server of servers ?? []) known.set(server.serverName, server);
  const names = new Set(known.keys());
  for (const name of project?.mcp?.servers ?? []) names.add(name);
  const rows = [...names].map((name) => {
    const server = known.get(name);
    return {
      name,
      missing: server === undefined,
      transport: server?.transport,
      origin: server?.origin,
      disabled: server?.disabled === true,
      toolCount: server?.toolCount ?? 0,
      toolNames: server?.toolNames ?? [],
      toolsTruncated: server?.toolsTruncated === true
    };
  });
  rows.sort((left, right) => Number(left.missing) - Number(right.missing) || left.name.localeCompare(right.name));
  return rows;
}

/** Build the union of discovered catalog entries and saved names. */
function skillRows(project, catalog, query) {
  const known = new Map();
  for (const skill of catalog ?? []) known.set(skill.name, skill);
  const names = new Set(known.keys());
  for (const name of project?.skills?.names ?? []) names.add(name);
  const needle = query.trim().toLowerCase();
  const rows = [...names].map((name) => {
    const skill = known.get(name);
    return {
      name,
      missing: skill === undefined,
      description: skill?.description ?? '',
      source: skill?.source,
      provider: skill?.provider,
      nativeModelInvocable: skill?.invocation?.modelInvocable !== false
    };
  });
  rows.sort((left, right) => Number(left.missing) - Number(right.missing) || left.name.localeCompare(right.name));
  if (needle.length === 0) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle));
}

/** Render one MCP mode segmented control. */
function modeControl(t, mode, saving, onMode) {
  return h(
    'div',
    { className: 'msm-mode', role: 'group', 'aria-label': t('mcpTitle') },
    h(
      'button',
      {
        type: 'button',
        className: 'msm-mode__button',
        'aria-pressed': mode === 'all',
        disabled: saving,
        onClick: () => onMode('all')
      },
      t('modeAll')
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'msm-mode__button',
        'aria-pressed': mode === 'selected',
        disabled: saving,
        onClick: () => onMode('selected')
      },
      t('modeSelected')
    )
  );
}

/** Render one checkbox row. */
function checkRow(options) {
  const { key, label, description, meta, checked, disabled, onChange, dataKey, dataValue } = options;
  const attrs = { className: 'msm-row', key };
  if (dataKey !== undefined) attrs[dataKey] = dataValue;
  return h(
    'label',
    attrs,
    h('input', {
      type: 'checkbox',
      checked,
      disabled,
      onChange: () => onChange(),
      'aria-label': label
    }),
    h(
      'span',
      { className: 'msm-row__main' },
      h('span', { className: 'msm-row__name' }, label),
      meta !== undefined ? h('span', { className: 'msm-row__meta' }, meta) : null,
      description !== undefined && description.length > 0
        ? h('span', { className: 'msm-row__description', title: description }, description)
        : null
    )
  );
}

/** Build the complete panel tree. */
export function Panel(props) {
  const {
    t,
    state,
    policy,
    phase,
    loadError,
    selectedPath,
    skills,
    skillsPhase,
    skillsError,
    query,
    newPath,
    adding,
    saving,
    notice,
    dirty,
    onRefresh,
    onSelect,
    onNewPath,
    onToggleAdd,
    onAddProject,
    onRemoveProject,
    onLabel,
    onMcpMode,
    onToggleServer,
    onSkillMode,
    onToggleSkill,
    onQuery,
    onSave,
    onReset
  } = props;

  const header = h(
    'header',
    { className: 'msm-header' },
    h(
      'div',
      null,
      h('h3', { className: 'msm-title' }, t('title')),
      h('p', { className: 'msm-description' }, t('description'))
    ),
    h(
      'div',
      { className: 'msm-toolbar' },
      h('button', { type: 'button', className: 'msm-button', disabled: saving, onClick: onRefresh }, t('refresh'))
    )
  );

  if (policy === null || state === null) {
    if (phase === 'failed') {
      return h(
        'section',
        { className: 'msm-root', 'data-plugin': 'mcp-skill-manager' },
        header,
        noticeBox(loadError ?? t('hostUnavailable'), 'error'),
        h(
          'div',
          { className: 'msm-toolbar' },
          h('button', { type: 'button', className: 'msm-button', onClick: onRefresh }, t('retry'))
        )
      );
    }
    return h(
      'section',
      { className: 'msm-root', 'data-plugin': 'mcp-skill-manager' },
      header,
      h('div', { className: 'msm-loading' }, t('loading'))
    );
  }

  const project = policy.projects.find((entry) => entry.path === selectedPath);
  const projectState = state.projects?.find((entry) => entry.path === selectedPath);
  const rows = serverRows(project, state.servers);
  const catalog = skills?.skills ?? [];
  const skillsForProject = skillRows(project, catalog, query);
  const enabledServers = project?.mcp?.mode === 'all' ? null : project?.mcp?.servers?.length ?? 0;
  const enabledSkills = project?.skills?.mode === 'all' ? null : project?.skills?.names?.length ?? 0;
  const suggestions = (state.workspaceSuggestions ?? []).filter(
    (suggestion) => !policy.projects.some((entry) => entry.path === suggestion.path)
  );
  const canSave = dirty || state.configError !== null;
  const configNotices = [];
  if (state.configError !== null) {
    configNotices.push(noticeBox(t('configError', { message: state.configError.message }), 'error'));
  }
  for (const warning of state.warnings ?? []) {
    configNotices.push(noticeBox(t('warnings', { message: warning.message }), 'warn'));
  }
  if (notice !== null) configNotices.push(noticeBox(notice.text, notice.kind));

  return h(
    'section',
    { className: 'msm-root', 'data-plugin': 'mcp-skill-manager' },
    header,
    ...configNotices,
    h(
      'div',
      { className: 'msm-toolbar msm-toolbar--project' },
      h(
        'label',
        { className: 'msm-muted', htmlFor: 'msm-project-select' },
        t('projects')
      ),
      h(
        'select',
        {
          id: 'msm-project-select',
          className: 'msm-select',
          value: selectedPath ?? '',
          disabled: saving || policy.projects.length === 0,
          onChange: (event) => onSelect(event.target.value)
        },
        policy.projects.length === 0
          ? h('option', { value: '' }, t('noProjects'))
          : policy.projects.map((entry) =>
              h('option', { key: entry.path, value: entry.path }, entry.label || entry.path)
            )
      ),
      h(
        'button',
        { type: 'button', className: 'msm-button', disabled: saving, onClick: onToggleAdd },
        adding ? t('cancel') : t('addProject')
      )
    ),
    adding
      ? h(
          'div',
          { className: 'msm-card' },
          h(
            'div',
            { className: 'msm-add' },
            h('input', {
              className: 'msm-input',
              value: newPath,
              placeholder: t('projectPathPlaceholder'),
              'aria-label': t('projectPath'),
              disabled: saving,
              onChange: (event) => onNewPath(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') onAddProject();
              }
            }),
            h('button', { type: 'button', className: 'msm-button msm-button--primary', disabled: saving, onClick: onAddProject }, t('addProject'))
          ),
          suggestions.length > 0
            ? h(
                'div',
                { className: 'msm-suggestions' },
                suggestions.map((suggestion) =>
                  h(
                    'button',
                    {
                      key: suggestion.path,
                      type: 'button',
                      className: 'msm-suggestion',
                      title: suggestion.path,
                      onClick: () => onNewPath(suggestion.path)
                    },
                    suggestion.title || suggestion.path
                  )
                )
              )
            : null
        )
      : null,
    project === undefined
      ? h(
          'div',
          { className: 'msm-empty' },
          h('div', null, t('noProjects')),
          h('div', { className: 'msm-muted' }, t('noProjectsHint'))
        )
      : h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'msm-card', 'data-msm-project': project.path },
            h(
              'div',
              { className: 'msm-project-head' },
              h(
                'div',
                { className: 'msm-project-title' },
                h('input', {
                  className: 'msm-input msm-label-input',
                  value: project.label,
                  'aria-label': t('label'),
                  disabled: saving,
                  onChange: (event) => onLabel(event.target.value)
                }),
                badge(
                  projectState?.exists === false ? t('projectMissing') : t('projectExists'),
                  projectState?.exists === false ? 'warn' : undefined
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'msm-button msm-button--danger',
                    disabled: saving,
                    onClick: () => onRemoveProject(project.path)
                  },
                  t('removeProject')
                )
              ),
              h('div', { className: 'msm-path' }, project.path),
              h('div', { className: 'msm-muted' }, t('removeHint'))
            )
          ),
          h(
            'section',
            { className: 'msm-card', 'data-msm-section': 'mcp' },
            h(
              'div',
              { className: 'msm-card__head' },
              h(
                'div',
                null,
                h('h4', { className: 'msm-card__title' }, t('mcpTitle')),
                h('p', { className: 'msm-card__description' }, t('mcpDescription'))
              ),
              modeControl(t, project.mcp.mode, saving, onMcpMode)
            ),
            h(
              'div',
              { className: 'msm-muted' },
              enabledServers === null ? t('allEnabled') : t('selectedCount', { count: enabledServers })
            ),
            rows.length === 0
              ? h('div', { className: 'msm-empty' }, t('noServers'))
              : h(
                  'div',
                  { className: 'msm-list' },
                  rows.map((row) =>
                    checkRow({
                      key: row.name,
                      label: row.name,
                      description:
                        row.toolNames.length === 0
                          ? undefined
                          : `${row.toolNames.join(', ')}${row.toolsTruncated ? ', …' : ''}`,
                      meta: [
                        row.transport ?? t('unknown'),
                        row.origin === 'profile' ? 'profile' : row.origin === 'tools' ? 'runtime' : null,
                        t('serverToolCount', { count: row.toolCount }),
                        row.disabled ? badge(t('profileDisabled'), 'warn') : null,
                        row.missing ? badge(t('staleServer'), 'warn') : null
                      ],
                      checked: project.mcp.mode === 'all' || project.mcp.servers.includes(row.name),
                      disabled: saving,
                      onChange: () => onToggleServer(row.name),
                      dataKey: 'data-msm-server',
                      dataValue: row.name
                    })
                  )
                )
          ),
          h(
            'section',
            { className: 'msm-card', 'data-msm-section': 'skills' },
            h(
              'div',
              { className: 'msm-card__head' },
              h(
                'div',
                null,
                h('h4', { className: 'msm-card__title' }, t('skillsTitle')),
                h('p', { className: 'msm-card__description' }, t('skillsDescription'))
              ),
              h(
                'div',
                { className: 'msm-toolbar' },
                h('input', {
                  className: 'msm-input msm-search',
                  type: 'search',
                  value: query,
                  placeholder: t('searchSkills'),
                  'aria-label': t('searchSkills'),
                  disabled: saving,
                  onChange: (event) => onQuery(event.target.value)
                }),
                modeControl(t, project.skills.mode, saving, onSkillMode)
              )
            ),
            h(
              'div',
              { className: 'msm-muted' },
              enabledSkills === null ? t('allEnabled') : t('selectedCount', { count: enabledSkills })
            ),
            skillsPhase === 'loading' ? noticeBox(t('skillsLoading')) : null,
            skillsPhase === 'failed' ? noticeBox(skillsError ?? t('skillsFailed'), 'error') : null,
            skills?.complete === false ? noticeBox(t('incomplete'), 'warn') : null,
            skills?.warning !== undefined && skills.warning !== null
              ? noticeBox(skills.warning, 'warn')
              : null,
            skillsForProject.length === 0
              ? h('div', { className: 'msm-empty' }, t('noSkills'))
              : h(
                  'div',
                  { className: 'msm-list' },
                  skillsForProject.map((row) =>
                    checkRow({
                      key: row.name,
                      label: row.name,
                      description: row.description,
                      meta: [
                        row.provider ?? row.source ?? t('unknown'),
                        row.missing ? badge(t('staleSkill'), 'warn') : null,
                        row.nativeModelInvocable ? null : badge(t('nativeDisabled'), 'muted')
                      ],
                      checked: project.skills.mode === 'all' || project.skills.names.includes(row.name),
                      disabled: saving,
                      onChange: () => onToggleSkill(row.name),
                      dataKey: 'data-msm-skill',
                      dataValue: row.name
                    })
                  )
                )
          )
        ),
    h(
      'div',
      { className: 'msm-footer' },
      h(
        'button',
        { type: 'button', className: 'msm-button msm-button--primary', disabled: saving || !canSave, onClick: onSave },
        saving ? t('saving') : t('save')
      ),
      h(
        'button',
        { type: 'button', className: 'msm-button', disabled: saving || !dirty, onClick: onReset },
        t('reset')
      ),
      h('span', { className: 'msm-muted' }, dirty ? t('unsaved') : t('statusHint')),
      h('span', { className: 'msm-footer__spacer' }),
      h('button', { type: 'button', className: 'msm-button msm-button--ghost', disabled: saving, onClick: onRefresh }, t('refresh'))
    )
  );
}
