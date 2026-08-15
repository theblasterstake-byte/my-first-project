/* 領収書 仕分けツール
 * 画像をOCRして 日付 / 支払先 / 内容 / 勘定科目 / 金額 / 税区分 を抽出し、CSVに書き出す。
 * 読み取れない項目は空欄のままにし、推測では埋めない。 */

const STORAGE_KEY = "receipts-v1";

const CATEGORIES = [
  "旅費交通費",
  "会議費",
  "接待交際費",
  "消耗品費",
  "通信費",
  "新聞図書費",
  "水道光熱費",
  "福利厚生費",
  "支払手数料",
  "雑費",
];

const TAX_TYPES = ["課税10%", "軽減8%", "非課税", "不明"];

/* 勘定科目の判定キーワード。上から順に評価する。 */
const CATEGORY_RULES = [
  {
    category: "旅費交通費",
    keywords: [
      "タクシー", "交通", "鉄道", "電鉄", "新幹線", "特急", "運賃", "乗車", "切符", "きっぷ",
      "JR", "メトロ", "地下鉄", "バス", "航空", "空港", "ANA", "JAL", "高速道路", "ETC",
      "駐車", "パーキング", "ガソリン", "給油", "ホテル", "旅館", "宿泊", "Suica", "PASMO", "ICOCA",
    ],
  },
  {
    category: "会議費",
    keywords: [
      "会議", "ミーティング", "打合せ", "打ち合わせ", "貸会議室", "喫茶", "珈琲", "コーヒー", "カフェ",
      "スターバックス", "STARBUCKS", "ドトール", "DOUTOR", "タリーズ", "TULLY", "コメダ", "ベローチェ",
    ],
  },
  {
    category: "接待交際費",
    keywords: [
      "接待", "宴会", "懇親", "居酒屋", "料亭", "割烹", "寿司", "鮨", "焼肉", "レストラン", "ダイニング",
      "バー", "スナック", "ラウンジ", "贈答", "ギフト", "お中元", "お歳暮", "生花", "花束",
      "Restaurant", "RESTAURANT", "Dining", "Bistro", "Izakaya",
    ],
  },
  {
    category: "消耗品費",
    keywords: [
      "消耗品", "文具", "文房具", "事務用品", "コクヨ", "アスクル", "ASKUL", "たのめーる",
      "ヨドバシ", "ビックカメラ", "ヤマダ電機", "ホームセンター", "カインズ", "コーナン",
      "ダイソー", "セリア", "ロフト", "LOFT", "東急ハンズ", "ハンズ",
      "コピー用紙", "用紙", "インク", "トナー", "電池", "乾電池", "ファイル", "ボールペン",
    ],
  },
  {
    category: "通信費",
    keywords: [
      "通信", "携帯", "電話", "NTT", "ドコモ", "docomo", "DOCOMO", "au", "KDDI",
      "ソフトバンク", "SoftBank", "SOFTBANK", "楽天モバイル", "インターネット", "プロバイダ", "回線",
      "切手", "はがき", "郵便", "ゆうパック", "レターパック", "宅配", "宅急便", "ヤマト運輸", "佐川急便",
    ],
  },
  {
    category: "新聞図書費",
    keywords: [
      "書店", "書房", "図書", "書籍", "新聞", "雑誌", "定期購読", "紀伊國屋", "紀伊国屋",
      "丸善", "ジュンク堂", "有隣堂", "三省堂", "TSUTAYA", "蔦屋",
    ],
  },
  {
    category: "水道光熱費",
    keywords: [
      "電気料金", "電力", "東京電力", "関西電力", "中部電力", "九州電力", "ガス", "都市ガス",
      "プロパン", "水道", "上下水道", "水道局", "光熱",
    ],
  },
  {
    category: "福利厚生費",
    keywords: ["薬局", "ドラッグ", "健康診断", "人間ドック", "予防接種", "慰労", "social", "福利厚生"],
  },
  {
    category: "支払手数料",
    keywords: ["振込手数料", "手数料", "送金", "決済手数料"],
  },
];

