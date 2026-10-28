# dsh-plugins

DeepSeek Harness（DSH）插件集合。五个插件可独立装入 profile，不修改 DSH 核心或启动第二个 Web 服务。要求 Node.js ≥22，目标 DSH 版本为 `0.2.1-rc.2`。

## 插件

| 插件 | 版本 | 作用 | 构建 |
| --- | --- | --- | --- |
| [pin-subagent-model](<pin-subagent-model/README.md>) | 0.4.0 | 固定子代理路由和/或独立预设，并只读展示实际请求的模型 | 无需构建，需安装 Host 依赖 |
| [dsh-mobile](<dsh-mobile/README.md>) | 0.3.0 | 抽屉、触屏操作、状态徽标、下拉加载历史和软键盘适配 | Host + Client |
| [dsh-smartui](<dsh-smartui/README.md>) | 0.1.3 | 主题与安全声明式卡片、表格、图表、表单及分组 | Host + Client |
| [dsh-lan-connect](<dsh-lan-connect/README.md>) | 0.1.0 | 同端口 `/lan` 自动登录入口和本地二维码 | 仅 Client |
| [dsh-history-budget](<dsh-history-budget/README.md>) | 0.2.0 | 按字节软预算裁剪会话首帧与历史页 | 纯 Host，无依赖 |

前四者声明 `@deepseek-ai/cordis ~4.0.5`；各插件的配置、兼容限制和验证命令见对应 README。

## 安装

从仓库根目录按需准备**要安装的插件**，然后链接现有 profile。安装会修改选定的 profile；确认目标和授权后再执行。离线安装不会补齐本地缺失的依赖。

| 插件 | 准备命令 |
| --- | --- |
| `pin-subagent-model` | `pnpm --dir pin-subagent-model install --offline` |
| `dsh-mobile` | `pnpm --dir dsh-mobile install`，然后 `pnpm --dir dsh-mobile run build` |
| `dsh-smartui` | `pnpm --dir dsh-smartui install`，然后 `pnpm --dir dsh-smartui run build` |
| `dsh-lan-connect` | `pnpm --dir dsh-lan-connect install --ignore-scripts`，然后 `pnpm --dir dsh-lan-connect run build` |
| `dsh-history-budget` | 无需准备 |

例如安装 mobile：

```bash
dsh plugin --profile web add "link:$PWD/dsh-mobile" --offline
```

安装后可在 WebUI **设置 → 插件**中启停。是否需要重启取决于 profile 和已加载的客户端元数据；按插件管理器提示操作并刷新现有页面。更换客户端包后不要仅凭构建成功断言当前页面已更新。

## 使用边界

- **LAN 安全**：网络可达且通过原生 Host/Origin 信任检查的设备可通过匿名 `/lan` 获得 operator 权限，只适用于可信网络。分享链接和二维码不含 token，但 303 登录跳转会携带可复用的进程 token；禁用插件不会撤销已签发的 Cookie。
- **移动端**：默认 `mode: auto` 在宽度 ≤720px 或粗指针时启用；`mode: on` 可强制应用于桌面。关闭移动层不取消已发起的历史分页。
- **历史预算**：记录、最少保留数及 turn 对齐可能使帧超出预算；被裁记录仍由原生分页取回。`dsh-mobile` 的下拉分页是独立功能。
- **子代理**：预设只适用于支持独立组合的后端；fork 仍继承父预设。固定路由/预设与工具白名单的优先级见插件 README。

## 开发与验证

依赖准备好后，从仓库根目录执行：

```bash
node scripts/check-bundles.mjs                 # 只检查 bundle 元数据
node scripts/verify-plugins.mjs dsh-mobile     # 可指定一个或多个插件；省略则检查全部
```

完整门禁会构建所选插件并覆盖其 `dist/`；若 GUI 通过 `link:` 使用该工作区，后续刷新可能加载新产物。按各插件 README 可执行更窄的测试。单测与 bundle 检查不能代替已登录 GUI、真实设备或 LAN 端到端验收。

`docs/*.md` 与 lockfile 按仓库约定保留在本地、不纳入 Git；可分发契约写在各插件 README。[SmartUI 视觉概念稿](<dsh-smartui/docs/visual-demo.html>)是已跟踪的独立演示，不随插件包分发，也不是运行时验收。构建或发布应保留所用 lockfile、版本和验证记录。

## 许可

各插件为 MIT；LAN 插件随包包含 `qrcode-generator` 的第三方 MIT 许可，详见[插件 README](<dsh-lan-connect/README.md>)。
