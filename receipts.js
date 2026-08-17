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
    .replace(/(?<![\d,])(\d{1,3})[ \t](\d{3})(?![\d,])/g, "$1,$2")
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

/* 日付が複数ある場合の優先順位。ご使用期間や支払期日を領収日と取り違えない。 */
const DATE_LABELS = [["領収日", 6], ["領収", 5], ["発行日", 5], ["発行", 4], ["取引日", 5], ["利用日", 5], ["ご利用日", 5], ["購入日", 5], ["検針日", 2]];
const DATE_EXCLUDE = /期間|期日|期限|有効|来店予定|次回|お支払期日|振替日|開始|終了|〜|～/;

function parseDate(lines, structuredLines) {
  const source = Array.isArray(lines) ? lines : String(lines).split(/\r?\n/);
  const candidates = [];

  source.forEach((line, index) => {
    if (DATE_EXCLUDE.test(line)) return;
    const found = parseDateFromText(line);
    if (!found.value) return;

    let weight = 0;
    for (const [label, value] of DATE_LABELS) {
      if (line.includes(label) && value > weight) weight = value;
    }
    candidates.push({ found, weight, index });
  });

  if (!candidates.length) {
    // 期間や期限しか無い場合は、そこから拾うほかない（確度は低）
    const fallback = parseDateFromText(source.join("\n"));
    return fallback.value ? { value: fallback.value, confidence: "low" } : fallback;
  }

  // ラベル付き優先、次に上にあるもの
  candidates.sort((a, b) => (b.weight - a.weight) || (a.index - b.index));
  const best = candidates[0];
  const lineConfidence =
    structuredLines && structuredLines[best.index] ? structuredLines[best.index].confidence : 100;

  let confidence = best.found.confidence;
  // OCR自身が自信の無い行から取った値は、そのまま信用しない
  if (lineConfidence && lineConfidence < 78 && confidence === "ok") confidence = "low";
  return { value: best.found.value, confidence };
}

/* OCRは年の桁を読み違える（2024→2924, 2624）。ありえない年は下2桁を
 * 手掛かりに直すが、確度は下げて必ず確認してもらう。範囲外は諦める。 */
function repairYear(year) {
  const thisYear = new Date().getFullYear();
  if (year >= 2000 && year <= thisYear + 1) return { year, confidence: "ok" };
  const candidate = 2000 + (year % 100);
  if (candidate >= 2010 && candidate <= thisYear + 1) return { year: candidate, confidence: "low" };
  return null;
}

function parseDateFromText(text) {
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
  const western = /(?<!\d)(\d{4})\s*[年\.\-/]\s*(\d{1,2})\s*[月\.\-/]\s*(\d{1,2})/.exec(text);
  if (western) {
    const repaired = repairYear(Number(western[1]));
    if (repaired) {
      const value = formatDate(repaired.year, Number(western[2]), Number(western[3]));
      if (value) return { value, confidence: repaired.confidence };
    }
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
    if (value !== null) results.push({ value, grouped: match[1].includes(",") });
  }
  return results;
}

function amountValuesInLine(line) {
  return amountsInLine(line).map((item) => item.value);
}

