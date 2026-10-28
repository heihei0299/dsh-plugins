# @local/dsh-lan-connect

在**现有 DSH Web 服务**的同一监听地址和端口上增加固定入口 `GET /lan`，让局域网里的手机、平板或另一台电脑直接打开原生 WebUI，不必复制带登录 token 的 URL。

> 不是给 DSH 加一层可选登录方式，也不是反向代理。入口本身匿名：**任何能访问 `/lan` 且请求通过原生 Host/Origin 信任检查的设备，都会获得当前 DSH 的原生浏览器 operator 权限。** 只应在可信局域网使用。

## 它做什么

1. 浏览器打开当前对外入口的 `/lan`（如 `http://<LAN IP>:<入口端口>/lan`），Host 先调用原生 `connection.requestRejection(req)`，让 Host/Origin 信任检查照常执行：`403` 直接拒绝，`401`（信任通过但无有效登录态）或 `undefined`（已认证）才继续，其它状态码一律 `503` 失败关闭。
2. 用 `webApp.getAdvertisedUrl()` 读取配置的 Web 根（**不接受请求 Host、`X-Forwarded-*`、query 或 `next` 决定跳转目标**），再调用原生 `connection.authenticatedUrl(root)` 得到带 `token` 的登录 URL，并校验同 origin、同 path、无凭据或 fragment、仅一个非空 `token`；响应 `303` 到该 URL，随后原生代码校验 token、签发 `HttpOnly; SameSite=Strict` Cookie，再 `303` 回干净的 WebUI。**插件不签发 Cookie、不替换 Connection、不接管 API/WebSocket/上传。**

## 安全语义（务必读完）

- **匿名自动授权**：没有口令、没有一次性确认。任何能连到入口**且通过原生 Host/Origin 信任检查**的设备都能进入并获得原生浏览器 `operator` 权限；没有按设备审批，也没有按设备撤销。
- **token 与分享地址**：源码与构建产物不含预置 token，token 由原生认证在进程运行时生成，生命周期内可重复使用，进程重启后才更换。设置卡片的入口链接和二维码不含 token；`303 Location` 携带 token，浏览器短暂经过后回到干净地址。浏览器历史、网络面板或代理日志可能看到该跳转，不要转发认证 URL。
- **不记录登录材料**：不记录登录 URL、token 或 Cookie；请求与错误响应统一 `cache-control: no-store`、`referrer-policy: no-referrer`，唯一含 URL 的日志是无 token 的入口链接（`entryUrl`）。只接受 `GET`，`POST`、`HEAD`、`OPTIONS` 等返回 `405` 且不生成登录跳转。
- **明文 HTTP 有风险**：对外入口是 HTTP 时，入口链接和原生 Cookie 可能以明文经过局域网（除非前面有 HTTPS 代理），卡片会按协议提示；只用于可信网络，或改用 HTTPS 入口。
- **对外入口 ≠ 服务端监听**：卡片分别展示。监听在 `127.0.0.1`/`::1` 不代表外部不可达——已有代理或端口转发时其他设备仍可经对外入口访问；对外入口本身是回环地址时其他设备无法访问。反向代理下 `/lan` 仍由原生 Host/Origin 检查把关，需用原生 `trustedHosts`、代理的 Host 头重写或两者配合让请求通过；`getAdvertisedUrl()` 只决定跳转根，不放宽信任。卡片列出的私有 IPv4 来自 `os.networkInterfaces()`，只是建议、不探测连通性（与对外入口同主机的标「入口地址」，与监听同主机的标「已绑定」，其余为「未绑定」）；插件只提示，不另开端口或第二台服务，也不转发公网请求。
- **停用/卸载不撤销已签发 Cookie**：移除插件只撤掉 `/lan` 路由和设置卡片，原生 Cookie 仍有效直到过期或原生登录态被清除；插件不承诺设备独立撤销。

## 使用

启用后刷新现有 DSH 页面，打开**设置 → 通用 → 局域网自动登录**，复制入口链接或扫描本地二维码，在另一台设备打开；成功后地址栏回到干净 WebUI。插件没有配置项，入口固定为 `/lan`，链接把 `lan` 解析到 `getAdvertisedUrl()` 的对外根（保留路径前缀，如根 `https://host/ui/` → `https://host/ui/lan`）；卡片同时展示 `webServer` 的实际 host/port/protocol，字段缺失或 URL 带 query/fragment/凭据时显示「不可用」，不猜地址。在现有 `web` profile 上曾观察到 `patchReload: live` 直接生效、无需重启；这是当时的安装环境事实，不是插件保证，其他 profile、HMR 不可用或包解析被拒绝时仍可能需要重启一次，以插件管理器结果为准；更换 client bundle 后刷新页面。

## 安装（本仓库工作区）

要求 Node.js ≥22、DSH `0.2.1-rc.2`，包管理器使用 `pnpm`；本插件需要构建 client：

```bash
cd dsh-lan-connect
pnpm install --ignore-scripts
pnpm run build
dsh plugin --profile web add "link:$PWD" --offline
```

也可在插件管理器中选择本目录，代替上述 CLI 安装。`link:` 使用已准备好的工作区和依赖，`--offline` 不从注册表补齐依赖；不要为了绕过构建而复制别人的 `dist`。

## 测试

```bash
# 仓库根目录：静态 bundle 门禁
node scripts/check-bundles.mjs dsh-lan-connect

# 插件目录：构建、串行测试（Host/Client/bundle）与 bundle 校验
cd dsh-lan-connect && pnpm install --ignore-scripts && pnpm run build
pnpm test && pnpm run verify:bundle

# 真实安装包的 native 集成测试（不会创建网络监听）
DSH_TEST_RUNTIME_ROOT=/path/to/installed/dsh \
  GOMAXPROCS=2 node --test --test-concurrency=1 test/native.test.js
```

`test/native.test.js` 默认跳过，只有显式设置 `DSH_TEST_RUNTIME_ROOT` 才运行：它在内存 fake credentials 和无监听 `webServer` stub 下验证 `/lan` 的 403/303、原生 token→Cookie→index、RPC、二进制流式上传、连接准入、停用后重挂载，不读取用户凭据、不创建网络监听。可选活体检查另计：在真实局域网设备打开 `/lan`，确认入口链接/二维码不含 token、401/403 与 Cookie 语义、停用后入口消失；没有可用的已认证 GUI 或 CDP 时必须记为「未验证」，不能用 native 内存集成代替端到端验收。

## 已知限制

- HTTP 页面上的剪贴板 API 可能不可用；卡片会选中链接并提示手动复制，不会假称复制成功。本地二维码由 `qrcode-generator` 在浏览器内生成，不请求外部服务；测试只验证本地 data URL、同一 URL 的稳定输出与不同 URL 的差异，未做逐符号解码。
- 不保证真实手机实机通过；仓库测试只覆盖 Host 单测、client SSR/VM 与原生内存集成。仓库没有受跟踪的发布工作流，发布须单独授权。

## 第三方许可

`dist/client.js` 会打包 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)，其 MIT 许可声明同时写入构建产物的 legal comment 和本节；`package.json` 的 `files` 包含 README、LICENSE 与 `dist/client.js`，因此交付时不会只剩本插件自己的 LICENSE。

qrcode-generator（`package.json` 声明 `^1.4.4`；本工作区解析并打包 1.5.2，构建产物 legal comment 记录实际版本）：

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
