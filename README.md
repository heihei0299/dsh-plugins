# dsh-plugins

DeepSeek Harness（DSH）插件集合。每个子目录是一个可独立装入 profile 的插件，互不依赖。

## 插件一览

| 目录 | 包名 | 版本 | 作用 | 形态 |
| --- | --- | --- | --- | --- |
| [pin-subagent-model](<pin-subagent-model/README.md>) | `dsh-plugin-pin-subagent-model` | 0.4.0 | 把每次委派的子 Agent 固定到指定 LLM 路由，并可选地直接指定其 Agent 预设，不继承父 Agent 的实时路由与组合；路由与预设可在插件页的行配置中修改，子代理会话输入框仍只读显示实际请求的模型短名与 effort | Host + Web Client 双端插件 bundle（纯 JS，无需构建） |
| [dsh-mobile](<dsh-mobile/README.md>) | `@local/dsh-mobile`（private） | 0.2.0 | 移动端布局与触控优化：侧栏抽屉、横滑开关抽屉、会话行操作触屏可达、设置面板重排、44px 触控目标、宽表格横滑、软键盘与进入会话不弹键盘；桌面端不受影响 | Host + Web Client 双端插件，需构建 |
| [dsh-smartui](<dsh-smartui/README.md>) | `@local/dsh-smartui`（private） | 0.1.3 | ChatGPT 风格外观 + 对话内安全声明式组件（卡片/表格/图表/表单/选项） | Host + Web Client 双端插件，需构建 |
| [dsh-lan-connect](<dsh-lan-connect/README.md>) | `@local/dsh-lan-connect`（private） | 0.1.0 | 在现有 Web 服务的同一端口增加固定 `/lan` 入口，让局域网设备用原生认证登录；链接与二维码不含 token | Host + Web Client 双端插件，仅需构建 client |
| [dsh-history-budget](<dsh-history-budget/README.md>) | `@local/dsh-history-budget`（private） | 0.1.0 | 按编码字节预算裁剪会话首帧与历史页，长 goal 回合或大工具输出不再整帧几 MB；被裁掉的记录仍由原生「加载更早」取回 | Host-only 插件 bundle（纯 JS，无依赖，无需构建） |

前四者共用 `@deepseek-ai/cordis ~4.0.5`，`dsh-history-budget` 无运行时依赖；五者均要求 Node.js ≥ 22。`pin-subagent-model` 另以 `@deepseek-ai/schemastery ~3.18.5` 声明 Host 配置 schema；五个插件均针对 DSH `0.2.1-rc.2`。

## 目录结构

```
dsh-plugins/
├── pin-subagent-model/     # 子 Agent 路由/预设固定 + WebUI 行配置 + 输入框模型位只读显示（bundle，无需构建）
│   ├── index.js            # Host 侧：Config schema、路由与预设固定
│   ├── client.js           # Client 侧：只读 composer chip + plugins.row.config 配置页
│   ├── cordis.patch.yml    # bundle 层：插入 entry `pin-subagent-model`
│   ├── locale/             # 插件管理卡片的中英文标题与说明
│   ├── assets/icon.svg     # 插件管理卡片图标
│   ├── package.json
│   └── test/
├── dsh-mobile/
│   ├── src/host/           # Host 侧：只有设置 schema
│   ├── src/client/         # Client 侧：地标、样式、抽屉、键盘、设置行
│   ├── src/shared/         # 设置解析、启用判定（两端共用）
│   ├── scripts/            # build / verify-bundle / browser-probe
│   └── tests/
├── dsh-smartui/
│   ├── src/host/           # Host 侧：entry、工具注册、设置持久化
│   ├── src/client/         # Client 侧：主题层、组件渲染、草稿填充
│   ├── src/shared/         # 协议、校验、类型（两端共用）
│   ├── scripts/            # build / verify-bundle / browser-probe
│   ├── docs/               # 协议、兼容性、验证记录
│   ├── examples/           # 三类 UI 文档示例（虚构数据）
│   └── tests/
├── dsh-lan-connect/
│   ├── index.js            # Host 侧：同端口 /lan 入口与 boot 元数据
│   ├── src/client.js       # Client 侧：设置卡片、复制、本地二维码
│   ├── scripts/build.mjs   # 只构建 dist/client.js
│   ├── locale/             # 插件管理卡片与卡片 UI 的中英文
│   ├── assets/icon.svg
│   └── test/               # Host / Client / bundle / 原生内存集成
└── dsh-history-budget/
    ├── index.js            # Host 侧：替换 follow/page，按字节预算裁剪
    ├── src/budget.js       # 纯函数：保留最新的、能放进预算的记录后缀
    ├── cordis.patch.yml    # bundle 层：插入 entry `history-budget`
    ├── locale/             # 插件管理卡片的中英文标题与说明
    ├── assets/icon.svg
    └── test/               # 裁剪算术、页面形状、幂等、恢复、bundle 契约
```

