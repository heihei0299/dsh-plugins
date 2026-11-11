# @local/dsh-lan-connect

在**现有 DSH Web 服务**的同一监听地址和端口上增加固定入口 `GET /lan`，让局域网里的手机、平板或另一台电脑直接打开原生 WebUI，不必复制带 token 的 URL。

不是可选登录方式，也不是反向代理。入口本身匿名：**任何能访问 `/lan` 且通过原生 Host/Origin 信任检查的设备，都会获得当前 DSH 的浏览器 operator 权限。** 只应在可信局域网使用。

## 它做什么

1. Host 先调用原生 `connection.requestRejection(req)`：`403` 直接拒绝，`401`（无有效登录态）或 `undefined`（已认证）才继续，其它状态码 `503` 失败关闭。
2. 用 `webApp.getAdvertisedUrl()` 读取配置的 Web 根（**不接受请求 Host、`X-Forwarded-*`、query 或 `next`**），再调 `connection.authenticatedUrl(root)` 得到登录 URL，并校验同 origin、同 path、无凭据或 fragment、仅一个非空 `token`；`303` 到该 URL，由原生代码校验 token、签发 `HttpOnly; SameSite=Strict` Cookie，再 `303` 回干净的 WebUI。**插件不签发 Cookie、不替换 Connection、不接管 API/WebSocket/上传。**

## 安全语义

- **匿名自动授权**：没有口令或确认，通过信任检查即获得 operator 权限；没有按设备审批或撤销。
- **token**：由原生认证在运行时生成，生命周期内可复用，进程重启才更换。设置卡片的链接和二维码不含 token；`303 Location` 会携带，浏览器短暂经过后回到干净地址；不要转发认证 URL。
- **不记录登录材料**：不记录登录 URL、token 或 Cookie；响应统一 `cache-control: no-store`、`referrer-policy: no-referrer`，唯一含 URL 的日志是无 token 的 `entryUrl`。只接受 `GET`，其它方法 `405` 且不生成跳转。
- **明文 HTTP**：入口为 HTTP 时链接与 Cookie 可能以明文经过局域网（除非前置 HTTPS 代理），卡片按协议提示。
- **对外入口 ≠ 监听地址**：监听在回环不代表外部不可达；反向代理下 `/lan` 仍受原生信任检查约束，需用 `trustedHosts` 或代理重写 Host。卡片列出的私有 IPv4 只是建议，不探测连通性。
- **停用不撤销**：移除插件只撤掉 `/lan` 路由和设置卡片，已签发的原生 Cookie 仍有效到过期。

## 使用

启用后刷新页面，打开**设置 → 通用 → 局域网自动登录**，复制入口链接或扫描本地二维码。插件没有配置项，入口固定为 `/lan`，链接把 `lan` 解析到 `getAdvertisedUrl()` 的对外根（保留路径前缀）；卡片同时展示 `webServer` 的实际 host/port/protocol，字段缺失或 URL 带 query/fragment/凭据时显示「不可用」。在 `patchReload: live` 的 `web` profile 上曾观察到无需重启，但这不是保证。

## 安装

要求 Node ≥22、DSH `0.2.1-rc.2`、`0.2.1-rc.5` 或 `0.2.2-rc.1`（门禁只接受这三个版本）与 pnpm；本插件需要构建 client。

```bash
cd dsh-lan-connect
pnpm install --ignore-scripts
pnpm run build
dsh plugin --profile web add "link:$PWD" --offline
```

也可在插件管理器中选择本目录。`link:` 使用已准备好的工作区与依赖；不要为了绕过构建复制别人的 `dist`。

## 测试

```bash
node scripts/check-bundles.mjs dsh-lan-connect          # 仓库根目录
cd dsh-lan-connect && pnpm install --ignore-scripts && pnpm run build
pnpm test && pnpm run verify:bundle
DSH_TEST_RUNTIME_ROOT=/path/to/installed/dsh GOMAXPROCS=2 \
  node --test --test-concurrency=1 test/native.test.js
```

`test/native.test.js` 默认跳过：在内存 fake credentials 与无监听 `webServer` 下验证 403/303、token→Cookie→index、RPC、二进制流式上传、连接准入与停用后重挂载。真实局域网设备打开 `/lan` 的端到端验收需另行执行，不能用内存集成代替。

## 已知限制

- HTTP 页面上的剪贴板 API 可能不可用，卡片会提示手动复制；二维码由 `qrcode-generator` 在浏览器内生成，测试只验证 data URL 与 URL 差异，未逐符号解码。
- 不保证真实手机实机通过；仓库没有受跟踪的发布工作流，发布须单独授权。

## 第三方许可

`dist/client.js` 打包 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)，其 MIT 声明同时写入构建产物的 legal comment 和本节；`files` 包含 README、LICENSE 与 `dist/client.js`。

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