function parseAmount(lines, structuredLines) {
  const heights = structuredLines && structuredLines.length ? structuredLines.map((line) => line.height) : [];
  const tallest = heights.length ? Math.max(...heights) : 0;

  // 手書き領収書の「金 55,000円也」形式は、ほぼ確実に総額。
  // ただし手書きは誤読しやすいので、その行の読み取り確信度を見て確度を決める。
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^金\s*[¥\\]?\s*(\d{1,3}(?:,\d{3})+|\d{2,8})\s*円?\s*(?:也)?$/.exec(lines[index].trim());
    if (!match) continue;
    const value = toAmount(match[1]);
    if (value === null) continue;
    const lineConfidence =
      structuredLines && structuredLines[index] ? structuredLines[index].confidence : 100;
    return { value, confidence: lineConfidence && lineConfidence < 85 ? "low" : "ok" };
  }

  const candidates = [];

  lines.forEach((line, index) => {
    const excluded = NON_TOTAL_LABELS.some((label) => line.includes(label));

    let labelWeight = 0;
    for (const [label, weight] of TOTAL_LABELS) {
      if (line.includes(label) && weight > labelWeight) labelWeight = weight;
    }
    // 「合計」の下の行に金額だけが置かれる様式がある
    if (!labelWeight && index > 0) {
      const previous = lines[index - 1];
      const previousIsLabel = TOTAL_LABELS.some(([label, weight]) => weight >= 8 && previous.includes(label));
      const previousHasAmount = amountValuesInLine(previous).length > 0;
      if (previousIsLabel && !previousHasAmount) labelWeight = 7;
    }

    const hasCurrency = /[¥\\]|円/.test(line);
    const relativeHeight = tallest && structuredLines && structuredLines[index]
      ? structuredLines[index].height / tallest
      : 0;

    for (const { value, grouped } of amountsInLine(line)) {
      // 桁が1〜2桁のものは点数や個数のことが多い
      if (value < 30) continue;
      let score = labelWeight * 12 + relativeHeight * 22 + (hasCurrency ? 6 : 0);
      if (excluded) score -= 40;
      if (/%|対象|点|個|枚|kWh|L\b|@/.test(line)) score -= 12;
      candidates.push({ value, score, labelWeight, excluded, index, grouped });
    }
  });

  if (!candidates.length) return { value: "", confidence: "none" };

  // 同じ金額が離れた行にも出ていれば、OCRの誤読ではない可能性が高い
  const occurrences = new Map();
  for (const candidate of candidates) {
    occurrences.set(candidate.value, (occurrences.get(candidate.value) || 0) + 1);
  }
  for (const candidate of candidates) {
    candidate.score += Math.min(2, occurrences.get(candidate.value) - 1) * 7;
  }

  // 同点なら大きい金額を採る（税込の総額を取りこぼさないため）
  candidates.sort((a, b) => (b.score - a.score) || (b.value - a.value));
  const best = candidates[0];

  // 「3,278」が別の行にあるのに「278」を選んでいるときは、先頭の桁を
  // 読み落とした可能性が高い。桁区切りのある長い方を採り、確認を促す。
  const truncated = candidates.find(
    (item) =>
      item.grouped &&
      item.value > best.value &&
      String(item.value).endsWith(String(best.value)) &&
      String(item.value).length > String(best.value).length
  );
  if (truncated && !best.grouped) {
    return { value: truncated.value, confidence: "low" };
  }

  // 小計＋消費税が総額に一致するなら、その裏付けを信頼する
  const values = candidates.map((item) => item.value);
  const supported = values.some((a) => values.some((b) => a !== b && Math.abs(a + b - best.value) < 1));

  let confidence = "low";
  if (best.labelWeight >= 8 && !best.excluded) confidence = "ok";
  else if (supported || best.score >= 24) confidence = "ok";
  if (best.excluded) confidence = "low";

  const lineConfidence =
    structuredLines && structuredLines[best.index] ? structuredLines[best.index].confidence : 100;
  if (lineConfidence && lineConfidence < 78 && confidence === "ok") confidence = "low";

  return { value: best.value, confidence };
}

/* ---------- 税区分 ---------- */