/* 合計金額を示す見出し。上ほど優先度が高い。 */
const TOTAL_LABELS = [
  ["税込合計", 10],
  ["合計金額", 9],
  ["お買上げ計", 9],
  ["ご請求金額", 9],
  ["請求金額", 9],
  ["領収金額", 9],
  ["お会計", 8],
  ["合計", 8],
  ["総額", 8],
  ["計", 4],
  ["金額", 3],
];

/* 金額行から除外する見出し（合計ではないもの）。 */
const NON_TOTAL_LABELS = [
  "小計", "税抜", "内消費税", "消費税", "外税", "対象", "お預り", "お預かり", "預り",
  "お釣", "釣銭", "つり", "現金", "クレジット", "ポイント", "値引", "割引", "残高", "点数",
];

/* ---------- 汎用ユーティリティ ---------- */

const $ = (id) => document.getElementById(id);

function toHalfWidth(text) {
  return text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，､]/g, ",")
    .replace(/[．。](?=\d)/g, ".")
    .replace(/￥/g, "¥")
    .replace(/　/g, " ");
}

/* OCRは日本語の文字間に空白を入れがち（「合 計」「セブ ン - イ レブ ン」）。
 * 全角文字どうしに挟まれた空白と、数字の桁区切り直後の空白だけを取り除く。
 * 英数字の間の空白は語の区切りなので残す。 */
function collapseOcrSpaces(text) {
  return text
    .replace(/([^\x00-\x7F])[ \t]+(?=[^\x00-\x7F])/g, "$1")
    .replace(/([^\x00-\x7F])[ \t]*([-ー–])[ \t]*(?=[^\x00-\x7F])/g, "$1$2")
    .replace(/(\d),[ \t]+(?=\d{3}\b)/g, "$1,")
    .replace(/([^\x00-\x7F])[ \t]+(?=[\d¥\\])/g, "$1 ")
    .replace(/[ \t]{2,}/g, " ");
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ---------- 日付の解析（和暦→西暦） ---------- */

const ERA_OFFSETS = [
  { names: ["令和", "令", "R"], offset: 2018, max: 99 },
  { names: ["平成", "平", "H"], offset: 1988, max: 31 },
  { names: ["昭和", "昭", "S"], offset: 1925, max: 64 },
];

function formatDate(year, month, day) {
  if (!year || !month || !day) return "";
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(iso + "T00:00:00");
  if (Number.isNaN(check.getTime()) || check.getDate() !== day) return "";
  return iso;
}

function parseDate(text) {
  // 和暦（令和6年1月5日 / R6.1.5）
  for (const era of ERA_OFFSETS) {
    for (const name of era.names) {
      const pattern = new RegExp(
        `${name}\\s*(元|\\d{1,2})\\s*[年\\.\\-/]\\s*(\\d{1,2})\\s*[月\\.\\-/]\\s*(\\d{1,2})`,
        "g"
      );
      const match = pattern.exec(text);
      if (match) {
        const eraYear = match[1] === "元" ? 1 : Number(match[1]);
        if (eraYear >= 1 && eraYear <= era.max) {
          const value = formatDate(era.offset + eraYear, Number(match[2]), Number(match[3]));
          if (value) return { value, confidence: "ok" };
        }
      }
    }
  }

  // 西暦4桁（2024年1月5日 / 2024/01/05 / 2024-01-05）
  const western = /(20\d{2})\s*[年\.\-/]\s*(\d{1,2})\s*[月\.\-/]\s*(\d{1,2})/.exec(text);
  if (western) {
    const value = formatDate(Number(western[1]), Number(western[2]), Number(western[3]));
    if (value) return { value, confidence: "ok" };
  }

  // 西暦2桁（24/01/05）。年の解釈に幅があるため確度は低。
  const short = /(?:^|[^\d])(\d{2})\s*[\.\-/]\s*(\d{1,2})\s*[\.\-/]\s*(\d{1,2})(?![\d:])/.exec(text);
  if (short) {
    const value = formatDate(2000 + Number(short[1]), Number(short[2]), Number(short[3]));
    if (value) return { value, confidence: "low" };
  }

  return { value: "", confidence: "none" };
}

/* ---------- 金額の解析 ---------- */

function toAmount(raw) {
  const digits = raw.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0 || value > 99999999) return null;
  return value;
}