## 安装

各插件都作为 bundle 装入现有 profile，可在 WebUI 的 **设置 → 插件** 里启用、关闭或移除；不启动第二个 Web 服务，也不修改已安装的 DSH 核心。

### pin-subagent-model

纯 JS，无需构建，但 Host 侧需要 `@deepseek-ai/schemastery`（配置 schema 与 WebUI 表单）：先在插件目录安装依赖，再链接检出目录（`--offline` 表示不从注册表补齐依赖）：

```bash
cd /home/shial/Project/dsh-plugins/pin-subagent-model && pnpm install --offline
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/pin-subagent-model --offline
```

bundle 层只注册 entry `pin-subagent-model`，路由与预设本身由 profile patch 提供（同一份包可服务任意路由）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: pin-subagent-model
  config:
    provider: cpa
    model: cline-pass/deepseek-v4.1-flash
    reasoningEffort: max
    agentPreset: standard      # 可选；空 = 继续继承父会话预设
    providers: [spawn, fork]
    onConflict: override
```

`provider`、`model`、`reasoningEffort`、`agentPreset` 是 volatile 字段，也可在 **插件页 → `dsh-plugin-pin-subagent-model` → 行 `pin-subagent-model` → 配置** 里修改：保存写回 profile patch，下一次委派即生效，无需改 YAML 或重启；`providers`、`onConflict` 仍是 ordinary 字段，只在 YAML 里配置。预设只会注入支持独立预设选择的后端（spawn），fork 继续继承父预设。

未配置 `provider`/`model` 与 `agentPreset` 时插件仍保持启用，只记一条警告、不固定任何路由或预设，所以先启用后配置不会破坏 profile；装饰仍在，之后从 YAML 或 WebUI 写入的配置对下一次委派生效。配置项、WebUI 入口、验证方法与取舍见 [插件文档](<pin-subagent-model/README.md>)。

首次安装（或更换 bundle 版本）后需要重启 dsh，新的 bundle 层才会参与组装；之后在插件页开关只重载 entry，不必重启。

0.3.0 起该插件增加 Web Client 半（子代理会话的只读 provider/model chip）。从 Host-only 0.2.x 升级时，运行中的 dsh 会按 Loader specifier/baseURL 缓存包元数据（包括“不是 client”的负结论），必须**重启一次现有 dsh，再刷新现有页面**，新 client 才会被发现。

0.3.1 将 chip 从标题栏移到输入框模型位旁：注册 additive 的 `conversation.input.right` 列表项，父会话该项返回 null，原生 `conversation.input.model` 单选模型选择器完全不变；任何渲染原生 composer 的位置都可使用该项，原生输入区被隐藏时该项也随之隐藏。升级客户端 bundle 后需刷新现有页面，若仍加载旧 bundle 则重启一次。本仓库没有前端 dev watcher，不保证 HMR。验证：纯 JS 单测，以及现有本地 Chrome CDP 的 390x844 窄屏主会话检查（非真实手机）：模型标识位于输入框、标题栏无模型标识，触摸父级面包屑可返回主会话，再从原生目录打开测试子会话；父会话原生模型选择器保留，均无横向溢出或 slot 错误。侧栏嵌入面板未单独实测；原局域网 GUI URL 匿名返回 401，未绕认证。

0.4.0 增加 Host `Config` schema、`agentPreset` 固定与 WebUI 行配置页（`plugins.row.config`），client 依赖图新增 `dsh-client-ui-plugin-manager`、`dsh-api-remotes` 与 `dsh-client-ui-settings`。升级时先在插件目录 `pnpm install`，替换包后**重启一次 dsh 并刷新现有页面**，再打开插件页的行配置；之后的配置改动都是 volatile 热更新，不需要重启。本次只完成单元测试与静态门禁，WebUI 活体验证需要重启窗口，尚未执行。

### dsh-mobile

需先构建产物，再装入 profile：

```bash
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/dsh-mobile --offline
```

默认 `mode: auto`，只在宽度 ≤720px 或粗指针设备上生效，桌面端不命中任何规则。开关与选项在 **设置 → 通用 → 移动端体验**，`mode: off` 会完整撤销所有注入。详见 [插件文档](<dsh-mobile/README.md>)。

### dsh-smartui

需先构建产物（`dist/host/index.js`、`dist/client.js`），再用插件管理器选择本地 bundle，或使用官方 CLI：

```bash
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/dsh-smartui --offline
```

`link:` 使用已准备好的工作区与依赖，离线安装不会从注册表补齐缺失包。安装后刷新现有 DSH 页面；更换包代码可能需要 Host 重启。完整说明见 [插件文档](<dsh-smartui/README.md>)。

### dsh-lan-connect

需先安装依赖并构建 client（Host 侧是纯 ESM，不需要构建）：

```bash
cd /home/shial/Project/dsh-plugins/dsh-lan-connect
pnpm install --ignore-scripts
pnpm run build
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/dsh-lan-connect --offline
```

插件复用现有 `webServer` 的监听地址和端口，新增固定 `GET /lan`；入口 URL 取自 `webApp.getAdvertisedUrl()`，因此支持已有代理/路径前缀，不硬编码端口，也不会另开服务、改监听或替换原生 Connection。浏览器打开 `/lan` 后，Host 先执行原生 Host/Origin 信任检查，再用该对外根与原生 `connection.authenticatedUrl()` 做一次 303，最终由原生代码签发 `HttpOnly; SameSite=Strict` Cookie。**入口是匿名的：任何能访问 `/lan` 的设备都会获得原生浏览器 operator 权限。** 设置卡片里的入口链接和本地二维码不含 token。

停用/卸载只撤销 `/lan` 与设置卡片，已经签发的原生 Cookie 不撤销；插件也不提供设备级撤销。明文 HTTP、对外入口与服务端监听不一致、多网卡候选都会在卡片中提示，插件不会自动改绑定或代理，也不探测候选地址连通性；建议先在路由器固定这台机器的 LAN IP。`patchReload: live` 下本次安装无需重启即生效；HMR 不可用或包解析被拒绝时仍可能需要重启，以插件管理器结果为准。完整语义与限制见 [插件文档](<dsh-lan-connect/README.md>)。

### dsh-history-budget

纯 ESM、无运行时依赖、无构建产物，`link:` 安装即可：

```bash
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/dsh-history-budget --offline
```

bundle 层只注册 entry `history-budget`，预算由 profile 配置提供（默认 512 KiB）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: history-budget
  config:
    maxBytes: 524288    # 单帧/单页编码字节预算
    minRecords: 1       # 单条记录超过预算时也至少保留的最新条数
    log: false          # 每次裁剪输出一行诊断
```

