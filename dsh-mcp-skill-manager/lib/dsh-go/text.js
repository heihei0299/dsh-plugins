/**
 * Native-panel copy for dsh-go. The manifest carries its own locale maps;
 * this module only covers text assembled by the panel controller and views.
 *
 * @module @local/dsh-mcp-skill-manager/dsh-go/text
 */

const COPY = {
  zh: {
    'panel.description': '按项目目录启用宿主 MCP 服务器与 skill。没有策略的目录保持全部启用。',
    'projects.title': '项目',
    'projects.empty': '还没有项目。先添加一个项目目录。',
    'projects.add': '添加项目',
    'projects.path': '项目目录',
    'projects.pathPlaceholder': '/绝对路径/到/项目',
    'projects.label': '显示名称（可选）',
    'projects.labelPlaceholder': '默认使用目录名',
    'projects.current': '当前目录',
    'projects.addCurrent': '使用当前目录',
    'projects.remove': '移除项目',
    'projects.removeConfirm': '确认移除？',
    'projects.removeBody': '移除后这个目录将恢复为全部启用。',
    'projects.none': '未选择项目',
    'projects.countAll': 'MCP 全部 · Skill 全部',
    'projects.countSelected': '{mcp} 个 MCP · {skills} 个 skill',
    'mcp.title': 'MCP 服务器',
    'mcp.all': '全部启用',
    'mcp.selected': '仅选中的',
    'mcp.empty': '没有发现 MCP 服务器。',
    'mcp.hostDisabled': '宿主停用',
    'mcp.stale': '目标中未发现',
    'skills.title': 'Skill',
    'skills.all': '全部启用',
    'skills.selected': '仅选中的',
    'skills.empty': '没有发现 skill。',
    'skills.unavailable': '当前宿主没有可读取的 skill 目录。',
    'skills.nativeDisabled': '本身不可调用',
    'skills.stale': '目录中已不存在',
    'mode.all': '全部',
    'mode.selected': '选中',
    'stats.file': '策略文件',
    'stats.cwd': '当前目录',
    'stats.mcp': 'MCP',
    'stats.skills': 'Skill',
    'stats.status': '状态',
    'stats.loaded': '已加载',
    'stats.error': '有错误',
    'stats.enabled': '{on}/{total} 启用',
    'status.loading': '正在读取…',
    'status.saved': '已保存',
    'status.saving': '正在保存…',
    'status.unsaved': '有未保存修改',
    'action.refresh': '刷新',
    'action.save': '保存',
    'action.cancel': '取消',
    'action.remove': '移除',
    'action.add': '添加',
    'action.addCurrent': '使用当前目录',
    'action.confirm': '确认',
    'notice.autoSave': '每次修改会立即写入策略文件。',
    'notice.configError': '策略文件读取失败，当前按全部启用处理：{message}',
    'notice.warning': '{message}',
    'notice.saved': '策略已保存。',
    'notice.addFirst': '先添加一个项目目录。',
    'notice.noCwd': '当前没有可用的工作目录。',
    'notice.invalidPath': '请输入绝对路径。',
    'notice.duplicate': '这个目录已经在项目中。',
    'notice.saveFailed': '保存失败：{message}',
    'notice.removeFailed': '移除失败：{message}',
    'notice.skillsUnavailable': 'Skill 目录暂不可用，MCP 仍可管理。',
    'notice.loading': '正在读取 MCP 与 skill 目录…',
    'notice.none': '没有需要显示的提示。',
    'empty.mcp': '没有可管理的 MCP 服务器。',
    'empty.skills': '没有可管理的 skill。',
    'v1.hint': '当前 App 版本不支持原生表单；请在 Web 设置中添加项目。',
    'confirm.remove': '移除',
    'summary.none': '没有匹配的项目，当前目录保持全部启用。',
    'summary.current': '当前目录',
    'form.optional': '可选',
    'form.required': '必填'
  },
  en: {
    'panel.description': 'Enable host MCP servers and skills per project directory. Directories without a policy stay fully enabled.',
    'projects.title': 'Projects',
    'projects.empty': 'No projects yet. Add a project directory first.',
    'projects.add': 'Add project',
    'projects.path': 'Project directory',
    'projects.pathPlaceholder': '/absolute/path/to/project',
    'projects.label': 'Display name (optional)',
    'projects.labelPlaceholder': 'Defaults to the directory name',
    'projects.current': 'Current directory',
    'projects.addCurrent': 'Use current directory',
    'projects.remove': 'Remove project',
    'projects.removeConfirm': 'Remove this project?',
    'projects.removeBody': 'This directory will return to fully enabled.',
    'projects.none': 'No project selected',
    'projects.countAll': 'All MCP · all skills',
    'projects.countSelected': '{mcp} MCP · {skills} skills',
    'mcp.title': 'MCP servers',
    'mcp.all': 'All enabled',
    'mcp.selected': 'Selected only',
    'mcp.empty': 'No MCP servers discovered.',
    'mcp.hostDisabled': 'Disabled by host',
    'mcp.stale': 'Not discovered here',
    'skills.title': 'Skills',
    'skills.all': 'All enabled',
    'skills.selected': 'Selected only',
    'skills.empty': 'No skills discovered.',
    'skills.unavailable': 'This host does not expose a readable skill catalog.',
    'skills.nativeDisabled': 'Not invocable',
    'skills.stale': 'No longer on disk',
    'mode.all': 'All',
    'mode.selected': 'Selected',
    'stats.file': 'Policy file',
    'stats.cwd': 'Current directory',
    'stats.mcp': 'MCP',
    'stats.skills': 'Skills',
    'stats.status': 'Status',
    'stats.loaded': 'Loaded',
    'stats.error': 'Error',
    'stats.enabled': '{on}/{total} enabled',
    'status.loading': 'Loading…',
    'status.saved': 'Saved',
    'status.saving': 'Saving…',
    'status.unsaved': 'Unsaved changes',
    'action.refresh': 'Refresh',
    'action.save': 'Save',
    'action.cancel': 'Cancel',
    'action.remove': 'Remove',
    'action.add': 'Add',
    'action.addCurrent': 'Use current directory',
    'action.confirm': 'Confirm',
    'notice.autoSave': 'Every change is written to the policy file immediately.',
    'notice.configError': 'Could not read the policy file; everything is enabled for now: {message}',
    'notice.warning': '{message}',
    'notice.saved': 'Policy saved.',
    'notice.addFirst': 'Add a project directory first.',
    'notice.noCwd': 'No working directory is available.',
    'notice.invalidPath': 'Enter an absolute path.',
    'notice.duplicate': 'That directory is already a project.',
    'notice.saveFailed': 'Save failed: {message}',
    'notice.removeFailed': 'Remove failed: {message}',
    'notice.skillsUnavailable': 'The skill catalog is unavailable; MCP remains manageable.',
    'notice.loading': 'Reading MCP and skill catalogs…',
    'notice.none': 'Nothing to report.',
    'empty.mcp': 'No MCP servers to manage.',
    'empty.skills': 'No skills to manage.',
    'v1.hint': 'This App version cannot render native forms. Add projects in Web settings.',
    'confirm.remove': 'Remove',
    'summary.none': 'No matching project; the current directory stays fully enabled.',
    'summary.current': 'Current directory',
    'form.optional': 'Optional',
    'form.required': 'Required'
  }
};

/** Resolve the copy table for a BCP-47-ish locale. */
export function copyFor(locale) {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? COPY.en : COPY.zh;
}

/** Translate one key and interpolate `{name}` placeholders. */
export function tr(locale, key, values) {
  const table = copyFor(locale);
  let text = table[key] ?? COPY.en[key] ?? key;
  if (values && typeof values === 'object') {
    for (const [name, value] of Object.entries(values)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** Count Unicode scalar values for manifest and view limits. */
export function charLength(value) {
  return [...String(value)].length;
}