function parseTaxType(text) {
  // OCRは % を 9・x・× に、0 を O に読み違える（「10%」→「109%」「OX」など）
  const standard = /(?:^|[^\d])1\s*[0OoＯ]\s*[0-9]?\s*[%％xX×]|10\s*パーセント/.test(text);
  const reduced = /(?:^|[^\d])8\s*[0-9]?\s*[%％xX×]|軽減税率|軽減対象|軽減/.test(text);
  const exempt = /非課税|不課税|課税対象外|印紙|切手|郵便料金/.test(text);
  // 税率の文字が潰れていても、「○%対象」や「消費税」があれば課税取引と分かる
  const taxable = /対象|消費税|税込|内税|外税|税抜/.test(text);

  if (exempt && !standard && !reduced) return { value: "非課税", confidence: "ok" };
  // 8%と10%が並ぶレシートは、税込総額としては10%扱いで台帳に載せ、確認を促す
  if (standard && reduced) return { value: "課税10%", confidence: "low" };
  if (standard) return { value: "課税10%", confidence: "ok" };
  if (reduced) return { value: "軽減8%", confidence: "ok" };
  if (taxable) return { value: "課税10%", confidence: "low" };
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

const VENDOR_EXCLUDE = /領収書|領収証|レシート|受領書|明細|控え|様$|^No|^TEL|^電話|^FAX|^〒|^\d|いたしました|ました|ください|です|ます|上記|正に|^但|として$|内訳|小計|合計/;
const VENDOR_CORPORATE = /(株式会社|有限会社|合同会社|\(株\)|（株）|\(有\)|ホテル|商店|薬局|書店|ストア|マート|センター)/;

function parseVendor(lines) {
  const candidates = [];

  lines.slice(0, 8).forEach((line, index) => {
    const cleaned = cleanVendor(line);
    if (cleaned.length < 2 || cleaned.length > 32) return;
    if (VENDOR_EXCLUDE.test(cleaned)) return;
    if (/[¥\\]|円|^金\s*\d|^\d/.test(cleaned)) return;
    if (!hasReadableText(cleaned)) return;

    // 上にあるほど店名らしい。法人格は手掛かりだが、支店名だけの短い行より
    // 1行目の屋号を優先する。
    const position = Math.max(0, 5 - index) * 4;
    const corporate = VENDOR_CORPORATE.test(cleaned) ? 4 : 0;
    const length = Math.min(cleaned.length, 12) * 0.8;
    const branchOnly = /^.{1,4}店$/.test(cleaned) ? -6 : 0;
    candidates.push({ value: cleaned, score: position + corporate + length + branchOnly, index, corporate });
  });

  if (!candidates.length) return { value: "", confidence: "none" };

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const confident = best.corporate > 0 || best.index === 0;
  return { value: best.value, confidence: confident ? "ok" : "low" };
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

function parseCategory(text, content, lines) {
  const haystack = text + " " + content;
  const header = (lines || []).slice(0, 4).join(" ");

  let best = null;
  for (const rule of CATEGORY_RULES) {
    for (const keyword of rule.keywords) {
      if (!keywordHit(haystack, keyword)) continue;
      // 長い語ほど誤検出しにくい。支払先や店名の行にある語はさらに強い手掛かり。
      const score = keyword.length * 2 + (keywordHit(header, keyword) ? 6 : 0);
      if (!best || score > best.score) best = { category: rule.category, score, keyword };
    }
  }

  if (!best) return { value: "", confidence: "none" };
  // 2文字の一般的な語だけが根拠のときは確度を下げる
  return { value: best.category, confidence: best.score >= 6 ? "ok" : "low" };
}

/* ---------- OCR結果 → 行の構造 ---------- */

/* tesseract の blocks から、行ごとの文字列と文字の大きさを取り出す。
 * 領収書では「合計」の金額が一番大きく刷られていることが多く、
 * 文字の大きさが金額を選ぶ手掛かりになる。 */
function linesFromRecognition(data) {
  const lines = [];
  const blocks = (data && data.blocks) || [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const words = (line.words || []).map((word) => ({
          text: word.text || "",
          confidence: typeof word.confidence === "number" ? word.confidence : 0,
          height: word.bbox ? word.bbox.y1 - word.bbox.y0 : 0,
        }));
        const text = collapseOcrSpaces(toHalfWidth(line.text || "")).trim();
        if (!text) continue;
        lines.push({
          text,
          height: words.length ? Math.max(...words.map((word) => word.height)) : 0,
          confidence: typeof line.confidence === "number" ? line.confidence : 0,
        });
      }
    }
  }
  return lines;
}

