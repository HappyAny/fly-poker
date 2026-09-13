# Fly Poker

[English](README.md) · [简体中文](README.zh-CN.md) · **日本語**

シミュレーション上のショウジョウバエの脳を相手に遊ぶ、2 人用のカードゲームです。手札は各 13 枚。先にすべて出し切った側が勝ちます。

**[デモで遊ぶ](https://fly-poker.piphipsi.com/)** · [ソースコード](https://github.com/HappyAny/fly-poker)

![Fly Poker のプレイ画面](screenshot.png)

- 練習・本気の 2 段階、ヒント、パス、一時停止、リスタート。
- 英語・簡体字中国語・日本語に対応。初回はブラウザーの言語に合わせ、手動で選んだ言語を保存します。
- オリジナルのラウンジジャズ BGM。音量調整とミュートに対応し、ゲームと一緒に一時停止します。
- スマートフォンではテーブルと操作ボタンを先に表示し、その下に 3D のハエと神経活動を表示します。
- 前処理済みの接続グラフ全体を WebGPU または CPU Worker で端末上で計算します。初回の圧縮モデルのダウンロードは約 39 MB です。

## ローカルで起動

Python 3 をインストールしてから実行します。

```sh
git clone https://github.com/HappyAny/fly-poker.git
cd fly-poker
python serve-local.py
```

<http://localhost:8891/> を開いてください。モデル、方策、音楽、Three.js はリポジトリに含まれています。アカウント、API キー、サーバー側の推論は不要です。Python は静的ファイルを配信します。

## 開発とビルド

Node.js 20 以降をインストールしてから実行します。

```sh
npm ci --ignore-scripts
npm test
npm run build
```

`dist/` 内の HTML、CSS、JavaScript、WGSL がウェブサイトのソースです。`client/brain_cpu_block.rs` は CPU 用 WebAssembly カーネル、`tools/compose-table-lounge.py` は音楽生成スクリプトです。`client-assets.json` が実行時のファイルを列挙し、ビルドで SHA-256 マニフェストを生成します。

CPU カーネルを再ビルドする場合は、Rust の `wasm32-unknown-unknown` ターゲットを追加して実行します。

```sh
rustc --edition 2021 --crate-type cdylib --target wasm32-unknown-unknown -C opt-level=3 -C panic=abort -C lto=yes client/brain_cpu_block.rs -o dist/brain-cpu.wasm
```

音楽の再生成には NumPy、SciPy、MP3 エンコード対応の SoundFile が必要です。`python tools/export-model.py --source path/to/graph.npz` は、`ids`、`indptr`、`indices`、`weights`、`stim`、`stim_group`、`readout` を持つ前処理済みグラフを書き出します。これらの再生成は任意で、同梱ファイルだけでゲームを起動できます。

## Cloudflare にデプロイ

```sh
npm run build:cloudflare
npx wrangler login
npx wrangler deploy
```

Wrangler がアップロードするのは `.cloudflare/public/` だけです。圧縮モデルは最大 20 MiB の 2 ファイル、非圧縮の互換用モデルは 3 ファイルに分割されます。ブラウザーは各チャンクを検証し、ストリームを展開して、モデル全体の SHA-256 を確認します。圧縮版の取得に失敗すると、非圧縮版を自動で試します。

`wrangler.jsonc` は静的ファイルとカスタムドメイン `fly-poker.piphipsi.com` を設定します。自分のコピーを公開する場合は Worker 名とドメインを自分のものに変更してください。`routes` を削除すると、自分の `workers.dev` アドレスを使えます。データベースや推論バックエンドは不要です。料金と制限は Cloudflare の[静的アセットの説明](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)、ドメインの設定は[公式ドキュメント](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)を参照してください。

## 公開デモのテスト

デモ URL：**<https://fly-poker.piphipsi.com/>**

依存パッケージと Chrome をインストールした環境で、公開モデルを読み込んで実際のゲーム開始を確認できます。

```sh
node client/verify-cloudflare-browser.mjs https://fly-poker.piphipsi.com/ poker gzip public
node client/verify-cloudflare-browser.mjs https://fly-poker.piphipsi.com/ poker fallback public
```

2 つ目のコマンドは、テスト用ブラウザー内で最初の圧縮チャンクの応答を HTTP 204 に置き換え、非圧縮版への完全なフォールバックを検証します。通常は CPU を使用し、`FLY_TEST_DEFAULT_BACKEND=1` を設定すると通常のバックエンド選択を確認します。モバイル表示は画面サイズのエミュレーションです。Chrome のパスは `CHROME_PATH`、必要なプロキシは `PLAYWRIGHT_PROXY_SERVER` で指定できます。結果とスクリーンショットは `release/` に保存されます。

## モデルと解釈

前処理済みグラフには 138,639 個のニューロン、15,091,983 本の接続、1,411 個の出力が含まれます。ゲーム状態の符号化、候補手の探索、学習済みの外部読み出しモデルを組み合わせて対戦相手を構成しています。神経活動の表示は、現在の候補計算で得られた新しい応答です。これは神経シミュレーションに人工的なゲームインターフェースを接続したもので、生物のハエがカードのルールを理解したり、カードゲームを遊べたりする証拠ではありません。

出典、モデル変換、元ファイルのチェックサムは[モデルの説明](dist/model/README.txt)、[出典マニフェスト](dist/model/sources.json)、[第三者の素材に関する記載](THIRD_PARTY_NOTICES.md)を参照してください。
