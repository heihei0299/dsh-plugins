# DSH Mobile

给现有 DSH Web GUI 加一层**只在移动端生效**的布局与触控优化。桌面端一行 CSS 都不会命中。

不是独立 App、不替换会话/输入框/审批、不改已安装的 DSH 核心、不启动第二个 Web 服务。

## 为什么需要它

DSH 的 Web 客户端是桌面优先的。在 390×844 的实测数据：

| 项目 | 原生 | 装上本插件 |
|---|---|---|
| 会话可用宽度 | 334px（56px 竖轨常驻） | **390px**（竖轨收为抽屉，+17%） |
| 折叠后重新打开侧栏 | **没有入口**（开关本身在竖轨里） | 浮动按钮 / 遮罩点击 |
| 输入区按钮 | 28×28 | **44×44** |
| 消息操作按钮 | 17.5–18px | **44×44** |
| 底部统计详情入口 | 约 20–22px 高（在输入卡片之外） | **最小 44px 触摸区域**，粘性底栏自身保留底部安全区 |
| 4 列以上表格横向滑动 | **滑不动**（`overflow-x:hidden`，只在 `:hover` 放行，触屏没有 hover） | `overflow-x:auto` |
| 会话滚动 | 下拉容易触发页面级手势 | `overscroll-behavior-y:contain` |
| 聚焦输入框 | 13.33px 字 → iOS 强制放大 | 粗指针下 16px |
| 视口高度 | `100%`（地址栏遮挡） | `100dvh` + 安全区 |
| 软键盘 | 覆盖输入区 | `visualViewport` 内边距抬升 |

设置面板（**设置 → 模型**）另有窄屏重排：宿主的 188px 分区栏固定在左侧，390px 视口下内容列只剩约 154px，提供商名称会压到「编辑 / 删除」下面。插件在 ≤720px 时把设置面板改为全屏，分区栏变成顶部可横滑标签，内容区全宽，并允许列表行头换行；更宽的触屏设备仍使用宿主居中面板，桌面端不受影响。

## 安装与启用

作为 bundle 装入现有 profile，之后在 **设置 → 插件** 里开关，不手改 profile：

```bash
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/dsh-mobile --offline
```

首次安装（或换 bundle 版本）后需要重启 dsh；此后开关只重载 entry，刷新页面即可。

## 设置

**设置 → 通用 → 移动端体验**（Host 持久化，`dsh-mobile` 命名空间，六项都是 `volatile()`，改完即时生效）：

| 字段 | 默认 | 作用 |
|---|---|---|
| `mode` | `auto` | `auto` 在「宽度 ≤720px 或粗指针」时启用；`on` 始终；`off` 完全关闭 |
| `drawerNavigation` | `true` | 竖轨改为抽屉 + 浮动开关按钮 |
| `comfortableTargets` | `true` | 输入区、底部统计详情与消息操作按钮的触摸区域升到 44px |
| `swipeNavigation` | `true` | 右滑开抽屉、左滑收起；纵向拖动、输入框、横滑容器、表格与已打开的宿主弹层都不触发 |
| `rowActionsOnTouch` | `true` | 让宿主默认只在 `:hover` 出现的会话行 / 工作区行操作常驻显示，并扩大省略号命中区 |
| `quietComposerFocus` | `true` | 进入或切换会话时不再由宿主的程序化聚焦弹出软键盘；真实点按输入区后照常聚焦 |

`off` 是**硬关闭**：根属性、样式表、viewport meta、监听器全部撤销，回到原生布局。首次加载 Host 设置之前不应用任何规则，避免半套布局。

## 触屏交互（自 dsh-web 移植）

