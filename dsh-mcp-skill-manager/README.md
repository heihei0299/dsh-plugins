# @local/dsh-mcp-skill-manager

在 DSH Web 设置里增加 **MCP 与 Skill** 面板：按**项目目录**决定会话可以使用哪些宿主 MCP server 与 skill。没有配置策略的目录保持全部启用，因此插件默认不改变现有行为。

> 只管理**已经存在**的 MCP server 与 skill 的启用状态，不新增、编辑或删除 MCP 定义，不改写 profile 的 `cordis.patch.yml`，也不停止 MCP 进程。

## 它做什么

策略按目录匹配，子目录继承最近的项目策略；多个项目路径重叠时使用最长前缀。策略文件默认是 `$DSH_HOME/mcp-skill-manager.json`（通常是 `~/.dsh/mcp-skill-manager.json`），也可在插件配置里用绝对路径 `stateFile` 覆盖。

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

- `mcp.mode: "all"` / `skills.mode: "all"`：该目录下发现的所有条目都启用；以后新增的条目也自动启用。
- `"selected"`：只启用列出的名称。保存过但当前未发现的名称会保留在策略里，并在面板里标记为 stale，恢复后继续生效。
- 没有任何项目匹配当前工作目录：全部启用；插件不会因为策略文件不存在而关闭任何东西。
- 面板里的“全部/选择”是同一个策略的两种表达。在“全部”模式下取消勾选一个条目，会切换为“选择”，并保留其余当前已知条目。

## 执行语义

- **MCP 工具**：对未选中的宿主级 server，使用 agent 作用域的 `tools.restrict({ deny })` 隐藏 `mcp__<server>__*` 工具；同时安装 `tools.guard` 拒绝这些工具以及 `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource` 中指向未选中 server 的调用。
- **MCP instructions**：在 agent 作用域注册空的 `mcp:<server>` system-prompt section，遮蔽该 server 的全局 instructions；`mcp-resource-servers` section 只列出启用的 server。MCP server 进程本身不会被停止。
- **Skill**：在 agent 作用域注册同名 runtime skill stub，`invocation` 的 `modelInvocable` 与 `userInvocable` 都为 `false`，并标记 `source: "mcp-skill-manager"`。agent 作用域比 preset/global 更近，因此会遮蔽原 skill；重新启用时撤掉 stub。
- **应用时机**：每个 agent 创建时（以及工作目录变化后）计算一次；`agent/pre-step` 前刷新 skill stub。面板保存后，新策略在相关会话的下一个模型步骤生效。MCP 工具限制会立即更新。
- **失败关闭**：skill 目录刷新失败时保留上一次的 stub，不会因为刷新失败把已禁用的 skill 重新暴露；错误会显示在面板中。策略文件损坏时按空策略启动，面板显示解析错误，不会让 Host 崩溃。

## 使用

启用插件后刷新 WebUI，打开 **设置 → MCP 与 Skill**：

1. 在“项目”里输入绝对目录，或从工作区建议中选择，添加项目。
2. 分别设置 MCP server 与 skill 的“全部/选择”和勾选项。
3. 保存。面板会重新读取规范化后的策略，并显示无法应用或未发现的条目。
4. 需要撤销未保存的修改时点“放弃修改”；需要重读策略和目录时点“刷新”。

权限沿用原生 Connection：只有已认证的 owner 浏览器会话能读写这三个 `/api/mcp-skill-manager/*` 路由；插件不签发额外凭据，也不监听新端口。

## 安装（本仓库工作区）

要求 Node.js ≥22、DSH **`0.2.2-rc.1`**，包管理器使用 `pnpm`。插件依赖该版本的 agent 作用域 system prompt、skill 与 tool 限制接口；更早版本未验证，版本门禁会拒绝安装。

```bash
cd dsh-mcp-skill-manager
pnpm install
pnpm run build
dsh plugin --profile web add "link:$PWD" --offline
```

也可在插件管理器里选择本目录安装。`link:` 使用已经准备好的工作区和依赖；`--offline` 不从注册表补齐依赖。不要把别的构建产物复制进来绕过构建。

## 测试

```bash
# 仓库根目录
node scripts/check-bundles.mjs dsh-mcp-skill-manager

# 插件目录：构建后串行跑 Host / Client / bundle 测试
cd dsh-mcp-skill-manager
pnpm test
pnpm run verify:bundle
```

测试覆盖策略规范化与最长前缀匹配、配置文件的原子写入与损坏回退、工具限制与 guard、system-prompt 遮蔽、skill stub 的失败关闭、HTTP 路由的鉴权/大小限制、client 状态机和 SSR 渲染。bundle 测试在 `vm` 里执行 `dist/client.js`，不连接真实浏览器。

## 已知限制

- 当前只可靠隐藏**宿主级** MCP 工具。若某个 server 由 preset/agent 作用域注册，`tools.restrict` 无法把它从该作用域的工具目录里移除；guard 仍会拒绝调用，但工具描述可能仍对模型可见。
- 禁用 MCP 只影响模型可见的工具、instructions 和资源条目，不停止或卸载 profile 中的 MCP 进程；其他项目仍可使用同一进程。
- skill catalog 通过当前目录下活 agent 的 preset 作用域读取；没有活 agent 时使用默认 preset，再退回全局 provider。不同 preset 的可用 skill 集合可能不同，面板显示的是所选作用域的结果。
- 被 stub 遮蔽的 skill 如果从磁盘删除，而策略仍把它列为禁用，stub 可能作为不可调用的 stale 条目保留到策略变化或 agent 重建；重新启用同名 skill 会撤掉 stub。
- 目录存在性检查是尽力而为；保存时会对已存在路径做 `realpath` 规范化，但不会创建目录，也不会跟踪之后发生的符号链接变化。
- 未在真实多用户 DSH 部署上验证跨用户隔离；面板沿用当前 operator 的 Connection 权限，策略文件按当前进程用户写入（`0600`）。

## License

MIT，Copyright (c) 2026 dsh-plugins contributors。完整文本见 [LICENSE](LICENSE)。