/* ---------- OCRテキスト → 1行のデータ ---------- */

function extractFields(rawText, structuredLines) {
  const text = toHalfWidth(rawText);
  const lines =
    structuredLines && structuredLines.length
      ? structuredLines.map((line) => line.text)
      : text
          .split(/\r?\n/)
          .map((line) => collapseOcrSpaces(line).trim())
          .filter((line) => line.length > 0);
  const flat = lines.join("\n");

  const date = parseDate(lines, structuredLines);
  const vendor = parseVendor(lines);
  const content = parseContent(lines);
  const amount = parseAmount(lines, structuredLines);
  const tax = parseTaxType(flat);
  const category = parseCategory(flat, content.value, lines);

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

/* 写真の向きはEXIFに入っていることがある。createImageBitmap に任せると
 * 撮影時の向きどおりに起こしてくれる。使えない環境では素の読み込みに戻す。 */
async function loadImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* 対応していない形式・古いブラウザは下の方法へ */
    }
  }
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

/* ---------- 取り込めるファイルの判定 ---------- */

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const HEIC_EXTENSIONS = /\.(heic|heif)$/i;

function classifyFile(file) {
  const name = file.name || "";
  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (HEIC_EXTENSIONS.test(name) || file.type === "image/heic" || file.type === "image/heif") return "heic";
  // スキャナや一部のスマートフォンは種別を付けずに渡してくる。拡張子でも見る。
  if ((file.type && file.type.startsWith("image/")) || IMAGE_EXTENSIONS.test(name)) return "image";
  return "unsupported";
}

/* ---------- PDFの領収書 ---------- */

/* 電子領収書のPDFには文字がそのまま入っていることが多い。
 * その文字を読めばOCRの誤りが入らないので、まず文字層を試す。 */
function linesFromPdfText(content) {
  const items = (content.items || []).filter((item) => item.str && item.str.trim());
  const rows = [];
  for (const item of items) {
    const y = Math.round(item.transform[5]);
    const x = item.transform[4];
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 3);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, text: item.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => {
      row.parts.sort((a, b) => a.x - b.x);
      const text = collapseOcrSpaces(toHalfWidth(row.parts.map((part) => part.text).join(" "))).trim();
      return { text, height: 0, confidence: 100 };
    })
    .filter((line) => line.text.length > 0);
}

/* PDFの文字層が実質空（紙をスキャンしただけのPDF）かどうか。 */
function pdfTextIsUsable(lines) {
  const text = lines.map((line) => line.text).join("");
  return text.length >= 20 && /\d/.test(text);
}

