/* コーパスを1件ずつ読み取らせ、項目ごとの正解率を出す。 */
const http = require("http");
const fs = require("fs");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const { CORPUS_SOURCE, CASES } = require("./corpus");

const PAGE = process.argv[2];
const ONLY = process.argv[3] ? Number(process.argv[3]) : null;
const CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob: 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src blob: data:; worker-src blob:; font-src data:";

const body = fs.readFileSync(PAGE, "utf8");
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP });
  res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`);
});

const FIELDS = ["date", "vendor", "category", "amount", "taxType"];

function judge(field, got, want) {
  if (!want) return null;
  if (field === "vendor") return typeof got === "string" && got.includes(want);
  return String(got) === String(want);
}

(async () => {
  await new Promise((resolve) => server.listen(8933, resolve));
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
  await page.goto("http://localhost:8933/", { waitUntil: "load" });
  await page.evaluate("(() => {" + CORPUS_SOURCE + "\nwindow.drawReceipt = drawReceipt; })()");

  const score = Object.fromEntries(FIELDS.map((f) => [f, { ok: 0, total: 0 }]));
  let perfect = 0;
  const started = Date.now();

  for (let index = 0; index < CASES.length; index += 1) {
    if (ONLY !== null && ONLY !== index) continue;
    const testCase = CASES[index];
    const got = await page.evaluate(async (spec) => {
      const canvas = drawReceipt(spec);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const file = new File([blob], "case.png", { type: "image/png" });
      rows = [];
      await ingest([file]);
      const row = rows[rows.length - 1];
      return {
        date: row.date, vendor: row.vendor, content: row.content,
        category: row.category, amount: row.amount, taxType: row.taxType,
        ocrText: row.ocrText, confidence: row.confidence,
      };
    }, testCase.spec);

    const marks = [];
    let allOk = true;
    for (const field of FIELDS) {
      const verdict = judge(field, got[field], testCase.truth[field]);
      if (verdict === null) continue;
      score[field].total += 1;
      if (verdict) score[field].ok += 1;
      else allOk = false;
      marks.push(`${field}:${verdict ? "○" : `×(${got[field] || "空"}≠${testCase.truth[field]})`}`);
    }
    if (allOk) perfect += 1;
    console.log(`${allOk ? "✓" : "✗"} ${testCase.name}`);
    console.log(`   ${marks.join(" ")}`);
    if (!allOk) console.log("   確度:", JSON.stringify(got.confidence || {}));
    if (!allOk && process.env.SHOW_OCR) console.log("   OCR:", JSON.stringify(got.ocrText || "").slice(0, 900));
  }

  const total = ONLY !== null ? 1 : CASES.length;
  console.log("\n--- 集計 ---");
  for (const field of FIELDS) {
    const { ok, total: count } = score[field];
    if (count) console.log(`${field.padEnd(9)} ${ok}/${count}`);
  }
  console.log(`全項目一致   ${perfect}/${total}`);
  console.log(`所要         ${((Date.now() - started) / 1000).toFixed(1)}秒`);

  await browser.close();
  server.close();
})();
