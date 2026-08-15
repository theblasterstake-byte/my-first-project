# 領収書仕分けデスク（Artifact版）

`receipts.html` と同じツールを、URLを開くだけで使える1枚のHTMLに固めたもの。
公開ページは外部ホストへ一切アクセスできないため、OCRエンジン一式をページに埋め込む。

- 抽出ロジック（日付・支払先・内容・勘定科目・金額・税区分）は `receipts.js` と共有する。
  `build.js` が `receipts.js` の「状態」セクションより前を切り出して差し込むので、
  ルールを直すときは `receipts.js` だけを直せばよい。
- 埋め込むもの: tesseract.js 本体 / ワーカー / WASMコア（SIMD・LSTM版）/ 日本語データ。
  合計およそ 7.9MB。

## ビルド

素材を npm から取得して展開する。

```bash
mkdir -p /tmp/receipt-assets && cd /tmp/receipt-assets
mkdir -p pkg lang && cd pkg
npm pack tesseract.js@5.1.1 tesseract.js-core@5.1.1
tar xzf tesseract.js-5.1.1.tgz && mv package tjs
tar xzf tesseract.js-core-5.1.1.tgz && mv package tcore
cd ../lang
npm pack @tesseract.js-data/jpn@1.0.0
tar xzf tesseract.js-data-jpn-1.0.0.tgz && mv package jpn
```

```bash
RECEIPT_ASSET_DIR=/tmp/receipt-assets node artifact/build.js /tmp/receipt-desk.html
```

出力は7.9MB程度になる。生成物はリポジトリには含めない。

## 覚え書き

- tesseract.js 5.1.1 は、言語を `{code, data}` で渡すと初期化時の言語名に `data`
  （バイト列）を使ってしまう。CDNを使わずデータを直接渡すため、`build.js` が
  ワーカーのその一箇所だけを `code` に差し替える。一致しなければビルドを止める。
- `corePath` は末尾が `js` でないと tesseract がファイル名を継ぎ足すので、
  blob URL に `#core.js` を付けて単一ファイル指定と認識させている。
- CSVの保存は Artifact の `downloads` 機能を使う。`csv` が許可されない環境では
  `.txt` で保存し、それも駄目なら本文を表示して手でコピーできるようにしている。
