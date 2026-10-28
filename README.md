# dsh-plugins

DeepSeek Harness（DSH）插件集合。每个子目录是一个可独立装入 profile 的插件，互不依赖。

## 插件一览

| 目录 | 包名 | 版本 | 作用 | 形态 |
| --- | --- | --- | --- | --- |
| [pin-subagent-model](<pin-subagent-model/README.md>) | `dsh-plugin-pin-subagent-model` | 0.4.0 | 为指定子代理后端固定 LLM 路由和/或独立 Agent 预设；WebUI 可编辑常用字段，子会话输入框只读展示实际请求的模型与 effort | Host + Web Client 双端插件 bundle（纯 JS，无需构建） |
| [dsh-mobile](<dsh-mobile/README.md>) | `@local/dsh-mobile`（private） | 0.3.0 | 移动布局与触控优化：侧栏抽屉、横滑、顶部下拉加载历史、状态徽标、触屏行操作、设置面板及软键盘处理；默认 `auto` 不影响桌面，`on` 可强制启用 | Host + Web Client 双端插件，需构建 |
| [dsh-smartui](<dsh-smartui/README.md>) | `@local/dsh-smartui`（private） | 0.1.3 | ChatGPT 风格外观与对话内声明式 UI：八类叶节点（卡片、表格、图表、表单、选项、指标、进度、提示）及一层分组 | Host + Web Client 双端插件，需构建 |
| [dsh-lan-connect](<dsh-lan-connect/README.md>) | `@local/dsh-lan-connect`（private） | 0.1.0 | 在现有 Web 服务同一端口增加匿名 `/lan` 入口，复用原生信任检查与认证；分享链接和二维码不含 token | Host + Web Client 双端插件，仅需构建 client |
| [dsh-history-budget](<dsh-history-budget/README.md>) | `@local/dsh-history-budget`（private） | 0.2.0 | 以软字节预算裁剪会话首帧与历史页；被裁记录仍通过原生分页取回，超大记录或 turn 可能超预算 | 纯 Host 插件 bundle（纯 JS，无依赖，无需构建） |

前四者共用 `@deepseek-ai/cordis ~4.0.5`，`dsh-history-budget` 无运行时依赖；五者均要求 Node.js ≥ 22。`pin-subagent-model` 另以 `@deepseek-ai/schemastery ~3.18.5` 声明 Host 配置 schema；五个插件均针对 DSH `0.2.1-rc.2`。

## 目录结构

```
dsh-plugins/
├── pin-subagent-model/     # 子 Agent 路由/预设固定 + WebUI 行配置 + 输入框模型位只读显示（bundle，无需构建）
│   ├── index.js            # Host 侧：Config schema、路由与预设固定
│   ├── client.js           # Client 侧：只读 composer chip + plugins.row.config 配置页
│   ├── src/pin.js          # 配置归一化、能力判定与委派请求改写
│   ├── cordis.patch.yml    # bundle 层：插入 entry `pin-subagent-model`
│   ├── locale/             # 插件管理卡片的中英文标题与说明
│   ├── assets/icon.svg     # 插件管理卡片图标
│   ├── package.json
│   └── test/
├── dsh-mobile/
│   ├── src/host/           # Host 侧：只有设置 schema
│   ├── src/client/         # Client 侧：抽屉、状态徽标、下拉分页、焦点与设置
│   ├── src/shared/         # 设置解析、启用判定（两端共用）
│   ├── scripts/            # build / verify-bundle / browser-probe
│   └── tests/
├── dsh-smartui/
│   ├── src/host/           # Host 侧：entry、工具注册、设置持久化
│   ├── src/client/         # Client 侧：主题层、组件渲染、草稿填充
│   ├── src/shared/         # 协议、校验、类型（两端共用）
│   ├── scripts/            # build / verify-bundle / browser-probe
│   ├── docs/visual-demo.html # 已跟踪的独立视觉概念稿，非运行时组件
│   ├── examples/           # 看板、对比、图表、表单示例（虚构数据）
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

各插件都作为 bundle 装入现有 profile，可在 WebUI 的 **设置 → 插件** 里启用、关闭或移除；不启动第二个 Web 服务，也不修改已安装的 DSH 核心。下面的命令从本仓库根目录执行；安装会修改所选 profile，应先确认目标与授权。

### pin-subagent-model

纯 JS，无需构建，但 Host 侧需要 `@deepseek-ai/schemastery`（配置 schema 与 WebUI 表单）：先在插件目录安装依赖，再链接检出目录（`--offline` 表示不从注册表补齐依赖）：

```bash
pnpm --dir pin-subagent-model install --offline
dsh plugin --profile web add "link:$PWD/pin-subagent-model" --offline
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