function amountsInLine(line) {
  const results = [];
  const pattern = /(?:¥|\\|円)?\s*(\d{1,3}(?:,\d{3})+|\d{2,8})\s*(?:円|-)?/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    const value = toAmount(match[1]);
    if (value !== null) results.push(value);
  }
  return results;
}

function parseAmount(lines) {
  let best = null;

  // 手書き領収書の「金 55,000円也」形式
  for (const line of lines) {
    const match = /^金\s*[¥\\]?\s*(\d{1,3}(?:,\d{3})+|\d{2,8})\s*円?\s*(?:也)?$/.exec(line.trim());
    if (match) {
      const value = toAmount(match[1]);
      if (value !== null) return { value, confidence: "ok" };
    }
  }

  lines.forEach((line, index) => {
    if (NON_TOTAL_LABELS.some((label) => line.includes(label))) return;

    for (const [label, weight] of TOTAL_LABELS) {
      if (!line.includes(label)) continue;
      // 同じ行、なければ次の行から金額を拾う
      let values = amountsInLine(line.slice(line.indexOf(label)));
      let sameLine = true;
      if (!values.length && lines[index + 1]) {
        values = amountsInLine(lines[index + 1]);
        sameLine = false;
      }
      if (!values.length) continue;

      const value = Math.max(...values);
      const score = weight + (sameLine ? 1 : 0) + (line.includes("税込") ? 2 : 0);
      if (!best || score > best.score || (score === best.score && value > best.value)) {
        best = { value, score, confidence: weight >= 8 ? "ok" : "low" };
      }
      break;
    }
  });

  if (best) return { value: best.value, confidence: best.confidence };

  // 合計の見出しが読めない場合は、通貨記号付きの最大額を候補にする（確度は低）。
  const currency = [];
  for (const line of lines) {
    if (NON_TOTAL_LABELS.some((label) => line.includes(label))) continue;
    const pattern = /(?:¥|\\)\s*(\d{1,3}(?:,\d{3})+|\d{2,8})|(\d{1,3}(?:,\d{3})+|\d{2,8})\s*円/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const value = toAmount(match[1] || match[2]);
      if (value !== null) currency.push(value);
    }
  }
  if (currency.length) return { value: Math.max(...currency), confidence: "low" };

  return { value: "", confidence: "none" };
}

/* ---------- 税区分 ---------- */

function parseTaxType(text) {
  const reduced = /軽減税率|軽減|8\s*%|8%対象|※/.test(text) && /8\s*%|軽減/.test(text);
  const standard = /10\s*%|10%対象/.test(text);
  const exempt = /非課税|不課税|課税対象外|印紙/.test(text);

  if (exempt && !standard && !reduced) return { value: "非課税", confidence: "ok" };
  if (standard && reduced) return { value: "課税10%", confidence: "low" }; // 混在。要確認。
  if (standard) return { value: "課税10%", confidence: "ok" };
  if (reduced) return { value: "軽減8%", confidence: "ok" };
  if (/消費税/.test(text)) return { value: "課税10%", confidence: "low" };
  return { value: "不明", confidence: "none" };
}

/* ---------- 支払先 ---------- */

