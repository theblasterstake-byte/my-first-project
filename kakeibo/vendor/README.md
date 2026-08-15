# vendor/ — 同梱している第三者ライブラリ

OCR をオフラインかつ端末内だけで動かすため、必要なファイルをここに置いています。
CDN への通信は行いません。

| パス | 内容 | 出所 | ライセンス |
| --- | --- | --- | --- |
| `tesseract/tesseract.min.js`<br>`tesseract/worker.min.js` | Tesseract.js 本体 v5.1.1 | npm `tesseract.js` | Apache-2.0 |
| `tesseract-core/tesseract-core-simd-lstm.wasm.js`<br>`tesseract-core/tesseract-core-lstm.wasm.js` | Tesseract OCR エンジン（WebAssembly を内蔵した単一ファイル版）。SIMD 対応端末では前者を使う | npm `tesseract.js-core` | Apache-2.0 |
| `tessdata/jpn.traineddata.gz` | 日本語の学習データ（tessdata_best の整数化版） | npm `@tesseract.js-data/jpn` | Apache-2.0 |

`.wasm` を別ファイルにした軽い版もありますが、Tesseract.js の Worker が blob URL で動く関係で
`.wasm` の相対パスを解決できないため、wasm を内蔵した `.wasm.js` を採用しています。
