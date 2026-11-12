# DSH Mobile

给现有 DSH Web GUI 加一层**默认只在移动端生效**的布局与触控优化。默认 `mode: auto`：宽度 >720px 且非粗指针的桌面不启用，设置行保留自身样式；`on` 会让桌面也启用（配置语义，不是缺陷）。不是独立 App，不替换会话/输入框/审批，不改 DSH 核心，不启动第二个 Web 服务。

## 要求与安装

需 Node ≥22、DSH `0.2.1-rc.2 || 0.2.1-rc.5 || 0.2.2-rc.1 || 0.2.2-rc.2` 与 pnpm。门禁不代表逐版验收：`0.2.2-rc.1` 做过桌面与 390×844 触屏冒烟，并静态核对了该版本客户端包的地标（`data-slot`、`data-composer-dock`、`data-row-key`、`aria-haspopup="tree"`）；`0.2.2-rc.2` 只做了静态地标核对（新增 `data-subagent-action`，子智能体弹层从 `tree` 变成 `dialog`）；真机触摸与登录态 GUI 验收仍待补。

```bash
cd dsh-mobile
pnpm install
pnpm run build
dsh plugin --profile web add "link:$PWD" --offline
```

按 bundle 装入后在 **设置 → 插件** 开关，不手改 profile；插件管理器要求重启时再重启并刷新页面。六项 volatile 设置保存后即时生效。

## 设置

**设置 → 通用 → 移动端体验**（`dsh-mobile` 命名空间，六项均为 `volatile()`）：

| 字段 | 默认 | 作用 |
|---|---|---|
| `mode` | `auto` | `auto` 在宽度 ≤720px 或粗指针时启用；`on` 始终启用；`off` 完全关闭 |
| `drawerNavigation` | `true` | 竖轨改为抽屉 + 浮动开关 |
| `comfortableTargets` | `true` | 输入区、统计详情与消息操作按钮升到 44px |
| `swipeNavigation` | `true` | 右滑开抽屉、左滑收起；输入框、横滑容器、表格与宿主弹层不触发 |
| `rowActionsOnTouch` | `true` | 会话/工作区行操作常驻显示，省略号命中区扩大 |
| `quietComposerFocus` | `true` | 进入或切换会话时不弹软键盘；点按输入区后照常聚焦 |

`off` 是硬关闭：根属性、样式表、viewport meta 与监听器全部撤销，已发起的历史分页不取消。配置快照未 ready 时不应用任何规则。

## 移动层效果

历史 390×844 实测（非本轮重跑）：会话可用宽度 334px → 390px；输入区/消息操作按钮与统计详情入口升到 44px；宽表格改为 `overflow-x:auto`；滚动加 `overscroll-behavior-y: contain`；粗指针下输入框 16px（避免 iOS 强制放大）；视口 `100dvh` + 安全区，软键盘由 `visualViewport` 抬升。设置面板在 ≤720px 时全屏，分区栏改为顶部横滑标签。

**顶部下拉加载更早**：在 Chat 视图会话滚动区顶部继续下拉 ≥48px，按 `SessionFace.loadOlder()` 取一页。只认 Chat 视图（无 `[data-chat-flow]` 不响应）；一次手势最多一页，要求窗口 `open`、`hasMore` 为真且无进行中请求；起点在输入框、可编辑区、输入卡片或自带垂直滚动的卡片上时不响应。prepend 后用 `[data-chat-anchor-key]` 行测量位移并同步 `scrollTop`。卸载只移除监听，不取消已发起的请求。

## 触屏交互

- **横滑开关抽屉**：水平位移 ≥60px 且 ≥1.5 倍垂直位移才触发；只在 release 时探测横滑容器与宿主弹层。插件只调 `ctx.layout.toggleSidebar()` 并读 `data-sidebar-collapsed`，宽度 `min(86vw, 320px)`，沿用宿主时长与缓动；抽屉有模态焦点管理（进入聚焦、Tab 循环、Esc 关闭、退出还原）。
- **行操作常驻**：用 `[data-slot="sidebar"] [data-row-key] > span:last-child:has(> button)` 定位行尾操作条，以伪元素把命中区外扩到 40×32，不改行高、不用 `!important`。
- **会话打开不弹键盘**：拦截 `HTMLElement.prototype.focus`，3 秒内没有落在输入卡片上的 `pointerdown` 时拒绝聚焦；只校验时间窗、不校验 `isTrusted`。副作用：其他插件在手机上的自动聚焦同样被拦下。

