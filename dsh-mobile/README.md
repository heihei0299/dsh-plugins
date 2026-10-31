# DSH Mobile

给现有 DSH Web GUI 加一层**默认只在移动端生效**的布局与触控优化。默认 `mode: auto`：宽度 >720px 且不是粗指针的桌面不启用移动布局，设置行仍保留自身样式；`on` 会让桌面也启用移动布局，这是配置语义，不是缺陷。不是独立 App，不替换会话/输入框/审批，不改已安装的 DSH 核心，不启动第二个 Web 服务。

## 要求与安装

需要 Node ≥22、DSH `0.2.1-rc.2 || 0.2.1-rc.5`（`engines` 精确声明这两个版本）与 pnpm。该范围只是安装门禁，不代表两个版本都已验收：rc.5 尚未做真机触摸与登录态 GUI 验收。按 bundle 装入现有 profile，之后在 **设置 → 插件** 里开关，不手改 profile：

```bash
cd dsh-mobile
pnpm install
pnpm run build
dsh plugin --profile web add "link:$PWD" --offline
```

首次安装或更换 bundle 版本时，是否需要重启取决于当前已加载的客户端元数据与依赖图；插件管理器提示需要重启时，重启现有 dsh 并刷新页面。六项 volatile 设置保存后无需重启。安装或修改正在运行的环境需先确认目标与授权。

## 设置

**设置 → 通用 → 移动端体验**（Host 持久化，`dsh-mobile` 命名空间，六项均为 `volatile()`，改完即时生效）：

| 字段 | 默认 | 作用 |
|---|---|---|
| `mode` | `auto` | `auto` 在「宽度 ≤720px 或粗指针」时启用；`on` 始终启用；`off` 完全关闭 |
| `drawerNavigation` | `true` | 竖轨改为抽屉 + 浮动开关按钮 |
| `comfortableTargets` | `true` | 输入区、底部统计详情与消息操作按钮的触摸区域升到 44px |
| `swipeNavigation` | `true` | 右滑开抽屉、左滑收起；纵向拖动、输入框、横滑容器、表格与其他已打开的宿主弹层不触发，抽屉自身除外 |
| `rowActionsOnTouch` | `true` | 让宿主默认只在 `:hover` 出现的会话行 / 工作区行操作常驻显示，并扩大省略号命中区 |
| `quietComposerFocus` | `true` | 进入或切换会话时不再由宿主的程序化聚焦弹出软键盘；真实点按输入区后照常聚焦 |

`off` 是**硬关闭**：移动布局的根属性、样式表、viewport meta 与监听器全部撤销，回到原生布局；已发起的历史分页不会因此取消。配置快照未 ready（loading / unavailable）时不应用任何规则，避免半套布局；若第一次快照已 ready 且满足条件，会立即激活，不保证首帧仍是宿主原生布局。

## 移动层效果

历史 390×844 实测（原生 → 本插件）：会话可用宽度 334px（56px 竖轨常驻）→ **390px**；输入区按钮 28×28、消息操作按钮 17.5–18px → **44×44**；底部统计详情入口约 20–22px 高 → **最小 44px 触摸区**（粘性底栏保留底部安全区）；4 列以上表格从只在 `:hover` 放行的 `overflow-x:hidden` → `overflow-x:auto`；会话滚动加 `overscroll-behavior-y: contain`；粗指针下输入框 16px（原生 13.33px 会触发 iOS 强制放大）；视口 `100%` → `100dvh` + 安全区，软键盘由 `visualViewport` 内边距抬升。设置面板在 ≤720px 时全屏，188px 分区栏改为顶部可横滑标签、内容全宽、列表行头允许换行；更宽触屏与桌面仍用宿主居中面板。

**顶部下拉加载更早**（本插件新增）：激活后在 Chat 视图的会话滚动区顶部继续下拉 ≥48px，按公开的 `SessionFace.loadOlder()` 取一页，不必精确点那枚约 25px 高的按钮。