async function renderPdfPage(page, targetWidth = 1800) {
  const initial = page.getViewport({ scale: 1 });
  const scale = Math.min(3, targetWidth / initial.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/* OCRは文字の高さがおよそ30px以上あると安定する。小さく写った領収書は
 * 拡大し、大きすぎる写真は縮める。 */
function fitForOcr(image, target = 2200, maxUpscale = 3) {
  const longest = Math.max(image.width, image.height);
  const scale = Math.min(target / longest, maxUpscale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/* 影やムラのある写真では画面全体を同じ明るさで切ると文字が消える。
 * 積分画像で局所平均を求め、周囲より暗い画素だけを黒にする（適応二値化）。 */
function binarize(canvas) {
  const ctx = canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const width = canvas.width;
  const height = canvas.height;

  const gray = new Float64Array(width * height);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    gray[p] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }

  // 積分画像（各画素までの累積和）
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }

  const radius = Math.max(8, Math.round(Math.min(width, height) / 24));
  const bias = 8; // 局所平均よりこれだけ暗ければ文字とみなす

  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const area = (bottom - top + 1) * (right - left + 1);
      const sum =
        integral[(bottom + 1) * (width + 1) + (right + 1)] -
        integral[top * (width + 1) + (right + 1)] -
        integral[(bottom + 1) * (width + 1) + left] +
        integral[top * (width + 1) + left];
      const localMean = sum / area;
      const value = gray[y * width + x] < localMean - bias ? 0 : 255;
      const index = (y * width + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function rotateCanvas(canvas, degrees) {
  if (!degrees) return canvas;
  const radians = (degrees * Math.PI) / 180;
  const swap = degrees === 90 || degrees === 270;
  const out = document.createElement("canvas");
  out.width = swap ? canvas.height : canvas.width;
  out.height = swap ? canvas.width : canvas.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

/* グレースケールのみ（二値化が裏目に出る鮮明な画像用）。 */
function grayscale(canvas) {
  const ctx = canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const value = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/* 隣り合う画素の差の中央値でざらつきを測る。文字の輪郭は差が大きくても
 * まばらなので中央値には効かず、全面のノイズだけが数値に出る。 */
function noiseLevel(canvas) {
  const ctx = canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const width = canvas.width;
  const step = Math.max(1, Math.round((width * canvas.height) / 20000));
  const diffs = [];
  for (let p = 1; p < width * canvas.height; p += step) {
    if (p % width === 0) continue;
    diffs.push(Math.abs(pixels[p * 4] - pixels[(p - 1) * 4]));
  }
  if (!diffs.length) return 0;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

function blurCanvas(canvas, radius) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";
  return out;
}

/* 二値化後に残る粒を、つながった黒の塊の大きさで判断して消す。
 * 文字の画は大きな塊になり、ノイズは数画素の塊にしかならない。
 * 粒が多いとTesseractが文字候補を大量に抱えて極端に遅くなるため、速度にも効く。 */
function removeSmallBlobs(canvas) {
  const ctx = canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const width = canvas.width;
  const height = canvas.height;
  const total = width * height;
  const minPixels = Math.max(8, Math.round(total / 200000));

  const black = new Uint8Array(total);
  for (let p = 0; p < total; p += 1) black[p] = pixels[p * 4] < 128 ? 1 : 0;

  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  const blob = new Int32Array(1024);

  for (let start = 0; start < total; start += 1) {
    if (!black[start] || seen[start]) continue;

    let top = 0;
    let size = 0;
    let overflow = false;
    stack[top] = start;
    top += 1;
    seen[start] = 1;

    while (top > 0) {
      top -= 1;
      const p = stack[top];
      if (size < blob.length) blob[size] = p;
      else overflow = true;
      size += 1;
      if (overflow && size > minPixels) break; // 十分大きい塊は残すので追跡をやめる

      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (black[q] && !seen[q]) {
            seen[q] = 1;
            stack[top] = q;
            top += 1;
          }
        }
      }
    }

    if (!overflow && size < minPixels) {
      for (let i = 0; i < size; i += 1) {
        const index = blob[i] * 4;
        pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function preprocess(image, variant = "binary") {
  // ざらつきは拡大すると平されてしまうので、原寸のうちに測る
  const noise = noiseLevel(grayscale(fitForOcr(image, 1000, 1)));
  const fitted = grayscale(fitForOcr(image));
  if (variant === "gray") return noise > 6 ? blurCanvas(fitted, 1) : fitted;
  const smoothed = noise > 10 ? blurCanvas(fitted, 1.5) : noise > 4 ? blurCanvas(fitted, 0.8) : fitted;
  return removeSmallBlobs(binarize(smoothed));
}

function makeThumbnail(image, maxSize = 200) {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.6);
}

/* ---------- 1ファイル → 領収書の面 ---------- */

/* PDFは1ページを1枚の領収書として扱う。画像はそのまま1枚。
 * 読み込めない形式は、理由の分かる文言で投げ返す。 */
async function readReceiptFaces(file, options = {}) {
  const kind = classifyFile(file);

  if (kind === "heic") {
    throw new Error("iPhoneのHEIC形式は、このブラウザでは開けません。写真を「互換性優先」でJPEGにするか、スクリーンショットを撮って入れてください");
  }
  if (kind === "unsupported") {
    throw new Error("画像またはPDFではないため取り込めません");
  }

  if (kind === "image") {
    const image = await loadImage(file);
    return [{ label: file.name, image }];
  }

  const pdfjs = options.pdfjs || (typeof pdfjsLib !== "undefined" ? pdfjsLib : null);
  if (!pdfjs) throw new Error("PDFを開く部品を読み込めませんでした");

  const data = new Uint8Array(await file.arrayBuffer());
  const document_ = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const faces = [];
  const pageCount = Math.min(document_.numPages, options.maxPages || 20);

  for (let number = 1; number <= pageCount; number += 1) {
    const page = await document_.getPage(number);
    const label = pageCount > 1 ? `${file.name} (${number}/${pageCount})` : file.name;
    let lines = [];
    try {
      lines = linesFromPdfText(await page.getTextContent());
    } catch {
      /* 文字層が壊れているPDFは、描画してOCRに回す */
    }
    if (pdfTextIsUsable(lines)) {
      faces.push({ label, lines, canvas: await renderPdfPage(page, 900) });
    } else {
      faces.push({ label, canvas: await renderPdfPage(page) });
    }
  }
  return faces;
}

/* 1面を読み取って、台帳に載せる値を返す。
 * PDFの文字層があるときはOCRを通さない（誤読が入らない）。 */
async function analyzeFace(worker, face, onStage) {
  if (face.lines && face.lines.length) {
    const text = face.lines.map((line) => line.text).join("\n");
    return { text, lines: face.lines, fields: extractFields(text, face.lines), source: "pdf" };
  }

  const image = face.image || face.canvas;
  const primary = await recognizeReceipt(worker, image, onStage);
  const fields = extractFields(primary.text, primary.lines);

  // 金額と日付は取り違えると痛い。別の前処理でもう一度読んで突き合わせ、
  // 食い違ったら「要確認」にする（黙って誤った値を確定させない）。
  try {
    const alternate = {
      variant: primary.attempt.variant === "binary" ? "gray" : "binary",
      degrees: primary.attempt.degrees,
    };
    if (onStage) onStage(alternate, 1);
    const second = await recognizeReceipt(worker, image, null, alternate);
    const check = extractFields(second.text, second.lines);

    for (const field of ["amount", "date"]) {
      if (!fields[field] && check[field]) {
        // 片方でしか読めなかったときは、読めた方を採って確認を促す
        fields[field] = check[field];
        fields.confidence[field] = "low";
      } else if (fields[field] && check[field] && fields[field] !== check[field]) {
        fields.confidence[field] = "low";
      }
    }
  } catch {
    /* 照合できなくても、1回目の結果は使える */
  }

  return { text: primary.text, lines: primary.lines, fields, source: "ocr" };
}

/* ---------- OCRの掛け方 ---------- */

/* 読み取り結果の見込みを点数にする。向きや前処理を選ぶための物差しで、
 * 領収書なら日本語・数字・金額まわりの語が揃うほど高くなる。 */
function scoreRecognition(data) {
  const text = (data && data.text) || "";
  // 崩れた読み取りでも漢字らしきものは大量に出る。文字数は軽く見て、
  // OCR自身の確信度と、領収書に必ず出る語の有無を重く見る。
  const japanese = (text.match(/[ぁ-んァ-ヶ一-鿿]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  const keywords = (text.match(/合計|小計|領収|消費税|税込|円|¥|様|店|年|月|日/g) || []).length;
  const amountShaped = (text.match(/\d{1,3},\d{3}|\d{2,6}\s*円/g) || []).length;
  const confidence = typeof data.confidence === "number" ? data.confidence : 0;
  return (
    confidence * 0.8 +
    Math.min(keywords, 10) * 7 +
    Math.min(amountShaped, 4) * 8 +
    Math.min(digits, 60) * 0.3 +
    Math.min(japanese, 100) * 0.08
  );
}

/* 十分に読めたとみなす点数。これを超えたら追加の試行はしない。 */
const RECOGNITION_GOOD_ENOUGH = 130;

/* 前処理と向きを変えながら読み取り、いちばん見込みの高い結果を返す。
 * 明るい紙は1回で終わり、傾いた写真や横倒しの写真だけ追加で試す。 */
async function recognizeReceipt(worker, image, onStage, forced) {
  // 既定では直前までの認識結果を学習に使うため、同じ画像でも結果がぶれる。
  // 台帳の値が入れる順で変わらないように、その学習を切る。
  if (!recognizeReceipt.configured) {
    try {
      await worker.setParameters({ classify_enable_learning: "0" });
      recognizeReceipt.configured = true;
    } catch {
      /* 設定できなくても読み取りは続けられる */
    }
  }

  const attempts = forced ? [forced] : [
    { variant: "binary", degrees: 0 },
    { variant: "gray", degrees: 0 },
    { variant: "binary", degrees: 90 },
    { variant: "binary", degrees: 270 },
    { variant: "binary", degrees: 180 },
  ];

  let best = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (onStage) onStage(attempt, index);
    const canvas = rotateCanvas(preprocess(image, attempt.variant), attempt.degrees);
    const { data } = await worker.recognize(canvas);
    const score = scoreRecognition(data);
    if (!best || score > best.score) best = { data, score, attempt };
    if (best.score >= RECOGNITION_GOOD_ENOUGH) break;
  }

  return {
    text: best.data.text || "",
    lines: linesFromRecognition(best.data),
    score: best.score,
    attempt: best.attempt,
  };
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
  const files = Array.from(fileList);
  if (!files.length) return;
  if (processing) {
    showStatus("処理中です。完了までお待ちください。", true);
    return;
  }
  processing = true;

  const faces = [];
  const rejected = [];
  for (const file of files) {
    try {
      const opened = await readReceiptFaces(file);
      for (const face of opened) {
        const row = blankRow({ fileName: face.label, pending: true });
        rows.push(row);
        faces.push({ row, face });
      }
    } catch (error) {
      rejected.push(`${file.name}：${error.message || error}`);
    }
  }
  render();

  if (rejected.length) showStatus(`取り込めなかったファイル:\n${rejected.join("\n")}`, true);
  if (!faces.length) {
    processing = false;
    return;
  }

  for (const { row, face } of faces) {
    try {
      row.thumbnail = makeThumbnail(face.image || face.canvas);
    } catch {
      /* サムネイルは無くても構わない */
    }
  }
  render();

  const needsOcr = faces.some(({ face }) => !(face.lines && face.lines.length));
  let worker = null;
  if (needsOcr) {
    try {
      worker = await getWorker();
    } catch (error) {
      faces.forEach(({ row }) => {
        row.pending = false;
      });
      render();
      saveRows();
      showStatus(error.message, true);
      processing = false;
      return;
    }
  }

  for (let index = 0; index < faces.length; index += 1) {
    const { row, face } = faces[index];
    showStatus(`読み取り中… (${index + 1}/${faces.length}) ${face.label}`, false, index / faces.length);
    try {
      const result = await analyzeFace(worker, face);
      Object.assign(row, result.fields, { ocrText: result.text, pending: false });
    } catch (error) {
      row.pending = false;
      row.confidence = { date: "none", vendor: "none", content: "none", category: "none", amount: "none", taxType: "none" };
      showStatus(`${face.label} の読み取りに失敗しました: ${error.message}`, true);
    }
    render();
  }

  saveRows();
  const needsCheck = faces.filter(({ row }) => lowConfidenceFields(row).length).length;
  showStatus(
    needsCheck
      ? `${faces.length}件を読み取りました。うち${needsCheck}件は確度が低い項目があります（枠がオレンジの欄）。内容を確認してください。`
      : `${faces.length}件を読み取りました。`,
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
