/**
 * Native-panel copy for dsh-go. The manifest carries its own locale maps; this
 * module covers the text the panel controller and its view assemble.
 *
 * @module dsh-i-have-adhd/dsh-go/text
 */

const COPY = {
  zh: {
    'panel.description': 'ADHD 输出模式按会话生效：用下面的开关替代 /adhd on|off。',
    'stats.plugin': '插件配置',
    'stats.pluginOn': '已启用',
    'stats.pluginOff': '已关闭',
    'stats.subagents': '子代理',
    'stats.subagentsOn': '套用',
    'stats.subagentsOff': '不套用',
    'stats.session': '当前会话',
    'stats.section': '提示词段',
    'session.on': '开',
    'session.off': '关',
    'session.child': '子代理不套用',
    'session.unknown': '未定位',
    'notice.on': '下一次模型步起按 ADHD 形状回复。',
    'notice.off': '当前会话已静音；下一次模型步起恢复默认风格。',
    'notice.child': '这是子代理会话，规则默认不进入委派报告。',
    'notice.disabled': '插件配置里 enabled 为 false：保留安装但不注册提示词段。',
    'notice.noAgent': '找不到这个会话的 live Agent，开关没有生效；请在对话里用 /adhd。',
    'action.on': '开启',
    'action.off': '关闭',
    'action.refresh': '刷新',
    'toast.on': '本会话已开启 ADHD 输出',
    'toast.off': '本会话已关闭 ADHD 输出',
    'toast.disabled': '插件配置已关闭，先启用插件'
  },
  en: {
    'panel.description': 'ADHD output mode is per session: these switches replace /adhd on|off.',
    'stats.plugin': 'Plugin config',
    'stats.pluginOn': 'Enabled',
    'stats.pluginOff': 'Disabled',
    'stats.subagents': 'Subagents',
    'stats.subagentsOn': 'Shaped',
    'stats.subagentsOff': 'Not shaped',
    'stats.session': 'This session',
    'stats.section': 'Prompt section',
    'session.on': 'On',
    'session.off': 'Off',
    'session.child': 'Not for subagents',
    'session.unknown': 'Not resolved',
    'notice.on': 'Replies follow the ADHD shape from the next model step.',
    'notice.off': 'Muted for this session; the default style returns on the next model step.',
    'notice.child': 'This is a subagent session, and the rules stay out of delegated reports.',
    'notice.disabled': 'The profile sets enabled: false, so the plugin stays installed but registers no section.',
    'notice.noAgent': 'The live Agent for this session was not found, so the switch did nothing; use /adhd in the conversation.',
    'action.on': 'On',
    'action.off': 'Off',
    'action.refresh': 'Refresh',
    'toast.on': 'ADHD output on for this session',
    'toast.off': 'ADHD output off for this session',
    'toast.disabled': 'The plugin config is off; enable the plugin first'
  }
};

/**
 * Resolve the copy table for a BCP-47-ish locale.
 * @param locale - current app locale.
 * @returns the zh or en table.
 */
export function copyFor(locale) {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? COPY.en : COPY.zh;
}

/**
 * Translate one key and interpolate `{name}` placeholders.
 * @param locale - current app locale.
 * @param key - copy key.
 * @param values - interpolation values.
 * @returns the rendered string, or the key when unknown.
 */
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