- 只认 Chat 视图：滚动区里没有 `[data-chat-flow]`（轨迹视图、会话检查器）时不响应。一次手势最多一页；只有窗口 `open`、`hasMore` 为真、`loadingOlder` 为假且没有未完成请求时才发。下拉距离只在 `scrollTop ≈ 0` 后开始累计，先向上滚到顶部的行程不计入 48px。
- 不合成点击、不按按钮文案找控件；宿主原生的分页按钮、游标和手动翻页保持原样。
- prepend 后用宿主自己的 `[data-chat-anchor-key]` 行测量位移并同步 `scrollTop`，锚点行不存在时才退回 `scrollHeight` 差值。
- 起于输入框、可编辑区或输入卡片（`data-composer-seat`）时不响应；多指、`touchcancel` 与普通滚动都不触发。
- 起于会话里自带垂直滚动的卡片（表格、代码块等任何计算样式 `overflow-y` 为 `auto` / `scroll` 且内容确实溢出的盒子）时也不响应：这段拖动归该卡片自己，即使它已经滚到自己的边界、浏览器把余量链给外层会话，也不当作下拉分页。判定只看触摸起点到会话滚动区之间的祖先链与计算样式，不识别任何插件类名；内容没溢出的同一盒子（例如只横滑的图表容器）、或 `overflow-y: visible` 的高块仍按外层下拉处理。卡片是否可滚在读到时才判定一次（手指确实位于顶部时），不在每次 `touchstart` 上遍历。
- 没有独立开关，随移动层一起启停。卸载只移除触摸监听并清空手势，**不取消已发起的 `loadOlder()`**：请求返回后若滚动区仍在、读者未移动且主视图未切换，仍会修正 `scrollTop`；被拒绝的 Promise 不由插件捕获，也没有自动重试。

## 触屏交互

