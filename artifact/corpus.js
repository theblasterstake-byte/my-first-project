/* 評価用の領収書コーパス。ブラウザ側で canvas に描画して画像にする。
 * 実物の写真は手元にないため、レイアウト・書体・傾き・コントラスト・ノイズを
 * 変えた合成画像で、抽出ルールの取りこぼしを測る。 */

const CORPUS_SOURCE = `
function drawReceipt(spec) {
  const width = spec.width || 620;
  const height = spec.height || 900;
  const base = document.createElement("canvas");
  base.width = width;
  base.height = height;
  const ctx = base.getContext("2d");

  ctx.fillStyle = spec.paper || "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const font = spec.font || "IPAGothic";
  ctx.fillStyle = spec.ink || "#111111";
  ctx.textBaseline = "top";

  let y = spec.top || 40;
  for (const line of spec.lines) {
    const size = line.size || 24;
    ctx.font = (line.bold ? "bold " : "") + size + "px " + font;
    if (line.text) {
      let x = spec.left || 40;
      if (line.align === "center") {
        x = (width - ctx.measureText(line.text).width) / 2;
      } else if (line.align === "right") {
        x = width - 40 - ctx.measureText(line.text).width;
      } else if (line.right) {
        // 品目と金額を左右に振り分ける（レシートの明細行）
        ctx.fillText(line.text, x, y);
        const rightText = line.right;
        ctx.fillText(rightText, width - 40 - ctx.measureText(rightText).width, y);
        y += size + (line.gap === undefined ? 10 : line.gap);
        continue;
      }
      ctx.fillText(line.text, x, y);
    }
    y += size + (line.gap === undefined ? 10 : line.gap);
  }

  let canvas = base;

  if (spec.rotate) {
    const radians = (spec.rotate * Math.PI) / 180;
    const swap = Math.abs(spec.rotate) === 90 || Math.abs(spec.rotate) === 270;
    const out = document.createElement("canvas");
    out.width = swap ? height : width;
    out.height = swap ? width : height;
    const octx = out.getContext("2d");
    octx.fillStyle = spec.paper || "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.translate(out.width / 2, out.height / 2);
    octx.rotate(radians);
    octx.drawImage(canvas, -width / 2, -height / 2);
    canvas = out;
  }

  if (spec.tilt) {
    const radians = (spec.tilt * Math.PI) / 180;
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d");
    octx.fillStyle = spec.paper || "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.translate(out.width / 2, out.height / 2);
    octx.rotate(radians);
    octx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    canvas = out;
  }

  if (spec.dim || spec.noise || spec.blur) {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d");
    if (spec.blur) octx.filter = "blur(" + spec.blur + "px)";
    octx.drawImage(canvas, 0, 0);
    octx.filter = "none";

    if (spec.dim) {
      // 影が落ちた写真のように、片側を暗くしてコントラストを下げる
      const gradient = octx.createLinearGradient(0, 0, out.width, out.height);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(1, "rgba(0,0,0," + spec.dim + ")");
      octx.fillStyle = gradient;
      octx.fillRect(0, 0, out.width, out.height);
    }

    if (spec.noise) {
      const image = octx.getImageData(0, 0, out.width, out.height);
      const pixels = image.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const jitter = (Math.random() - 0.5) * spec.noise;
        pixels[i] = Math.max(0, Math.min(255, pixels[i] + jitter));
        pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + jitter));
        pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + jitter));
      }
      octx.putImageData(image, 0, 0);
    }
    canvas = out;
  }

  return canvas;
}
`;

