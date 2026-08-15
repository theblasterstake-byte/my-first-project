#!/usr/bin/env node
/* ============================================================
   kakeibo/ を1枚の HTML にまとめる（Artifact などで配る用）

   使い方: node kakeibo/build-single-file.js [出力先]

   OCR の資材（Tesseract 本体・エンジン・日本語モデル）も埋め込むため、
   出力は 7MB 前後になる。Service Worker と共有メニュー受け取りは
   単一ファイルでは動かないので無効化する。
   ============================================================ */

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const OUT = process.argv[2] || path.join(DIR, "dist", "kakeibo-single.html");

const read = (p) => fs.readFileSync(path.join(DIR, p), "utf8");
const readB64 = (p) => fs.readFileSync(path.join(DIR, p)).toString("base64");

/* text/plain のブロックに入れるので、終了タグだけは現れないことを確かめる */
function assertNoScriptEnd(name, text) {
  if (/<\/script/i.test(text)) {
    throw new Error(`${name} に </script が含まれるため、そのままでは埋め込めません`);
  }
}

const html = read("index.html");
const css = read("style.css");
const ocrJs = read("ocr.js");
const appJs = read("app.js");
const tesseractJs = read("vendor/tesseract/tesseract.min.js");
const workerJs = read("vendor/tesseract/worker.min.js");
const coreJs = read("vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js");
const langB64 = readB64("vendor/tessdata/jpn.traineddata.gz");

[
  ["tesseract.min.js", tesseractJs],
  ["worker.min.js", workerJs],
  ["tesseract-core-simd-lstm.wasm.js", coreJs],
].forEach(([name, text]) => assertNoScriptEnd(name, text));

/* 埋め込んだ資材を blob URL にして、Tesseract の Worker に渡す下ごしらえ。
   Worker からの読み込み要求は importScripts と fetch を差し替えて横取りする。 */
const bootstrap = `
window.__SINGLE_FILE__ = true;

(function setUpOcrAssets() {
  const textOf = (id) => document.getElementById(id).textContent;
  const blobUrl = (text, type) => URL.createObjectURL(new Blob([text], { type }));

  function bytesFromBase64(base64) {
    const binary = atob(base64.replace(/\\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  try {
    const coreUrl = blobUrl(textOf("tess-core"), "text/javascript");
    const langUrl = URL.createObjectURL(
      new Blob([bytesFromBase64(textOf("tess-lang"))], { type: "application/gzip" })
    );

    // Worker の中で、エンジンと学習データの取得先を埋め込み分に向け直す
    const shim =
      "(function(){var CORE=" + JSON.stringify(coreUrl) + ",LANG=" + JSON.stringify(langUrl) + ";" +
      "var si=self.importScripts.bind(self);" +
      "self.importScripts=function(){for(var i=0;i<arguments.length;i++){" +
      "var u=String(arguments[i]);si(/tesseract-core/.test(u)?CORE:u);}};" +
      "var of=self.fetch.bind(self);" +
      "self.fetch=function(u,o){var s=(u&&u.url)||String(u);" +
      "return /traineddata/.test(s)?of(LANG,o):of(u,o);};" +
      "})();\\n";

    const workerUrl = blobUrl(shim + textOf("tess-worker"), "text/javascript");

    window.__OCR_PATHS__ = {
      lib: "",           // 本体はこの HTML に直接書かれている
      worker: workerUrl,
      coreSimd: coreUrl, // 差し替え後は値そのものは使われない
      core: coreUrl,
      lang: "embedded",
    };
  } catch (err) {
    console.warn("OCR 資材の準備に失敗しました", err);
  }
})();
`;

let out = html
  /* 単一ファイルでは外部参照をすべて外す */
  .replace(/\s*<link rel="stylesheet" href="style\.css">/, "")
  .replace(/\s*<link rel="icon"[^>]*>/, "")
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, "")
  .replace(/\s*<link rel="manifest"[^>]*>/, "")
  .replace("</head>", `<style>\n${css}\n</style>\n</head>`)
  /* 共有メニューは単一ファイルでは使えないので案内文を差し替える */
  .replace(
    /撮影・選択すると自動で読み取ります。[^<]*/,
    "撮影・選択すると自動で読み取ります。コピーした画像の貼り付けや、ドラッグ＆ドロップでも読み取れます。"
  )
  .replace(
    '<script src="ocr.js"></script>\n<script src="app.js"></script>',
    [
      `<script type="text/plain" id="tess-core">${coreJs}</script>`,
      `<script type="text/plain" id="tess-worker">${workerJs}</script>`,
      `<script type="text/plain" id="tess-lang">${langB64}</script>`,
      `<script>${tesseractJs}</script>`,
      `<script>${bootstrap}</script>`,
      `<script>${ocrJs}</script>`,
      `<script>${appJs}</script>`,
    ].join("\n")
  );

/* 置換もれがあれば気づけるようにする */
["style.css", 'src="ocr.js"', 'src="app.js"', "manifest.json"].forEach((needle) => {
  if (out.includes(needle)) throw new Error(`置換もれ: ${needle}`);
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
console.log(`書き出し: ${OUT}`);
console.log(`  合計 ${mb(Buffer.byteLength(out))}`);
console.log(`  内訳: エンジン ${mb(coreJs.length)} / 日本語モデル ${mb(langB64.length)}`);