function cleanVendor(line) {
  return line
    .replace(/^(発行|発行者|発行元|店名|屋号)\s*[:：]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* 意味のある文字（かな・漢字・英数）が2文字以上あるか。OCRノイズの除外用。 */
function hasReadableText(text) {
  const readable = text.match(/[぀-ヿ一-鿿 a-zA-Z0-9]/g);
  return readable !== null && readable.length >= 2;
}

function parseVendor(lines) {
  const corporate = /(株式会社|有限会社|合同会社|\(株\)|（株）|\(有\)|ホテル|商店|薬局|書店|ストア|マート|店$)/;

  for (const line of lines.slice(0, 12)) {
    if (line.length < 2 || line.length > 30) continue;
    if (/領収書|領収証|レシート|受領書|明細|控え|様$|^No|^TEL|^電話|^〒|^\d/.test(line)) continue;
    if (corporate.test(line)) {
      const value = cleanVendor(line);
      if (hasReadableText(value)) return { value, confidence: "ok" };
    }
  }

  // 会社名らしい手掛かりがない場合は、上部の最初のまとまった行を候補にする（確度は低）。
  for (const line of lines.slice(0, 6)) {
    const cleaned = cleanVendor(line);
    if (cleaned.length < 3 || cleaned.length > 30) continue;
    if (/領収書|領収証|レシート|明細|様$|^\d|^TEL|^電話|^〒|円|¥/.test(cleaned)) continue;
    if (!hasReadableText(cleaned)) continue;
    return { value: cleaned, confidence: "low" };
  }

  return { value: "", confidence: "none" };
}

/* ---------- 内容（但し書き・品目を20字以内で要約） ---------- */

function truncate(text, max = 20) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1) + "…" : cleaned;
}

function parseContent(lines) {
  // 但し書き（但し ○○代として）
  for (const line of lines) {
    const match = /但[しく]?\s*[書]?\s*[:：]?\s*(.+?)(?:として)?$/.exec(line);
    if (match && match[1]) {
      const body = match[1].replace(/^[\s:：]+/, "").trim();
      if (body.length >= 2) return { value: truncate(body), confidence: "ok" };
    }
  }

  // 「○○代」「○○費」の記載（消費税など金額の内訳は除く）
  for (const line of lines) {
    if (/税|小計|合計|預|釣/.test(line)) continue;
    const match = /([^\s：:()（）¥\\\d]{2,12}(?:代|費|料金|運賃))\s*(?:として)?/.exec(line);
    if (match && !NON_TOTAL_LABELS.some((label) => match[1].includes(label))) {
      return { value: truncate(match[1]), confidence: "ok" };
    }
  }

  // 明細行（金額を伴う品目行）を最大2件まとめる
  const items = [];
  for (const line of lines) {
    if (NON_TOTAL_LABELS.some((label) => line.includes(label))) continue;
    if (TOTAL_LABELS.some(([label]) => line.includes(label))) continue;
    const match = /^([^\d¥\\]{2,20}?)\s*[¥\\]?\s*(?:\d{1,3}(?:,\d{3})+|\d{2,7})\s*円?$/.exec(line.trim());
    if (match) {
      const name = match[1].replace(/[*※・]/g, "").trim();
      if (name.length >= 2) items.push(name);
    }
    if (items.length >= 2) break;
  }
  if (items.length) return { value: truncate(items.join("、")), confidence: "low" };

  return { value: "", confidence: "none" };
}

/* ---------- 勘定科目 ---------- */

/* 英数字だけのキーワードは単語境界で判定する（"au" が "Restaurant" に当たるのを防ぐ）。 */
function keywordHit(haystack, keyword) {
  if (/^[A-Za-z0-9]+$/.test(keyword)) {
    return new RegExp(`(^|[^A-Za-z0-9])${keyword}([^A-Za-z0-9]|$)`, "i").test(haystack);
  }
  return haystack.includes(keyword);
}

function parseCategory(text, content) {
  const haystack = text + " " + content;
  for (const rule of CATEGORY_RULES) {
    const hit = rule.keywords.find((keyword) => keywordHit(haystack, keyword));
    if (hit) return { value: rule.category, confidence: "ok" };
  }
  // 該当する手掛かりがなければ推測せず空欄にする。
  return { value: "", confidence: "none" };
}

/* ---------- OCRテキスト → 1行のデータ ---------- */

