#!/usr/bin/env node
/**
 * Mechanical check that this repository's plugins are still accepted by the
 * installed DSH.
 *
 * Two static layers, read-only (only file reads):
 *
 * 1. Every plugin manifest's `engines.dsh` is handed to the target DSH's own
 *    `@deepseek-ai/dsh-app-boot` `evaluatePluginCompatibility` — the exact
 *    function the boot preflight and the plugin manager use — with an EMPTY
 *    exemption table. A profile-local exemption is not evidence: without an
 *    exemption the row would be denied at boot, so the check must not accept it
 *    either.
 * 2. The listed contracts a plugin leans on are still present in that install.
 *    Each entry names one dependency point; a failing pattern means the seam
 *    moved, and the FAIL line names the file to read.
 *
 * The optional third layer is NOT read-only: it runs each plugin's own `test`
 * script, and a `pretest` may write build artifacts (dsh-mobile builds dist/).
 * Pass `--contracts-only` when the tree must not be written — for example in a
 * two-version matrix — since the contract set depends on the target runtime
 * while the plugin tests do not.
 *
 * Usage: node scripts/check-compat.mjs [--dsh <dsh package dir>] [--contracts-only] [--baseline <file>]
 * Exit codes: 0 every check passed and the baseline matches; 2 every check
 * passed but dsh/cordis drifted from the baseline; 1 a check, argument or
 * environment failure.
 *
 * The local skill at .agents/skills/dsh-compat-check/scripts/check.mjs imports
 * this module and only supplies its own baseline path, so there is one contract
 * list and one evaluation path, not two.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Repository root: this file lives in <root>/scripts. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Local skill directory that owns baseline.json (user-private, git-ignored). */
const DEFAULT_BASELINE = join(repoRoot, ".agents", "skills", "dsh-compat-check", "baseline.json");

