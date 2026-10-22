# @local/dsh-lan-connect

在 **现有 DSH Web 服务** 的同一监听地址和端口上增加一个固定入口 `GET /lan`，让局域网里的手机、平板或另一台电脑直接打开原生 WebUI，不必复制带着登录 token 的 URL。

> 这不是给 DSH 加一层“可选的登录方式”，也不是反向代理。入口本身是匿名的：**任何能访问 `/lan` 的设备都会获得当前 DSH 的原生浏览器 operator 权限。** 只应在可信局域网使用。

## 它做什么

1. 浏览器打开当前对外入口的 `/lan`，例如 `http://<这台机器的 LAN IP>:<入口端口>/lan`。
2. Host 先调用原生 `connection.requestRejection(req)`，让原生 Host/Origin 信任检查照常执行；`403` 直接拒绝，`401` 或 `undefined`（信任通过）才继续。
3. 用 `webApp.getAdvertisedUrl()` 读取当前配置的 Web 根，**不接受请求 Host、`X-Forwarded-*`、query 或 `next` 参数决定跳转目标**。
4. 调用原生 `connection.authenticatedUrl(root)`，得到带唯一 `token` 参数的登录 URL，并校验它与配置根同 origin、同 path、仅含一个非空 `token`。
5. 响应 `303` 到该原生登录 URL；随后由原生代码校验 token、签发 `HttpOnly; SameSite=Strict` Cookie，再 `303` 回干净的 WebUI。**插件不自己签发 Cookie，不替换 Connection，不接管 API/WebSocket/上传。**

因此 `/lan` 不删除认证，也不绕过原生校验；它只是替操作者完成“打开一个带 token 的入口”这一步。认证的后续链路仍是原生的。

## 安全语义（务必读完）

- **匿名自动授权**：`/lan` 没有口令、没有一次性确认。任何能连到该入口的设备都能进入，并获得原生浏览器 `operator` 权限。没有按设备审批，也没有按设备撤销。
- **源码不含固定 token**：仓库与构建产物不含任何预置 token 或 Cookie；token 由原生认证在进程运行时生成，每次 `/lan` 跳转都会使用它；它在进程生命周期内保持有效，**不是一次性凭据**，进程重启后才更换。
- **分享地址不含 token**：设置卡片展示的入口链接和本地二维码只包含 `/lan`，不包含 token。token 只出现在 Host 每次生成的 `303` `Location` 中；浏览器会短暂经过该原生登录 URL，随后回到干净地址。插件不记录它，也不应被复制或粘贴到别处。
- **不记录登录材料**：插件不记录登录 URL、token 或 Cookie；请求与错误响应统一 `cache-control: no-store`、`referrer-policy: no-referrer`。
- **只接受 GET**：`/lan` 的 `POST`、`HEAD`、`OPTIONS` 等返回 `405`，不会生成登录跳转。
- **可伪造的元数据不会被展示**：浏览器端只读 Host 注入的 `globalThis.__DSH_LAN_CONNECT__`；字段缺失或 URL 带 query/fragment/凭据时，卡片显示“不可用”，不猜地址；非法候选地址会被丢弃。
- **停用/卸载不撤销已签发的 Cookie**：停用或移除插件会撤销 `/lan` 路由和设置卡片；原生浏览器 Cookie 仍然有效，直到过期或原生登录状态被清除。插件不承诺“设备独立撤销”。
- **明文 HTTP**：对外入口是 HTTP 时，入口链接和原生 Cookie 可能以明文经过局域网（除非前面有 HTTPS 代理）；卡片会按对外入口协议明确提示。只能用于可信网络，或改用 HTTPS 入口。
- **区分“对外入口”和“服务端监听”**：卡片分别显示两者。服务端监听在 `127.0.0.1`/`::1` 并不自动意味着外部不可达——已有代理或端口转发时，其他设备仍可通过对外入口访问；卡片会用对外入口判断可达性，并提示当前是代理/转发关系。反过来，对外入口本身是回环地址时，其他设备无法访问。插件只提示，不修改监听地址、端口或代理。
- **多网卡候选只是建议**：设置卡片列出的私有 IPv4 地址来自 `os.networkInterfaces()`，不探测连通性，不代表其他设备一定可达。与对外入口主机相同的候选会标为“入口地址”，其余标为建议。分享前建议在路由器上为这台机器固定 LAN IP。
- **进程级 token 的可见范围**：插件自身不记录登录 URL、token 或 Cookie；但浏览器历史/网络面板以及你放在前面的反向代理仍可能看到原生 token 跳转。该 token 在进程生命周期内可重复使用，停用插件也不会更换它；不要把入口响应或代理访问日志到处转发。
- **反向代理仍走原生信任检查**：如果把 WebUI 放在 HTTPS/路径前缀代理后，`/lan` 也仍由原生 Host/Origin 检查把关。需要用原生 `trustedHosts` 配置、代理的 Host 头重写，或两者配合让该请求通过；插件不修改这项原生配置。`webApp.getAdvertisedUrl()` 只决定跳转根，不会放宽信任。
- **不是代理/隧道**：不会另开端口、不会开第二台服务、不会把公网请求转发进来。