未移植长按行菜单、输入区紧凑重排、Enter 换行等与宿主规则冲突或改变发送语义的特性。

## 状态徽标

在自己的插槽条目里渲染计数徽标（运行中小圆点，≥10 显示 `9+`），点击在图标下方展开锚定浮层；子智能体可跳转，后台任务为只读条目。

- 浮层是 `popover="manual"` 顶层元素：无遮罩、无焦点陷阱、`aria-modal="false"`，宽 ≤360px、高 ≤440px；关闭方式为按钮、再点图标、点外部、Esc、切换会话或关闭插件。
- 数据来自 `sessions.list` 的 `subagentCatalog` 与 `ctx.jobs`（需 `watchRows`）；子智能体运行状态优先，停止后仅当 `subagentTiming.lastTurnCompleted` 为真才显示“已完成”。
- **安全边界**：宿主徽标只在同类替代徽标渲染时隐藏，覆盖类别写在 `data-dsh-mobile-badges`；投影读不到时不隐藏，回退到宿主原控件。子智能体优先按宿主的 `data-subagent-action` 入口标记匹配（0.2.2-rc.2 起），旧版本回退到 `aria-haspopup="tree"`（0.2.1-rc.2、0.2.2-rc.1 的 `CatalogDropdown` 均已核对；rc.2 把该弹层改成了 `dialog`）；后台任务没有稳定标识，只保留收窄的文案匹配（`button[aria-expanded]` 含“后台任务”/“background job”），宿主改文案或未知语言时可能出现两套徽标。

## 边界与已知限制

- 依赖宿主 DOM 地标（集中在 `src/client/landmarks.ts`），不依赖哈希类名；地标缺失时样式可能不命中，须靠活体探针确认。
- 设置面板依赖 `[data-shortcut-modal="settings"]` 与 `[data-slot="settings.section"]`；View 标签保持原大小（升到 44px 会让头部从 76px 涨到 95px）。
- 键盘补偿保留页面缩放；iOS 旧版本靠 `visualViewport` 兜底，软键盘行为仍需真机确认。
- 不改右侧面板策略、PWA、浏览器历史或系统返回手势；横滑只控制抽屉。

## 开发与验证

插件包只分发构建产物与资源。默认门禁全部离线、不启动浏览器：

```bash
pnpm install
pnpm run typecheck
pnpm run build           # dist/host/index.js + dist/client.js
pnpm test                # pretest 会先构建
pnpm run verify:bundle   # 惰性 factory、仅宿主 React、地标引用与插槽清理
```

`verify:bundle` 只证明产物体引用了 `HOST_LANDMARKS` 的选择器，不能证明宿主仍提供这些结构。可选活体检查不属默认门禁，须在验证记录中单独标明：

- **触摸回归**：需本地 Playwright/Chromium，用 `DSH_MOBILE_PLAYWRIGHT_MODULE` 与 `DSH_MOBILE_BROWSER_EXECUTABLE` 启用，在隔离页面运行真实 bundle。
- **页面探针**：连接已在运行的 Chrome CDP，报告或 `--verify` 验收：

```bash
node scripts/browser-probe.mjs http://127.0.0.1:9222 --viewport 390x844 --touch
node scripts/browser-probe.mjs http://127.0.0.1:9222 --viewport 390x844 --touch --verify --expect conversation
```

`--verify` 始终要求 root/AppFrame/sidebar/main/rightbar 锚点；其余地标只在 `--expect conversation|settings|tabs|table` 声明时要求。退出码 0 成功/报告，1 探针或验收失败，2 用法错误。

## License

[MIT](<LICENSE>)。