这层来自 [zhu1090093659/dsh-web](https://github.com/zhu1090093659/dsh-web) 的移动端适配模块（`packages/dsh-remote-web-ui/src/client/mobile-adapt.ts`，Apache-2.0），按本机宿主实际 DOM 重写而非照搬选择器。

- **横滑开关抽屉**：触摸结束时判定水平位移 ≥60px 且 ≥1.5 倍垂直位移；只在 release 时探测「是否在横滑容器内」（容器确实可横滑才吞手势），避免每次点按/滚动触发布局计算。多指、`touchcancel`、起点在输入框或插件控件、终点在横滑容器内、当前有宿主弹层时不触发；宿主窄屏把侧栏列本身渲染成 `popover`，所以判定必须排除抽屉自身。插件只调 `ctx.layout.toggleSidebar()` 并读宿主写在帧上的 `data-sidebar-collapsed`，不另存状态；宽度 `min(86vw, 320px)`，沿用宿主的滑动时长与缓动，遮罩同步淡出并在退出完成前拦截触摸，重复遮罩点击不会重开。抽屉有模态焦点管理：进入聚焦内部控件、Tab 内循环、Esc 关闭、退出恢复焦点；会话主视图或全局面板成功切换后收起，没有对话头部的全局面板保留底角导航按钮，避免收起后失去入口。开关抽屉及不影响启用状态的窗口缩放不重装样式、viewport 或键盘监听。
- **行操作常驻**：用 `[data-slot="sidebar"] [data-row-key] > span:last-child:has(> button)` 定位宿主行尾操作条，以伪元素把命中区外扩 12×8（16px 图标 → 40×32），不改行高、不引入 `!important`。没有按钮的空白行不命中；宿主若在行尾追加 span 需更新地标。手机抽屉 320px 时标题比原来再短约 20px，换来重命名 / fork / 归档在触屏可达。
- **会话打开不弹键盘**：拦截 `HTMLElement.prototype.focus`，输入区编辑面在 3 秒内没有落在输入卡片上的 `pointerdown` 时拒绝聚焦。补丁只在移动层激活期间安装，退出按函数身份还原；原型上的 `focus` 已被别人改写时保留别人的补丁。它只校验时间窗、**不校验 `event.isTrusted`**——证明的是“最近有一次落在输入卡片上的 `pointerdown`”，脚本派发的事件同样能满足。卸载先把本次闭包的 `active` 置 false 再移除监听，其他插件捕获的旧闭包继续调用也不再拦截。副作用：其他插件在手机上的自动聚焦（例如把草稿填回输入框）同样被拦下，用户需先点一下输入框。

未移植：长按行菜单（宿主 `HoverCard` 的 800ms `pointerenter` 本身就是预览卡片，同一手势不能有两种含义）、输入区紧凑重排 / 菜单改底部弹层 / 隐藏右栏 / 头部动作移位（宿主已有 `flex-wrap`、`@container (width<=560px)`、`position:fixed` + clamp 菜单、<300px 零轨道、<1024px rail 等规则，搬来只会打架）、Enter 换行（会改变宿主发送语义，不属于布局/触控适配）。

## 状态徽标

宿主头部「3 个子智能体」「1 个后台任务」各占约 100px；插件在自己的插槽条目里渲染机器人/层叠图标与计数（运行中小圆点，≥10 显示 `9+`），点击在**图标下方**展开锚定浮层，子智能体可跳转。

- 浮层是 `popover="manual"` 顶层元素，头部 `overflow:hidden` 与 `container-type:inline-size` 裁不到；默认距图标 8px、距屏幕边缘 ≥12px，宽 ≤360px、高 ≤440px，空间不足时只在「上方确实更宽裕」才上翻，其余列表独立滚动。
- **不是底部面板、不是模态**：无遮罩、无 `::backdrop`、无整页变暗，`aria-modal="false"`，无焦点陷阱，浮层外页面照常可点；行内名称完整换行，后台任务为只读状态条目，不伪装成按钮，也没有宿主的“终止任务”动作。关闭方式：32px 关闭按钮（44px 命中区）、再点同一图标、点另一图标切换、点浮层外、Esc、焦点移出、切换会话或插件关闭；关闭时若焦点仍在面板内且触发图标仍在文档中，焦点回到该图标；打开时焦点进入关闭按钮。
- 数据来自 `sessions.list` 的 `subagentCatalog` 投影与 `ctx.jobs` 任务名册（名册需要 `watchRows` 订阅）。子智能体运行状态优先；停止后只有宿主 `subagentTiming.lastTurnCompleted` 明确为真才显示“已完成”，其余显示“未运行”，不把中断或未知状态当成成功。跳转用显式注入的 `uiWorkspace.openSession`（Cordis 对未声明服务会抛错，不能用可选链跳过依赖声明）。
- **安全边界**：宿主徽标只在同类替代徽标渲染时才隐藏，覆盖类别写在插槽的 `data-dsh-mobile-badges` 上；投影读不到时不隐藏，回退到宿主原控件而不是什么都不显示。子智能体徽标按 `aria-haspopup="tree"` 隐藏（已核对 0.2.1-rc.2 的 `CatalogDropdown`），只匹配该插槽下的直接条目；未来同一插槽出现其他树形弹出控件仍可能误匹配。后台任务**没有**可用的稳定宿主标识（普通 `<div>`，按钮只带本地化 `aria-label`，插槽条目 id 未落 DOM），只保留收窄的文案匹配：直属 `button[aria-expanded]` 且文案含“后台任务”或“background job”；宿主改文案或使用未知语言时可能出现两套徽标，同结构同文案的其他控件仍可能被误隐藏。

## 边界与已知限制

- **依赖宿主 DOM 地标**，不依赖哈希类名；地标集中在 `src/client/landmarks.ts`。构建断言只检查产物是否引用这些选择器，宿主是否仍提供对应结构须靠活体探针；地标缺失时相关样式可能不命中。顶部下拉另依赖 `[data-conversation-scroll]`、`[data-chat-flow]`、`[data-chat-anchor-key]`，滚动区折叠/展开动画可能让 `scrollHeight` 差值不精确。从自带垂直滚动的卡片上起手不能分页（须在会话背景上下拉），这是为避免滚动冲突而刻意收窄的范围；判定依赖 `getComputedStyle` 与 `scrollHeight` / `clientHeight`，宿主若把滚动放到自定义滚动容器（不产生原生滚动盒）上，该容器仍会被当成外层下拉。
- 设置面板依赖 `[data-shortcut-modal="settings"]` 及其 `nav` / 内容两级子节点与 `[data-slot="settings.section"]`，行头按 `li > div:first-child` 匹配，不依赖提供商文案或哈希类名；设置页不额外补偿软键盘，沿用宿主 options 滚动容器。
- **View 标签（对话/轨迹）保持原大小**：升到 44px 会让头部从 76px 涨到 95px。头部只改横向内边距（20/28px → 12px）与标签行底部 6px；390×844 下头部 90px → 83.5px，改 `min-height` 反而更高。
- **键盘补偿保留页面缩放**：页面放大时不把可视视口缩小误认成键盘；视口事件按帧合并，仅补偿值变化时写入。输入框 16px 规则覆盖实际 contenteditable 编辑器，宽表格允许双指缩放。iOS 旧版本不支持 `interactive-widget`，靠 `visualViewport` 内边距兜底；软键盘行为最终仍需真机确认。
- **不改**右侧面板策略、PWA/安装、浏览器历史或系统返回/前进手势、主题色；横滑只控制抽屉，除状态徽标外不替换宿主槽位内容。

## 开发与验证

插件包只分发构建产物和资源，不包含 `src/`、`tests/` 或 `scripts/`；以下命令在源码检出中运行。

```bash
pnpm install
pnpm run typecheck
pnpm run build           # dist/host/index.js + dist/client.js
pnpm test                # pretest 会先构建；回归用例串行
pnpm run verify:bundle   # 惰性 factory、仅宿主 React、样式表地标引用且无 url()/@import、4 个插槽 / 2 份字典 / 根属性的注册与清理
```

默认门禁是 typecheck、build、Node 测试和 bundle 校验，全部离线、不启动浏览器；依赖就绪的干净检出可直接 `pnpm test`。**`verify:bundle` 只是产物自检**：检查构建出的样式表是否仍引用 `landmarks.ts` 里 `HOST_LANDMARKS` 的每个选择器；只记录、不要求命中的 `VIEW_TABS` 与 `COLLAPSED_ATTRIBUTE` 不在该列表。产物体内没有宿主 DOM，不能证明宿主升级后地标仍存在；宿主活体地标由可选探针的 `--verify` 验收，两者不可互相替代。

可选活体检查不属于默认门禁，须在验证记录中单独标明执行或未执行，不能用 Node 测试当作真机/GUI 验收：

- **触摸回归**：需本地 Playwright 与 Chromium，用 `DSH_MOBILE_PLAYWRIGHT_MODULE`（模块绝对路径）与 `DSH_MOBILE_BROWSER_EXECUTABLE`（浏览器绝对路径）启用；在隔离页面运行真实插件 bundle，验证服务声明、子智能体菜单点击、底部按钮命中及关闭插件后的还原，不连接用户会话，不代表登录态 GUI 的端到端验收。
- **页面探针**：连接**已在运行**的 Chrome CDP，不启动浏览器或读取凭据；临时设置设备视口与触摸仿真并在结束时清除，但无法恢复目标页原先已有的仿真设置，使用前应选无既有仿真的页面。

```bash
# 报告模式：没找到 DSH 目标只输出 needsTarget、退出 0；连接/执行错误仍退出 1
node scripts/browser-probe.mjs http://127.0.0.1:9222 --viewport 390x844 --touch

# 验收模式：唯一 DSH 页面、插件已激活、无插槽崩溃、关键地标齐全才退出 0
node scripts/browser-probe.mjs http://127.0.0.1:9222 --viewport 390x844 --touch --verify --expect conversation
```

`--verify` 始终要求 shell 锚点（root、AppFrame、sidebar/main/rightbar）存在，宿主改名会直接失败而不是静默跳过。会话头、设置面板、View 标签、表格等条件性地标只在对应锚点存在时才要求；若验收目标本身就是这些状态，用 `--expect conversation`（及 `settings`/`tabs`/`table` 等 `PROBE_ANCHORS` 名称）显式声明，锚点被改名或删除时报 `expected:*` 失败。`--expect` 必须与 `--verify` 一起使用且提供非空状态。只读子智能体等由宿主替换输入组件的会话没有 `data-composer-card`，不属于默认 `--expect conversation` 验收场景。无 DSH 目标算验收失败。退出码：0 成功/报告，1 探针或验收失败，2 用法错误。

产物是 DSH Host ESM + `window.__ModuleLoader__` 惰性 Client factory，React 从宿主模块表取；Client 运行时不 import 任何 DSH Client 内部包。普通本地检查按当前任务与仓库规则选择。

## License

[MIT](<LICENSE>)。