从 Host-only 0.2.x 或没有配置页的 0.3.x 升级时，运行中的 dsh 可能缓存旧的客户端元数据或依赖图；按[插件升级说明](<pin-subagent-model/README.md>)准备依赖、重启**现有 dsh**并刷新现有页面。profile 使用 `patchReload: live` 时，后续启停可重载 entry；四个 volatile 字段保存后在下一次委派生效。此前的浏览器或委派验证是历史记录，不能代替对当前运行页面的验收，也不保证 HMR。

### dsh-mobile

需先构建产物，再装入 profile：

```bash
pnpm --dir dsh-mobile install
pnpm --dir dsh-mobile run build
dsh plugin --profile web add "link:$PWD/dsh-mobile" --offline
```

默认 `mode: auto` 只在宽度 ≤720px 或粗指针设备上启用；`mode: on` 可在桌面强制启用。开关与选项在 **设置 → 通用 → 移动端体验**。`mode: off` 撤销移动布局及监听，但不会取消已发起的历史分页请求；详细的在途请求与焦点边界见 [插件文档](<dsh-mobile/README.md>)。

### dsh-smartui

需先构建产物（`dist/host/index.js`、`dist/client.js`），再用插件管理器选择本地 bundle，或使用官方 CLI：

```bash
pnpm --dir dsh-smartui install
pnpm --dir dsh-smartui run build
dsh plugin --profile web add "link:$PWD/dsh-smartui" --offline
```

`link:` 使用已准备好的工作区与依赖，离线安装不会从注册表补齐缺失包。安装后刷新现有 DSH 页面；更换包代码可能需要 Host 重启。完整说明见 [插件文档](<dsh-smartui/README.md>)。

### dsh-lan-connect

需先安装依赖并构建 client（Host 侧是纯 ESM，不需要构建）：

```bash
pnpm --dir dsh-lan-connect install --ignore-scripts
pnpm --dir dsh-lan-connect run build
dsh plugin --profile web add "link:$PWD/dsh-lan-connect" --offline
```

插件复用现有 `webServer` 的监听地址和端口，新增固定 `GET /lan`；入口 URL 取自 `webApp.getAdvertisedUrl()`，支持已有代理/路径前缀，不硬编码端口，也不会另开服务、改监听或替换原生 Connection。浏览器打开 `/lan` 后，Host 先执行原生 Host/Origin 信任检查，再通过原生 `connection.authenticatedUrl()` 生成 303 跳转，最终由原生代码签发 `HttpOnly; SameSite=Strict` Cookie。**入口是匿名的：任何网络可达且通过原生信任检查的设备都能获得原生浏览器 operator 权限，只适用于可信网络。** 分享链接与本地二维码不含 token，但 303 的 `Location` 含原生 token，可能被浏览器或代理看到。

停用/卸载只撤销 `/lan` 与设置卡片，已经签发的原生 Cookie 不撤销；插件也不提供设备级撤销。明文 HTTP、对外入口与服务端监听不一致、多网卡候选都会在卡片中提示，插件不会自动改绑定或代理，也不探测候选地址连通性；建议先在路由器固定这台机器的 LAN IP。是否需要重启取决于 profile 的 reload 能力与已加载的客户端依赖，以插件管理器结果为准。完整语义与限制见 [插件文档](<dsh-lan-connect/README.md>)。

### dsh-history-budget

纯 ESM、无运行时依赖、无构建产物，`link:` 安装即可：

```bash
dsh plugin --profile web add "link:$PWD/dsh-history-budget" --offline
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

Host 半只在挂载期间替换存活 `sessionController` 的 `follow` 与 `page`：仅当 follow 的**第一帧**是含记录的 snapshot 时才尝试裁剪；历史页也按同一规则处理。只有实际丢弃记录时才置 `hasMore: true`，`cursor` / `projections` / `assistantStream` 保持不变，原生 `session/page` 可继续取回更早记录。预算按帧或页对象的 JSON UTF-8 字节计算，不含外层传输开销；它是**软上限**：最少保留条数、超大记录或 turn 对齐都可能超预算，而窗口内缺少 `turn/start` 时不能保证完整 turn。

当前版本不包含 Web Client 半：插件不合成点击、不写 `scrollTop`；若同时启用 `dsh-mobile`，其顶部下拉分页是独立的可选客户端功能。若从含客户端半边的旧版本升级，建议重启现有 dsh 并刷新页面，让 Loader 重新读取包清单。详见 [插件文档](<dsh-history-budget/README.md>)。

## 开发约定

- Node.js ≥ 22，包管理器统一用 `pnpm`，不做全局安装。
- 安装、运行时修改和发布应遵循当前任务授权及环境规则；普通本地检查按改动范围选择，不自动执行发布或远程写入。
- 依赖已准备好后，可在仓库根目录运行 `node scripts/verify-plugins.mjs`，或在命令后指定一个或多个插件目录名。该门禁先检查 bundle 元数据，再按插件执行类型检查、**先构建再测试**及需要的产物校验；它不安装依赖，也不代替 native 或真实浏览器检查。LAN 的常规测试已包含 bundle 测试，不再重复执行同一测试。
- 该门禁会覆盖所选插件的 `dist/`；如果工作区通过 `link:` 装入正在使用的 GUI，产物更新可能影响后续刷新或热更新。需要保持 GUI 不变时，应在隔离副本中执行。
- 也可在仓库根目录按插件选择检查（构建型插件需要事先安装好依赖）：

```bash
# pin-subagent-model（无需构建）
(cd pin-subagent-model && node --test --test-concurrency=1)
# 可选：把 /path/to/installed/dsh 换成实际安装根目录
DSH_TEST_RUNTIME_ROOT=/path/to/installed/dsh GOMAXPROCS=2 \
  node --test --test-concurrency=1 pin-subagent-model/test/native.test.js

