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

**设置 → 通用 → 移动端体验**（Host 持久化，`dsh-mobile` 命名空间，三项都是 `volatile()`，改完即时生效）：

| 字段 | 默认 | 作用 |
|---|---|---|
| `mode` | `auto` | `auto` 在「宽度 ≤720px 或粗指针」时启用；`on` 始终；`off` 完全关闭 |
| `drawerNavigation` | `true` | 竖轨改为抽屉 + 浮动开关按钮 |
| `comfortableTargets` | `true` | 输入区、底部统计详情与消息操作按钮的触摸区域升到 44px |

`off` 是**硬关闭**：根属性、样式表、viewport meta、监听器全部撤销，回到原生布局。首次加载 Host 设置之前不应用任何规则，避免半套布局。

## 边界与已知限制

- **依赖宿主 DOM 地标**，不依赖哈希类名。全部集中在 [`src/client/landmarks.ts`](<src/client/landmarks.ts>)，并由两道机械检查守护（构建产物断言 + `dsh-compat-check`）。地标缺失时样式自然不命中，插件退化为「只是多一个按钮」，不抛异常。
- **设置面板依赖宿主的设置对话框标记**：`[data-shortcut-modal="settings"]`、它下面的 `nav` / 内容两级子节点，以及分区 slot `[data-slot="settings.section"]`。列表行头按 `li > div:first-child` 结构匹配，不依赖提供商文案或哈希类名；宿主改名或改结构时对应规则不命中，面板退回宿主布局（不抛错），构建断言会先提示。设置页不额外补偿软键盘，沿用宿主 options 滚动容器。
- **抽屉状态是宿主自己的**。插件只调用公开的 `ctx.layout.toggleSidebar()`，并读宿主写在帧上的 `data-sidebar-collapsed`，不另存一份状态。
- **抽屉使用宿主的滑动时长与缓动**，遮罩按相同时长淡出，退出完成前仍拦截触摸；关闭过程中的重复遮罩点击不会重新打开抽屉。开关抽屉及不影响启用状态的窗口缩放，不重装样式、viewport 或键盘监听。
- **抽屉具有模态焦点管理**：进入时聚焦内部控件，Tab 在抽屉内循环，Esc 关闭，退出时恢复焦点；宿主菜单/弹窗优先处理自己的键盘与焦点。会话主视图或全局面板成功切换后收起，不因展开分组或无关列表更新收起；没有对话头部的全局面板保留底角导航按钮，避免收起后失去入口。
- **键盘补偿保留页面缩放**：页面放大时不把可视视口缩小误认成键盘；视口事件按帧合并，仅补偿值变化时写入。输入框的 16px 规则覆盖实际 contenteditable 编辑器，宽表格允许双指缩放。
- **View 标签（对话/轨迹）不放大**。实测把它们升到 44px 会让头部从 76px 涨到 95px——用 19px 常驻阅读空间换很少点的两个标签，不划算。
- **状态徽标折叠成图标 + 数字**。宿主的「3 个子智能体」「1 个后台任务」各占约 100px，插件在自己的插槽条目里渲染机器人/层叠图标与计数（运行中小圆点，≥10 显示 `9+`），点击在**该图标正下方**展开锚定浮层，子智能体可跳转。
  - 浮层是 `popover="manual"` 元素，由浏览器放在**顶层（top layer）**：头部 `overflow:hidden` 与 `container-type:inline-size` 都裁不到它；默认距图标 8px、距屏幕边缘至少 12px，右缘跟随图标，宽 ≤360px、高 ≤440px，空间不足时只在「上方确实更宽裕」才上翻，其余情况列表独立滚动。
  - **不是底部面板、不是模态**：没有全屏遮罩、没有 `::backdrop`、没有整页变暗，`aria-modal="false"`；浮层外的页面照常可点。行内名称完整换行，状态与进度各占一行；后台任务为只读状态条目，不伪装成可点击按钮。
  - 关闭方式：右上 32px 关闭按钮（44px 命中区）、再点同一个图标收起、点另一个图标直接切换、点浮层外、Esc、焦点移出、切换会话或插件关闭；关闭后焦点回到触发图标。打开时焦点进入关闭按钮，Tab 可进入列表做键盘滚动。
  - 数据分别来自 `sessions.list` 的 `subagentCatalog` 投影与 `ctx.jobs` 的任务名册；后台任务名册需要 `watchRows` 订阅。
  - 子智能体跳转使用显式注入的 `uiWorkspace.openSession`；Cordis 对未声明的服务会抛错，不能用可选链跳过依赖声明。
  - **宿主徽标只在同类替代徽标渲染时才隐藏**：插件把覆盖的类别写在插槽的 `data-dsh-mobile-badges` 上，样式据此隐藏对应宿主控件；投影读不到时该类别不隐藏，回退到宿主原控件而不是什么都不显示。
  - 隐藏依靠 `aria-label` 文案匹配（中英文），宿主改文案会导致两套徽标同时出现——这是可见降级，不是静默失效。
- **头部只改横向内边距与标签行底部 6px**（20/28px → 12px）。改 `min-height` 反而让两行头部更高。
- 390×844 实测头部：原始 90px，本插件 83.5px（32px 抽屉按钮 + 6px 标签行留白）。
- **抽屉宽度取 `min(86vw, 320px)`**，不使用宿主拖拽出的宽度偏好。
- **不改**右侧面板策略、PWA/安装、手势导航、主题色；除状态徽标外不替换宿主槽位内容。
- iOS 旧版本对 `interactive-widget` 无支持，靠 `visualViewport` 内边距兜底；软键盘行为最终仍需真机确认。

## 开发

```bash
pnpm install
pnpm run typecheck
pnpm run build           # dist/host/index.js + dist/client.js
pnpm test                # pretest 会先构建；回归用例串行
pnpm run verify:bundle   # 惰性 factory、仅宿主 React、地标契约、注册与清理
```

默认门禁是 typecheck、build、Node 测试和 bundle 校验，全部离线、不启动浏览器；干净检出可直接 `pnpm test`（`pretest` 先构建 `dist`）。可选活体检查不属于默认门禁：触摸回归需要本地 Playwright 与 Chromium，用 `DSH_MOBILE_PLAYWRIGHT_MODULE`（模块绝对路径）和 `DSH_MOBILE_BROWSER_EXECUTABLE`（浏览器绝对路径）启用；页面探针需要已运行的 Chrome CDP。两者都应在验证记录中单独标明执行或未执行，不能把 Node 测试当作真机/GUI 验收。

触摸回归在隔离页面运行真实插件 bundle，验证服务声明、子智能体菜单点击和底部按钮的触摸命中与关闭插件后的还原；不连接用户会话、不代表登录态 GUI 的端到端验收。

只读页面探针（连**已在运行**的 Chrome CDP，不启动浏览器、不读凭据、量完自动还原视口）：

```bash
node scripts/browser-probe.mjs http://127.0.0.1:9222 --viewport 390x844 --touch
```

产物是 DSH Host ESM + `window.__ModuleLoader__` 惰性 Client factory；React 从宿主模块表取。Client 不运行时 import 任何 DSH Client 内部包。

所有构建、测试与安装都需要针对当前任务单独授权。

## License

[MIT](<LICENSE>)。