这一层来自 [zhu1090093659/dsh-web](https://github.com/zhu1090093659/dsh-web) 的移动端适配模块（`packages/dsh-remote-web-ui/src/client/mobile-adapt.ts`，Apache-2.0），按本机宿主的实际 DOM 重新实现，而不是照搬选择器。

移植并保留的效果：

| 效果 | 实现 | 关键取舍 |
|---|---|---|
| 横滑开关抽屉 | 触摸结束时判定：水平位移 ≥60px 且 ≥1.5 倍垂直位移 | 在 release 时才探测「是否在横滑容器内」，避免每次点按/滚动都触发布局计算；多指、取消、已打开弹层一律不响应 |
| 会话行 / 工作区行操作可达 | 插件激活期间让宿主的行操作条常驻，并用伪元素把按钮命中区向外扩 12×8（实测 16px 图标 → 40×32） | 宿主的行操作只在 `:hover` 出现，手机上因此完全不可达；用选择器特异性获胜，不引入 `!important`，也不改变行高 |
| 会话打开不弹键盘 | 拦截 `HTMLElement.prototype.focus`：输入区编辑面在没有 3 秒内真实点按的情况下拒绝聚焦 | 只在移动层激活期间生效，退出时按函数身份还原；其他插件后装的补丁不会被移除 |

**没有移植的部分及原因**（都在本机宿主上逐条核对过已原生解决，或会与宿主行为冲突）：

- **长按行菜单**：宿主给行加了 `HoverCard`（`openDelayMs: 800`，`pointerenter` 不过滤 touch），长按 0.8 秒本身就是「预览卡片」。再把长按改成菜单会让同一手势有两种含义，因此改为直接显示行操作控件。
- **输入区紧凑重排 / 菜单改底部弹层 / 隐藏右栏 / 头部动作移位**：本机宿主的输入区行已 `flex-wrap:wrap` 并有 `@container (width<=560px)` 收窄间距；模型等菜单已 `position:fixed` 并按 12px 边距双向 clamp 到视口；右栏在可用宽度 <300px 时轨道本来就是 0；侧栏 <1024px 自动收成 rail（本插件再改成抽屉）。这些规则搬过来只会与宿主打架。
- **Enter 换行**：会改变宿主既有的发送语义，不属于布局/触控适配。

## 边界与已知限制

- **依赖宿主 DOM 地标**，不依赖哈希类名。地标集中在源码的 `src/client/landmarks.ts`；构建断言只检查插件产物是否使用这些选择器，宿主是否仍提供对应结构须通过下述活体探针检查。地标缺失时相关样式可能不命中，不能假定所有布局均保持正常。
- **设置面板依赖宿主的设置对话框标记**：`[data-shortcut-modal="settings"]`、它下面的 `nav` / 内容两级子节点，以及分区 slot `[data-slot="settings.section"]`。列表行头按 `li > div:first-child` 结构匹配，不依赖提供商文案或哈希类名；宿主改名或改结构时对应规则可能不命中，构建断言不能发现宿主变化。设置页不额外补偿软键盘，沿用宿主 options 滚动容器。
- **抽屉状态是宿主自己的**。插件只调用公开的 `ctx.layout.toggleSidebar()`，并读宿主写在帧上的 `data-sidebar-collapsed`，不另存一份状态。
- **抽屉使用宿主的滑动时长与缓动**，遮罩按相同时长淡出，退出完成前仍拦截触摸；关闭过程中的重复遮罩点击不会重新打开抽屉。开关抽屉及不影响启用状态的窗口缩放，不重装样式、viewport 或键盘监听。
- **抽屉具有模态焦点管理**：进入时聚焦内部控件，Tab 在抽屉内循环，Esc 关闭，退出时恢复焦点；宿主菜单/弹窗优先处理自己的键盘与焦点。会话主视图或全局面板成功切换后收起，不因展开分组或无关列表更新收起；没有对话头部的全局面板保留底角导航按钮，避免收起后失去入口。
- **键盘补偿保留页面缩放**：页面放大时不把可视视口缩小误认成键盘；视口事件按帧合并，仅补偿值变化时写入。输入框的 16px 规则覆盖实际 contenteditable 编辑器，宽表格允许双指缩放。
- **View 标签（对话/轨迹）不放大**。实测把它们升到 44px 会让头部从 76px 涨到 95px——用 19px 常驻阅读空间换很少点的两个标签，不划算。
- **状态徽标折叠成图标 + 数字**。宿主的「3 个子智能体」「1 个后台任务」各占约 100px，插件在自己的插槽条目里渲染机器人/层叠图标与计数（运行中小圆点，≥10 显示 `9+`），点击在**该图标正下方**展开锚定浮层，子智能体可跳转。
  - 浮层是 `popover="manual"` 元素，由浏览器放在**顶层（top layer）**：头部 `overflow:hidden` 与 `container-type:inline-size` 都裁不到它；默认距图标 8px、距屏幕边缘至少 12px，右缘跟随图标，宽 ≤360px、高 ≤440px，空间不足时只在「上方确实更宽裕」才上翻，其余情况列表独立滚动。
  - **不是底部面板、不是模态**：没有全屏遮罩、没有 `::backdrop`、没有整页变暗，`aria-modal="false"`；浮层外的页面照常可点。行内名称完整换行，状态与进度各占一行；后台任务为只读状态条目，不伪装成可点击按钮。
  - 关闭方式：右上 32px 关闭按钮（44px 命中区）、再点同一个图标收起、点另一个图标直接切换、点浮层外、Esc、焦点移出、切换会话或插件关闭；关闭后焦点回到触发图标。打开时焦点进入关闭按钮，Tab 可进入列表做键盘滚动。
  - 数据分别来自 `sessions.list` 的 `subagentCatalog` 投影与 `ctx.jobs` 的任务名册；后台任务名册需要 `watchRows` 订阅。子智能体运行状态优先；停止后只有宿主 `subagentTiming.lastTurnCompleted` 明确为真才显示“已完成”，其余显示“未运行”，不会把中断或未知状态当成成功。
  - 子智能体跳转使用显式注入的 `uiWorkspace.openSession`；Cordis 对未声明的服务会抛错，不能用可选链跳过依赖声明。
  - **宿主徽标只在同类替代徽标渲染时才隐藏**：插件把覆盖的类别写在插槽的 `data-dsh-mobile-badges` 上，样式据此隐藏对应宿主控件；投影读不到时该类别不隐藏，回退到宿主原控件而不是什么都不显示。
  - 子智能体徽标按宿主的 `aria-haspopup="tree"` 标识隐藏（已核对 0.2.1-rc.2 的 `CatalogDropdown`），与语言/文案无关，且只匹配该插槽下的直接条目；未来若同一插槽出现其他树形弹出控件，仍可能误匹配。
  - 后台任务徽标**没有**可用的稳定宿主标识（宿主条目是普通 `<div>`，直接子 `<button aria-expanded>` 只带本地化 `aria-label`，插槽条目 id 未落到 DOM）。因此只保留收窄后的文案匹配：直属 `button[aria-expanded]` 且文案含“后台任务”或“background job”，不再匹配任意 `job` 后代。宿主改文案或使用未知语言时可能出现两套徽标；若其他控件恰好具有相同结构和文案，仍可能被误隐藏。建议宿主为插槽条目输出稳定标记（例如 `data-slot-entry`），插件不为此发明接口。
- **头部只改横向内边距与标签行底部 6px**（20/28px → 12px）。改 `min-height` 反而让两行头部更高。
- 390×844 实测头部：原始 90px，本插件 83.5px（32px 抽屉按钮 + 6px 标签行留白）。
- **抽屉宽度取 `min(86vw, 320px)`**，不使用宿主拖拽出的宽度偏好。
- **横滑判定在触摸结束时进行**，阈值是 60px 水平位移且至少 1.5 倍于垂直位移；多指接触、`touchcancel`、起点在输入框/插件自身控件上、终点处于横滑容器内，或当前有宿主弹层时都不触发。横滑容器在 release 时才用计算样式 + `scrollWidth` 判定（提前判定会让每次点按都触发布局计算）；判定依据是容器当前确实可横滑，不可横滑的容器不会吞掉手势。
  - 宿主在窄屏把**侧栏列本身**渲染成 `popover` 元素（`pI_x6G_sidebarCol` 带 `popover` 属性）。因此「有弹层就不响应」的判定必须排除抽屉自身，否则抽屉一打开、左滑收起就会被自己挡住——这一点是在活体校验里发现的，不是推测。
- **行操作常驻按结构定位**：`[data-slot="sidebar"] [data-row-key] > span:last-child`。宿主的行把操作条作为**最后一个子 span**，其第一个按钮就是省略号菜单；宿主若在行尾追加新的 span，这条规则会指向错误元素，需要按届时结构更新地标。隐藏宿主徽标与这里无关，两者互不影响。
- **行操作常驻会占掉标题宽度**：手机抽屉宽 320px 时标题会在原基础上再短约 20px（与宿主机上悬停时的布局一致），换来的是重命名 / fork / 归档在触屏上可达。
- **聚焦拦截是全局 prototype 补丁**：只在移动层激活期间安装，退出时按函数身份还原；3 秒窗口从「点按输入卡片」开始计时，因此点按发送按钮后的重新聚焦、以及点按卡片空白处聚焦编辑器都照常工作。副作用是：其他插件在手机上对编辑器发起的自动聚焦（例如把草稿填回输入框）同样会被拦下，用户需要先点一下输入框。
- **不改**右侧面板策略、PWA/安装、手势导航、主题色；除状态徽标外不替换宿主槽位内容。
- iOS 旧版本对 `interactive-widget` 无支持，靠 `visualViewport` 内边距兜底；软键盘行为最终仍需真机确认。

## 开发

以下构建、测试与探针命令在源码检出中运行；插件包只分发构建产物和资源，不包含 `src/`、`tests/` 或 `scripts/`。

```bash
pnpm install
pnpm run typecheck
pnpm run build           # dist/host/index.js + dist/client.js
pnpm test                # pretest 会先构建；回归用例串行
pnpm run verify:bundle   # 产物检查：惰性 factory、仅宿主 React、样式表地标引用、注册与清理
```

默认门禁是 typecheck、build、Node 测试和 bundle 校验，全部离线、不启动浏览器；干净检出可直接 `pnpm test`（`pretest` 先构建 `dist`）。**`verify:bundle` 只是产物自检**：它检查构建出的样式表是否仍引用 `landmarks.ts` 的每个选择器，产物体内没有宿主 DOM，因此不能证明宿主升级后地标仍存在。宿主活体地标由可选探针的 `--verify` 验收，两者不可互相替代。

可选活体检查不属于默认门禁：触摸回归需要本地 Playwright 与 Chromium，用 `DSH_MOBILE_PLAYWRIGHT_MODULE`（模块绝对路径）和 `DSH_MOBILE_BROWSER_EXECUTABLE`（浏览器绝对路径）启用；页面探针需要已运行的 Chrome CDP。两者都应在验证记录中单独标明执行或未执行，不能把 Node 测试当作真机/GUI 验收。

触摸回归在隔离页面运行真实插件 bundle，验证服务声明、子智能体菜单点击和底部按钮的触摸命中与关闭插件后的还原；不连接用户会话、不代表登录态 GUI 的端到端验收。

页面探针连接**已在运行**的 Chrome CDP，不启动浏览器或读取凭据。它临时设置设备视口和触摸仿真，结束时清除这些覆盖；无法恢复目标页原先已有的仿真设置，使用前应选择无既有仿真的页面：

```bash
# 报告模式：没找到 DSH 目标只输出 needsTarget、退出 0；连接/执行错误仍退出 1
node scripts/browser-probe.mjs http://127.0.0.1:9222 --viewport 390x844 --touch

# 验收模式：找到唯一 DSH 页面、插件已激活、无插槽崩溃、当前页面状态所需的关键地标齐全才退出 0
# --expect conversation 显式声明“这个验收目标应当处于会话页”，锚点消失时不会被当成别的页面状态跳过
node scripts/browser-probe.mjs http://127.0.0.1:9222 --viewport 390x844 --touch --verify --expect conversation
```

`--verify` 始终要求 shell 锚点（root、AppFrame、sidebar/main/rightbar）存在——宿主改名会直接失败，而不是让整组检查静默跳过。会话头、设置面板、View 标签、表格等条件性地标只在对应锚点存在时才要求；若验收目标本身就是这些条件状态，用 `--expect conversation`（及 `settings`/`tabs`/`table` 等 `PROBE_ANCHORS` 名称）显式声明，锚点被改名/删除时报 `expected:*` 失败。`--expect` 必须与 `--verify` 一起使用并提供非空状态。因此探针只对“当前页面状态 + 显式声明”的条件地标负责，不声称无条件覆盖所有条件 DOM；只读子智能体等由宿主替换输入组件的会话没有 `data-composer-card`，不属于默认 `--expect conversation` 验收场景。无 DSH 目标算验收失败（退出码 1）。退出码：0 成功/报告，1 探针或验收失败，2 用法错误。

产物是 DSH Host ESM + `window.__ModuleLoader__` 惰性 Client factory；React 从宿主模块表取。Client 不运行时 import 任何 DSH Client 内部包。

所有构建、测试与安装都需要针对当前任务单独授权。

## 活体验证记录（2026-10-28）

在隔离实例（`DSH_HOME=/tmp/dsh-mobile-probe`，`dsh plugin add link:…/dsh-mobile`，端口 50144，不连接任何用户会话）上，用 Chrome CDP 以 **390×844 / mobile / touch** 运行真实插件产物：

| 检查 | 方法 | 结果 |
|---|---|---|
| 激活 | `Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled`，读根属性与样式表 | `data-dsh-mobile=drawer`、两块样式表在、`grid-template-columns: 0px 390px 0px`、`frame` 高 844 |
| 横滑开关抽屉 | `Input.dispatchTouchEvent` 真实触摸：右滑 300px / 左滑 240px / 纵向拖动 / 35px 轻推 | 右滑展开、左滑（从抽屉内起手）收起、纵向与轻推均不动作 |
| 会话打开不弹键盘 | 先 `editor.focus()` 再真实点按输入卡片后 `editor.focus()` | 未点按时拒绝（`activeElement` 不是编辑面），点按后允许 |
| 行操作可达 | 打开抽屉测量工作区行 | 操作条 `display:flex`、按钮 `position:relative`、`::after` 命中区外扩 12×8；空白会话行不含按钮，规则正确地不匹配 |
| 硬关闭 | `mode=off` 后重载 | 根属性、移动样式表、抽屉按钮、键盘 inset 变量全部撤销，`meta[viewport]` 复原为 `width=device-width, initial-scale=1`，程序化聚焦恢复、横滑不再响应 |

未覆盖：真实 iOS/Android 手势管线（`Input.dispatchTouchEvent` 不等价于真实触摸滚动竞争）、会话行（非空白）的操作菜单、以及登录态 GUI 的端到端验收——隔离实例无凭据、真实 GUI 匿名 401。`scripts/browser-probe.mjs --verify --expect conversation` 在该隔离实例上仅因 `header-actions` 缺失失败：该实例处在「新会话」页，宿主不渲染会话头部的动作槽，与本插件无关。

## License

[MIT](<LICENSE>)。
