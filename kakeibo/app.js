/* ============================================================
   レシート家計簿
   レシート／領収書を作成 → そのまま家計簿に記録されるツール
   データは localStorage にのみ保存（端末内で完結）
   ============================================================ */

const STORAGE_KEY = "kakeibo:v1";

/* カテゴリは固定の並び順で、色もこの順に固定で割り当てる
   （表示順や金額順で色が入れ替わらないようにするため） */
const CATEGORIES = [
  { id: "food", label: "食費", color: "var(--series-1)" },
  { id: "daily", label: "日用品", color: "var(--series-2)" },
  { id: "transport", label: "交通費", color: "var(--series-3)" },
  { id: "utility", label: "住居・光熱", color: "var(--series-4)" },
  { id: "comm", label: "通信", color: "var(--series-5)" },
  { id: "fun", label: "趣味・娯楽", color: "var(--series-6)" },
  { id: "health", label: "健康・医療", color: "var(--series-7)" },
  { id: "other", label: "その他", color: "var(--series-other)" },
];

const PAYMENTS = {
  cash: "現金",
  card: "クレジットカード",
  emoney: "電子マネー / QR",
  transfer: "口座振替 / 振込",
};

const MAX_PHOTO_EDGE = 1000;
const PHOTO_QUALITY = 0.65;

/* ---------- 状態 ---------- */

let store = {
  records: [],
  settings: { budget: 0, issuer: "", issuerDetail: "", taxRate: "10" },
};

let ui = {
  tab: "create",
  month: monthKey(new Date()),
  editingId: null,
  photo: null,
  detailId: null,
  docId: null,
};

/* ---------- 汎用ヘルパー ---------- */

const $ = (id) => document.getElementById(id);

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key, step) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + step, 1);
  return monthKey(d);
}

function formatMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return `${y}年${m}月`;
}

function yen(value) {
  const n = Math.round(Number(value) || 0);
  return `¥${n.toLocaleString("ja-JP")}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日(${wd})`;
}

function categoryOf(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}

function newId() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

let toastTimer = null;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

/* ---------- 保存・読み込み ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.records)) store.records = parsed.records;
    if (parsed.settings) store.settings = { ...store.settings, ...parsed.settings };
  } catch (err) {
    console.warn("保存データを読み込めませんでした", err);
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (err) {
    toast("保存できませんでした。写真を減らすか、古い記録を削除してください。");
    console.warn(err);
    return false;
  }
}

/* ---------- 金額の計算 ---------- */

function computeTotals(items, taxRate, taxMode) {
  const rate = Number(taxRate) || 0;
  const sum = items.reduce((acc, it) => acc + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  if (rate === 0) return { subtotal: Math.round(sum), tax: 0, total: Math.round(sum) };
  if (taxMode === "included") {
    const total = Math.round(sum);
    const tax = Math.round((total * rate) / (100 + rate));
    return { subtotal: total - tax, tax, total };
  }
  const subtotal = Math.round(sum);
  const tax = Math.round((subtotal * rate) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/* ============================================================
   タブ切り替え
   ============================================================ */

function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll(".view").forEach((v) => {
    v.hidden = v.dataset.view !== tab;
  });
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.tab === tab);
  });
  window.scrollTo({ top: 0 });
  if (tab === "list") renderList();
  if (tab === "report") renderReport();
  if (tab === "settings") renderSettings();
}

/* ============================================================
   作成タブ
   ============================================================ */

function itemRowHtml(item = { name: "", qty: 1, price: "" }) {
  return `
    <div class="item-row">
      <input type="text" class="item-name" placeholder="品名" value="${escapeHtml(item.name)}" autocomplete="off">
      <input type="number" class="item-qty" inputmode="numeric" min="0" step="1" value="${escapeHtml(item.qty)}" aria-label="数量">
      <input type="number" class="item-price" inputmode="decimal" min="0" step="1" value="${escapeHtml(item.price)}" placeholder="単価" aria-label="単価">
      <button type="button" class="item-del" aria-label="この行を削除">×</button>
    </div>`;
}

function renderItems(items) {
  const head = `<div class="items-head"><span>品名</span><span>数量</span><span>単価</span><span></span></div>`;
  $("items").innerHTML = head + items.map(itemRowHtml).join("");
}

