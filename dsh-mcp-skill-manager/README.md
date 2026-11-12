# @local/dsh-mcp-skill-manager

在 DSH Web 设置和 dsh-go App 里增加 **MCP 与 Skill** 面板：按**项目目录**决定会话可以使用哪些宿主 MCP server 与 skill。没有策略的目录保持全部启用，因此默认不改变现有行为；两端共用同一份策略文件。

只管理**已经存在**的条目：不新增、编辑或删除 MCP 定义，不改写 profile 的 `cordis.patch.yml`，也不停止 MCP 进程。

## 策略

按目录匹配，子目录继承最近的项目策略，重叠路径取最长前缀。策略文件默认 `$DSH_HOME/mcp-skill-manager.json`（通常 `~/.dsh/mcp-skill-manager.json`），可用绝对路径 `stateFile` 覆盖。

```json
{
  "version": 1,
  "projects": [
    {
      "path": "/home/me/work/app",
      "label": "app",
      "mcp": { "mode": "selected", "servers": ["rea"] },
      "skills": { "mode": "selected", "names": ["tdd", "diagnosing-bugs"] }
    }
  ]
}
```

- `mode: "all"` 启用该目录下所有已发现条目（含以后新增的）；`"selected"` 只启用列出的名称。
- 保存过但当前未发现的名称保留在策略里并标记为 stale，恢复后继续生效。
- 没有项目匹配当前工作目录时全部启用；策略文件不存在不会关闭任何东西。

## 执行语义

- **MCP 工具**：用 agent 作用域的 `tools.restrict({ deny })` 隐藏未选中 server 的 `mcp__<server>__*`，并用 `tools.guard` 拒绝这些工具及指向它们的 `list_mcp_resources` 等调用。
- **MCP instructions**：在 agent 作用域注册空的 `mcp:<server>` system-prompt section 遮蔽全局 instructions；`mcp-resource-servers` 只列启用的 server。MCP 进程不停止。
- **Skill**：在 agent 作用域注册同名 runtime stub（`modelInvocable`/`userInvocable` 均为 false，标记 `source: "mcp-skill-manager"`），比 preset/global 更近，因此遮蔽原 skill；重新启用时撤掉。
- **时机**：每个 agent 创建时（及工作目录变化后）计算一次，`agent/pre-step` 前刷新 skill stub；面板保存后下一个模型步骤生效。
- **失败关闭**：skill 目录刷新失败保留上一次的 stub；策略文件损坏时按空策略启动并在面板显示解析错误，Host 不崩溃。

## 使用

开启插件后刷新 WebUI，打开 **设置 → MCP 与 Skill**：添加项目（绝对路径或工作区建议）→ 分别设置 MCP/skill 的“全部/选择”与勾选 → 保存。需要撤销时点“放弃修改”，重读时点“刷新”。

权限沿用原生 Connection：只有已认证的 owner 浏览器会话能读写 `/api/mcp-skill-manager/*`；不签发额外凭据，不监听新端口。

## dsh-go 原生面板

dsh-go 在会话页签与功能页显示同一面板，并在输入框加号工具里提供入口（`composer.actions` 胶囊与 `composer.tools` 加号指向同一个 `policy` 面板）。原生端只渲染声明式视图，策略计算与保存在 Host 完成：可增删项目、切换模式与勾选、移除 stale 名称、刷新目录扫描。

入口只在具备原生 bridge 的本地引擎出现；SSH、relay 等没有 bridge 的 Host 仍只用 Web 面板。旧版 App 不支持 v2 表单组件时退回 v1 视图（新增项目需在 Web 面板完成）。

本仓库只在 dsh-go 的 SDK checker 与单测中验证原生视图，未连接真实 Android 设备做端到端验收。

## 安装

要求 Node ≥22、DSH **`0.2.2-rc.1`** 或 **`0.2.2-rc.2`** 与 pnpm；更早版本未验证，门禁会拒绝安装。

```bash
cd dsh-mcp-skill-manager
pnpm install && pnpm run build
dsh plugin --profile web add "link:$PWD" --offline
```

也可在插件管理器里选择本目录安装。`link:` 使用已准备好的工作区与依赖，`--offline` 不从注册表补齐；不要复制别人的构建产物。

## 测试

```bash
node scripts/check-bundles.mjs dsh-mcp-skill-manager   # 仓库根目录
cd dsh-mcp-skill-manager && pnpm test && pnpm run verify:bundle
```

覆盖策略规范化与最长前缀匹配、原子写入与损坏回退、工具限制与 guard、prompt 遮蔽、stub 失败关闭、HTTP 路由鉴权、client 状态机与 SSR、dsh-go manifest 与面板动作。bundle 测试在 `vm` 里执行 `dist/client.js`，不连接浏览器。

## 已知限制

- 只可靠隐藏**宿主级** MCP 工具；preset/agent 作用域注册的 server 仍可能出现在该作用域的工具目录里，guard 会拒绝调用但描述可见。
- 禁用 MCP 不影响进程与其他项目；skill catalog 按当前活 agent 的 preset 作用域读取，无活 agent 时回落默认 preset 再回落全局。
- 被 stub 遮蔽的 skill 若从磁盘删除且策略仍列为禁用，stub 可能保留到策略变化或 agent 重建。
- 目录存在性检查是尽力而为：保存时 `realpath` 规范化，不创建目录、不跟踪之后的符号链接变化。
- 未验证多用户部署的跨用户隔离；策略文件按进程用户以 `0600` 写入。

## License

MIT，Copyright (c) 2026 dsh-plugins contributors。完整文本见 [LICENSE](LICENSE)。
