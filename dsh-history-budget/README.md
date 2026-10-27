# dsh-history-budget

把 Web 客户端打开会话时收到的**首帧**和历史页按编码字节裁剪，而不是只按 500 条消息计数。

纯 JS、无依赖、无需构建，分两半：**Host** 只在挂载期间替换存活 `sessionController` 服务的两个方法（卸载时按原属性恢复）；**Web Client** 目前不启用任何增强（原因与范围见[浏览器半边](#浏览器半边)），「加载更早」完全走宿主原生分页与原生滚动锚定。它不读会话日志，不改网关，也不碰会话存储。

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

Host 裁剪后，`加载更早` 成为常用路径。原生客户端有一个交互特性：新页被 prepend 到视口**上方**后，Chrome 的滚动锚定会把 `scrollTop` 同步加上新增高度，屏幕仍停在原来那条消息上（实测：`scrollTop 0 → 160`，高度 8612 → 8772 px）。

**当前状态：客户端增强已停用，两项都不生效。**

1. **不合成点击：** 原先的“一次性重试”按 `textContent` 匹配按钮文字，会把无关控件当成原生分页器——实测标题为 `Load earlier` 的 SmartUI 可排序表头被当作分页器，用户点一次后 1.2 秒又被合成点击一次，排序翻转两次。`loadOlder` 是公开客户端方法，聊天分页按钮、轨迹视图、会话检查器与任何程序化调用都会走它，因此“方法被调用”不能证明被点的控件是原生分页器；原生按钮本身也没有可稳定识别的标记。
2. **不写视口：** 原先的“还原滚动位置”在点击后 3 秒内以“转录变高”作为加载成功的证据，无关的实时输出或延迟图片就会消耗掉这一次机会，真正的 prepend 到达时反而不修正。按内容高度推断业务完成已被判定为不可靠。

因此 `client.js`（build-free loader bundle）现在只做一件事：挂载时把 `document.documentElement.dataset.dshHistoryBudget` 置为 `off`，卸载时删除。它不注册任何文档级手势监听、不合成点击、不写 `scrollTop`；「加载更早」的手动分页、分页游标和宿主的滚动锚定保持原样。`createReveal` 作为未被调用的测试接缝暂时保留，随后单独删除。

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
node --test --test-concurrency=1     # 37 项：裁剪算术、页面形状、幂等、恢复、bundle 契约，以及客户端降级回归（同文案第三方按钮零合成点击、零视口写入、无文档级手势监听、禁用标记）
```

活体验证（不属于常规门禁）：临时 `DSH_HOME` + 复制会话 + 独立端口，用 `--patch` 只把本插件装进 web profile；浏览器侧用 CDP 记录 `WebSocket` 消息字节与 `/api/session/page` 的 `decodedBodySize`。本次结果的数字见上文「实测」。

## 排错

- 打开 `log: true`，每次裁剪输出 `history-budget: opening frame trimmed N record(s) to M bytes`。
- 看到 `already wrapped; mount this plugin once` 说明同一服务被装了两次：检查 profile 里是否重复插入了 `history-budget` entry。
- 看到 `cannot be replaced in place` 说明当前宿主的方法属性不可写；插件不会继续，也不会影响原生分页。
- 客户端半挂载后在页面上留下 `data-dsh-history-budget="off"`（卸载即删除）。`"off"` 表示 bundle 已加载但增强停用；页面上不再有 `window.__dshHistoryBudget` 计数器。若「加载更早」加载成功却看不到新条目，这是宿主原生滚动锚定的行为，本插件不再修正。