function extractFields(rawText) {
  const text = toHalfWidth(rawText);
  const lines = text
    .split(/\r?\n/)
    .map((line) => collapseOcrSpaces(line).trim())
    .filter((line) => line.length > 0);
  const flat = lines.join("\n");

  const date = parseDate(flat);
  const vendor = parseVendor(lines);
  const content = parseContent(lines);
  const amount = parseAmount(lines);
  const tax = parseTaxType(flat);
  const category = parseCategory(flat, content.value);

  return {
    date: date.value,
    vendor: vendor.value,
    content: content.value,
    category: category.value,
    amount: amount.value === "" ? "" : String(amount.value),
    taxType: tax.value,
    confidence: {
      date: date.confidence,
      vendor: vendor.confidence,
      content: content.confidence,
      category: category.confidence,
      amount: amount.confidence,
      taxType: tax.confidence,
    },
  };
}

/* ---------- 画像の前処理 ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    image.src = url;
  });
}

/* OCR前にグレースケール化とコントラスト強調を行う。 */
function preprocess(image, maxSize = 1600) {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = data.data;
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    pixels[i] = pixels[i + 1] = pixels[i + 2] = gray;
    sum += gray;
  }
  const mean = sum / (pixels.length / 4);
  const contrast = 1.35;
  for (let i = 0; i < pixels.length; i += 4) {
    const adjusted = Math.max(0, Math.min(255, (pixels[i] - mean) * contrast + mean));
    pixels[i] = pixels[i + 1] = pixels[i + 2] = adjusted;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

function makeThumbnail(image, maxSize = 200) {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.6);
}

/* ---------- 状態 ---------- */

let rows = loadRows();
let ocrWorker = null;
let processing = false;

function loadRows() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveRows() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // 画像サムネイルで容量を超えることがある。保存できなくても操作は続行する。
    showStatus("保存領域が不足しているため、この内容はブラウザに保存されませんでした。先にCSVへ書き出してください。", true);
  }
}

function blankRow(extra = {}) {
  return {
    id: uid(),
    fileName: "",
    thumbnail: "",
    ocrText: "",
    date: "",
    vendor: "",
    content: "",
    category: "",
    amount: "",
    taxType: "不明",
    confidence: {},
    pending: false,
    ...extra,
  };
}

/* ---------- 描画 ---------- */

function lowConfidenceFields(row) {
  const labels = {
    date: "日付",
    vendor: "支払先",
    content: "内容",
    category: "勘定科目",
    amount: "金額",
    taxType: "税区分",
  };
  return Object.keys(labels)
    .filter((field) => {
      const level = row.confidence && row.confidence[field];
      return level === "low" || level === "none";
    })
    .map((field) => labels[field]);
}

function render() {
  const body = $("receipt-body");
  body.innerHTML = "";

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    if (row.pending) tr.classList.add("pending");

    const lows = lowConfidenceFields(row);
    const badge = row.pending
      ? '<span class="confidence low">読み取り中…</span>'
      : lows.length
      ? `<span class="confidence ${lows.length > 3 ? "none" : "low"}" title="要確認: ${escapeHtml(lows.join("・"))}">要確認 ${lows.length}</span>`
      : row.ocrText
      ? '<span class="confidence ok">読み取り済み</span>'
      : "";

    tr.innerHTML = `
      <td>
        ${row.thumbnail ? `<img class="thumb" src="${row.thumbnail}" alt="領収書">` : ""}
        <span class="filename" title="${escapeHtml(row.fileName)}">${escapeHtml(row.fileName)}</span>
        ${badge}
      </td>
      <td><input type="date" data-field="date" value="${escapeHtml(row.date)}"></td>
      <td><input type="text" data-field="vendor" value="${escapeHtml(row.vendor)}" placeholder="店名・会社名"></td>
      <td><input type="text" data-field="content" value="${escapeHtml(row.content)}" maxlength="20" placeholder="但し書き（20字以内）"></td>
      <td>
        <select data-field="category">
          <option value="">（未分類）</option>
          ${CATEGORIES.map(
            (category) =>
              `<option value="${category}"${row.category === category ? " selected" : ""}>${category}</option>`
          ).join("")}
        </select>
      </td>
      <td><input type="number" data-field="amount" value="${escapeHtml(row.amount)}" min="0" step="1" placeholder="0"></td>
      <td>
        <select data-field="taxType">
          ${TAX_TYPES.map(
            (tax) => `<option value="${tax}"${row.taxType === tax ? " selected" : ""}>${tax}</option>`
          ).join("")}
        </select>
      </td>
      <td class="col-actions">
        <button type="button" class="icon-btn" data-action="text" title="読み取り結果のテキストを見る" ${
          row.ocrText ? "" : "disabled"
        }>📄</button>
        <button type="button" class="icon-btn danger" data-action="delete" title="この行を削除">✕</button>
      </td>
    `;

    ["date", "vendor", "content", "category", "amount", "taxType"].forEach((field) => {
      const input = tr.querySelector(`[data-field="${field}"]`);
      const level = row.confidence && row.confidence[field];
      if (level === "low" || level === "none") {
        input.style.borderColor = "var(--warn)";
        input.title = "自動判定の確度が低い項目です。内容を確認してください。";
      }
    });

    body.appendChild(tr);
  });

  $("empty-state").hidden = rows.length > 0;
  renderSummary();
}