/** Plugin dependencies on dsh / cordis internals. */
export const CONTRACTS = [
	{
		id: "subagent.startActivation",
		pkg: "@deepseek-ai/dsh-subagent",
		file: "lib/index.js",
		pattern: /startActivation\(\s*spec\s*\)/,
		why: "pin-subagent-model 装饰 ctx.subagents.startActivation；改名或改形会让 pin 静默失效"
	},
	{
		id: "spec.provider",
		pkg: "@deepseek-ai/dsh-subagent",
		file: "lib/types/types.d.ts",
		pattern: /readonly provider: string/,
		why: "插件按 spec.provider 过滤要 pin 的后端"
	},
	{
		id: "spec.request 载体",
		pkg: "@deepseek-ai/dsh-subagent",
		file: "lib/types/types.d.ts",
		pattern: /readonly request: Omit<SubagentStartRequest/,
		why: "插件通过 spec.request 取任务字段"
	},
	{
		id: "request.agentOptions",
		pkg: "@deepseek-ai/dsh-subagent",
		file: "lib/types/types.d.ts",
		pattern: /readonly agentOptions\?: AgentOptions/,
		why: "改路由的唯一通道；字段消失就无处写 pin"
	},
	{
		id: "startLocal 使用 request.agentOptions",
		pkg: "@deepseek-ai/dsh-subagent",
		file: "lib/index.js",
		pattern: /resolveChildAgentOptions\(\s*parent,\s*request\.agentOptions/,
		why: "证明改写 request.agentOptions 会真正决定子 Agent 路由"
	},
	{
		id: "request.agentPreset",
		pkg: "@deepseek-ai/dsh-subagent",
		file: "lib/types/types.d.ts",
		pattern: /readonly agentPreset\?: string/,
		why: "固定子代理预设的唯一通道；字段消失就无处写 agentPreset"
	},
	{
		id: "startLocal 使用 request.agentPreset",
		pkg: "@deepseek-ai/dsh-subagent",
		file: "lib/index.js",
		pattern: /composition: \{ agentPreset: request\.agentPreset \}/,
		why: "证明改写 request.agentPreset 会真正决定子 Agent 组合"
	},
	{
		id: "spawn 支持 agentPreset",
		pkg: "@deepseek-ai/dsh-subagent-spawn-in-process",
		file: "lib/index.js",
		pattern: /agentPreset: true/,
		why: "插件给 spawn 子代理写 agentPreset；能力位消失会直接拒绝委派"
	},
	{
		id: "fork 不支持 agentPreset",
		pkg: "@deepseek-ai/dsh-subagent-fork-in-process",
		file: "lib/index.js",
		pattern: /agentPreset: false/,
		why: "插件按该能力位跳过 fork；若变为 true，fork 会收到独立 preset 而不再继承"
	},
	{
		id: "preset registry mount",
		pkg: "@deepseek-ai/dsh-agent-preset-registry",
		file: "lib/index.js",
		pattern: /async mount\(ctx, id\)/,
		why: "request.agentPreset 最终经 registry.mount 生效；方法改名 pin 会静默失效"
	},
	{
		id: "WebUI plugins.row.config 槽",
		pkg: "@deepseek-ai/dsh-client-ui-plugin-manager",
		file: "lib/types/client/slot-contract.d.ts",
		pattern: /'plugins\.row\.config': \{/,
		why: "配置页注册在官方行配置槽；槽名变化后插件页不再出现「配置」入口"
	},
	{
		id: "configForms.get",
		pkg: "@deepseek-ai/dsh-client-ui-settings",
		file: "lib/types/client/config-form.d.ts",
		pattern: /get<T>\(entryId: string\): ConfigForm<T>/,
		why: "配置页通过 entry id 取得 ConfigForm；签名变化会读不到 volatile 值"
	},
	{
		id: "agentPresets/list remote",
		pkg: "@deepseek-ai/dsh-agent-preset-registry",
		file: "lib/typert.remote-client.js",
		pattern: /'agentPresets\/list'/,
		why: "配置页下拉用 remote.agentPresets.list() 读取已声明预设"
	},
	{
		id: "schemastery volatile",
		pkg: "@deepseek-ai/schemastery",
		file: "lib/index.mjs",
		pattern: /prototype\.volatile = function volatile/,
		why: "Host Config 用 .volatile() 暴露 WebUI 可写字段；没有该标记设置页不会出现"
	},
	{
		id: "能力闸门",
		pkg: "@deepseek-ai/dsh-subagent",
		file: "lib/index.js",
		pattern: /assertCapabilities\(/,
		why: "注入 agentOptions 会过能力校验；新增能力位可能拒绝 pin"
	},
	{
		id: "spawn 支持 agentOptions",
		pkg: "@deepseek-ai/dsh-subagent-spawn-in-process",
		file: "lib/index.js",
		pattern: /agentOptions: true/,
		why: "pin 注入 agentOptions，后端不再声明该能力会直接拒绝委派"
	},
	{
		id: "spawn 后端名",
		pkg: "@deepseek-ai/dsh-subagent-spawn-in-process",
		file: "lib/index.js",
		pattern: /default\("spawn"\)/,
		why: "插件按 provider 名 spawn 过滤；默认名变化会让该后端不被 pin"
	},
	{
		id: "fork 支持 agentOptions",
		pkg: "@deepseek-ai/dsh-subagent-fork-in-process",
		file: "lib/index.js",
		pattern: /agentOptions: true/,
		why: "同上，fork 后端"
	},
	{
		id: "fork 后端名",
		pkg: "@deepseek-ai/dsh-subagent-fork-in-process",
		file: "lib/index.js",
		pattern: /default\("fork"\)/,
		why: "同上，fork 后端"
	},
	{
		id: "委派工具入口",
		pkg: "@deepseek-ai/dsh-tool-subagent",
		file: "lib/index.js",
		pattern: /subagents\.startActivation\s*\(/,
		why: "模型侧委派必须仍走被装饰的入口，否则 pin 不覆盖工具调用"
	},
	{
		id: "cordis ctx.effect",
		pkg: "@deepseek-ai/cordis",
		file: "lib/types/fiber.d.ts",
		pattern: /effect\(execute:/,
		why: "插件用 ctx.effect(fn, label) 注册并在 dispose 时还原装饰"
	},
	{
		id: "cordis inject 声明",
		pkg: "@deepseek-ai/cordis",
		file: "lib/types/registry.d.ts",
		pattern: /inject\?: Inject/,
		why: "插件用 export const inject = ['subagents'] 声明依赖"
	},
	// dsh-mobile 依赖宿主 DOM 地标，而不是 CSS 类名。每一条对应
	// dsh-mobile/src/client/landmarks.ts 里的一个选择器；sed 换名即在此 FAIL。
	{
		id: "dsh-mobile: root 槽锚点",
		pkg: "@deepseek-ai/dsh-client-ui-renderer",
		file: "lib/client.js",
		pattern: /"data-slot": slotKey/,
		why: "dsh-mobile 全部结构选择器都以 [data-slot=\"…\"] 锚点为基准；锚点消失则样式不命中"
	},
	{
		id: "dsh-mobile: 帧折叠属性",
		pkg: "@deepseek-ai/dsh-client-ui-layout",
		file: "lib/client.js",
		pattern: /"data-sidebar-collapsed":/,
		why: "抽屉用宿主自己的 data-sidebar-collapsed 跟随开合状态；改名会让抽屉永远停在关闭位"
	},
	{
		id: "dsh-mobile: overlay 层",
		pkg: "@deepseek-ai/dsh-client-ui-layout",
		file: "lib/client.js",
		pattern: /"data-shell-overlay": true/,
		why: "抽屉按钮与遮罩注册在 shell.overlay 槽；该槽不再挂载则没有打开侧栏的入口"
	},
	{
		id: "dsh-mobile: layout.toggleSidebar",
		pkg: "@deepseek-ai/dsh-client-ui-layout",
		file: "lib/types/client/service.d.ts",
		pattern: /toggleSidebar\(\): void/,
		why: "抽屉的开合动作只调用宿主公开的 ctx.layout.toggleSidebar，不自己写布局状态"
	},
	{
		id: "dsh-mobile: 输入卡片",
		pkg: "@deepseek-ai/dsh-client-ui-conversation",
		file: "lib/client.js",
		pattern: /"data-composer-card": true/,
		why: "44px 触控目标按 [data-composer-card] button 定位；标记改名则该规则失效"
	},
	{
		id: "dsh-mobile: 会话滚动容器",
		pkg: "@deepseek-ai/dsh-client-ui-conversation",
		file: "lib/client.js",
		pattern: /"data-conversation-scroll":/,
		why: "软键盘内边距与 overscroll 收敛都挂在该滚动容器上"
	},
	{
		id: "dsh-mobile: 消息操作按钮",
		pkg: "@deepseek-ai/dsh-client-ui-chat",
		file: "lib/client.js",
		pattern: /"data-actions-reveal":/,
		why: "复制/分支等消息操作按钮的触控目标按该标记定位"
	},
	{
		id: "dsh-mobile: 设置面板锚点",
		pkg: "@deepseek-ai/dsh-client-ui-settings-general",
		file: "lib/client.js",
		pattern: /"data-shortcut-modal": "settings"/,
		why: "窄屏设置面板重排以该宿主标记为根；改名后全屏与横向标签规则不再命中"
	},
	{
		id: "dsh-mobile: 设置分区 slot",
		pkg: "@deepseek-ai/dsh-client-ui-settings-general",
		file: "lib/client.js",
		pattern: /"settings\.section": \{/,
		why: "设置列表行头换行规则挂在 settings.section 的 data-slot 锚点下；slot 改名会让模型行重新重叠"
	},
	{
		id: "dsh-mobile: 宽表格 class",
		pkg: "@deepseek-ai/dsh-web-frontend",
		dir: "dist/assets",
		match: /^index-.*\.js$/,
		pattern: /md-table-wide/,
		why: "4 列以上表格在触屏上没有 hover，必须由插件改回可横向滚动；class 改名会让宽表格再次无法滑动"
	},
	{
		id: "dsh-mobile: 动效时长 token",
		pkg: "@deepseek-ai/dsh-client-ui-theme",
		file: "lib/client.js",
		pattern: /--ds-transition-duration-slow:/,
		why: "抽屉滑入复用宿主的 --ds-transition-duration-slow，与 sidebar-right 一致；token 改名会让回退值 .3s 静默接管"
	},
	{
		id: "dsh-mobile: 缓动 token",
		pkg: "@deepseek-ai/dsh-client-ui-theme",
		file: "lib/client.js",
		pattern: /--ds-ease-in-out:/,
		why: "复用宿主共享缓动；改名后回退到 cubic-bezier(.4,0,.2,1)，不再随宿主主题变化"
	},
	{
		id: "dsh-mobile: 原生边缘面板滑入范式",
		pkg: "@deepseek-ai/dsh-client-ui-sidebar-right",
		file: "lib/client.js",
		pattern: /transition:transform var\(--ds-transition-duration-slow\) var\(--ds-ease-in-out\),\s*visibility 0s linear var\(--ds-transition-duration-slow\)/,
		why: "抽屉过渡抄自 sidebar-right；宿主若改写自身滑入方式，这里应同步而不是继续跟随旧范式"
	},
	// dsh-history-budget 只包装存活 sessionController 的 follow / page，并依赖
	// 网关「每次调用重新解析 receiver 再 Reflect.get 方法」的分发方式。
	{
		id: "dsh-history-budget: sessionController 服务",
		pkg: "@deepseek-ai/dsh-api-session-controller",
		file: "lib/types/index.d.ts",
		pattern: /sessionController: SessionController;/,
		why: "插件 inject ['sessionController'] 并原地替换它的方法；服务名或类改名会让注入失败、裁剪不生效"
	},
	{
		id: "dsh-history-budget: follow 签名",
		pkg: "@deepseek-ai/dsh-api-session-controller",
		file: "lib/types/index.d.ts",
		pattern: /follow\(request: SessionFollowRequest, signal: AbortSignal\): AsyncIterable<SessionFollowFrame>;/,
		why: "插件包装的是返回异步帧流的 follow；改成 Promise 或换名会让首帧裁剪静默消失"
	},
	{
		id: "dsh-history-budget: page 签名",
		pkg: "@deepseek-ai/dsh-api-session-controller",
		file: "lib/types/index.d.ts",
		pattern: /page\(request: SessionPageRequest, signal: AbortSignal\): Promise<SessionPage>;/,
		why: "插件包装返回页值的 page；签名变化会让历史页不再按字节裁剪"
	},
	{
		id: "dsh-history-budget: 首帧形状",
		pkg: "@deepseek-ai/dsh-api-session-controller",
		file: "lib/types/types.d.ts",
		pattern: /readonly type: 'snapshot';[\s\S]{0,600}?readonly records: readonly SessionHistoryRecord\[\];/,
		why: "插件只在首帧 type === 'snapshot' 且带 records 数组时裁剪；形状改名即静默不裁剪"
	},
	{
		id: "dsh-history-budget: 页值形状",
		pkg: "@deepseek-ai/dsh-api-session-controller",
		file: "lib/types/types.d.ts",
		pattern: /export interface SessionPage \{\s*readonly records: readonly SessionHistoryRecord\[\];\s*readonly hasMore: boolean;/,
		why: "插件按 { records, hasMore } 裁剪页值；字段改名会把裁剪结果写成客户端读不到的键"
	},
	{
		id: "dsh-history-budget: 网关按调用取 receiver",
		pkg: "@deepseek-ai/dsh-api-gateway",
		file: "lib/index.js",
		pattern: /Reflect\.get\(callReceiver, implementation\)/,
		why: "原地替换服务方法仍被分发的唯一依据；网关若缓存方法引用，包装不会生效"
	},
	{
		id: "dsh-history-budget: 网关按调用解析服务",
		pkg: "@deepseek-ai/dsh-api-gateway",
		file: "lib/index.js",
		pattern: /receiverContext\.get\(descriptor\.service\)/,
		why: "每次调用重新解析 receiver 才能看到替换后的方法；改为启动期绑定则裁剪静默失效"
	},
	// dsh-lan-connect 只做 additive 注册：原生路由位、index 注入行、原生信任
	// 检查与原生登录 URL 签发都必须是宿主提供的原物，插件不替换它们。
	{
		id: "dsh-lan-connect: webServer 服务",
		pkg: "@deepseek-ai/dsh-host-webserver",
		file: "lib/types/index.d.ts",
		pattern: /webServer: WebServer;/,
		why: "插件 inject ['webServer'] 并校验公开方法；服务名改名会让 apply 直接抛错"
	},
	{
		id: "dsh-lan-connect: webServer.register",
		pkg: "@deepseek-ai/dsh-host-webserver",
		file: "lib/types/index.d.ts",
		pattern: /register\(route: WebRoute\): \(\) => void;/,
		why: "插件用 register 挂 GET /lan 并靠返回的 disposer 撤销；返回类型变化会让入口在停用后残留"
	},
	{
		id: "dsh-lan-connect: exact 路由",
		pkg: "@deepseek-ai/dsh-host-webserver",
		file: "lib/types/index.d.ts",
		pattern: /export type WebRouteKind = 'exact' \| 'prefix';/,
		why: "插件注册 { kind: 'exact', path: '/lan' }；kind 联合变化会让入口不再精确匹配"
	},
	{
		id: "dsh-lan-connect: webServer 监听事实",
		pkg: "@deepseek-ai/dsh-host-webserver",
		file: "lib/types/index.d.ts",
		pattern: /get port\(\): number \| undefined;[\s\S]{0,300}?get host\(\): Config\['host'\];[\s\S]{0,400}?get protocol\(\): 'http:' \| 'https:';/,
		why: "入口地址与卡片都按 port/host/protocol 组合；去掉任一只读事实会让插件把它当成不可用"
	},
	{
		id: "dsh-lan-connect: webServer.getOrigin",
		pkg: "@deepseek-ai/dsh-host-webserver",
		file: "lib/types/index.d.ts",
		pattern: /getOrigin\(\): string;/,
		why: "监听 origin 由宿主给出；方法改名后 /lan 无法确定自身入口"
	},
	{
		id: "dsh-lan-connect: index-inject 事件",
		pkg: "@deepseek-ai/dsh-host-webserver",
		file: "lib/types/index.d.ts",
		pattern: /'webserver\/index-inject'\(table: IndexInjection\[\]\): void;/,
		why: "插件用该事件把 __DSH_LAN_CONNECT__ 注入 index；事件改名后设置卡片永远读不到数据"
	},
	{
		id: "dsh-lan-connect: global 注入行",
		pkg: "@deepseek-ai/dsh-host-webserver",
		file: "lib/types/injections.d.ts",
		pattern: /kind: 'global';\s*name: string;\s*value: unknown;/,
		why: "插件 push 的是 { kind: 'global', name, value } 行；行形状变化会让浏览器全局不被写入"
	},
	{
		id: "dsh-lan-connect: webApp.getAdvertisedUrl",
		pkg: "@deepseek-ai/dsh-web-app",
		file: "lib/types/index.d.ts",
		pattern: /getAdvertisedUrl\(\): string;/,
		why: "入口只从配置的对外根推导跳转目标；方法改名或换层会让 /lan 永久 503"
	},
	{
		id: "dsh-lan-connect: connection 信任检查",
		pkg: "@deepseek-ai/dsh-client-connection",
		file: "lib/types/rpc-host.d.ts",
		pattern: /requestRejection\(request: ConnectionTrustRequest\): ConnectionRequestRejection;/,
		why: "插件先跑原生 Host/Origin 检查再决定是否发 303；方法改名会让入口 fail closed 成 503"
	},
	{
		id: "dsh-lan-connect: 拒绝状态语义",
		pkg: "@deepseek-ai/dsh-client-connection",
		file: "lib/types/rpc.d.ts",
		pattern: /export type ConnectionRequestRejection = 401 \| 403 \| undefined;/,
		why: "插件只把 401（信任通过但无登录态）视作可放行、403 直接拒绝，其它状态 fail closed；新增状态会改变安全语义"
	},
	{
		id: "dsh-lan-connect: connection.authenticatedUrl",
		pkg: "@deepseek-ai/dsh-client-connection",
		file: "lib/types/rpc-host.d.ts",
		pattern: /authenticatedUrl\(baseUrl: string\): string;/,
		why: "303 Location 由原生方法签发；插件只校验 token 参数存在且唯一，不自己发 Cookie"
	},
	// dsh-smartui 的 Host 半边注册工具与提示词段，Client 半边只使用公开对象。
	{
		id: "dsh-smartui: tool presentationMeta",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/index.d.ts",
		pattern: /presentationMeta\?\(args: unknown, value: JsonValue\): JsonValue;/,
		why: "结果里的 meta.smartui 靠 output.presentationMeta 落盘；字段改名会让历史卡片只剩文本降级"
	},
	{
		id: "dsh-smartui: tools.register",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/index.d.ts",
		pattern: /register\(definition: ToolDefinition\): \(\) => void;/,
		why: "Host 半边用 ctx.tools.register 注册 render_smart_ui 并靠 disposer 撤销"
	},
	{
		id: "dsh-smartui: defineTool 导出",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/schema.d.ts",
		pattern: /export declare function defineTool</,
		why: "工具定义由 defineTool 生成；导出改名会让 Host 半边直接 import 失败"
	},
	{
		id: "dsh-smartui: systemPrompt.section",
		pkg: "@deepseek-ai/dsh-system-prompt",
		file: "lib/types/index.d.ts",
		pattern: /section\(section: PromptSection\): \(\) => void;/,
		why: "插件用可撤销的提示词段教模型调用工具；方法改名会静默丢掉提示词"
	},
	{
		id: "dsh-smartui: uiConversation 服务",
		pkg: "@deepseek-ai/dsh-client-ui-conversation",
		file: "lib/types/client/index.d.ts",
		pattern: /uiConversation: import\('\.\/conversation\/assembly\.ts'\)\.UiConversation;/,
		why: "插件 inject ['uiConversation'] 并通过它注册 Conversation 定义；服务改名会让卡片不再出现"
	},
	{
		id: "dsh-smartui: Conversation 事件注册",
		pkg: "@deepseek-ai/dsh-client-ui-conversation",
		file: "lib/types/client/conversation/event-registry.d.ts",
		pattern: /register\(definition: ConversationNodeDefinitionInput\): \(\) => void;/,
		why: "成功结果的 meta.smartui 靠该注册投影成 Chat 行；签名变化会让历史卡片消失"
	},
	{
		id: "dsh-smartui: tool.call.toolview 槽",
		pkg: "@deepseek-ai/dsh-client-ui-tool",
		file: "lib/types/client/contract/slots.d.ts",
		pattern: /'tool\.call\.toolview': \{/,
		why: "render_smart_ui 的自定义工具视图注册在该 keyed 槽；槽名变化后工具行回退成通用摘要"
	},
	{
		id: "dsh-smartui: conversation.chat.node 槽",
		pkg: "@deepseek-ai/dsh-client-ui-chat",
		file: "lib/types/client/contract/slots.d.ts",
		pattern: /'conversation\.chat\.node': \{/,
		why: "会话里的 smartui-document 行注册在该 keyed 槽；槽名变化会让已存 metadata 不再渲染"
	},
	{
		id: "dsh-smartui: conversation.input.dock 槽",
		pkg: "@deepseek-ai/dsh-client-ui-conversation",
		file: "lib/types/client/contract/slots.d.ts",
		pattern: /'conversation\.input\.dock': \{/,
		why: "草稿启动建议注册在输入框上方 dock；槽名变化后建议条消失"
	},
	{
		id: "dsh-smartui: 草稿插入接口",
		pkg: "@deepseek-ai/dsh-client-ui-conversation",
		file: "lib/types/client/contract/input.d.ts",
		pattern: /captureInsertion\(\): TokenSpan;[\s\S]{0,800}?insertText\(text: string, span: TokenSpan\): boolean;/,
		why: "组件选择只把可见文本写进原生草稿、不自行发送；两个方法改名或改变返回语义会让插入失败"
	},
	{
		id: "dsh-smartui: theme.overrideTokens",
		pkg: "@deepseek-ai/dsh-client-ui-theme",
		file: "lib/types/client/index.d.ts",
		pattern: /overrideTokens\(source: string, tokens: ThemeTokenOverrides\): \(\) => void;/,
		why: "appearance=chatgpt 只叠加 token 层并靠 disposer 撤销；接口变化会覆盖宿主主题或无法清理"
	},
	// lan-connect / smartui / mobile 共用的客户端注册面。
	{
		id: "client locale 注册",
		pkg: "@deepseek-ai/dsh-client-locale",
		file: "lib/types/client/index.d.ts",
		pattern: /register\(ns: string, locale: string, dict: LocaleDict\): \(\) => void;/,
		why: "客户端半边用 ctx.locale.register 注册 en/zh 字典；签名变化会让卡片失去文案"
	},
	{
		id: "client locale.bind",
		pkg: "@deepseek-ai/dsh-client-locale",
		file: "lib/types/client/index.d.ts",
		pattern: /bind\(ns: string\): Translate;/,
		why: "lan-connect 与 smartui 都用 bind(ns) 取当前语言的 translate；签名变化会显示 key 而不是文案"
	},
	{
		id: "client ConfigForm 读写面",
		pkg: "@deepseek-ai/dsh-client-ui-settings",
		file: "lib/types/client/config-form.d.ts",
		pattern: /getSnapshot\(\): ConfigFormSnapshot<T>;[\s\S]{0,700}?set\(field: string, value: unknown\): Promise<boolean>;/,
		why: "设置卡按 getSnapshot/subscribe 读取、按 set 保存；读写面变化会让设置停在 loading 或保存无效"
	},
	{
		id: "client settings.general.item 槽",
		pkg: "@deepseek-ai/dsh-client-ui-settings",
		file: "lib/types/client/contract/slots.d.ts",
		pattern: /'settings\.general\.item': \{/,
		why: "lan-connect 与 smartui 的设置卡片都注册在 General 行槽；槽名变化后卡片不再出现"
	},
	{
		id: "client slots.inject",
		pkg: "@deepseek-ai/dsh-client-ui-renderer",
		file: "lib/types/client/registry.d.ts",
		pattern: /inject\(key: keyof SlotMap & string, callback: \(\) => SlotInjectionEffect\): \(\) => void;/,
		why: "客户端先 inject 等待槽声明再 register；接口改名会让卡片/建议条永不注册"
	},
	{
		id: "client slots.register",
		pkg: "@deepseek-ai/dsh-client-ui-renderer",
		file: "lib/types/client/registry.d.ts",
		pattern: /readonly register: SlotCore\['register'\];/,
		why: "槽注册入口必须仍是原型方法（代理按调用方 ctx 绑定 effect）；改成实例属性会让停用不再撤销注册"
	}
];

/**
 * Resolve the target DSH package directory.
 *
 * `--dsh <dir>` wins; otherwise the installed `dsh` on PATH is walked up to the
 * package whose name is `@deepseek-ai/dsh`. This never reads a profile.
 * @param explicit - directory from `--dsh`, if any.
 * @returns absolute package directory, or null.
 */
export function resolveDshRoot(explicit) {
	if (typeof explicit === "string" && explicit.trim() !== "") return resolve(explicit);
	try {
		const bin = realpathSync(execSync("command -v dsh", { encoding: "utf8" }).trim());
		let dir = dirname(bin);
		for (let depth = 0; depth < 6; depth += 1) {
			const manifest = join(dir, "package.json");
			if (existsSync(manifest) && readJson(manifest)?.name === "@deepseek-ai/dsh") return dir;
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	} catch {}
	return null;
}

/**
 * Read JSON, returning null instead of throwing.
 * @param path - file path.
 * @returns parsed value, or null.
 */
export function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

/**
 * Read the text a contract points at.
 * `file` names one file; `dir` + `match` covers hashed build artifacts, where
 * every matching file is read and any hit counts.
 * @param contract - one CONTRACTS entry.
 * @param dshRoot - target DSH package directory.
 * @returns text, or a reason it could not be read.
 */
export function contractText(contract, dshRoot) {
	if (typeof contract.dir === "string") {
		const directory = join(dshRoot, "node_modules", contract.pkg, contract.dir);
		let names;
		try {
			names = readdirSync(directory);
		} catch {
			return { text: null, reason: `${contract.pkg}/${contract.dir} 不存在（包被改名或移除？）` };
		}
		const matching = names.filter((name) => contract.match.test(name));
		if (matching.length === 0) return { text: null, reason: `${contract.pkg}/${contract.dir} 下没有匹配 ${String(contract.match)} 的产物` };
		const parts = [];
		for (const name of matching) {
			try {
				parts.push(readFileSync(join(directory, name), "utf8"));
			} catch {
				return { text: null, reason: `${contract.pkg}/${contract.dir}/${name} 读不出来` };
			}
		}
		return { text: parts.join("\n"), reason: null };
	}
	try {
		return { text: readFileSync(join(dshRoot, "node_modules", contract.pkg, contract.file), "utf8"), reason: null };
	} catch {
		return { text: null, reason: `${contract.pkg}/${contract.file} 不存在（包被改名或移除？）` };
	}
}

/**
 * Evaluate every contract against one DSH install.
 * @param dshRoot - target DSH package directory.
 * @param contracts - contract list; defaults to CONTRACTS.
 * @returns one result per contract.
 */
export function checkContracts(dshRoot, contracts = CONTRACTS) {
	return contracts.map((contract) => {
		const { text, reason } = contractText(contract, dshRoot);
		const reasons = [];
		if (text === null) reasons.push(reason);
		else if (!contract.pattern.test(text)) reasons.push(contract.why);
		return {
			id: contract.id,
			ok: reasons.length === 0,
			where: typeof contract.dir === "string"
				? `${contract.pkg}/${contract.dir}/${String(contract.match)}`
				: `${contract.pkg}/${contract.file}`,
			reasons
		};
	});
}

/**
 * Load the target install's own compatibility evaluator.
 *
 * This is the module the boot preflight imports, not a local reimplementation
 * of its semver rules, so a change in those rules is observed here too.
 * @param dshRoot - target DSH package directory.
 * @returns the app-boot module.
 * @throws when the module or its evaluation entry cannot be resolved.
 */
export async function loadAppBoot(dshRoot) {
	const require = createRequire(join(dshRoot, "package.json"));
	const entry = require.resolve("@deepseek-ai/dsh-app-boot");
	const appBoot = await import(pathToFileURL(entry).href);
	if (typeof appBoot.evaluatePluginCompatibility !== "function") {
		throw new Error(`${entry} 没有导出 evaluatePluginCompatibility（app-boot 的兼容评估入口改名了）`);
	}
	if (typeof appBoot.getDshRuntimeVersion !== "function") {
		throw new Error(`${entry} 没有导出 getDshRuntimeVersion，无法确认评估函数使用的是目标版本`);
	}
	return appBoot;
}

/**
 * Run one manifest through the target install's real evaluation, with no
 * exemption: an exemption the user granted locally must not make this pass,
 * because a fresh profile would still be denied at boot.
 * @param manifest - parsed plugin package.json.
 * @param appBoot - module returned by loadAppBoot.
 * @returns acceptance and, on rejection, the unmet requirements and warning.
 */
export function evaluateEngines(manifest, appBoot) {
	const evaluate = appBoot?.evaluatePluginCompatibility;
	if (typeof evaluate !== "function") throw new Error("app-boot 没有导出 evaluatePluginCompatibility");
	// Empty exemption table on purpose: see the comment above.
	const issue = evaluate.call(appBoot, manifest, {});
	if (issue === undefined) return { ok: true };
	const warning = typeof appBoot.pluginCompatibilityWarning === "function" ? appBoot.pluginCompatibilityWarning(issue) : undefined;
	return { ok: false, requirements: issue.requirements, runtimeVersion: issue.runtimeVersion, warning };
}

/**
 * Enumerate plugin directories: direct children with a package.json.
 * @param root - repository root.
 * @returns absolute plugin directories.
 */
export function pluginDirs(root = repoRoot) {
	return readdirSync(root)
		.filter((name) => !name.startsWith(".") && name !== "node_modules")
		.map((name) => join(root, name))
		.filter((path) => statSync(path).isDirectory() && existsSync(join(path, "package.json")));
}

/**
 * Read the pass and skip counts from `node --test` output (TAP or spec
 * reporter). A skipped native/browser test must stay visible, so an
 * unparseable count is reported as `?` rather than assumed to be zero.
 * @param output - captured test-runner output.
 * @returns `{ pass, skip }` as decimal strings.
 */
export function testCounts(output) {
	return {
		pass: output.match(/(?:ℹ|#) pass (\d+)/)?.[1] ?? "?",
		skip: output.match(/(?:ℹ|#) skip(?:ped)? (\d+)/)?.[1] ?? "?"
	};
}

/**
 * Run one plugin's unit tests.
 *
 * Test layout is not uniform (`test/` and `tests/` both exist) and neither is
 * the runner (plain JS on `node --test`, TypeScript through tsx), so a declared
 * `test` script wins and `node --test` is only the fallback. This executes the
 * plugin's own scripts, so a `pretest` may build artifacts such as dist/.
 * @param dir - plugin directory.
 * @returns `{ ok, detail }` or `{ skip }`.
 */
export function runPluginTests(dir) {
	const name = dir.split("/").pop();
	const manifest = readJson(join(dir, "package.json"));
	const hasTests = existsSync(join(dir, "test")) || existsSync(join(dir, "tests"));
	if (!hasTests) return { ok: true, skip: `单测 ${name} (无 test/ 或 tests/ 目录)` };
	const script = manifest?.scripts?.test;
	try {
		const out = typeof script === "string"
			? execFileSync("pnpm", ["run", "test"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
			: execFileSync("node", ["--test"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		const { pass, skip } = testCounts(out);
		return { ok: true, detail: `[PASS] 单测 ${name} (pass ${pass} / skip ${skip})` };
	} catch (error) {
		const tail = String(error.stdout ?? "").trim().split("\n").slice(-3).join("\n       ");
		return { ok: false, detail: `[FAIL] 单测 ${name}\n       ${tail}` };
	}
}

/**
 * Baseline drift: the recorded dsh/cordis versions differ from the target.
 * @param baseline - parsed baseline.json, or null when missing.
 * @param dshVersion - target dsh version.
 * @param cordisVersion - target cordis version.
 * @returns true when the baseline must be refreshed.
 */
export function baselineDrifted(baseline, dshVersion, cordisVersion) {
	return baseline === null || baseline.dsh !== dshVersion || baseline.cordis !== cordisVersion;
}

/**
 * Exit code from the two outcomes, kept separate so the mapping is testable.
 * @param outcomes - failure count and baseline drift.
 * @returns 1 on failure, 2 on drift, 0 when everything matches.
 */
export function exitCodeFor({ failures, drifted }) {
	if (failures > 0) return 1;
	return drifted ? 2 : 0;
}

/**
 * Parse command-line arguments. Every malformed argument is an error: silently
 * falling back to the installed dsh would check a version the caller did not
 * ask for.
 * @param argv - arguments after the script path.
 * @returns parsed options, or `{ error }` naming the first problem.
 */
export function parseArgs(argv) {
	const options = { contractsOnly: false, help: false };
	const valued = new Map([["--dsh", "dsh"], ["--baseline", "baseline"]]);
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--contracts-only") {
			options.contractsOnly = true;
			continue;
		}
		if (argument === "--help" || argument === "-h") {
			options.help = true;
			continue;
		}
		const field = valued.get(argument);
		if (field === undefined) return { ...options, error: `未知参数 ${JSON.stringify(argument)}` };
		const value = argv[index + 1];
		if (value === undefined) return { ...options, error: `${argument} 缺少值` };
		if (value.startsWith("-")) return { ...options, error: `${argument} 的值是另一个参数 ${JSON.stringify(value)}` };
		if (value.trim() === "") return { ...options, error: `${argument} 需要非空值` };
		options[field] = value;
		index += 1;
	}
	return options;
}

/** Help text shared by the CLI and the skill wrapper. */
export const HELP = `Usage: node scripts/check-compat.mjs [--dsh <dsh package dir>] [--contracts-only] [--baseline <file>]

  --dsh <dir>         check another install (default: the dsh package on PATH)
  --contracts-only    check engines.dsh and the listed contracts; skips plugin
                      unit tests, whose scripts may build dist/
  --baseline <file>   compare against another baseline.json (default: the local skill's)

The default run executes each plugin's own "test" script; a "pretest" may write
build artifacts (dsh-mobile builds dist/). Use --contracts-only to avoid writes.

Exit codes: 0 pass and baseline matches; 2 pass but dsh/cordis drifted; 1 check,
argument or environment failure.`;

/**
 * Run the whole check.
 * @param options - argv plus output sinks and a baseline override.
 * @returns process exit code.
 */
export async function runCompatCheck({ argv = [], baselinePath = DEFAULT_BASELINE, log = console.log, error = console.error } = {}) {
	const options = parseArgs(argv);
	if (options.error !== undefined) {
		error(`参数错误：${options.error}`);
		error("用 --help 查看用法。");
		return 1;
	}
	if (options.help) {
		log(HELP);
		return 0;
	}
	if (options.baseline !== undefined) baselinePath = resolve(options.baseline);
	const dshRoot = resolveDshRoot(options.dsh);
	if (dshRoot === null) {
		error("无法解析已安装的 dsh 包目录；请用 --dsh <dir> 指定，或确认 `dsh` 在 PATH 上。");
		return 1;
	}

	const dshManifest = readJson(join(dshRoot, "package.json"));
	if (dshManifest?.name !== "@deepseek-ai/dsh") {
		error(`${dshRoot} 不是 @deepseek-ai/dsh 包目录（package.json 缺失、不可读或 name 不匹配）。`);
		return 1;
	}
	const cordisManifest = readJson(join(dshRoot, "node_modules", "@deepseek-ai", "cordis", "package.json"));
	const baseline = readJson(baselinePath);
	const dshVersion = dshManifest?.version ?? "unknown";
	const cordisVersion = cordisManifest?.version ?? "unknown";
	let failures = 0;

	log(`dsh 升级兼容性检查  (${repoRoot})`);
	log(`dsh      ${dshVersion}  ${dshRoot}`);
	log(`cordis   ${cordisVersion}`);
	log(baseline === null ? `baseline 缺失：${baselinePath} 不存在或不是 JSON` : `baseline dsh ${baseline.dsh} / cordis ${baseline.cordis}  (${baseline.verifiedOn})`);

	// 1. engines.dsh through the target install's own evaluator, no exemption.
	const plugins = pluginDirs(repoRoot);
	let appBoot;
	try {
		appBoot = await loadAppBoot(dshRoot);
		const runtimeVersion = appBoot.getDshRuntimeVersion();
		log(`app-boot ${runtimeVersion}  @deepseek-ai/dsh-app-boot（与启动 preflight 同一评估函数，无豁免）`);
		if (runtimeVersion !== dshVersion) {
			// The evaluation uses app-boot's own version; a different dsh package
			// beside it means this install was hand-assembled, so its verdict says
			// nothing about the dsh version printed above.
			failures += 1;
			log(`[FAIL] app-boot ${runtimeVersion} 与 dsh ${dshVersion} 不一致 — 目标安装不是一份未改动的发布包，评估结果不能代表该 dsh。`);
		}
	} catch (reason) {
		failures += 1;
		log(`[FAIL] app-boot 兼容性评估不可用`);
		log(`       ${reason instanceof Error ? reason.message : String(reason)}`);
	}
	if (appBoot !== undefined) {
		for (const dir of plugins) {
			const manifest = readJson(join(dir, "package.json"));
			const label = dir.split("/").pop();
			if (manifest === null) {
				failures += 1;
				log(`[FAIL] engines.dsh ${label.padEnd(24)} package.json 读不出来，无法评估`);
				continue;
			}
			const declared = typeof manifest.engines?.dsh === "string" ? manifest.engines.dsh : "（无 engines.dsh，按 dsh peer 判定）";
			try {
				const verdict = evaluateEngines(manifest, appBoot);
				if (verdict.ok) {
					log(`[PASS] engines.dsh ${label.padEnd(24)} ${declared}`);
					continue;
				}
				failures += 1;
				log(`[FAIL] engines.dsh ${label.padEnd(24)} ${declared}`);
				if (verdict.warning !== undefined) log(`       ${verdict.warning}`);
				else log(`       未满足：${JSON.stringify(verdict.requirements)}`);
				log("       不要为了过关改版本声明：要么插件确实需要该运行时，要么在单独授权的改动里更新声明。");
			} catch (reason) {
				failures += 1;
				log(`[FAIL] engines.dsh ${label.padEnd(24)} ${declared}`);
				log(`       无法评估：${reason instanceof Error ? reason.message : String(reason)}`);
			}
		}
	}

	// 2. Internal seams the plugins depend on.
	for (const result of checkContracts(dshRoot)) {
		if (!result.ok) failures += 1;
		log(`${result.ok ? "[PASS]" : "[FAIL]"} ${result.id.padEnd(30)} ${result.where}`);
		for (const problem of result.reasons) log(`       ${problem}`);
	}

	// 3. Plugin unit tests, unless this run is one cell of a version matrix.
	if (options.contractsOnly) {
		log("[SKIP] 单测（--contracts-only 只跑契约）");
	} else {
		for (const dir of plugins) {
			const result = runPluginTests(dir);
			if (result.skip !== undefined) {
				log(`[SKIP] ${result.skip}`);
				continue;
			}
			if (!result.ok) failures += 1;
			log(result.detail);
		}
	}

	log("");
	if (failures > 0) {
		log(`结论：${failures} 项失败 — 按上面 FAIL 的文件读契约并适配插件，不要改 dsh 安装目录。`);
		return exitCodeFor({ failures, drifted: false });
	}
	const drifted = baselineDrifted(baseline, dshVersion, cordisVersion);
	const scope = options.contractsOnly ? "engines 与契约通过（--contracts-only 未跑单测）" : "契约与单测通过";
	log(drifted ? `结论：${scope}，但版本已偏离 baseline — 做活体验证后更新 baseline.json。` : `结论：${scope}，基线一致 — 仍须按 skill 第 2 步做活体验证。`);
	return exitCodeFor({ failures, drifted });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exitCode = await runCompatCheck({ argv: process.argv.slice(2) });
}
