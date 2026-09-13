# 和果蝇打牌 · Fly Poker

[English](README.md) · **简体中文** · [日本語](README.ja.md)

每人 13 张的双人跑得快。先出完手牌的一方获胜。

**[在线试玩](https://fly-poker.piphipsi.com/)** · [GitHub 源码](https://github.com/HappyAny/fly-poker)

![游戏画面](screenshot.png)

- 陪练、认真两种强度；提示、主动过牌、暂停和重开。
- 浏览器语言自动匹配，也可手动切换并记住选择。
- 原创轻爵士 BGM，支持音量、静音和随对局暂停。
- 手机优先显示牌桌和操作；下方显示三维果蝇与神经活动。
- 完整连接图在本机通过 WebGPU 或 CPU Worker 运行，首次下载约 39 MB。

## 本地运行

克隆仓库后，用 Python 3 启动：

```sh
git clone https://github.com/HappyAny/fly-poker.git
cd fly-poker
python serve-local.py
```

打开 <http://localhost:8891/>。模型、策略、音乐和 Three.js 已包含在仓库中。游戏运行不需要服务器推理、账号或 API Key；Python 仅用于提供静态文件。

## 开发和验证

安装 Node.js 20 或更高版本后：

```sh
npm ci --ignore-scripts
npm test
npm run build
```

`dist/` 中的 HTML、CSS、JavaScript、WGSL 就是网页源码。`client/brain_cpu_block.rs` 是 CPU WebAssembly 内核，`tools/compose-table-lounge.py` 是音乐合成脚本。`client-assets.json` 列出全部运行资源，构建会生成 SHA-256 清单。

安装 Rust 的 `wasm32-unknown-unknown` target 后，可重新编译 CPU 内核：

```sh
rustc --edition 2021 --crate-type cdylib --target wasm32-unknown-unknown -C opt-level=3 -C panic=abort -C lto=yes client/brain_cpu_block.rs -o dist/brain-cpu.wasm
```

重新合成音乐需要 NumPy、SciPy 和支持 MP3 编码的 SoundFile。`python tools/export-model.py --source path/to/graph.npz` 可从准备好的连接图重新导出模型；输入字段为 `ids`、`indptr`、`indices`、`weights`、`stim`、`stim_group`、`readout`。运行本项目无需重新导出或训练。

## Cloudflare 免费静态部署

```sh
npm run build:cloudflare
npx wrangler login
npx wrangler deploy
```

Wrangler 只上传 `.cloudflare/public/`。压缩模型拆成两个不超过 20 MiB 的文件，原始兼容格式拆成三个文件；浏览器逐块校验并流式解压，再核对完整模型的 SHA-256。压缩下载失败时会自动尝试原始格式。`wrangler.jsonc` 使用静态资源配置，不需要数据库或后端推理服务。

`wrangler.jsonc` 配置了自定义域名 `fly-poker.piphipsi.com`。若部署自己的副本，请修改 Worker 名称并换成你拥有的域名；也可移除 `routes`，使用自己的 `workers.dev` 地址。免费静态资源计费与限制以 [Cloudflare 官方说明](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) 为准。

## 试玩与公网测试

演示域名：**<https://fly-poker.piphipsi.com/>**

安装项目依赖和 Chrome 后，可用真实模型检查公网开局：

```sh
node client/verify-cloudflare-browser.mjs https://fly-poker.piphipsi.com/ poker gzip public
node client/verify-cloudflare-browser.mjs https://fly-poker.piphipsi.com/ poker fallback public
```

第二条命令会在测试浏览器中把首个压缩分块替换为 HTTP 204，验证完整原始分块回退。浏览器检查默认强制 CPU 以便覆盖兼容路径；设置 `FLY_TEST_DEFAULT_BACKEND=1` 可检查正常后端选择。手机检查使用模拟屏幕尺寸。可用 `CHROME_PATH` 指定 Chrome 程序路径，需要代理时设置 `PLAYWRIGHT_PROXY_SERVER`。报告和截图保存在 `release/`。

## 模型与边界

连接图包含 138,639 个神经元、15,091,983 条连接和 1,411 路输出。牌局状态编码、候选搜索与外接评分器共同构成游戏对手；神经活动图展示当前候选计算产生的新响应。这是人工设计的神经仿真游戏接口，不能据此认为真实果蝇理解规则或会打牌。

来源、模型变换说明和上游文件哈希见 [模型说明](dist/model/README.txt)、[来源清单](dist/model/sources.json) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。