function renderSummary() {
  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const needsCheck = rows.filter((row) => !row.pending && lowConfidenceFields(row).length).length;
  $("summary").innerHTML = rows.length
    ? `<strong>${rows.length}</strong> 件 / 合計 <strong>¥${total.toLocaleString("ja-JP")}</strong>` +
      (needsCheck ? ` ・ 要確認 <strong>${needsCheck}</strong> 件` : "")
    : "";
  $("export-csv").disabled = rows.length === 0;
}

function showStatus(message, isError = false, progress = null) {
  const status = $("status");
  status.hidden = false;
  status.classList.toggle("error", isError);
  $("status-text").textContent = message;
  $("progress-fill").style.width = progress === null ? "0%" : `${Math.round(progress * 100)}%`;
}

function hideStatus() {
  $("status").hidden = true;
}

/* ---------- OCR処理 ---------- */

async function getWorker() {
  if (ocrWorker) return ocrWorker;
  if (typeof Tesseract === "undefined") {
    throw new Error(
      "OCRライブラリを読み込めませんでした。オフラインの可能性があります。表に直接入力すればCSV出力は利用できます。"
    );
  }
  showStatus("OCRエンジンを準備しています（初回は日本語データの取得に時間がかかります）…", false, 0.05);
  ocrWorker = await Tesseract.createWorker(["jpn", "eng"], 1, {
    logger: () => {},
  });
  return ocrWorker;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  if (processing) {
    showStatus("処理中です。完了までお待ちください。", true);
    return;
  }
  processing = true;

  // 先に行を作って画像を表示し、OCRは順に進める。
  const queue = [];
  for (const file of files) {
    const row = blankRow({ fileName: file.name, pending: true });
    rows.push(row);
    queue.push({ row, file });
  }
  render();

  let worker;
  try {
    worker = await getWorker();
  } catch (error) {
    queue.forEach(({ row }) => {
      row.pending = false;
    });
    render();
    saveRows();
    showStatus(error.message, true);
    processing = false;
    return;
  }

  for (let index = 0; index < queue.length; index += 1) {
    const { row, file } = queue[index];
    showStatus(`読み取り中… (${index + 1}/${queue.length}) ${file.name}`, false, index / queue.length);
    try {
      const image = await loadImage(file);
      row.thumbnail = makeThumbnail(image);
      const canvas = preprocess(image);
      const { data } = await worker.recognize(canvas);
      const fields = extractFields(data.text || "");
      Object.assign(row, fields, { ocrText: data.text || "", pending: false });
    } catch (error) {
      row.pending = false;
      row.confidence = { date: "none", vendor: "none", content: "none", category: "none", amount: "none", taxType: "none" };
      showStatus(`${file.name} の読み取りに失敗しました: ${error.message}`, true);
    }
    render();
  }

  saveRows();
  const needsCheck = queue.filter(({ row }) => lowConfidenceFields(row).length).length;
  showStatus(
    needsCheck
      ? `${queue.length} 件を読み取りました。うち ${needsCheck} 件は確度が低い項目があります（枠がオレンジの欄）。内容を確認してください。`
      : `${queue.length} 件を読み取りました。`,
    false,
    1
  );
  processing = false;
}

