# dsh-history-budget

把 Web 客户端打开会话时收到的**首帧**和历史页按编码字节裁剪，而不是只按消息条数。

纯 JS、无依赖、无需构建的**纯 Host 插件**：挂载期间替换存活 `sessionController` 服务的 `follow` 与 `page` 方法（`page` 不是函数时只包装 `follow`）。卸载时本次包装失活，属性仍由本插件持有时恢复原属性；后装的包装器不会被覆盖。**没有客户端半边**：不改滚动、分页器或任何 DOM，不读会话日志，不改网关，也不碰会话存储。

## 它解决什么

官方分页只数消息条数（`maxMessages` 服务端默认 50，Web 客户端固定传 500）。长 goal 回合或一次超大工具输出会把单帧撑到几 MB。`dsh-remote-bridge` 的 `session.snapshot.page.v1` 用「编码字节」做分页预算，本插件把同一口径带到官方通道：

- `follow` 只检查流的**第一帧**：是带 `records` 数组的 `snapshot` 才保留最新的记录后缀；其它帧（包括之后出现的 `snapshot`）一律不裁剪。
- `page` 的历史页同样按字节裁剪。
- 只有确实丢弃记录才发送新帧并把 `hasMore` 置 `true`；没裁剪时原帧连同原 `hasMore` 原样发出，`cursor`、`header`、`projections`、`assistantStream` 不动。
- 被裁掉的更早记录仍可用 WebUI 原生「加载更早」取回（它调用 `session/page`），客户端零改动。

预算量的是**传入裁剪的帧/页值自身**序列化后的 UTF-8 字节（`Buffer.byteLength(JSON.stringify(value))`，含 `header`、`projections`），网关 `{ ok, value }` 信封、帧头与 HTTP 压缩不计入。因此预算只是**软上限**：`minRecords`、单条超大记录和 turn 对齐都可能让实际帧超过 `maxBytes`。

历史实测（一次隔离环境，`maxBytes: 200000`，CDP 量真实载荷；本轮未重跑）：4.0 MB 日志会话的首帧从 629,122 B 降到 199,679 B，历史页从 582,506 B 降到 199,419 B，后续页 173,014 B；客户端渲染与「加载更早」连续翻页正常。默认预算为 512 KiB。

## 配置

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `maxBytes` | `524288` | 单帧/单页编码字节预算 |
| `minRecords` | `1` | 即使单条记录超过预算，也至少保留的最新记录数 |
| `log` | `false` | 每次裁剪输出一行诊断（无 logger 方法时写 stderr） |

bundle 层只注册 entry，预算属于 profile 配置：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: history-budget
  config: { maxBytes: 524288, minRecords: 1, log: false }
```

配置在挂载时读取，改动后重载该 entry 即生效。`maxBytes` 与 `minRecords` 须为正的安全整数，无效值告警并回退各自默认值；只有 `log === true` 才启用逐次诊断。

## 安装

从仓库根目录执行（要求 Node `>=22`，`engines.dsh: 0.2.1-rc.2`，插件管理器按此判兼容）：

```bash
dsh plugin --profile web add "link:$PWD/dsh-history-budget" --offline
```

无依赖、无构建产物，`link:` 安装后重载 entry 即可。首次加入 profile 仍可能需要重启一次 dsh，让新的 bundle 层参与组装，以插件管理器结果为准。插件依赖网关「每次调用重新解析 receiver」的分发方式和 `sessionController` 暴露的 `follow` / `page` 方法名，在 DSH `0.2.1-rc.2` 上验证过（历史记录，本轮未重跑宿主兼容验证）。

## 限制

- **预算不是硬上限，turn 对齐会主动超出。** 客户端按 turn 组装对话，窗口切在 turn 中间时后续 prepend 的页会被应用却不渲染，因此默认把字节切点回退到该位置或之前最近的 `turn/start`，可能超预算，最坏把整个末尾 turn 放进同一帧。仅当窗口 `records` 里找得到该 turn 的 `turn/start` 时才成立；上游窗口本身从 turn 中段开始时仍可能切在中部。
- **单条记录与 `minRecords` 都优先于预算。** 超预算的单条记录仍整条发出，也绝不截断或拆分（否则会交给客户端日志里没有的内容）；默认 `minRecords: 1`，所以 2 MB 的单条工具输出仍是 2 MB 一帧，与 `dsh-remote-bridge` 的取舍一致。
- **只约束经过 `sessionController` 的读取**：不改会话日志、数据库或其它读取路径；客户端从本地缓存直接渲染的部分不受影响。
- **进程内替换。** `follow` 缺失或不可写时告警且不裁剪，`page` 不可写时只保留首帧裁剪；替换失败不改变原生调用结果，上游异常仍原样传播。请求自带 `maxBytes`（未来宿主原生预算）时直接让位，避免双重分页。插件不验证网关分发路径，宿主升级改变分发方式时可能静默失效。
- **分页单位仍是记录（entry），不是 turn。** turn 对齐只把切点向前回退，一个 turn 仍可能跨页；官方客户端本就按 entry 追加。
- **首帧更短意味着首屏更少**，回看更早内容要点「加载更早」。历史实测中新页 prepend 到视口上方后 Chrome 的滚动锚定使视口保持原处；插件不合成点击、不写 `scrollTop`、不介入分页游标。

## 验证

```bash
cd dsh-history-budget
node --test --test-concurrency=1     # 29 项：裁剪算术、页面形状、幂等、恢复、bundle 契约（含「本包不提供客户端半边」）
```

可选活体验证（不属常规门禁，本轮未重跑）：临时 `DSH_HOME` + 复制会话 + 独立端口，用 `--patch` 只把本插件装进 web profile，浏览器侧用 CDP 记录 `WebSocket` 消息字节与 `/api/session/page` 的 `decodedBodySize`。