function readItems() {
  return [...document.querySelectorAll(".item-row")].map((row) => ({
    name: row.querySelector(".item-name").value.trim(),
    qty: Number(row.querySelector(".item-qty").value) || 0,
    price: Number(row.querySelector(".item-price").value) || 0,
  }));
}

function updateTotals() {
  const totals = computeTotals(readItems(), $("f-taxrate").value, $("f-taxmode").value);
  $("t-subtotal").textContent = yen(totals.subtotal);
  $("t-tax").textContent = yen(totals.tax);
  $("t-total").textContent = yen(totals.total);
  return totals;
}

function setDocType(type) {
  document.body.classList.toggle("is-invoice", type === "invoice");
  document.querySelectorAll(".seg-btn").forEach((b) => {
    const active = b.dataset.doctype === type;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", String(active));
  });
  $("preview-btn").textContent = type === "invoice" ? "領収書を表示" : "レシートを表示";
}

function currentDocType() {
  return document.body.classList.contains("is-invoice") ? "invoice" : "receipt";
}

function setPhoto(dataUrl) {
  ui.photo = dataUrl || null;
  const wrap = $("photo-preview");
  if (dataUrl) {
    $("photo-img").src = dataUrl;
    wrap.hidden = false;
  } else {
    $("photo-img").removeAttribute("src");
    wrap.hidden = true;
    $("f-photo").value = "";
  }
}

function resetForm() {
  ui.editingId = null;
  $("receipt-form").reset();
  $("f-date").value = todayISO();
  $("f-taxrate").value = store.settings.taxRate || "10";
  $("f-taxmode").value = "included";
  setDocType("receipt");
  renderItems([{ name: "", qty: 1, price: "" }]);
  setPhoto(null);
  updateTotals();
  $("save-btn").textContent = "家計簿に記録";
  $("cancel-edit").hidden = true;
}

function fillFormFrom(record) {
  ui.editingId = record.id;
  setDocType(record.docType || "receipt");
  $("f-date").value = record.date;
  $("f-store").value = record.store || "";
  $("f-payee").value = record.payee || "";
  $("f-note").value = record.note || "";
  $("f-taxrate").value = String(record.taxRate ?? "10");
  $("f-taxmode").value = record.taxMode || "included";
  $("f-category").value = record.category;
  $("f-payment").value = record.payment;
  $("f-memo").value = record.memo || "";
  renderItems(record.items.length ? record.items : [{ name: "", qty: 1, price: "" }]);
  setPhoto(record.photo || null);
  updateTotals();
  $("save-btn").textContent = "変更を保存";
  $("cancel-edit").hidden = false;
  setTab("create");
}

function handleSubmit(event) {
  event.preventDefault();
  const items = readItems().filter((it) => it.name || it.price);
  const totals = computeTotals(items, $("f-taxrate").value, $("f-taxmode").value);

  if (!$("f-date").value) {
    toast("日付を入力してください。");
    return;
  }
  if (totals.total <= 0) {
    toast("金額を入力してください。");
    return;
  }

  const record = {
    id: ui.editingId || newId(),
    docType: currentDocType(),
    date: $("f-date").value,
    store: $("f-store").value.trim(),
    payee: $("f-payee").value.trim(),
    note: $("f-note").value.trim(),
    items,
    taxRate: Number($("f-taxrate").value),
    taxMode: $("f-taxmode").value,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    category: $("f-category").value,
    payment: $("f-payment").value,
    memo: $("f-memo").value.trim(),
    photo: ui.photo,
    issuer: store.settings.issuer,
    issuerDetail: store.settings.issuerDetail,
    createdAt: ui.editingId
      ? store.records.find((r) => r.id === ui.editingId)?.createdAt || Date.now()
      : Date.now(),
  };

  const editing = Boolean(ui.editingId);
  if (editing) {
    const index = store.records.findIndex((r) => r.id === ui.editingId);
    store.records[index] = record;
  } else {
    store.records.push(record);
  }

  if (!save()) {
    if (!editing) store.records.pop();
    return;
  }

  ui.month = record.date.slice(0, 7);
  resetForm();
  renderStoreSuggestions();
  toast(editing ? "変更を保存しました" : `${yen(record.total)} を記録しました`);
  setTab("list");
}

/* 写真は端末内に持つのでリサイズしてから保存する */
async function compressImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を読み込めませんでした"));
    image.src = dataUrl;
  });

  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
}