/* ---------- CSV出力 ---------- */

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toDisplayDate(iso) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  return `${year}/${month}/${day}`;
}

function exportCsv() {
  const header = ["日付", "支払先", "内容", "勘定科目", "金額", "税区分", "確度", "要確認項目", "ファイル名"];
  const lines = [header.join(",")];

  rows.forEach((row) => {
    const lows = lowConfidenceFields(row);
    lines.push(
      [
        toDisplayDate(row.date),
        row.vendor,
        row.content,
        row.category,
        row.amount === "" ? "" : String(Number(row.amount)),
        row.taxType || "不明",
        lows.length ? "low" : "ok",
        lows.join("・"),
        row.fileName,
      ]
        .map(csvCell)
        .join(",")
    );
  });

  // Excelで文字化けしないようUTF-8 BOMを付ける。
  const blob = new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(
    today.getDate()
  ).padStart(2, "0")}`;
  link.href = url;
  link.download = `領収書仕分け_${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ---------- イベント ---------- */

const dropzone = $("dropzone");
const fileInput = $("file-input");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragover");
  handleFiles(event.dataTransfer.files);
});
fileInput.addEventListener("change", () => {
  handleFiles(fileInput.files);
  fileInput.value = "";
});

$("receipt-body").addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  const id = event.target.closest("tr").dataset.id;
  const row = rows.find((item) => item.id === id);
  if (!row) return;
  row[field] = event.target.value;
  // 手で直した項目は確認済みとして扱う。
  if (row.confidence) row.confidence[field] = "ok";
  event.target.style.borderColor = "";
  event.target.title = "";
  saveRows();
  renderSummary();
});

$("receipt-body").addEventListener("change", (event) => {
  if (event.target.tagName === "SELECT") {
    event.target.dispatchEvent(new Event("input", { bubbles: true }));
  }
});

$("receipt-body").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.closest("tr").dataset.id;
  const row = rows.find((item) => item.id === id);
  if (!row) return;

  if (button.dataset.action === "delete") {
    rows = rows.filter((item) => item.id !== id);
    saveRows();
    render();
  } else if (button.dataset.action === "text") {
    openPreview(row);
  }
});

function openPreview(row) {
  $("preview-title").textContent = row.fileName || "読み取り結果";
  $("preview-body").innerHTML = `
    ${row.thumbnail ? `<img src="${row.thumbnail}" alt="領収書">` : ""}
    <pre>${escapeHtml(row.ocrText || "(テキストなし)")}</pre>
  `;
  $("preview-modal").hidden = false;
}

$("preview-close").addEventListener("click", () => {
  $("preview-modal").hidden = true;
});
$("preview-modal").addEventListener("click", (event) => {
  if (event.target === $("preview-modal")) $("preview-modal").hidden = true;
});

$("receipt-body").addEventListener("click", (event) => {
  if (event.target.classList.contains("thumb")) {
    const id = event.target.closest("tr").dataset.id;
    const row = rows.find((item) => item.id === id);
    if (row) openPreview(row);
  }
});

$("add-row").addEventListener("click", () => {
  rows.push(blankRow({ fileName: "（手入力）" }));
  saveRows();
  render();
});

$("clear-all").addEventListener("click", () => {
  if (!rows.length) return;
  if (!confirm("すべての行を削除しますか？この操作は取り消せません。")) return;
  rows = [];
  saveRows();
  render();
  hideStatus();
});

$("export-csv").addEventListener("click", exportCsv);

render();
