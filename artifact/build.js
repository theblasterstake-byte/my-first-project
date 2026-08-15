#!/usr/bin/env node
/* 領収書仕分けデスク（Artifact版）のビルド。
 *
 * 公開ページは外部ホストへ一切アクセスできないため、OCRエンジン一式
 * （tesseract.js 本体・ワーカー・WASMコア・日本語データ）をページに埋め込む。
 * 抽出ロジックは receipts.js から切り出して共有し、二重管理を避ける。
 *
 * 使い方: node artifact/build.js [出力先.html]
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ASSET_DIR = process.env.RECEIPT_ASSET_DIR;

if (!ASSET_DIR) {
  console.error(
    "RECEIPT_ASSET_DIR を指定してください（tesseract.js / tesseract.js-core / @tesseract.js-data/jpn を展開した場所）。"
  );
  process.exit(1);
}

const ASSETS = {
  main: path.join(ASSET_DIR, "pkg/tjs/dist/tesseract.min.js"),
  worker: path.join(ASSET_DIR, "pkg/tjs/dist/worker.min.js"),
  core: path.join(ASSET_DIR, "pkg/tcore/tesseract-core-simd-lstm.wasm.js"),
  jpn: path.join(ASSET_DIR, "lang/jpn/4.0.0_best_int/jpn.traineddata.gz"),
};

/* tesseract.js 5.1.1 の worker は、言語をオブジェクト（{code, data}）で渡したとき
 * 初期化時の言語名に data（バイト列）を使ってしまう。CDNを使わずデータを直接渡す
 * には、この一箇所を code に直す必要がある。 */
function patchWorker(source) {
  const buggy = 'return"string"==typeof t?t:t.data}';
  const fixed = 'return"string"==typeof t?t:t.code}';
  const occurrences = source.split(buggy).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `worker.min.js の言語名の箇所が見つかりません（一致 ${occurrences} 件）。tesseract.js のバージョンを確認してください。`
    );
  }
  return source.replace(buggy, fixed);
}

/* receipts.js の先頭から「状態」セクションの直前までが、ブラウザ非依存の
 * 抽出ロジックと画像処理。Artifact版はここを共有する。 */
function extractParser() {
  const source = fs.readFileSync(path.join(ROOT, "receipts.js"), "utf8");
  const marker = "/* ---------- 状態 ---------- */";
  const end = source.indexOf(marker);
  if (end === -1) throw new Error("receipts.js に状態セクションの目印が見つかりません。");
  const parser = source.slice(0, end).trim();
  for (const name of ["extractFields", "loadImage", "preprocess", "makeThumbnail", "escapeHtml", "CATEGORIES", "TAX_TYPES"]) {
    if (!parser.includes(name)) throw new Error(`共有部分に ${name} が含まれていません。`);
  }
  return parser;
}

function base64(file) {
  return fs.readFileSync(file).toString("base64");
}

function build(outputPath) {
  for (const [name, file] of Object.entries(ASSETS)) {
    if (!fs.existsSync(file)) throw new Error(`素材が見つかりません: ${name} (${file})`);
  }

  const template = fs.readFileSync(path.join(__dirname, "receipt-desk.template.html"), "utf8");
  const mainJs = fs.readFileSync(ASSETS.main, "utf8");
  if (mainJs.includes("</script")) throw new Error("tesseract.min.js に </script が含まれるため直接埋め込めません。");

  const workerB64 = Buffer.from(patchWorker(fs.readFileSync(ASSETS.worker, "utf8")), "utf8").toString("base64");

  const html = template
    .replace("{{PARSER_JS}}", () => extractParser())
    .replace("{{TESSERACT_JS}}", () => mainJs)
    .replace("{{WORKER_B64}}", () => workerB64)
    .replace("{{CORE_B64}}", () => base64(ASSETS.core))
    .replace("{{JPN_B64}}", () => base64(ASSETS.jpn));

  const leftover = html.match(/\{\{[A-Z_]+\}\}/);
  if (leftover) throw new Error(`置換されていない箇所があります: ${leftover[0]}`);

  fs.writeFileSync(outputPath, html);
  const size = fs.statSync(outputPath).size;
  console.log(`${outputPath} を書き出しました（${(size / 1048576).toFixed(2)} MB）`);
  if (size > 16 * 1024 * 1024) throw new Error("16MBの上限を超えています。");
}

build(process.argv[2] || path.join(ROOT, "receipt-desk.html"));
