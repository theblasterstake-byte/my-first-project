#!/usr/bin/env node
/**
 * index.html / style.css / app.js を 1 枚の HTML にまとめる。
 *
 *   node crm/build.js
 *
 * 出力
 *   crm/dist/sales-crm.html  … 単体で配布・ダブルクリックできる完全な HTML
 *   crm/dist/artifact.html   … <head>/<body> を持たない断片（Artifact 公開用）
 */

const fs = require("fs");
const path = require("path");

const dir = __dirname;
const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");

const html = read("index.html");
const css = read("style.css");
const js = read("app.js");

// index.html から <body> の中身だけを取り出す（<script> タグは除く）
const body = html
  .slice(html.indexOf("<body>") + "<body>".length, html.lastIndexOf("</body>"))
  .replace(/\s*<script src="app\.js"><\/script>/, "")
  .trim();

const title = "Sales CRM";
const head = `<title>${title}</title>\n<style>\n${css}</style>`;

const outDir = path.join(dir, "dist");
fs.mkdirSync(outDir, { recursive: true });

// 単体配布用（<head>/<body> つきの完全な HTML）
fs.writeFileSync(
  path.join(outDir, "sales-crm.html"),
  `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${head}
</head>
<body>
${body}

<script>
${js}</script>
</body>
</html>
`
);

// Artifact 公開用（<head>/<body> は公開時に付与されるので断片で出す）
fs.writeFileSync(path.join(outDir, "artifact.html"), `${head}\n\n${body}\n\n<script>\n${js}</script>\n`);

console.log("dist/sales-crm.html と dist/artifact.html を書き出しました。");