它只在挂载期间替换存活 `sessionController` 的 `follow` 与 `page`：首帧保留最新的、能放进预算的记录后缀并置 `hasMore: true`，`cursor` / `projections` / `assistantStream` 不动，WebUI 的「加载更早」仍从原生 `session/page` 取回被裁记录，客户端无需改动。单条记录超过预算时仍整条发出，不截断内容。详见 [插件文档](<dsh-history-budget/README.md>)。

## 开发约定

- Node.js ≥ 22，包管理器统一用 `pnpm`，不做全局安装。
- 所有安装、构建、类型检查、测试、打包与发布都需要针对当前任务单独授权；本机 release 构建交由 GitHub Actions。
- 获得授权且各插件依赖已准备好后，可在仓库根目录运行 `node scripts/verify-plugins.mjs`，或在命令后指定一个或多个插件目录名。该门禁先检查 bundle 元数据，再按插件执行类型检查、**先构建再测试**及需要的产物校验；它不安装依赖，也不代替 native 或真实浏览器检查。LAN 的常规测试已包含 bundle 测试，不再重复执行同一测试。
- 该门禁会覆盖所选插件的 `dist/`；如果工作区通过 `link:` 装入正在使用的 GUI，产物更新可能影响后续刷新或热更新。需要保持 GUI 不变时，应在隔离副本中执行。
- 也可以获得授权后在对应子目录单独执行：

