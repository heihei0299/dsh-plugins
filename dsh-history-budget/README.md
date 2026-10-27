# dsh-history-budget

把 Web 客户端打开会话时收到的**首帧**和历史页按编码字节裁剪，而不是只按 500 条消息计数。

纯 JS、无依赖、无需构建，分两半：**Host** 只在挂载期间替换存活 `sessionController` 服务的两个方法（卸载时按原属性恢复），**Web Client** 只修复「加载更早」加载成功却看不见的滚动行为。它不读会话日志，不改网关，也不碰会话存储。

## 它解决什么

官方分页只数消息条数：`maxMessages` 服务端默认 50，Web 客户端固定传 500。长 goal 回合或一次超大工具输出会把单帧撑到几 MB——本机实测一个 4.0 MB 日志会话的首帧是 **629,122 字节 / 306 条记录**。把 500 改成 120 只是减少条数，单条大记录仍会整条发出。

`dsh-remote-bridge` 的 `session.snapshot.page.v1` 用「编码字节」作为分页预算；本插件把同一口径带到官方通道：

- `sessionController.follow` 的首个 `snapshot` 帧：保留**最新**的、能放进预算的记录后缀；
- `sessionController.page` 的历史页：同样按字节裁剪；
- `hasMore: true`，`cursor`、`header`、`projections`、`assistantStream` 全部不动；
- 被裁掉的更早记录仍可通过 WebUI 原生的「加载更早」取回——那个按钮本来就调用 `session/page`，**客户端零改动**。

预算量的是客户端实际收到的那份 JSON（`JSON.stringify` 后的 UTF-8 字节），与 HTTP 压缩无关；压缩是另一层收益。

## 实测

隔离的 `DSH_HOME` + 复制上述 4.0 MB 会话，`maxBytes: 200000`，用 CDP 量真实载荷：

| 项 | 未启用 | 启用后 |
| --- | --- | --- |
| 首帧（WebSocket 文本帧） | 629,122 B | 199,679 B |
| 历史页 1（`/api/session/page` 解码后） | 582,506 B | 199,419 B |
| 历史页 2 | — | 173,014 B |
| 客户端 | — | 正常渲染、「加载更早」连续翻页、无控制台报错 |

默认预算是 512 KiB；上表用 200 KiB 是为了让裁剪在单次会话里可见。

## 配置

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `maxBytes` | `524288` | 单帧/单页编码字节预算 |
| `minRecords` | `1` | 即使单条记录超过预算，也至少保留的最新记录数 |
| `log` | `false` | 每次裁剪输出一行诊断（无 logger 方法时写到 stderr） |

bundle 层只注册 entry，预算属于 profile 配置：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: history-budget
  config:
    maxBytes: 524288
    minRecords: 1
    log: false
```

配置在挂载时读取；改动后重载该 entry 即可生效，不需要重启进程。

## 安装

```bash
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/dsh-history-budget --offline
```

无依赖、无构建产物，`link:` 安装后重载 entry 即可。首次加入 profile 时仍可能需要重启一次 dsh，让新的 bundle 层参与组装，以插件管理器结果为准。

## 浏览器半边

Host 裁剪后，`加载更早` 成为常用路径，而原生客户端有一个交互缺陷：新页被 prepend 到视口**上方**后，Chrome 的滚动锚定会把 `scrollTop` 同步加上新增高度，屏幕仍停在原来那条消息上——加载成功，但用户看不到任何变化（实测：`scrollTop 0 → 160`，高度 8612 → 8772 px，屏幕不动）。

`client.js`（build-free loader bundle）做两件事：

1. **还原滚动位置**：捕获「加载更早 / Load earlier」的点击，记录 `scrollTop`；3 秒内检测到内容增长，就把 `scrollTop` 放回点击时的位置，视口直接落在新加载的条目上。
2. **一次性重试**：会话刚打开时，第一次点击可能因为 follow 流还在建立而整页被静默丢弃（实测前两次点击内容完全不变）。若 1.2 秒内没有任何增长、按钮仍挂载且可用、用户也没有滚动，就再触发一次按钮自身的 click；同一按钮 5 秒内最多重试一次。

`wheel` / `touchstart` / `keydown` 会立刻取消等待，绝不和用户抢滚动；没有增长就什么都不做。它不修改会话存储、请求或按钮行为。

## 限制

- **不拆分 turn。** 客户端按 turn 组装对话：窗口切在 turn 中间时，后续 prepend 的页会被应用却不渲染（实测连续 prepend 138 + 259 条后，转录高度仍是 1870 px）。所以字节预算的切点会回退到所在 turn 的 `turn/start`——首帧可能因此超出预算，最坏情况是整个末尾 turn 都进入首帧。这是"能用"优先于"最小"的取舍。
- **单条记录超过预算时仍会整帧发出。** 不截断、不拆分记录——那会交给客户端会话日志里没有的内容。`minRecords` 优先于预算，所以 2 MB 的单条工具输出仍是 2 MB 一帧；这与 `dsh-remote-bridge` 的取舍一致。
- **只约束经过 `sessionController` 的读取。** 它不改变会话日志、数据库或其它读取路径；客户端从本地缓存直接渲染的部分不受影响。
- **进程内替换。** 宿主升级后若方法名或分发路径变化，插件会放弃包装并给出警告，不会让调用失败；请求自带 `maxBytes`（未来宿主原生预算）时它直接让位，避免双重分页。
- **分页粒度是记录（entry）而不是 turn。** 一个 turn 可以跨页；官方客户端本来就按 entry 追加，实测无渲染问题，但这不是 turn 对齐的分页。
- **首帧更短意味着首屏更少。** 需要回看更早内容时要点「加载更早」，这是用一次交互换首帧体积。
- **客户端半边需要重启才能被发现。** 运行中的 dsh 会按 Loader specifier 缓存「这个包没有 client」的结论；从 0.1.x（Host-only）升级到 0.2.0 后，必须重启一次 dsh，再刷新页面，`client.js` 才会被加载。

## 兼容性

- 在 DSH `0.2.1-rc.2` 上实测；依赖网关「每次调用重新解析 receiver」的分发方式与 `sessionController` 暴露的 `follow` / `page` 方法名。
- 插件管理器按 `engines.dsh: 0.2.1-rc.2` 判兼容。
- 网关的 `validateBinding` 只校验 `typertRemote` 的 service/serviceKey/namespace，不校验方法身份，所以在位替换不会触发 `gateway/binding-invalid`。

## 验证

```bash
cd dsh-history-budget
node --test --test-concurrency=1     # 28 项：裁剪算术、页面形状、幂等、恢复、bundle 契约、滚动还原与重试
```

活体验证（不属于常规门禁）：临时 `DSH_HOME` + 复制会话 + 独立端口，用 `--patch` 只把本插件装进 web profile；浏览器侧用 CDP 记录 `WebSocket` 消息字节与 `/api/session/page` 的 `decodedBodySize`。本次结果的数字见上文「实测」。

## 排错

- 打开 `log: true`，每次裁剪输出 `history-budget: opening frame trimmed N record(s) to M bytes`。
- 看到 `already wrapped; mount this plugin once` 说明同一服务被装了两次：检查 profile 里是否重复插入了 `history-budget` entry。
- 看到 `cannot be replaced in place` 说明当前宿主的方法属性不可写；插件不会继续，也不会影响原生分页。
- 客户端半在页面上留下 `data-dsh-history-budget="on"` 与 `window.__dshHistoryBudget`（`{clicks, retries, reveals}`）。`clicks` 增长但 `reveals` 不增长，说明点击后被应用的页没有让转录变高——先看该 turn 是否被切在半中间。