## 使用

安装并启用插件后：

1. 刷新现有的 DSH 页面。
2. 打开 **设置 → 通用 → 局域网自动登录**，复制入口链接或扫描本地二维码。
3. 在另一台设备上打开该链接；成功后地址栏回到原生干净的 WebUI。

插件没有配置项，入口路径固定为 `/lan`。入口 URL 来自 `webApp.getAdvertisedUrl()`（因此支持已有的代理/路径前缀），卡片同时展示 `webServer` 的实际 host/port/protocol；不硬编码端口，也不修改原生监听或代理。

> 本次在现有 `web` profile 上安装时，`patchReload: live` 直接重组并生效，**无需重启**；页面刷新后即加载新 client。其他 profile、HMR 不可用或包解析被拒绝时仍可能需要重启一次；以插件管理器结果为准。更换 client bundle 后刷新页面。

## 安装（本仓库工作区）

先构建（本插件只需要 build client）：

```bash
cd dsh-lan-connect
pnpm install --ignore-scripts
pnpm run build
```

再用插件管理器选择本地 bundle，或使用 CLI 链接当前检出：

```bash
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/dsh-lan-connect --offline
```

`link:` 使用已准备好的工作区和依赖，`--offline` 表示不从注册表补齐依赖。不要为了绕过构建而复制别人的 `dist`。

## 开发

要求 Node.js ≥ 22，包管理器统一使用 `pnpm`。本仓库不做全局安装；本机 release 构建交由 GitHub Actions，这里只做开发用 client 构建。

```bash
# 静态 bundle 门禁（仓库根目录）
node scripts/check-bundles.mjs dsh-lan-connect

# 插件目录
cd dsh-lan-connect
pnpm install --ignore-scripts
pnpm run build
pnpm test          # 串行 node --test，包括 Host、Client 与 bundle 测试

# 显式启用真实安装包的 native 集成测试（不会创建网络监听）
DSH_TEST_RUNTIME_ROOT=/home/shial/.local/share/fnm/node-versions/v24.16.0/installation/lib/node_modules/@deepseek-ai/dsh \
  GOMAXPROCS=2 node --test --test-concurrency=1 test/native.test.js

pnpm run verify:bundle
```

`test/native.test.js` 只在显式设置 `DSH_TEST_RUNTIME_ROOT` 时运行；它加载该安装包的 Cordis 与 native Connection，在内存 fake credentials 和无监听 `webServer` stub 下验证原生 token→Cookie→index、RPC、二进制流式上传、连接准入、卸载重启，不读取用户凭据、不创建网络监听。全量测试时请设置该变量，否则该用例会跳过。

## 已知限制

- 不提供设备级撤销，也不管理原生 Cookie 生命周期。
- `/lan` 的安全性等价于“网络可达 + 原生 Host/Origin 信任检查”；没有口令或设备审批。
- 只列出 RFC 1918 IPv4 候选，不做连通性探测。
- HTTP 页面上的剪贴板 API 可能不可用；卡片会选中链接并提示手动复制，不会假称复制成功。
- 本地二维码由 `qrcode-generator` 在浏览器内生成，不请求外部二维码服务。测试只验证本地 data URL、同一 URL 的稳定输出与不同 URL 的差异，未引入二维码解码器做逐符号解码。
- 本插件不保证真实手机实机通过；仓库测试只覆盖 Host 单测、client SSR/VM 与原生内存集成。
- 不发布 release；本机不打包。

## English

`@local/dsh-lan-connect` adds one fixed same-port `GET /lan` entry to the existing DSH WebUI. A device that can reach that entry is admitted as the native browser operator: the Host runs the native Host/Origin trust check, builds the login URL from `webApp.getAdvertisedUrl()` (never from request headers or query parameters), and redirects with `connection.authenticatedUrl()` to the native token exchange. The native process token is not one-time and stays valid until the process restarts. The native exchange mints the `HttpOnly; SameSite=Strict` cookie. Shared entry URLs and local QR codes contain no token; the listener, port, authentication, APIs, WebSockets and uploads are unchanged. Disabling the plugin removes only the `/lan` route and the settings card; native cookies already issued remain valid. Plain HTTP, a loopback advertised entry, the listener/advertised-proxy distinction, and multi-NIC suggestions are reported, never silently changed. Any reachable device gets operator access—use it only on a trusted LAN.

## 第三方许可

`dist/client.js` 会打包 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)，其 MIT 许可声明同时写入构建产物的 legal comment 和本节；`package.json` 的 `files` 包含 README 与 `dist/client.js`，因此交付时不会只剩本插件自己的 LICENSE。

qrcode-generator（本插件使用 1.5.2）：

```text
Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## License

本插件自身：MIT，Copyright (c) 2026 dsh-plugins contributors。完整文本见 [LICENSE](LICENSE)。