# dsh-smartui（测试中的交付产物用例读取 dist）
pnpm --dir dsh-smartui run typecheck
pnpm --dir dsh-smartui run build
pnpm --dir dsh-smartui test
pnpm --dir dsh-smartui run verify:bundle

# dsh-mobile（test 的 pretest 会构建 dist）
pnpm --dir dsh-mobile run typecheck
pnpm --dir dsh-mobile test
pnpm --dir dsh-mobile run verify:bundle

# dsh-lan-connect（只构建 client；常规测试含 bundle 测试）
pnpm --dir dsh-lan-connect run build
pnpm --dir dsh-lan-connect test
# 可选：真实安装包的 native 集成（不创建网络监听）
DSH_TEST_RUNTIME_ROOT=/path/to/installed/dsh GOMAXPROCS=2 \
  node --test --test-concurrency=1 dsh-lan-connect/test/native.test.js

# dsh-history-budget（无依赖、无需构建）
pnpm --dir dsh-history-budget test
```

- 仓库没有统一 workspace 根；五个插件各自维护包清单和验证入口，构建与 probe 依插件能力而不同。历史 T9 调研决定不为少量脚本重复引入共享开发工具包；目前仍各自保留脚本。

`.agents/` 下存放本地专用技能（`dsh-compat-check`：DSH 升级或重装后核对插件与当前 dsh 的内部契约、跑插件单测并做一次活体委派验证），已被全局 gitignore 排除，不入库。

## 文档、依赖与验证策略

### docs 与 lockfile（方案 B：保持 de-track）

- `docs/*.md`、插件内的设计/验证记录与 `pnpm-lock.yaml` 保留在本地、不纳入 Git；`.gitignore` 忽略 `*.md`（README 除外）和 lockfile。关键契约写在各插件 README，插件分发不依赖本地 spec。
- 已跟踪的 [SmartUI 视觉概念稿](<dsh-smartui/docs/visual-demo.html>) 是独立 HTML 演示，不是运行时组件，也不打入插件包；它不改变上述 Markdown 文档的 de-track 约定。
- lockfile 可复现策略：各插件的 `engines.dsh` 精确声明 `0.2.1-rc.2`；mobile、SmartUI 和 LAN 包另声明 `packageManager`，其余包没有该字段。在保留 lockfile 的准备构建工作区用 `pnpm install --frozen-lockfile` 安装，再从该工作区构建/发布。干净检出按 `package.json` 的 semver 范围解析，不承诺字节级依赖复现；安装后必须重跑对应插件的完整门禁。发布工件只从已验证工作区构建，lockfile 随发布记录归档而不入 Git。
- 每次发布记录至少关联源码提交与工作树状态、实际 Node/pnpm/DSH 版本、各插件使用的 lockfile 原件及其 SHA-256、构建与验证日志，以及发布产物的 SHA-256。仓库目前没有受跟踪的 GitHub Actions 工作流；若外部工作流负责归档，应在发布记录中保留可追溯的运行信息，不能仅凭上述约定假定归档已经执行。

### 默认验证与可选活体检查

- 默认门禁全部离线、不启动浏览器：`typecheck` / `test` / `build` / `verify:bundle`（按上节各插件命令）；`dsh-mobile` 的 `pretest` 会先构建 `dist`。
- 可选活体检查单独记录，不能以默认测试替代：SmartUI 的真实页面样式单例/卡片/设置开关；`dsh-mobile` 的 390×844 触摸回归与页面探针；`dsh-lan-connect` 的真实 `/lan` 入口与 native 集成；`pin-subagent-model` 的插件页行配置、子代理 chip 与 fork 行为。需要已认证 GUI 或 Chrome CDP 而本轮不可用的项目，在验证记录中写“未验证”。

## License

MIT。`dsh-mobile`、`dsh-smartui` 与 `dsh-lan-connect` 目录下有完整 LICENSE；`dsh-lan-connect` 的 README 另含打包进 client 的 `qrcode-generator` 第三方 MIT 声明。`pin-subagent-model` 的许可声明见其 `package.json`。
