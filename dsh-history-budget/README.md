# dsh-history-budget

把 Web 客户端打开会话时收到的**首帧**和历史页按编码字节裁剪，而不是只按消息条数。

纯 JS、无依赖、无构建的 **Host 插件**：挂载期间包装 `sessionController` 的 `follow` 与历史读方法 `events` / `page`（不存在的只跳过），卸载时恢复原属性；没有客户端半边，不改 DOM、会话日志或存储。

## 行为

- `follow` 只裁第一帧（带 `records` 的 `snapshot`）的最新记录后缀，其它帧原样通过。
- `events` / `page` 按字节裁剪，页值里宿主新增的 `cursor` 等字段原样保留。
- 只有确实丢弃记录才把 `hasMore` 置 `true`；没裁剪时原帧连同原 `hasMore` 发出。
- 被裁记录仍可由 WebUI 原生「加载更早」取回，客户端零改动。
- 预算量的是帧值自身 `JSON.stringify` 后的 UTF-8 字节（含 `header`、`projections`），不含网关信封与 HTTP 压缩，因此是软上限。

## 配置

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `maxBytes` | `524288` | 单帧/单页编码字节预算 |
| `minRecords` | `1` | 即使单条记录超预算，也至少保留的最新记录数 |
| `log` | `false` | 每次裁剪输出一行诊断 |

bundle 层只注册 entry，预算属于 profile 配置：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: history-budget
  config: { maxBytes: 524288, minRecords: 1, log: false }
```

挂载时读取；改动后重载该 entry 生效。`maxBytes` 与 `minRecords` 须为正的安全整数，非法值告警并回退默认。

## 安装

要求 Node ≥22；`engines.dsh` 接受 `0.2.1-rc.2`、`0.2.1-rc.5`、`0.2.2-rc.1` 或 `0.2.2-rc.2`。从仓库根目录：

```bash
dsh plugin --profile web add "link:$PWD/dsh-history-budget" --offline
```

无依赖、无构建；首次加入 profile 可能需重启一次让新的 bundle 层参与组装，以插件管理器结果为准。

## 限制

- **不是硬上限**：`minRecords`、单条超大记录和 turn 对齐都可能让帧超出 `maxBytes`。
- **只约束经过 `sessionController` 的读取**：不改日志、数据库或客户端缓存。
- **进程内替换**：`follow` 或历史读不可写时告警并降级为不裁剪；请求自带 `maxBytes` 时让位给宿主；宿主改分发方式时可能静默失效。
- **分页单位是记录**，一个 turn 仍可能跨页；首帧更短意味着首屏更少。

## 验证

```bash
cd dsh-history-budget
node --test --test-concurrency=1     # 未配置 runtime 时原生集成测试跳过
DSH_TEST_RUNTIME_ROOT=/path/to/dsh node --test --test-concurrency=1 test/native.test.js
```

原生测试在内存中使用目标 DSH 的 Cordis、Typert 与 gateway，SessionController 是采用真实方法体的替身；不是真实会话端到端测试。

## 许可

MIT。