/* ============================================================
   明細タブ
   ============================================================ */

function recordsOfMonth(month) {
  return store.records
    .filter((r) => r.date.slice(0, 7) === month)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)));
}

function renderList() {
  $("list-month").textContent = formatMonth(ui.month);

  const keyword = $("search-input").value.trim().toLowerCase();
  const categoryFilter = $("filter-category").value;
  const monthRecords = recordsOfMonth(ui.month);

  const filtered = monthRecords.filter((r) => {
    if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
    if (!keyword) return true;
    const haystack = [r.store, r.memo, r.note, r.payee, ...r.items.map((i) => i.name)]
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });

  const total = filtered.reduce((sum, r) => sum + r.total, 0);
  $("list-total").textContent = yen(total);
  $("list-count").textContent = `${filtered.length}件`;

  const groups = new Map();
  filtered.forEach((r) => {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  });

  $("record-list").innerHTML = [...groups.entries()]
    .map(([date, records]) => {
      const daySum = records.reduce((sum, r) => sum + r.total, 0);
      return `
        <div class="day-group">
          <div class="day-head">
            <strong>${formatDate(date)}</strong>
            <span class="day-sum">${yen(daySum)}</span>
          </div>
          ${records.map(recordHtml).join("")}
        </div>`;
    })
    .join("");

  $("list-empty").hidden = filtered.length > 0;
}

function recordHtml(record) {
  const cat = categoryOf(record.category);
  const title = record.store || record.items.find((i) => i.name)?.name || "（店名なし）";
  const meta = [cat.label, PAYMENTS[record.payment] || "", record.memo]
    .filter(Boolean)
    .join(" · ");
  const badge = record.docType === "invoice" ? '<span class="badge">領収書</span>' : "";
  const thumb = record.photo
    ? `<img class="rec-photo" src="${record.photo}" alt="">`
    : "";
  return `
    <button type="button" class="record" data-id="${record.id}">
      <span class="rec-dot" style="background:${cat.color}"></span>
      ${thumb}
      <span class="rec-body">
        <span class="rec-title">${escapeHtml(title)}${badge}</span>
        <span class="rec-meta">${escapeHtml(meta)}</span>
      </span>
      <span class="rec-amount">${yen(record.total)}</span>
    </button>`;
}

/* ---------- 詳細シート ---------- */

