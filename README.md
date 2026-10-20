# dsh-plugins

DeepSeek Harness（DSH）插件集合。每个子目录是一个可独立装入 profile 的插件，互不依赖。

## 插件一览

| 目录 | 包名 | 版本 | 作用 | 形态 |
| --- | --- | --- | --- | --- |
| [pin-subagent-model](<pin-subagent-model/README.md>) | `dsh-plugin-pin-subagent-model` | 0.2.0 | 把每次委派的子 Agent 固定到指定 LLM 路由，不继承父 Agent 的实时路由 | Host 插件 bundle（纯 JS，无需构建） |
| [dsh-mobile](<dsh-mobile/README.md>) | `@local/dsh-mobile`（private） | 0.1.0 | 移动端布局与触控优化：侧栏抽屉、44px 触控目标、宽表格横滑、软键盘处理；桌面端不受影响 | Host + Web Client 双端插件，需构建 |
| [dsh-smartui](<dsh-smartui/README.md>) | `@local/dsh-smartui`（private） | 0.1.2 | ChatGPT 风格外观 + 对话内安全声明式组件（卡片/表格/图表/表单/选项） | Host + Web Client 双端插件，需构建 |

三者共用 `@deepseek-ai/cordis ~4.0.5`，均要求 Node.js ≥ 22。`dsh-mobile` 与 `dsh-smartui` 针对 DSH `0.2.1-rc.2`。

## 目录结构

```
dsh-plugins/
├── pin-subagent-model/     # 子 Agent 路由固定插件（bundle，无需构建）
│   ├── index.js            # 全部实现
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
└── dsh-smartui/
    ├── src/host/           # Host 侧：entry、工具注册、设置持久化
    ├── src/client/         # Client 侧：主题层、组件渲染、草稿填充
    ├── src/shared/         # 协议、校验、类型（两端共用）
    ├── scripts/            # build / verify-bundle / browser-probe
    ├── docs/               # 协议、兼容性、验证记录
    ├── examples/           # 三类 UI 文档示例（虚构数据）
    └── tests/
```

## 安装

两种插件都作为 bundle 装入现有 profile，可在 WebUI 的 **设置 → 插件** 里启用、关闭或移除；不启动第二个 Web 服务，也不修改已安装的 DSH 核心。

### pin-subagent-model

纯 JS，无需构建，直接链接检出目录（`--offline` 表示不从注册表补齐依赖）：

```bash
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/pin-subagent-model --offline
```

bundle 层只注册 entry `pin-subagent-model`，路由本身由 profile patch 提供（同一份包可服务任意路由）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: pin-subagent-model
  config:
    provider: cpa
    model: cline-pass/deepseek-v4.1-flash
    reasoningEffort: max
    providers: [spawn, fork]
    onConflict: override
```

未配置 `provider` / `model` 时插件仍保持启用，只记一条警告、不固定任何路由，所以先启用后配置不会破坏 profile。`patchReload: live` 下配置改动对下一次委派即生效。配置项、验证方法与取舍见 [插件文档](<pin-subagent-model/README.md>)。

首次安装（或更换 bundle 版本）后需要重启 dsh，新的 bundle 层才会参与组装；之后在插件页开关只重载 entry，不必重启。

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

## 开发约定

- Node.js ≥ 22，包管理器统一用 `pnpm`，不做全局安装。
- 所有安装、构建、类型检查、测试、打包与发布都需要针对当前任务单独授权；本机 release 构建交由 GitHub Actions。
- 获得授权后，命令均在对应子目录内执行：

```bash
# pin-subagent-model
node --test

# dsh-mobile / dsh-smartui
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run verify:bundle
```

`.agents/` 下存放本地专用技能（`dsh-compat-check`：DSH 升级或重装后核对插件与当前 dsh 的内部契约、跑插件单测并做一次活体委派验证），已被全局 gitignore 排除，不入库。

## License

MIT。`dsh-mobile` 与 `dsh-smartui` 目录下有完整 LICENSE；`pin-subagent-model` 的许可声明见其 `package.json`。
