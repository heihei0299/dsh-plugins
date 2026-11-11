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
		pattern: /page\(request: SessionPageRequest, signal: AbortSignal\): Promise<SessionEventsPage>;/,
		why: "插件包装返回页值的 page；页值附加字段随版本增加，改签名会重新决定裁剪如何保留它们"
	},
	{
		id: "dsh-history-budget: events 签名",
		pkg: "@deepseek-ai/dsh-api-session-controller",
		file: "lib/types/index.d.ts",
		pattern: /events\(request: SessionPageRequest, signal: AbortSignal\): Promise<SessionEventsPage>;/,
		why: "当前的历史读入口；插件与 page 一起包装，签名变化会让这一支不再按字节裁剪"
	},
	{
		id: "dsh-history-budget: 页值附加字段",
		pkg: "@deepseek-ai/dsh-api-session-controller",
		file: "lib/types/types.d.ts",
		pattern: /export interface SessionEventsPage extends SessionPage \{\s*readonly cursor: number;/,
		why: "裁剪只替换 records/hasMore、其余字段靠展开保留；附加字段改形会让裁剪后的页丢掉 cursor"
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
		pattern: /register\(route: WebRoute \| WebResourceRoute\): \(\) => void;/,
		why: "插件用 register 挂 GET /lan（WebRoute 一支）并靠返回的 disposer 撤销；联合或返回类型变化会让入口在停用后残留"
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
		pattern: /'webserver\/index-inject'\(table: IndexInjection\[\], peer: PeerScope\): void;/,
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
		file: "lib/types/contracts.d.ts",
		pattern: /presentationMeta\?\(args: unknown, value: JsonValue\): JsonValue;/,
		why: "结果里的 meta.smartui 靠 output.presentationMeta 落盘；字段改名会让历史卡片只剩文本降级"
	},
	{
		id: "dsh-smartui: tools.register",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/index.d.ts",
		pattern: /register\(definition: ToolDefinition, options\?: ToolRegistrationOptions\): \(\) => void;/,
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
	// dsh-i-have-adhd 只依赖提示词段、Agent 识别与命令注册这三个稳定缝。
	{
		id: "dsh-i-have-adhd: systemPrompt.section",
		pkg: "@deepseek-ai/dsh-system-prompt",
		file: "lib/types/index.d.ts",
		pattern: /section\(section: PromptSection\): \(\) => void;/,
		why: "插件用可撤销的提示词段承载风格规则；方法改名会让 apply 直接抛错"
	},
	{
		id: "dsh-i-have-adhd: getSectionOrder",
		pkg: "@deepseek-ai/dsh-system-prompt",
		file: "lib/types/index.d.ts",
		pattern: /getSectionOrder\(name: PromptSectionOrderName\): number;/,
		why: "插件把风格段定位在 persona 之后；API 改名会让 apply 直接抛错"
	},
	{
		id: "dsh-i-have-adhd: AssembleContext.agent",
		pkg: "@deepseek-ai/dsh-agent",
		file: "lib/types/runtime-types.d.ts",
		pattern: /agent\?: Agent;/,
		why: "插件按当前 Agent 跳过子代理并实现 /adhd off；字段消失会让规则错误地作用于委派报告"
	},
	{
		id: "dsh-i-have-adhd: SessionHeader.origin/delegationDepth",
		pkg: "@deepseek-ai/dsh-session",
		file: "lib/types/types.d.ts",
		pattern: /readonly origin\?: 'subagent';[\s\S]{0,400}?readonly delegationDepth\?: number;/,
		why: "子代理识别依赖这两个持久字段；改名会让风格规则进入委派报告"
	},
	{
		id: "dsh-i-have-adhd: commands.register",
		pkg: "@deepseek-ai/dsh-commands",
		file: "lib/types/index.d.ts",
		pattern: /register\(definition: CommandDefinition\): \(\) => void;/,
		why: "插件注册 /adhd on|off|status；签名变化会让会话内切换失效"
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
	},
	// mcp-skill-manager：按项目限制宿主 MCP 工具、指令、资源与 skill。
	{
		id: "mcp-skill-manager: tools.restrict",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/index.d.ts",
		pattern: /restrict\(filter: ToolRestriction\): \(\) => void;/,
		why: "按 server 隐藏宿主 MCP 工具依赖 agent 作用域的 restrict；签名或作用域语义变化会让禁用失效"
	},
	{
		id: "mcp-skill-manager: tools.guard",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/index.d.ts",
		pattern: /guard\(guard: ToolGuard\): \(\) => void;/,
		why: "preset 作用域工具无法被 restrict 隐藏，仍要靠 guard 拒绝执行；guard 接口变化会让兜底失效"
	},
	{
		id: "mcp-skill-manager: tools.definitions",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/index.d.ts",
		pattern: /definitions\(scope\?: ScopeKey, toolSet\?: ResolvedToolSet\): readonly ToolDefinition\[\];/,
		why: "面板从全局 definitions 推导 MCP server 与工具数；签名变化会让 server 列表不完整"
	},
	{
		id: "mcp-skill-manager: tools/change",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/events.d.ts",
		pattern: /'tools\/change'\(\): void;/,
		why: "MCP server 注册/注销后要重新计算限制；事件改名会让面板策略停在旧工具集"
	},
	{
		id: "mcp-skill-manager: skills.register",
		pkg: "@deepseek-ai/dsh-skill",
		file: "lib/types/index.d.ts",
		pattern: /register\(skill: SkillRegistration\): \(\) => void;/,
		why: "禁用一个 skill 依赖 agent 作用域注册同名非调用 stub；接口变化会让禁用失效"
	},
	{
		id: "mcp-skill-manager: skills.snapshot",
		pkg: "@deepseek-ai/dsh-skill",
		file: "lib/types/index.d.ts",
		pattern: /snapshot\(options\?: SkillViewOptions\): Promise<SkillCatalogSnapshot>;/,
		why: "面板列举项目 skill、Host 计算要遮蔽的名称都依赖 snapshot；返回值变化会让目录为空或错误"
	},
	{
		id: "mcp-skill-manager: skills/change",
		pkg: "@deepseek-ai/dsh-skill",
		file: "lib/types/index.d.ts",
		pattern: /'skills\/change'\(\): void;/,
		why: "skill 目录变化后要重建 stub；事件改名会让已禁用 skill 重新暴露"
	},
	{
		id: "mcp-skill-manager: agent.ctx",
		pkg: "@deepseek-ai/dsh-agent",
		file: "lib/types/runtime-types.d.ts",
		pattern: /readonly ctx: Context;/,
		why: "所有限制、prompt 遮蔽与 skill stub 都注册在 agent.ctx 的作用域；字段消失会让策略只能作用于全局"
	},
	{
		id: "mcp-skill-manager: agent/created",
		pkg: "@deepseek-ai/dsh-agent",
		file: "lib/types/runtime-types.d.ts",
		pattern: /'agent\/created'\(this: Scoped<Agent>, payload: \{/,
		why: "新 agent 创建时应用项目策略；事件签名变化会让会话绕过策略"
	},
	{
		id: "mcp-skill-manager: agent/pre-step",
		pkg: "@deepseek-ai/dsh-agent",
		file: "lib/types/runtime-types.d.ts",
		pattern: /'agent\/pre-step'\(this: Scoped<Agent>, payload: \{/,
		why: "每步前刷新 skill stub，避免 tool-skill 读到旧目录；事件变化会让禁用延迟一步"
	},
	{
		id: "mcp-skill-manager: workingDirectory.get",
		pkg: "@deepseek-ai/dsh-working-directory",
		file: "lib/types/index.d.ts",
		pattern: /get\(session: Session\): string;/,
		why: "项目策略按 agent 的有效工作目录匹配；签名变化会让目录回退到 session header 或进程 cwd"
	},
	{
		id: "mcp-skill-manager: agent-presets.composedPreset",
		pkg: "@deepseek-ai/dsh-agent-preset-registry",
		file: "lib/types/index.d.ts",
		pattern: /composedPreset\(ctx: Context\): string \| undefined;/,
		why: "面板要按活 agent 的实际 preset 读取 skill 目录；接口变化会让列表退回默认 preset"
	},
	{
		id: "mcp-skill-manager: agent-presets.acquireScope",
		pkg: "@deepseek-ai/dsh-agent-preset-registry",
		file: "lib/types/index.d.ts",
		pattern: /acquireScope\(id\?: string\): Promise<\{\s*key: ScopeKey;\s*\} & AsyncDisposable>;/,
		why: "不能为读目录创建 agent，只能借 preset 作用域租约；租约形状变化会让 skill 目录无法读取或泄漏"
	},
	{
		id: "mcp-skill-manager: connection.fetchRoute",
		pkg: "@deepseek-ai/dsh-client-connection",
		file: "lib/types/rpc.d.ts",
		pattern: /interface ConnectionFetchRoute \{[\s\S]{0,700}?readonly fetch: \(request: Request\) => Promise<Response>;/,
		why: "面板的三个策略路由注册在原生 Connection 精确路由上；字段变化会让请求 404 或绕过鉴权语义"
	},
	{
		id: "mcp-skill-manager: connection.fetchRegister",
		pkg: "@deepseek-ai/dsh-client-connection",
		file: "lib/types/rpc.d.ts",
		pattern: /register\(route: ConnectionFetchRoute\): \(\) => Promise<void>;/,
		why: "Host 用 fetch.register 暴露策略 API；返回类型变化会让停用无法撤销路由"
	},
	{
		id: "mcp-skill-manager: client settings.section",
		pkg: "@deepseek-ai/dsh-client-ui-settings",
		file: "lib/types/client/contract/slots.d.ts",
		pattern: /'settings\.section': \{[\s\S]{0,160}?kind: 'list';/,
		why: "面板注册为独立设置 section；槽名或 shape 变化会让入口消失"
	},
	{
		id: "mcp-skill-manager: systemPrompt.section",
		pkg: "@deepseek-ai/dsh-system-prompt",
		file: "lib/types/index.d.ts",
		pattern: /section\(section: PromptSection\): \(\) => void;/,
		why: "禁用 MCP 时用空 section 遮蔽 instructions；接口变化会让 instructions 泄漏给模型"
	},
	{
		id: "mcp-skill-manager: systemPrompt shadowing",
		pkg: "@deepseek-ai/dsh-system-prompt",
		file: "lib/types/index.d.ts",
		pattern: /section shadows a global section with the same name;/,
		why: "空 mcp:<server> section 必须遮蔽全局同名 section；遮蔽语义变化会让禁用 server 的 instructions 仍可见"
	},
	{
		id: "mcp-skill-manager: loader.entries",
		pkg: "@deepseek-ai/cordis-plugin-loader",
		file: "lib/types/config/tree.d.ts",
		pattern: /entries\(\): Generator<Entry, void, void>;/,
		why: "面板从 loader 条目读取已配置 MCP server；迭代器消失会让列表退回仅工具推导"
	},
	{
		id: "mcp-skill-manager: loader.entry",
		pkg: "@deepseek-ai/cordis-plugin-loader",
		file: "lib/types/config/entry.d.ts",
		pattern: /options: EntryOptions;[\s\S]{0,500}?get disabled\(\): boolean;/,
		why: "读取 serverName/transport/config 与禁用状态依赖 Entry.options 和 disabled；形状变化会让发现结果错误"
	},
	{
		id: "mcp-skill-manager: session.event",
		pkg: "@deepseek-ai/dsh-session",
		file: "lib/types/index.d.ts",
		pattern: /'session\/event'\(this: Scoped<Session>, session: Session, event: SessionEvent\): void;/,
		why: "工作目录切换后要重新应用项目策略；事件签名变化会让会话继续使用旧目录的 MCP/skill"
	},
	{
		id: "mcp-skill-manager: working-directory/change",
		pkg: "@deepseek-ai/dsh-session",
		file: "lib/types/known-event-types.js",
		pattern: /'working-directory\/change'/,
		why: "监听 session/event 时按这个事件名过滤；改名会让工作目录切换不再触发策略刷新"
	},
	{
		id: "mcp-skill-manager: mcp publicToolName",
		pkg: "@deepseek-ai/dsh-mcp-client",
		file: "lib/index.js",
		pattern: /const joined = `mcp__\$\{serverName\}__\$\{rawName\}`;/,
		why: "面板与 guard 按 mcp__<server>__<tool> 解析工具；命名变化会让禁用匹配不到工具"
	},
	{
		id: "mcp-skill-manager: mcp serverName schema",
		pkg: "@deepseek-ai/dsh-mcp-client",
		file: "lib/index.js",
		pattern: /serverName: z\.string\(\)\.required\(\)\.pattern\(SERVER_NAME_PATTERN\)/,
		why: "loader 发现以 serverName 为身份；字段或校验变化会让 server 列表缺项"
	},
	// dsh-memory 读取持久化会话、注入提示词段、调用模型并注册可选工具。
	{
		id: "dsh-memory: sessionPersistence.list",
		pkg: "@deepseek-ai/dsh-session-persistence",
		file: "lib/types/index.d.ts",
		pattern: /list\(options\?: SessionPersistenceListOptions\): Promise<readonly SessionPersistenceSnapshot\[\]>;/,
		why: "阶段 1 从持久化目录选择空闲根会话；方法消失或改形会让记忆生成静默停摆"
	},
	{
		id: "dsh-memory: sessionPersistence.open",
		pkg: "@deepseek-ai/dsh-session-persistence",
		file: "lib/types/index.d.ts",
		pattern: /open\(id: SessionId, access: SessionAccess, options\?: SessionPersistenceOpenOptions\): Promise<SessionHandle>;/,
		why: "插件用 read 句柄读取会话事件；签名变化会让 rollout 证据读不出来"
	},
	{
		id: "dsh-memory: SessionHandle.read",
		pkg: "@deepseek-ai/dsh-session-persistence",
		file: "lib/types/handle.d.ts",
		pattern: /read\(offset\?: number, length\?: number, options\?: SessionHandleReadOptions\): Promise<SessionHandleReadResult>;/,
		why: "证据读取依赖 offset/length 切片；改形会让最近事件窗口失效"
	},
	{
		id: "dsh-memory: agent/created",
		pkg: "@deepseek-ai/dsh-agent",
		file: "lib/types/runtime-types.d.ts",
		pattern: /'agent\/created'\(this: Scoped<Agent>, payload: \{/,
		why: "根会话启动时触发后台管线；事件改名会让插件只在手动调用时工作"
	},
	{
		id: "dsh-memory: systemPrompt.section",
		pkg: "@deepseek-ai/dsh-system-prompt",
		file: "lib/types/index.d.ts",
		pattern: /section\(section: PromptSection\): \(\) => void;/,
		why: "memory_summary 与 v2 读取指令通过提示词段注入；方法改名会丢掉整条读路径"
	},
	{
		id: "dsh-memory: llm.stream",
		pkg: "@deepseek-ai/dsh-llm",
		file: "lib/types/index.d.ts",
		pattern: /stream\(options: GenerateOptions\): AsyncIterable<StreamChunk>;/,
		why: "阶段 1/2 直接调用模型；流接口改形会让提取与合并无法开始"
	},
	{
		id: "dsh-memory: tools.register",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/index.d.ts",
		pattern: /register\(definition: ToolDefinition, options\?: ToolRegistrationOptions\): \(\) => void;/,
		why: "可选 memory_read/search/list/note 工具用该注册口；签名变化会让工具不可见"
	},
	{
		id: "session-header: llm/stream 瀑布",
		pkg: "@deepseek-ai/dsh-llm",
		file: "lib/types/index.d.ts",
		pattern: /'llm\/stream'\(this: LlmRuntime, options: GenerateOptions/,
		why: "插件只在该瀑布里开 AsyncLocalStorage 作用域；事件改名或改签会让所有注入静默失效"
	},
	{
		id: "session-header: GenerateOptions.sessionId",
		pkg: "@deepseek-ai/dsh-llm",
		file: "lib/types/types.d.ts",
		pattern: /sessionId\?: Branded<'SessionId'>/,
		why: "在线值取自该字段；字段消失后 LLM 请求不再带会话 id"
	},
	{
		id: "session-header: tools/execute 瀑布",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/events.d.ts",
		pattern: /'tools\/execute'\(this: Scoped<ToolsService>, exec: ToolDispatchExecution/,
		why: "工具阶段的白名单作用域挂在这里；事件改名后网关内的工具请求不再带标头"
	},
	{
		id: "session-header: ToolDispatchExecution.agent",
		pkg: "@deepseek-ai/dsh-tools",
		file: "lib/types/contracts.d.ts",
		pattern: /readonly agent\?: Agent;/,
		why: "工具阶段用调用方 Agent 取会话；字段消失后该阶段只能跳过"
	},
	{
		id: "session-header: Agent.id",
		pkg: "@deepseek-ai/dsh-agent",
		file: "lib/types/types.d.ts",
		pattern: /export interface Agent \{[^}]*readonly id: SessionId;/,
		why: "工具阶段的会话 id 来自 Agent.id；改形会让该阶段静默跳过"
	},
	{
		id: "cache-optimizer: llm/stream 瀑布",
		pkg: "@deepseek-ai/dsh-llm",
		file: "lib/types/index.d.ts",
		pattern: /'llm\/stream'\(this: LlmRuntime, options: GenerateOptions/,
		why: "请求作用域（含会话 id 与已派发模型）只在 llm/stream 里可取；事件改名或改形后 fetch 补丁无法归属请求"
	},
	{
		id: "cache-optimizer: llm/stream 返回值",
		pkg: "@deepseek-ai/dsh-llm",
		file: "lib/types/index.d.ts",
		pattern: /next: \(\) => AsyncIterable<StreamChunk>\): AsyncIterable<StreamChunk>/,
		why: "适配器包装该异步迭代器以维持 AsyncLocalStorage 作用域；返回类型变化会让包装失效或吞块"
	},
	{
		id: "cache-optimizer: session/event",
		pkg: "@deepseek-ai/dsh-session",
		file: "lib/types/index.d.ts",
		pattern: /'session\/event'\(this: Scoped<Session>, session: Session, event: SessionEvent\): void;/,
		why: "message_end/tool_execution_end/agent_settled 都由 session/event 翻译；改名后统计与刷新不再发生"
	},
	{
		id: "cache-optimizer: assistant/message 用量",
		pkg: "@deepseek-ai/dsh-session",
		file: "lib/types/types.d.ts",
		pattern: /'assistant\/message': \{[\s\S]*?usage\?: TokenUsage;/,
		why: "缓存命中/写入 token 只在这里按条携带；字段消失后 footer 计数与 stats 全为空"
	},
	{
		id: "cache-optimizer: system-prompt/assemble 瀑布",
		pkg: "@deepseek-ai/dsh-system-prompt",
		file: "lib/types/index.d.ts",
		pattern: /'system-prompt\/assemble'\(this: Scoped<SystemPrompt>, assembly: PromptPresentation/,
		why: "before_agent_start 的提示词改写挂在这里；瀑布消失后只剩纯请求侧优化"
	},
	{
		id: "cache-optimizer: commands.register",
		pkg: "@deepseek-ai/dsh-commands",
		file: "lib/types/index.d.ts",
		pattern: /register\(definition: CommandDefinition\): \(\) => void;/,
		why: "/cache-optimizer 经该注册器挂载；改名后整条命令面（doctor/stats/fix/rollback）消失"
	},
	{
		id: "cache-optimizer: settings.describe",
		pkg: "@deepseek-ai/dsh-settings",
		file: "lib/types/index.d.ts",
		pattern: /describe\(options\?: SettingsDescribeOptions\): SettingsDescriptor\[\];/,
		why: "provider compat 从 live settings 读取；签名变化后 compat 解析退化为空配置"
	},
	{
		id: "cache-optimizer: settings.mutate",
		pkg: "@deepseek-ai/dsh-settings",
		file: "lib/types/index.d.ts",
		pattern: /mutate\(ns: string, ops: readonly SettingsPathOp\[\], expectedRevision\?: number\): Promise<void>;/,
		why: "fix/rollback 经路径型 settings 写入 profile；改名后修复只能打印手工指导"
	},
	{
		id: "cache-optimizer: ctx.get 非严格读取",
		pkg: "@deepseek-ai/cordis",
		file: "lib/types/reflect.d.ts",
		pattern: /get\(name: string, strict\?: boolean\): any;/,
		why: "settings/configEditor/userQuestions/commands 都是可选依赖，靠非严格读取探测；语义变化会让可选缝静默失效"
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