```bash
# pin-subagent-model（无需构建）
pnpm install --offline
node --test --test-concurrency=1
# 可选：已安装 dsh 的 Cordis/SubagentRuntime 契约测试
DSH_TEST_RUNTIME_ROOT=/home/shial/.local/share/fnm/node-versions/v24.16.0/installation/lib/node_modules/@deepseek-ai/dsh \
  GOMAXPROCS=2 node --test --test-concurrency=1 test/native.test.js

# dsh-smartui
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
pnpm run verify:bundle

# dsh-mobile（先 build，bundle 测试读取 dist；pretest 也会自动构建）
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
pnpm run verify:bundle

# dsh-lan-connect（Host + Client；构建只产出 dist/client.js）
pnpm install --ignore-scripts
pnpm run build
pnpm test
pnpm run verify:bundle
# 可选：真实安装包的 native 集成（不创建网络监听）
DSH_TEST_RUNTIME_ROOT=/home/shial/.local/share/fnm/node-versions/v24.16.0/installation/lib/node_modules/@deepseek-ai/dsh \
  GOMAXPROCS=2 node --test --test-concurrency=1 test/native.test.js
```

- 不建立共享开发工具包（2026-10-24 T9 spike 结论）：仓库没有 workspace 根，四个插件各自以 `link:` 和独立 lockfile 安装；构建包装的重复约 40 行，而引入第五个包会增加 `file:` devDependency、离线安装和发布文件清单三条链。verify/probe 已按插件差异分叉（smartui 样式标签、mobile 地标派生、lan 的 node:test），统一模板会把差异藏进配置分支，收益不足。各自保留脚本，命令约定保持一致。

`.agents/` 下存放本地专用技能（`dsh-compat-check`：DSH 升级或重装后核对插件与当前 dsh 的内部契约、跑插件单测并做一次活体委派验证），已被全局 gitignore 排除，不入库。

## 文档、依赖与验证策略

### docs 与 lockfile（方案 B：保持 de-track）

- `docs/*.md`、插件内的设计/验证记录与 `pnpm-lock.yaml` 不纳入 git；文件保留在本地，`.gitignore` 继续忽略 `*.md`（README 除外）和 lockfile。仓库只分发插件源码、测试与 README。
- 关键契约与决策压缩在各插件 README；代码与 README 不再引用不存在的 `docs/` 路径（`dsh-mobile` 的 contracts 已改指 README）。SmartUI 的 `docs/` 与 `HANDOFF.md` 是本地记录，README 已注明其非分发属性。
- lockfile 可复现策略：DSH 版本由 `engines.dsh` 精确钉住（当前 `0.2.1-rc.2`），包管理器由 `packageManager` 钉住；在保留 lockfile 的准备构建工作区用 `pnpm install --frozen-lockfile` 安装，再从该工作区构建/发布。干净检出按 `package.json` 的 semver 范围解析，不承诺字节级依赖复现；安装后必须重跑对应插件的完整门禁。发布工件只从已验证工作区构建，lockfile 随发布记录归档而不入 git。
- 每次发布记录至少关联源码提交与工作树状态、实际 Node/pnpm/DSH 版本、各插件使用的 lockfile 原件及其 SHA-256、构建与验证日志，以及发布产物的 SHA-256。仓库目前没有受跟踪的 GitHub Actions 工作流；若外部工作流负责归档，应在发布记录中保留可追溯的运行信息，不能仅凭上述约定假定归档已经执行。

### 默认验证与可选活体检查

- 默认门禁全部离线、不启动浏览器：`typecheck` / `test` / `build` / `verify:bundle`（按上节各插件命令）；`dsh-mobile` 的 `pretest` 会先构建 `dist`。
- 可选活体检查单独记录，不能以默认测试替代：SmartUI 的真实页面样式单例/卡片/设置开关；`dsh-mobile` 的 390×844 触摸回归与页面探针；`dsh-lan-connect` 的真实 `/lan` 入口与 native 集成；`pin-subagent-model` 的插件页行配置、子代理 chip 与 fork 行为。需要已认证 GUI 或 Chrome CDP 而本轮不可用的项目，在验证记录中写“未验证”。

## License

MIT。`dsh-mobile`、`dsh-smartui` 与 `dsh-lan-connect` 目录下有完整 LICENSE；`dsh-lan-connect` 的 README 另含打包进 client 的 `qrcode-generator` 第三方 MIT 声明。`pin-subagent-model` 的许可声明见其 `package.json`。
