/* ============================================================
   OCR — レシート写真から日付・店名・金額・明細を読み取る
   Tesseract.js（日本語モデル）を同梱し、すべて端末内で処理する
   ============================================================ */

const OCR = (() => {
  /* Worker は blob URL で動くため、パスは絶対 URL にしておく */
  const abs = (path) => new URL(path, document.baseURI).href;

  const PATHS = {
    lib: abs("vendor/tesseract/tesseract.min.js"),
    worker: abs("vendor/tesseract/worker.min.js"),
    /* wasm を内蔵した単一ファイル版。Worker が blob URL で動いても
       .wasm の相対パス解決に失敗しないので、こちらを使う */
    coreSimd: abs("vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js"),
    core: abs("vendor/tesseract-core/tesseract-core-lstm.wasm.js"),
    lang: abs("vendor/tessdata"),
  };

  /* WebAssembly SIMD が使えるかどうか（使えると2倍近く速い） */
  function hasSimd() {
    try {
      return WebAssembly.validate(
        new Uint8Array([
          0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
          253, 15, 253, 98, 11,
        ])
      );
    } catch {
      return false;
    }
  }

  let libPromise = null;
  function loadLibrary() {
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const script = document.createElement("script");
      script.src = PATHS.lib;
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error("OCRライブラリを読み込めませんでした"));
      document.head.appendChild(script);
    });
    return libPromise;
  }

  let workerPromise = null;
  let progressHandler = null;

  function getWorker() {
    if (workerPromise) return workerPromise;
    workerPromise = loadLibrary()
      .then((Tesseract) =>
        Tesseract.createWorker("jpn", 1, {
          workerPath: PATHS.worker,
          corePath: hasSimd() ? PATHS.coreSimd : PATHS.core,
          langPath: PATHS.lang,
          gzip: true,
          logger: (m) => progressHandler && progressHandler(m),
        })
      )
      .catch((err) => {
        workerPromise = null;
        throw err;
      });
    return workerPromise;
  }

  /* ---------- 前処理：拡大・グレースケール・コントラスト強調 ---------- */

  const OCR_TARGET_WIDTH = 1600;
  const OCR_MAX_WIDTH = 2200;

  async function preprocess(source) {
    const img = await loadImage(source);
    const ratio = Math.min(OCR_MAX_WIDTH / img.width, Math.max(1, OCR_TARGET_WIDTH / img.width));
    const scale = img.width < OCR_TARGET_WIDTH ? Math.min(ratio, 2.5) : ratio;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;

    /* グレースケール化しつつ明るさのヒストグラムを取る */
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      const v = g | 0;
      px[i] = px[i + 1] = px[i + 2] = v;
      hist[v]++;
    }

    /* 上下2%を捨てた範囲に伸ばす（影や日焼けしたレシート対策） */
    const total = canvas.width * canvas.height;
    const cut = total * 0.02;
    let low = 0;
    let high = 255;
    for (let acc = 0, v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc > cut) { low = v; break; }
    }
    for (let acc = 0, v = 255; v >= 0; v--) {
      acc += hist[v];
      if (acc > cut) { high = v; break; }
    }
    if (high - low > 20) {
      const lut = new Uint8Array(256);
      for (let v = 0; v < 256; v++) {
        lut[v] = Math.max(0, Math.min(255, Math.round(((v - low) * 255) / (high - low))));
      }
      for (let i = 0; i < px.length; i += 4) {
        px[i] = px[i + 1] = px[i + 2] = lut[px[i]];
      }
    }

    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("画像を読み込めませんでした"));
      img.src = typeof source === "string" ? source : URL.createObjectURL(source);
    });
  }

  /* ---------- 読み取り本体 ---------- */

  async function recognize(source, onProgress) {
    progressHandler = onProgress || null;
    try {
      const canvas = await preprocess(source);
      const worker = await getWorker();
      const { data } = await worker.recognize(canvas);
      return { text: data.text || "", confidence: data.confidence || 0 };
    } finally {
      progressHandler = null;
    }
  }

  async function terminate() {
    if (!workerPromise) return;
    try {
      (await workerPromise).terminate();
    } catch {
      /* 破棄に失敗しても実害はない */
    }
    workerPromise = null;
  }

  /* ============================================================
     読み取ったテキストの解析
     ============================================================ */

  /* 全角英数と ￥ だけを半角にする。長音符「ー」は文字なので変換しない */
  const toHalfWidth = (text) =>
    text
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[￥]/g, "¥")
      .replace(/　/g, " ");

  /* 桁区切りの誤読を直す（「1, 480」「1、480」「1.480」→「1,480」） */
  const normalizeNumbers = (line) => line.replace(/(\d)\s*[,、､．.]\s*(\d{3})(?!\d)/g, "$1,$2");

  /* OCR は日本語の文字間に空白を入れがちなので、和文どうしの空白は詰める */
  const JP = "ぁ-んァ-ヴー々〆ヵヶ一-龠";
  const tidyJapanese = (text) =>
    text
      .replace(new RegExp(`([${JP}])[ ]+(?=[${JP}])`, "g"), "$1")
      .replace(new RegExp(`(\\d)[ ]+(?=[${JP}])`, "g"), "$1")
      .replace(new RegExp(`([${JP}])[ ]+(?=\\d)`, "g"), "$1")
      .trim();

  /* 数字の並びの中でだけ、よくある誤読を直す */
  function fixDigits(token) {
    return token.replace(/[OoDQ]/g, "0").replace(/[lI|]/g, "1").replace(/[Ss]/g, "5").replace(/[Bb]/g, "8");
  }

  const TOTAL_KEYS = /合\s*計|合訃|ご請求|請求金?額|お会計|お買上げ?計|買上計|総\s*額|総\s*計|税込\s*合?\s*計|お支払[い]?金?額/;
  const NOT_TOTAL = /小\s*計|中\s*計|お?預(り|かり)|お?釣り?|釣\s*銭|現\s*金|クレジ|カード|電子マネー|ポイント|point|残高|値引|割引|対象|税率|外税|内税|消費税|点数|個数/i;
  const NOISE = /^[\s\-=*※.,_|]+$/;

  /* 数量や内容量の単位が続く数字は金額ではない */
  const UNIT_AFTER = /^\s*(?:ml|mL|l|L|g|kg|cc|mm|cm|m|個|枚|本|袋|入|点|%|ｇ|人)/;

  function amountsIn(line) {
    const found = [];
    const re = /(?:[¥\\]\s*)?(\d{1,3}(?:,\d{3})+|\d{1,7})(?:\s*円)?/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const digits = m[1].replace(/,/g, "");
      const value = Number(digits);
      if (!Number.isFinite(value) || value <= 0 || value > 9999999) continue;
      if (UNIT_AFTER.test(line.slice(m.index + m[0].length))) continue;
      found.push({
        value,
        index: m.index,
        end: m.index + m[0].length,
        marked: /[¥\\]/.test(m[0]) || /円/.test(m[0]) || m[1].includes(","),
      });
    }
    return found;
  }

  function splitLines(text) {
    return toHalfWidth(text)
      .split(/\r?\n/)
      .map((l) => tidyJapanese(normalizeNumbers(l.replace(/\s+/g, " ").trim())))
      .filter((l) => l && !NOISE.test(l));
  }

  /* 「小計」「消費税」など、ラベルのついた金額を拾う */
  function findLabeled(lines, re) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!re.test(lines[i])) continue;
      const amounts = amountsIn(lines[i]);
      if (amounts.length) return amounts[amounts.length - 1].value;
    }
    return null;
  }

  function findTotal(lines) {
    /* レシートは 小計 → 消費税 → 合計 → お預り の順が多いので、
       条件に合う「最後の」合計行を採用する */
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!TOTAL_KEYS.test(line) || NOT_TOTAL.test(line)) continue;
      const here = amountsIn(line);
      if (here.length) return here[here.length - 1].value;
      /* 「合計」の次の行に金額があるレイアウトも拾う */
      const next = lines[i + 1] ? amountsIn(lines[i + 1]) : [];
      if (next.length) return next[next.length - 1].value;
    }
    return null;
  }

  /* 日付・時刻・電話番号のように、金額ではない数字が並ぶ行 */
  const DATE_OR_TIME = /20\d{2}\s*[年\/\-.]|\d{1,2}\s*[:：]\s*\d{2}|\d{2,4}-\d{2,4}-\d{3,4}/;
  /* 住所の番地（1-2-3）は金額でも明細でもない */
  const ADDRESS = /〒|[都道府県][^\s]{0,8}[市区町村]|\d+\s*[-−]\s*\d+\s*[-−]?\s*\d*$/;

  function amountCandidates(lines) {
    const seen = new Map();
    lines.forEach((line) => {
      if (DATE_OR_TIME.test(line) || ADDRESS.test(line)) return;
      if (/tel|電話|〒|no\.|レジ|伝票|責任/i.test(line)) return;
      amountsIn(line).forEach((a) => {
        if (a.value < 10) return;
        const score =
          (a.marked ? 2 : 0) +
          (TOTAL_KEYS.test(line) && !NOT_TOTAL.test(line) ? 5 : 0) -
          (NOT_TOTAL.test(line) ? 3 : 0);
        const prev = seen.has(a.value) ? seen.get(a.value) : -Infinity;
        seen.set(a.value, Math.max(prev, score));
      });
    });
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1] || b[0] - a[0])
      .slice(0, 6)
      .map(([value]) => value);
  }

  function makeDate(year, month, day) {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
    const now = new Date().getFullYear();
    if (year < 2000 || year > now + 1) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function findDate(text) {
    const t = toHalfWidth(text);
    const patterns = [
      [/(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/, (m) => makeDate(+m[1], +m[2], +m[3])],
      [/(?:令和|R)\s*(\d{1,2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/, (m) => makeDate(2018 + +m[1], +m[2], +m[3])],
      [/(?:平成|H)\s*(\d{1,2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/, (m) => makeDate(1988 + +m[1], +m[2], +m[3])],
      [/(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/, (m) => makeDate(2000 + +m[1], +m[2], +m[3])],
    ];
    for (const [re, build] of patterns) {
      const m = t.match(re);
      if (m) {
        const date = build(m);
        if (date) return date;
      }
    }
    return null;
  }

  function findStore(lines) {
    const skip = /領収|レシート|receipt|tel|電話|fax|〒|http|www|no\.|レジ|伝票|担当|様$/i;
    for (const line of lines.slice(0, 8)) {
      const name = tidyJapanese(line.replace(/^[*※\-=\s]+|[*※\-=\s]+$/g, ""));
      if (name.length < 2 || name.length > 28) continue;
      if (skip.test(name)) continue;
      const digits = (name.match(/\d/g) || []).length;
      if (digits > name.length / 3) continue;
      return name;
    }
    return "";
  }

  function findItems(lines, total, subtotal) {
    const items = [];
    for (const line of lines) {
      if (TOTAL_KEYS.test(line) || NOT_TOTAL.test(line) || /税/.test(line)) continue;
      if (DATE_OR_TIME.test(line)) continue;
      const m = line.match(/^(.{1,28}?)\s*[¥\\]?\s*(\d{1,3}(?:,\d{3})*|\d{1,6})\s*[※*]?$/);
      if (!m) continue;
      if (ADDRESS.test(line)) continue;
      if (/[-−]\s*$/.test(m[1])) continue; // 「1-2-3」のような番地の一部

      /* 「￥」は「洲」「半」「\」などに誤読されやすいので、品名の末尾から取り除く */
      let name = tidyJapanese(m[1].replace(/[\s.…・洲半川\\¥]+$/, ""));
      const amount = Number(fixDigits(m[2]).replace(/,/g, ""));
      if (!name || !Number.isFinite(amount) || amount <= 0 || amount > 999999) continue;
      if (!/[^\d\s.,\-]/.test(name)) continue; // 数字だけの行は明細ではない

      let qty = 1;
      const qtyMatch = name.match(/[×xX*]\s*(\d{1,2})\s*$/) || name.match(/(\d{1,2})\s*点\s*$/);
      if (qtyMatch) {
        qty = Number(qtyMatch[1]) || 1;
        name = name.slice(0, qtyMatch.index).trim();
      }
      if (!name) continue;

      items.push({ name, qty, price: qty > 1 ? Math.round(amount / qty) : amount });
    }

    if (!items.length) return [];
    /* 明細の合計が「合計」か「小計」のどちらかとほぼ一致するときだけ採用する。
       外税のレシートでは明細の和は小計に一致する。 */
    const sum = items.reduce((acc, it) => acc + it.qty * it.price, 0);
    const matches = (target) => target && Math.abs(sum - target) <= Math.max(3, target * 0.03);
    return matches(total) || matches(subtotal) ? items : [];
  }

  /* 小計・消費税・合計の関係から、税率と「単価が税込か税抜か」を推定する */
  function inferTax(total, subtotal, tax) {
    const snap = (rate) => (rate >= 9 ? 10 : rate >= 6.5 ? 8 : rate <= 1 ? 0 : null);

    if (subtotal && tax && total && Math.abs(subtotal + tax - total) <= 2) {
      return { taxMode: "excluded", taxRate: snap((tax / subtotal) * 100) };
    }
    if (total && tax && total > tax) {
      return { taxMode: "included", taxRate: snap((tax / (total - tax)) * 100) };
    }
    return { taxMode: null, taxRate: null };
  }

  const CATEGORY_HINTS = [
    [/スーパー|マート|ストア|青果|精肉|鮮魚|食品|ベーカリー|イオン|ライフ|マルエツ|西友|イトーヨーカ|業務スーパー|セブン|ローソン|ファミリーマート|ミニストップ|食堂|レストラン|カフェ|珈琲|コーヒー|ラーメン|寿司|居酒屋|マクドナルド|吉野家|すき家|弁当/i, "food"],
    [/ドラッグ|薬局|薬品|ファーマシー|クリニック|医院|病院|歯科|整骨|接骨/i, "health"],
    [/ホームセンター|ダイソー|セリア|キャンドゥ|100円|雑貨|キホーテ|無印良品|ニトリ|カインズ|コーナン/i, "daily"],
    [/jr|鉄道|電鉄|バス|タクシー|地下鉄|乗車|きっぷ|定期券|ガソリン|eneos|出光|コスモ石油|高速|駐車|パーキング/i, "transport"],
    [/電力|電気|ガス|水道|不動産|家賃|管理費|東京電力|関西電力/i, "utility"],
    [/ドコモ|docomo|au|ソフトバンク|softbank|楽天モバイル|通信|プロバイダ|nuro|光回線/i, "comm"],
    [/書店|ブック|映画|シネマ|ゲーム|カラオケ|レジャー|旅行|ホテル|スポーツ|ジム/i, "fun"],
  ];

  function guessCategory(text) {
    for (const [re, id] of CATEGORY_HINTS) {
      if (re.test(text)) return id;
    }
    return null;
  }

  function parse(text) {
    const lines = splitLines(text);
    const total = findTotal(lines);
    const subtotal = findLabeled(lines, /小\s*計|税抜\s*計/);
    const tax = findLabeled(lines, /消費\s*税|税\s*額|内\s*税|外\s*税/);
    const candidates = amountCandidates(lines);
    const inferred = inferTax(total, subtotal, tax);

    return {
      lines,
      total: total ?? (candidates.length ? candidates[0] : null),
      totalFromKeyword: total !== null,
      subtotal,
      tax,
      candidates,
      date: findDate(text),
      store: findStore(lines),
      items: findItems(lines, total, subtotal),
      taxMode: inferred.taxMode,
      taxRate: inferred.taxRate ?? (/8\s*%|軽減/.test(toHalfWidth(text)) ? 8 : null),
      category: guessCategory(toHalfWidth(text)),
    };
  }

  return { recognize, parse, terminate, hasSimd };
})();