function openDetail(id) {
  const record = store.records.find((r) => r.id === id);
  if (!record) return;
  ui.detailId = id;

  const cat = categoryOf(record.category);
  const rows = [
    ["日付", formatDate(record.date)],
    ["店名 / 発行者", record.store || "—"],
    ["カテゴリ", cat.label],
    ["支払方法", PAYMENTS[record.payment] || "—"],
    ["小計", yen(record.subtotal)],
    ["消費税", `${yen(record.tax)}（${record.taxRate}%）`],
  ];
  if (record.docType === "invoice") {
    rows.splice(2, 0, ["宛名", record.payee ? `${record.payee} 様` : "—"]);
    rows.splice(3, 0, ["但し書き", record.note || "—"]);
  }
  if (record.memo) rows.push(["メモ", record.memo]);

  const itemsHtml = record.items.filter((i) => i.name).length
    ? `<div class="detail-rows" style="margin-top:12px">${record.items
        .filter((i) => i.name || i.price)
        .map(
          (i) =>
            `<div><span class="k">${escapeHtml(i.name || "（品名なし）")} ×${i.qty}</span><span class="v">${yen(
              i.qty * i.price
            )}</span></div>`
        )
        .join("")}</div>`
    : "";

  $("detail-body").innerHTML = `
    <p class="detail-amount">${yen(record.total)}</p>
    <div class="detail-rows">
      ${rows
        .map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${escapeHtml(v)}</span></div>`)
        .join("")}
    </div>
    ${itemsHtml}
    ${record.photo ? `<img class="detail-photo" src="${record.photo}" alt="レシートの写真">` : ""}`;

  $("detail-sheet").hidden = false;
}

function closeDetail() {
  $("detail-sheet").hidden = true;
  ui.detailId = null;
}

function deleteCurrentRecord() {
  const record = store.records.find((r) => r.id === ui.detailId);
  if (!record) return;
  if (!confirm(`${record.store || "この記録"}（${yen(record.total)}）を削除しますか？`)) return;
  store.records = store.records.filter((r) => r.id !== ui.detailId);
  save();
  closeDetail();
  renderList();
  toast("削除しました");
}

/* ============================================================
   伝票（レシート／領収書）の表示・印刷
   ============================================================ */

function buildDocData() {
  const items = readItems().filter((it) => it.name || it.price);
  const totals = computeTotals(items, $("f-taxrate").value, $("f-taxmode").value);
  return {
    docType: currentDocType(),
    date: $("f-date").value || todayISO(),
    store: $("f-store").value.trim(),
    payee: $("f-payee").value.trim(),
    note: $("f-note").value.trim(),
    items,
    taxRate: Number($("f-taxrate").value),
    ...totals,
    payment: $("f-payment").value,
    issuer: store.settings.issuer,
    issuerDetail: store.settings.issuerDetail,
  };
}

function paperHtml(doc) {
  const [y, m, d] = doc.date.split("-").map(Number);
  const dateText = `${y}年${m}月${d}日`;
  const issuer = [doc.issuer, doc.issuerDetail].filter(Boolean).join("\n");

  const itemLines = doc.items
    .filter((i) => i.name || i.price)
    .map(
      (i) => `<div class="p-item">
          <span class="n">${escapeHtml(i.name || "（品名なし）")}</span>
          <span class="q">${i.qty} × ${yen(i.price)}</span>
          <span class="a">${yen(i.qty * i.price)}</span>
        </div>`
    )
    .join("");

  const taxLines = `
    <div class="p-row"><span>小計</span><span class="r">${yen(doc.subtotal)}</span></div>
    <div class="p-row"><span>消費税 (${doc.taxRate}%)</span><span class="r">${yen(doc.tax)}</span></div>`;

  if (doc.docType === "invoice") {
    return `
      <p class="doc-title">領収書</p>
      <p class="doc-sub">${dateText}</p>
      <div class="p-payee">${escapeHtml(doc.payee || "　")} 様</div>
      <div class="p-amount">${yen(doc.total)}</div>
      <div class="p-row"><span>但し</span><span class="r">${escapeHtml(doc.note || "お品代")}として</span></div>
      <p style="margin:10px 0 0">上記正に領収いたしました。</p>
      <hr>
      ${itemLines}
      ${itemLines ? "<hr>" : ""}
      ${taxLines}
      <div class="p-row p-total"><span>合計</span><span class="r">${yen(doc.total)}</span></div>
      <div class="p-row"><span>お支払方法</span><span class="r">${PAYMENTS[doc.payment] || ""}</span></div>
      ${issuer ? `<div class="p-issuer">${escapeHtml(issuer)}</div>` : ""}
      ${doc.total >= 50000 ? '<div class="p-stamp">収入印紙<br>貼付欄</div>' : ""}`;
  }

  return `
    <p class="doc-title">領 収 証</p>
    <p class="doc-sub">${escapeHtml(doc.store || "")}</p>
    <div class="p-row"><span>${dateText}</span><span class="r">${PAYMENTS[doc.payment] || ""}</span></div>
    <hr>
    ${itemLines || '<div class="p-item"><span class="n">（明細なし）</span></div>'}
    <hr>
    ${taxLines}
    <div class="p-row p-total"><span>合計</span><span class="r">${yen(doc.total)}</span></div>
    ${issuer ? `<div class="p-issuer">${escapeHtml(issuer)}</div>` : ""}
    <p class="p-foot">ご来店ありがとうございました</p>`;
}

function openDoc(doc) {
  $("doc-paper").innerHTML = paperHtml(doc);
  $("doc-sheet").hidden = false;
}

/* ============================================================
   集計タブ
   ============================================================ */

function renderReport() {
  $("report-month").textContent = formatMonth(ui.month);

  const records = recordsOfMonth(ui.month);
  const total = records.reduce((sum, r) => sum + r.total, 0);
  const prev = store.records
    .filter((r) => r.date.slice(0, 7) === shiftMonth(ui.month, -1))
    .reduce((sum, r) => sum + r.total, 0);

  $("hero-total").textContent = yen(total);

  if (prev > 0) {
    const diff = total - prev;
    const pct = Math.round((Math.abs(diff) / prev) * 100);
    const cls = diff > 0 ? "up" : "down";
    const word = diff > 0 ? "増" : "減";
    $("hero-delta").innerHTML =
      diff === 0
        ? "前月と同じ"
        : `前月比 <span class="${cls}">${word} ${yen(Math.abs(diff))}（${pct}%）</span>`;
  } else {
    $("hero-delta").textContent = records.length ? "前月の記録はありません" : "";
  }

  renderBudget(total);
  renderCategoryChart(records, total);
  renderDaily(records);
}

function renderBudget(total) {
  const budget = Number(store.settings.budget) || 0;
  const block = $("budget-block");
  if (!budget) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  const ratio = Math.min(1, total / budget);
  const fill = $("budget-fill");
  fill.style.width = `${ratio * 100}%`;
  fill.classList.toggle("over", total > budget);
  $("budget-text").textContent =
    total > budget
      ? `予算 ${yen(budget)} を ${yen(total - budget)} オーバー`
      : `予算 ${yen(budget)} / 残り ${yen(budget - total)}`;
}

const DONUT_R = 70;
const DONUT_C = 2 * Math.PI * DONUT_R;
const DONUT_GAP = 2.5;

function renderCategoryChart(records, total) {
  const svg = $("donut");
  const list = $("cat-list");
  const empty = $("report-empty");

  $("donut-total").textContent = yen(total);

  if (!records.length) {
    svg.innerHTML = `<title>カテゴリ別の支出割合</title>
      <circle cx="100" cy="100" r="${DONUT_R}" fill="none" stroke="var(--surface-2)" stroke-width="26"></circle>`;
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  /* カテゴリは定義順のまま集計し、金額の大きい順に並べる。
     色はカテゴリに固定なので、並び替えても色は動かない。 */
  const sums = CATEGORIES.map((cat) => ({
    ...cat,
    amount: records.filter((r) => r.category === cat.id).reduce((sum, r) => sum + r.total, 0),
  })).filter((c) => c.amount > 0);

  sums.sort((a, b) => b.amount - a.amount);

  let offset = 0;
  const single = sums.length === 1;
  const segments = sums
    .map((c) => {
      const len = (c.amount / total) * DONUT_C;
      const gap = single ? 0 : DONUT_GAP;
      const dash = Math.max(len - gap, 0.5);
      const seg = `<circle class="donut-seg" data-cat="${c.id}" cx="100" cy="100" r="${DONUT_R}"
        fill="none" stroke="${c.color}" stroke-width="26"
        stroke-dasharray="${dash} ${DONUT_C - dash}" stroke-dashoffset="${-offset}"
        transform="rotate(-90 100 100)"><title>${c.label} ${yen(c.amount)}</title></circle>`;
      offset += len;
      return seg;
    })
    .join("");

  svg.innerHTML = `<title>カテゴリ別の支出割合</title>${segments}`;

  list.innerHTML = sums
    .map((c) => {
      const pct = Math.round((c.amount / total) * 100);
      return `
        <li class="cat-row">
          <div class="cat-top">
            <span class="cat-swatch" style="background:${c.color}"></span>
            <span class="cat-name">${c.label}</span>
            <span class="cat-pct">${pct}%</span>
            <span class="cat-amount">${yen(c.amount)}</span>
          </div>
          <div class="cat-bar"><span style="width:${(c.amount / sums[0].amount) * 100}%;background:${c.color}"></span></div>
        </li>`;
    })
    .join("");
}

function renderDaily(records) {
  const [y, m] = ui.month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const totals = new Array(days).fill(0);
  records.forEach((r) => {
    const day = Number(r.date.slice(8, 10));
    if (day >= 1 && day <= days) totals[day - 1] += r.total;
  });
  const max = Math.max(...totals, 1);

  $("daily").innerHTML = totals
    .map((amount, i) => {
      const day = i + 1;
      const height = amount ? Math.max(3, (amount / max) * 100) : 2;
      const label = day === 1 || day % 5 === 0 ? day : "";
      return `
        <div class="daily-col${amount ? "" : " is-empty"}" data-day="${day}" data-amount="${amount}">
          <span class="daily-bar" style="height:${height}%"></span>
          <span class="daily-label">${label}</span>
        </div>`;
    })
    .join("");
}

/* ---------- チャートのツールチップ ---------- */

function showTooltip(target, text) {
  const tip = $("viz-tooltip");
  const rect = target.getBoundingClientRect();
  tip.textContent = text;
  tip.hidden = false;
  tip.style.left = `${Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2))}px`;
  tip.style.top = `${rect.top}px`;
}

function hideTooltip() {
  $("viz-tooltip").hidden = true;
}

/* ============================================================
   設定タブ
   ============================================================ */

function renderSettings() {
  $("s-budget").value = store.settings.budget || "";
  $("s-issuer").value = store.settings.issuer || "";
  $("s-issuer-detail").value = store.settings.issuerDetail || "";
  $("s-taxrate").value = store.settings.taxRate || "10";

  const bytes = new Blob([JSON.stringify(store)]).size;
  const photos = store.records.filter((r) => r.photo).length;
  $("storage-note").textContent =
    `記録 ${store.records.length}件（写真つき ${photos}件） / 使用容量 約${(bytes / 1024 / 1024).toFixed(2)}MB。` +
    "ブラウザのデータを消すと記録も消えるため、ときどきバックアップしてください。";
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  if (!store.records.length) {
    toast("書き出す記録がありません。");
    return;
  }
  const header = [
    "日付", "種別", "店名/発行者", "宛名", "但し書き", "カテゴリ",
    "支払方法", "小計", "消費税", "税率", "合計", "メモ", "明細",
  ];
  const rows = [...store.records]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) =>
      [
        r.date,
        r.docType === "invoice" ? "領収書" : "レシート",
        r.store,
        r.payee,
        r.note,
        categoryOf(r.category).label,
        PAYMENTS[r.payment] || "",
        r.subtotal,
        r.tax,
        `${r.taxRate}%`,
        r.total,
        r.memo,
        r.items.filter((i) => i.name).map((i) => `${i.name}x${i.qty}`).join(" / "),
      ]
        .map(csvCell)
        .join(",")
    );
  // Excel が UTF-8 と判定できるよう BOM を付ける
  download(`kakeibo-${todayISO()}.csv`, "﻿" + [header.join(","), ...rows].join("\r\n"), "text/csv");
  toast("CSVを書き出しました");
}

function exportJson() {
  download(`kakeibo-backup-${todayISO()}.json`, JSON.stringify(store), "application/json");
  toast("バックアップを書き出しました");
}

async function importJson(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.records)) throw new Error("形式が違います");
    if (!confirm(`${parsed.records.length}件の記録を読み込みます。現在のデータは置き換わります。よろしいですか？`)) {
      return;
    }
    store.records = parsed.records;
    if (parsed.settings) store.settings = { ...store.settings, ...parsed.settings };
    save();
    renderSettings();
    renderList();
    toast("復元しました");
  } catch (err) {
    console.warn(err);
    toast("このファイルは読み込めませんでした。");
  } finally {
    $("import-json").value = "";
  }
}

/* ============================================================
   初期化
   ============================================================ */

function renderCategoryOptions() {
  $("f-category").innerHTML = CATEGORIES.map(
    (c) => `<option value="${c.id}">${c.label}</option>`
  ).join("");
  $("filter-category").innerHTML =
    `<option value="all">すべてのカテゴリ</option>` +
    CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
}

function renderStoreSuggestions() {
  const names = [...new Set(store.records.map((r) => r.store).filter(Boolean))].slice(0, 30);
  $("store-list").innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => setDocType(btn.dataset.doctype));
  });

  document.querySelectorAll("[data-month-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ui.month = shiftMonth(ui.month, Number(btn.dataset.monthStep));
      if (ui.tab === "list") renderList();
      if (ui.tab === "report") renderReport();
    });
  });

  /* --- 作成フォーム --- */
  $("add-item").addEventListener("click", () => {
    $("items").insertAdjacentHTML("beforeend", itemRowHtml());
    const rows = document.querySelectorAll(".item-row");
    rows[rows.length - 1].querySelector(".item-name").focus();
  });

  $("items").addEventListener("input", updateTotals);
  $("items").addEventListener("click", (event) => {
    const btn = event.target.closest(".item-del");
    if (!btn) return;
    if (document.querySelectorAll(".item-row").length === 1) {
      const row = btn.closest(".item-row");
      row.querySelectorAll("input").forEach((i) => (i.value = i.classList.contains("item-qty") ? 1 : ""));
    } else {
      btn.closest(".item-row").remove();
    }
    updateTotals();
  });

  $("f-taxrate").addEventListener("change", updateTotals);
  $("f-taxmode").addEventListener("change", updateTotals);
  $("receipt-form").addEventListener("submit", handleSubmit);
  $("cancel-edit").addEventListener("click", () => {
    resetForm();
    toast("編集をやめました");
  });

  $("f-photo").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    toast("写真を処理しています…");
    try {
      setPhoto(await compressImage(file));
      toast("写真を添付しました");
    } catch (err) {
      console.warn(err);
      toast("この画像は読み込めませんでした。");
    }
  });
  $("remove-photo").addEventListener("click", () => setPhoto(null));

  $("preview-btn").addEventListener("click", () => {
    ui.docId = null;
    openDoc(buildDocData());
  });

  /* --- 明細 --- */
  $("search-input").addEventListener("input", renderList);
  $("filter-category").addEventListener("change", renderList);
  $("record-list").addEventListener("click", (event) => {
    const btn = event.target.closest(".record");
    if (btn) openDetail(btn.dataset.id);
  });

  $("detail-close").addEventListener("click", closeDetail);
  $("detail-sheet").addEventListener("click", (event) => {
    if (event.target === $("detail-sheet")) closeDetail();
  });
  $("detail-delete").addEventListener("click", deleteCurrentRecord);
  $("detail-edit").addEventListener("click", () => {
    const record = store.records.find((r) => r.id === ui.detailId);
    closeDetail();
    if (record) fillFormFrom(record);
  });
  $("detail-show").addEventListener("click", () => {
    const record = store.records.find((r) => r.id === ui.detailId);
    if (record) openDoc(record);
  });

  $("doc-close").addEventListener("click", () => ($("doc-sheet").hidden = true));
  $("doc-sheet").addEventListener("click", (event) => {
    if (event.target === $("doc-sheet")) $("doc-sheet").hidden = true;
  });
  $("doc-print").addEventListener("click", () => window.print());

  /* --- 集計チャートのツールチップ --- */
  const vizHandler = (event) => {
    const seg = event.target.closest(".donut-seg");
    if (seg) {
      const cat = categoryOf(seg.dataset.cat);
      const amount = seg.querySelector("title").textContent;
      showTooltip(seg, amount || cat.label);
      return;
    }
    const col = event.target.closest(".daily-col");
    if (col) {
      showTooltip(col, `${col.dataset.day}日 ${yen(col.dataset.amount)}`);
      return;
    }
    hideTooltip();
  };
  $("view-report").addEventListener("pointerover", vizHandler);
  $("view-report").addEventListener("pointerdown", vizHandler);
  $("view-report").addEventListener("pointerleave", hideTooltip);
  document.addEventListener("scroll", hideTooltip, { passive: true });

  /* --- 設定 --- */
  $("s-budget").addEventListener("change", () => {
    store.settings.budget = Number($("s-budget").value) || 0;
    save();
  });
  $("s-issuer").addEventListener("change", () => {
    store.settings.issuer = $("s-issuer").value.trim();
    save();
  });
  $("s-issuer-detail").addEventListener("change", () => {
    store.settings.issuerDetail = $("s-issuer-detail").value.trim();
    save();
  });
  $("s-taxrate").addEventListener("change", () => {
    store.settings.taxRate = $("s-taxrate").value;
    save();
  });

  $("export-csv").addEventListener("click", exportCsv);
  $("export-json").addEventListener("click", exportJson);
  $("import-json").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importJson(file);
  });
  $("reset-all").addEventListener("click", () => {
    if (!confirm("すべての記録と設定を削除します。元に戻せません。よろしいですか？")) return;
    store = { records: [], settings: { budget: 0, issuer: "", issuerDetail: "", taxRate: "10" } };
    save();
    resetForm();
    renderSettings();
    renderStoreSuggestions();
    toast("すべて削除しました");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("doc-sheet").hidden) $("doc-sheet").hidden = true;
    else if (!$("detail-sheet").hidden) closeDetail();
  });
}

function init() {
  load();
  renderCategoryOptions();
  renderStoreSuggestions();
  bindEvents();
  resetForm();
  setTab("create");

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* オフライン対応は任意機能なので失敗しても続行する */
    });
  }
}

init();