/* 各件: 描画指定 + 正解。vendor は部分一致で判定する。 */
const CASES = [
  {
    name: "コンビニ（明細・軽減税率混在）",
    truth: { date: "2024-01-05", vendor: "セブン", category: "消耗品費", amount: "1205", taxType: "課税10%" },
    spec: {
      width: 620,
      height: 900,
      lines: [
        { text: "セブン-イレブン 渋谷道玄坂店", size: 28 },
        { text: "東京都渋谷区道玄坂1-2-3", size: 20 },
        { text: "TEL 03-1234-5678", size: 20, gap: 24 },
        { text: "2024年1月5日(金) 18:42", size: 24, gap: 24 },
        { text: "領　収　証", size: 30, align: "center", gap: 24 },
        { text: "コピー用紙 A4", right: "398", size: 24 },
        { text: "※おにぎり 鮭", right: "138", size: 24 },
        { text: "ボールペン 黒", right: "150", size: 24 },
        { text: "電池 単3 4本", right: "519", size: 24, gap: 20 },
        { text: "小計", right: "1,205", size: 24 },
        { text: "合計", right: "￥1,205", size: 30, bold: true },
        { text: "(8%対象", right: "138)", size: 20 },
        { text: "(10%対象", right: "1,067)", size: 20, gap: 20 },
        { text: "お預り", right: "2,000", size: 22 },
        { text: "お釣", right: "795", size: 22 },
      ],
    },
  },
  {
    name: "タクシー（和暦）",
    truth: { date: "2024-03-12", vendor: "日本交通", category: "旅費交通費", amount: "3480", taxType: "課税10%" },
    spec: {
      width: 560,
      height: 760,
      lines: [
        { text: "領収書", size: 32, align: "center", gap: 24 },
        { text: "日本交通株式会社", size: 26 },
        { text: "渋谷営業所　車両番号 12-34", size: 20, gap: 24 },
        { text: "令和6年3月12日", size: 26, gap: 20 },
        { text: "乗車 18:20", right: "降車 18:45", size: 22 },
        { text: "走行 5.2km", size: 22, gap: 20 },
        { text: "運賃", right: "3,480円", size: 26 },
        { text: "うち消費税10%", right: "316円", size: 20, gap: 16 },
        { text: "合計", right: "3,480円", size: 30, bold: true },
      ],
    },
  },
  {
    name: "手書き風（但し書き・金○○円也）",
    truth: { date: "2023-11-30", vendor: "ミーティングルーム東京", category: "会議費", amount: "55000", taxType: "課税10%" },
    spec: {
      width: 700,
      height: 560,
      lines: [
        { text: "領　収　書", size: 36, align: "center", gap: 30 },
        { text: "株式会社サンプル商事　様", size: 24, gap: 26 },
        { text: "金　55,000円也", size: 34, bold: true, gap: 26 },
        { text: "但し　会議室利用料として", size: 24 },
        { text: "上記正に領収いたしました", size: 22, gap: 26 },
        { text: "2023年11月30日", size: 24, gap: 20 },
        { text: "有限会社ミーティングルーム東京", size: 24 },
        { text: "東京都新宿区西新宿9-9-9", size: 20 },
        { text: "消費税10% 5,000円", size: 20 },
      ],
    },
  },
  {
    name: "飲食店（外税・小計＋消費税）",
    truth: { date: "2024-12-08", vendor: "オーベルジュ", category: "接待交際費", amount: "24200", taxType: "課税10%" },
    spec: {
      width: 600,
      height: 820,
      lines: [
        { text: "レストラン オーベルジュ", size: 28, align: "center" },
        { text: "東京都港区南青山3-3-3", size: 18, align: "center", gap: 26 },
        { text: "2024/12/08 19:30", size: 22, gap: 22 },
        { text: "お料理 コース×2", right: "20,000", size: 22 },
        { text: "ドリンク", right: "2,000", size: 22, gap: 18 },
        { text: "小計", right: "22,000", size: 24 },
        { text: "消費税(10%)", right: "2,200", size: 22, gap: 18 },
        { text: "合計", right: "￥24,200", size: 30, bold: true },
        { text: "クレジットカード", right: "24,200", size: 20 },
      ],
    },
  },
  {
    name: "書店（2桁年・内税）",
    truth: { date: "2024-05-07", vendor: "紀伊國屋", category: "新聞図書費", amount: "2750", taxType: "課税10%" },
    spec: {
      width: 560,
      height: 700,
      lines: [
        { text: "紀伊國屋書店 新宿本店", size: 26 },
        { text: "TEL 03-3354-0131", size: 18, gap: 24 },
        { text: "24/05/07 14:03", size: 22, gap: 22 },
        { text: "経理実務の本", right: "2,750", size: 22, gap: 18 },
        { text: "合計", right: "2,750", size: 28, bold: true },
        { text: "(内消費税等", right: "250)", size: 20 },
        { text: "10%対象", right: "2,750", size: 20, gap: 18 },
        { text: "現金", right: "3,000", size: 20 },
        { text: "お釣", right: "250", size: 20 },
      ],
    },
  },
  {
    name: "郵便局（非課税）",
    truth: { date: "2026-04-02", vendor: "郵便", category: "通信費", amount: "940", taxType: "非課税" },
    spec: {
      width: 540,
      height: 640,
      lines: [
        { text: "日本郵便株式会社", size: 26 },
        { text: "新宿郵便局", size: 22, gap: 24 },
        { text: "2026/04/02", size: 22, gap: 22 },
        { text: "レターパックプラス", right: "520", size: 22 },
        { text: "切手 84円×5", right: "420", size: 22, gap: 18 },
        { text: "合計", right: "940円", size: 28, bold: true },
        { text: "郵便料金は非課税です", size: 18 },
      ],
    },
  },
  {
    name: "ガソリンスタンド（数字が多い）",
    truth: { date: "2024-07-21", vendor: "ENEOS", category: "旅費交通費", amount: "6820", taxType: "課税10%" },
    spec: {
      width: 580,
      height: 760,
      lines: [
        { text: "ENEOS 環八高井戸SS", size: 26 },
        { text: "株式会社サンプル石油", size: 20, gap: 24 },
        { text: "2024年7月21日 09:15", size: 22, gap: 22 },
        { text: "ハイオク 40.12L", right: "@170", size: 22 },
        { text: "給油額", right: "6,820", size: 22, gap: 18 },
        { text: "合計金額", right: "￥6,820", size: 28, bold: true },
        { text: "内消費税(10%)", right: "620", size: 20 },
      ],
    },
  },
  {
    name: "ホテル（和暦・宿泊）",
    truth: { date: "2025-02-14", vendor: "ホテル", category: "旅費交通費", amount: "18700", taxType: "課税10%" },
    spec: {
      width: 620,
      height: 800,
      lines: [
        { text: "ホテルサンプル大阪", size: 28, align: "center", gap: 24 },
        { text: "領収書", size: 26, align: "center", gap: 24 },
        { text: "令和7年2月14日", size: 24, gap: 20 },
        { text: "ご宿泊料金 1泊", right: "17,000", size: 22 },
        { text: "サービス料", right: "1,700", size: 22, gap: 18 },
        { text: "ご請求金額", right: "￥18,700", size: 30, bold: true },
        { text: "消費税10%を含みます", size: 18 },
      ],
    },
  },
  {
    name: "電気料金（期間表記あり）",
    truth: { date: "2024-09-30", vendor: "電力", category: "水道光熱費", amount: "12480", taxType: "課税10%" },
    spec: {
      width: 640,
      height: 820,
      lines: [
        { text: "東京電力エナジーパートナー株式会社", size: 24 },
        { text: "電気ご使用量のお知らせ", size: 22, gap: 24 },
        { text: "ご使用期間 2024年8月25日〜2024年9月24日", size: 20 },
        { text: "検針日 2024年9月25日", size: 20 },
        { text: "お支払期日 2024年10月15日", size: 20, gap: 22 },
        { text: "領収日 2024年9月30日", size: 22, gap: 20 },
        { text: "ご使用量", right: "312kWh", size: 22 },
        { text: "請求金額", right: "12,480円", size: 28, bold: true },
        { text: "消費税等相当額(10%)", right: "1,134円", size: 20 },
      ],
    },
  },
  {
    name: "回転（90度・写真の向き違い）",
    truth: { date: "2024-06-03", vendor: "ドトール", category: "会議費", amount: "880", taxType: "課税10%" },
    spec: {
      width: 520,
      height: 700,
      rotate: 90,
      lines: [
        { text: "ドトールコーヒーショップ", size: 26 },
        { text: "新橋店", size: 20, gap: 24 },
        { text: "2024年6月3日 10:12", size: 22, gap: 22 },
        { text: "ブレンドコーヒー M", right: "440", size: 22 },
        { text: "アイスカフェラテ M", right: "440", size: 22, gap: 18 },
        { text: "合計", right: "880", size: 28, bold: true },
        { text: "(10%対象", right: "880)", size: 20 },
      ],
    },
  },
  {
    name: "薄暗い写真（傾き・ノイズ）",
    truth: { date: "2024-10-11", vendor: "カインズ", category: "消耗品費", amount: "3278", taxType: "課税10%" },
    spec: {
      width: 620,
      height: 820,
      tilt: 2.5,
      dim: 0.45,
      noise: 26,
      lines: [
        { text: "カインズホーム 川崎店", size: 28 },
        { text: "TEL 044-000-0000", size: 20, gap: 24 },
        { text: "2024年10月11日 16:40", size: 24, gap: 22 },
        { text: "収納ボックス", right: "1,980", size: 24 },
        { text: "掃除用洗剤", right: "698", size: 24 },
        { text: "軍手 5双", right: "600", size: 24, gap: 20 },
        { text: "合計", right: "3,278", size: 30, bold: true },
        { text: "(10%対象", right: "3,278)", size: 20 },
      ],
    },
  },
  {
    name: "小さく写った領収書（低解像度）",
    truth: { date: "2024-03-01", vendor: "アスクル", category: "消耗品費", amount: "5478", taxType: "課税10%" },
    spec: {
      width: 300,
      height: 420,
      top: 20,
      left: 18,
      lines: [
        { text: "アスクル株式会社", size: 15 },
        { text: "2024年3月1日", size: 13, gap: 8 },
        { text: "コピー用紙 5冊", right: "3,300", size: 13 },
        { text: "トナー", right: "1,980", size: 13, gap: 8 },
        { text: "合計", right: "5,478", size: 17, bold: true },
        { text: "(10%対象 5,478)", size: 12 },
      ],
    },
  },
];

module.exports = { CORPUS_SOURCE, CASES };
