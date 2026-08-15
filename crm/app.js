/* ==========================================================
   Sales CRM — 営業担当者向けの顧客管理ツール
   データはブラウザの localStorage に保存されます。
   ========================================================== */

const STORAGE_KEY = "sales-crm";
const UNDO_TIMEOUT_MS = 6000;

const STATUSES = [
  { id: "lead", label: "見込み", cls: "badge-lead" },
  { id: "negotiating", label: "商談中", cls: "badge-negotiating" },
  { id: "won", label: "受注", cls: "badge-won" },
  { id: "lost", label: "失注", cls: "badge-lost" },
  { id: "dormant", label: "休眠", cls: "badge-dormant" },
];

const STAGES = [
  { id: "lead", label: "リード", probability: 10 },
  { id: "proposal", label: "提案", probability: 30 },
  { id: "quote", label: "見積", probability: 50 },
  { id: "negotiation", label: "交渉", probability: 75 },
  { id: "won", label: "受注", probability: 100 },
  { id: "lost", label: "失注", probability: 0 },
];

const OPEN_STAGES = ["lead", "proposal", "quote", "negotiation"];

const ACTIVITY_TYPES = [
  { id: "call", label: "電話" },
  { id: "email", label: "メール" },
  { id: "visit", label: "訪問" },
  { id: "online", label: "オンライン商談" },
  { id: "other", label: "その他" },
];

/* ---------- 状態 ---------- */

let state = load();

let currentView = "dashboard";
let searchQuery = "";
let statusFilter = "";
let ownerFilter = "";
let customerSort = "updated";
let dealOwnerFilter = "";
let hideClosedDeals = false;
let activityTypeFilter = "";

let editingCustomerId = null;
let editingDealId = null;
let detailCustomerId = null;

let confirmResolve = null;
let undoState = null; // { snapshot, timer }

/* ---------- DOM ---------- */

const $ = (id) => document.getElementById(id);

const views = {
  dashboard: $("view-dashboard"),
  customers: $("view-customers"),
  deals: $("view-deals"),
  activities: $("view-activities"),
  data: $("view-data"),
};

/* ==========================================================
   ユーティリティ
   ========================================================== */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr(d = new Date()) {
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

function yen(amount) {
  const n = Number(amount) || 0;
  if (n >= 100000000) return "¥" + (n / 100000000).toFixed(n % 100000000 === 0 ? 0 : 1) + "億";
  if (n >= 10000) return "¥" + (n / 10000).toFixed(n % 10000 === 0 ? 0 : 1) + "万";
  return "¥" + n.toLocaleString("ja-JP");
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function formatFullDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function dayDiff(iso) {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  const today = new Date(todayStr() + "T00:00:00");
  return Math.round((target - today) / 86400000);
}

function statusOf(id) {
  return STATUSES.find((s) => s.id === id) || STATUSES[0];
}

function stageOf(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}

function activityTypeOf(id) {
  return ACTIVITY_TYPES.find((t) => t.id === id) || ACTIVITY_TYPES[4];
}

function customerOf(id) {
  return state.customers.find((c) => c.id === id);
}

function dealsOfCustomer(id) {
  return state.deals.filter((d) => d.customerId === id);
}

function activitiesOfCustomer(id) {
  return state.activities.filter((a) => a.customerId === id).sort((a, b) => b.date.localeCompare(a.date));
}

/* ==========================================================
   永続化
   ========================================================== */

function emptyState() {
  return { customers: [], deals: [], activities: [] };
}

/** 古い保存データや取り込みデータでも欠けた項目で落ちないように整える。 */
function normalize(raw) {
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    customers: list(raw.customers).map((c) => ({
      id: c.id || uid(),
      company: c.company || "",
      person: c.person || "",
      jobTitle: c.jobTitle || "",
      phone: c.phone || "",
      email: c.email || "",
      status: STATUSES.some((s) => s.id === c.status) ? c.status : "lead",
      owner: c.owner || "",
      address: c.address || "",
      tags: Array.isArray(c.tags) ? c.tags : [],
      nextActionDate: c.nextActionDate || "",
      nextActionNote: c.nextActionNote || "",
      note: c.note || "",
      createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
    })),
    deals: list(raw.deals).map((d) => ({
      id: d.id || uid(),
      customerId: d.customerId || "",
      title: d.title || "",
      amount: Number(d.amount) || 0,
      stage: STAGES.some((s) => s.id === d.stage) ? d.stage : "lead",
      probability: Number(d.probability) || 0,
      closeDate: d.closeDate || "",
      note: d.note || "",
      createdAt: d.createdAt || new Date().toISOString(),
      updatedAt: d.updatedAt || d.createdAt || new Date().toISOString(),
    })),
    activities: list(raw.activities).map((a) => ({
      id: a.id || uid(),
      customerId: a.customerId || "",
      type: ACTIVITY_TYPES.some((t) => t.id === a.type) ? a.type : "other",
      date: a.date || todayStr(),
      summary: a.summary || "",
      createdAt: a.createdAt || new Date().toISOString(),
    })),
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn("保存データを読み込めませんでした", e);
    return emptyState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    showToast("保存に失敗しました。ブラウザの空き容量をご確認ください。");
  }
}

function commit() {
  save();
  render();
}

function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

/* ==========================================================
   トースト / 確認ダイアログ
   ========================================================== */

const toast = $("toast");
const toastMessage = $("toast-message");
const toastUndo = $("toast-undo");
let toastTimer = null;

function showToast(message, undoSnapshot = null) {
  toastMessage.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);

  if (undoSnapshot) {
    undoState = { snapshot: undoSnapshot };
    toastUndo.hidden = false;
  } else {
    undoState = null;
    toastUndo.hidden = true;
  }

  toastTimer = setTimeout(() => {
    toast.hidden = true;
    undoState = null;
  }, UNDO_TIMEOUT_MS);
}

toastUndo.addEventListener("click", () => {
  if (!undoState) return;
  state = undoState.snapshot;
  undoState = null;
  toast.hidden = true;
  commit();
  showToast("元に戻しました。");
});

const confirmModal = $("confirm-modal");

function askConfirm(text, okLabel = "削除する") {
  $("confirm-text").textContent = text;
  $("confirm-ok").textContent = okLabel;
  confirmModal.hidden = false;
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function closeConfirm(result) {
  confirmModal.hidden = true;
  if (confirmResolve) confirmResolve(result);
  confirmResolve = null;
}

$("confirm-ok").addEventListener("click", () => closeConfirm(true));
$("confirm-cancel").addEventListener("click", () => closeConfirm(false));
confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) closeConfirm(false);
});

/* ==========================================================
   ナビゲーション
   ========================================================== */

$("nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (!btn) return;
  currentView = btn.dataset.view;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b === btn));
  Object.entries(views).forEach(([name, el]) => {
    el.hidden = name !== currentView;
  });
  render();
});

$("global-search").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  if (searchQuery && currentView !== "customers") {
    document.querySelector('.nav-item[data-view="customers"]').click();
    return;
  }
  render();
});

/* ==========================================================
   顧客フォーム
   ========================================================== */

const customerModal = $("customer-modal");
const customerForm = $("customer-form");

function fillSelect(select, items, selected) {
  select.innerHTML = items
    .map((i) => `<option value="${esc(i.id)}"${i.id === selected ? " selected" : ""}>${esc(i.label)}</option>`)
    .join("");
}

function openCustomerModal(id = null) {
  editingCustomerId = id;
  const c = id ? customerOf(id) : null;
  $("customer-modal-title").textContent = c ? "顧客を編集" : "顧客を追加";

  fillSelect($("c-status"), STATUSES, c ? c.status : "lead");
  $("owner-list").innerHTML = ownerNames()
    .map((o) => `<option value="${esc(o)}"></option>`)
    .join("");

  $("c-company").value = c ? c.company : "";
  $("c-person").value = c ? c.person : "";
  $("c-title").value = c ? c.jobTitle : "";
  $("c-phone").value = c ? c.phone : "";
  $("c-email").value = c ? c.email : "";
  $("c-owner").value = c ? c.owner : "";
  $("c-address").value = c ? c.address : "";
  $("c-tags").value = c ? c.tags.join(", ") : "";
  $("c-next-date").value = c ? c.nextActionDate : "";
  $("c-next-note").value = c ? c.nextActionNote : "";
  $("c-note").value = c ? c.note : "";

  customerModal.hidden = false;
  $("c-company").focus();
}

customerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    company: $("c-company").value.trim(),
    person: $("c-person").value.trim(),
    jobTitle: $("c-title").value.trim(),
    phone: $("c-phone").value.trim(),
    email: $("c-email").value.trim(),
    status: $("c-status").value,
    owner: $("c-owner").value.trim(),
    address: $("c-address").value.trim(),
    tags: parseTags($("c-tags").value),
    nextActionDate: $("c-next-date").value,
    nextActionNote: $("c-next-note").value.trim(),
    note: $("c-note").value,
    updatedAt: new Date().toISOString(),
  };
  if (!data.company) return;

  if (editingCustomerId) {
    const c = customerOf(editingCustomerId);
    Object.assign(c, data);
    showToast("顧客情報を更新しました。");
  } else {
    state.customers.push({ id: uid(), createdAt: new Date().toISOString(), ...data });
    showToast("顧客を追加しました。");
  }

  customerModal.hidden = true;
  commit();
  if (detailCustomerId) renderDetail();
});

function parseTags(value) {
  return value
    .split(/[,、]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function ownerNames() {
  return [...new Set(state.customers.map((c) => c.owner).filter(Boolean))].sort();
}

/* ==========================================================
   商談フォーム
   ========================================================== */

const dealModal = $("deal-modal");
const dealForm = $("deal-form");

function customerOptions() {
  return [...state.customers]
    .sort((a, b) => a.company.localeCompare(b.company, "ja"))
    .map((c) => ({ id: c.id, label: c.company + (c.person ? `（${c.person}）` : "") }));
}

function openDealModal(id = null, customerId = null) {
  if (state.customers.length === 0) {
    showToast("先に顧客を登録してください。");
    return;
  }
  editingDealId = id;
  const d = id ? state.deals.find((x) => x.id === id) : null;
  $("deal-modal-title").textContent = d ? "商談を編集" : "商談を追加";

  fillSelect($("d-customer"), customerOptions(), d ? d.customerId : customerId || state.customers[0].id);
  fillSelect($("d-stage"), STAGES, d ? d.stage : "lead");

  $("d-title").value = d ? d.title : "";
  $("d-amount").value = d ? d.amount : "";
  $("d-probability").value = d ? d.probability : stageOf("lead").probability;
  $("d-close").value = d ? d.closeDate : "";
  $("d-note").value = d ? d.note : "";

  dealModal.hidden = false;
  $("d-title").focus();
}

$("d-stage").addEventListener("change", (e) => {
  $("d-probability").value = stageOf(e.target.value).probability;
});

dealForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    customerId: $("d-customer").value,
    title: $("d-title").value.trim(),
    amount: Number($("d-amount").value) || 0,
    stage: $("d-stage").value,
    probability: Math.min(100, Math.max(0, Number($("d-probability").value) || 0)),
    closeDate: $("d-close").value,
    note: $("d-note").value,
    updatedAt: new Date().toISOString(),
  };
  if (!data.title || !data.customerId) return;

  if (editingDealId) {
    Object.assign(
      state.deals.find((x) => x.id === editingDealId),
      data
    );
    showToast("商談を更新しました。");
  } else {
    state.deals.push({ id: uid(), createdAt: new Date().toISOString(), ...data });
    showToast("商談を追加しました。");
  }

  touchCustomer(data.customerId);
  dealModal.hidden = true;
  commit();
  if (detailCustomerId) renderDetail();
});

function touchCustomer(id) {
  const c = customerOf(id);
  if (c) c.updatedAt = new Date().toISOString();
}

/* ==========================================================
   活動フォーム
   ========================================================== */

const activityModal = $("activity-modal");
const activityForm = $("activity-form");

function openActivityModal(customerId = null) {
  if (state.customers.length === 0) {
    showToast("先に顧客を登録してください。");
    return;
  }
  fillSelect($("a-customer"), customerOptions(), customerId || state.customers[0].id);
  fillSelect($("a-type"), ACTIVITY_TYPES, "call");
  $("a-date").value = todayStr();
  $("a-summary").value = "";
  $("a-set-next").checked = false;
  $("a-next-date").value = "";
  $("a-next-note").value = "";
  $("a-next-date").disabled = true;
  $("a-next-note").disabled = true;
  activityModal.hidden = false;
  $("a-summary").focus();
}

$("a-set-next").addEventListener("change", (e) => {
  $("a-next-date").disabled = !e.target.checked;
  $("a-next-note").disabled = !e.target.checked;
  if (e.target.checked && !$("a-next-date").value) $("a-next-date").value = todayStr();
});

activityForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const customerId = $("a-customer").value;
  const summary = $("a-summary").value.trim();
  if (!customerId || !summary) return;

  state.activities.push({
    id: uid(),
    customerId,
    type: $("a-type").value,
    date: $("a-date").value || todayStr(),
    summary,
    createdAt: new Date().toISOString(),
  });

  const c = customerOf(customerId);
  if (c) {
    if ($("a-set-next").checked) {
      c.nextActionDate = $("a-next-date").value;
      c.nextActionNote = $("a-next-note").value.trim();
    }
    c.updatedAt = new Date().toISOString();
  }

  activityModal.hidden = true;
  commit();
  if (detailCustomerId) renderDetail();
  showToast("活動を記録しました。");
});

/* ==========================================================
   モーダル共通の閉じる操作
   ========================================================== */

document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    btn.closest(".modal-overlay").hidden = true;
  });
});

[customerModal, dealModal, activityModal].forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!confirmModal.hidden) return closeConfirm(false);
  const open = [activityModal, dealModal, customerModal].find((m) => !m.hidden);
  if (open) {
    open.hidden = true;
    return;
  }
  if (!detailDrawer.hidden) closeDetail();
});

/* ==========================================================
   ヘッダーのボタン
   ========================================================== */

$("new-customer-btn").addEventListener("click", () => openCustomerModal());
$("new-deal-btn").addEventListener("click", () => openDealModal());

/* ---------- スマホ用のフローティング追加ボタン ---------- */

const fabMenu = $("fab-menu");

function toggleFabMenu(open) {
  fabMenu.hidden = open === undefined ? !fabMenu.hidden : !open;
  $("fab").textContent = fabMenu.hidden ? "＋" : "×";
}

$("fab").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleFabMenu();
});

$("fab-customer").addEventListener("click", () => {
  toggleFabMenu(false);
  openCustomerModal();
});
$("fab-deal").addEventListener("click", () => {
  toggleFabMenu(false);
  openDealModal();
});
$("fab-activity").addEventListener("click", () => {
  toggleFabMenu(false);
  openActivityModal();
});

document.addEventListener("click", (e) => {
  if (!fabMenu.hidden && !e.target.closest("#fab-menu") && !e.target.closest("#fab")) toggleFabMenu(false);
});

/* ==========================================================
   顧客詳細ドロワー
   ========================================================== */

const detailDrawer = $("detail-drawer");

function openDetail(id) {
  detailCustomerId = id;
  detailDrawer.hidden = false;
  renderDetail();
}

function closeDetail() {
  detailDrawer.hidden = true;
  detailCustomerId = null;
}

$("detail-close").addEventListener("click", closeDetail);
detailDrawer.addEventListener("click", (e) => {
  if (e.target === detailDrawer) closeDetail();
});

function renderDetail() {
  const c = customerOf(detailCustomerId);
  if (!c) return closeDetail();

  const st = statusOf(c.status);
  const deals = dealsOfCustomer(c.id);
  const openAmount = deals
    .filter((d) => OPEN_STAGES.includes(d.stage))
    .reduce((sum, d) => sum + d.amount, 0);
  const wonAmount = deals.filter((d) => d.stage === "won").reduce((sum, d) => sum + d.amount, 0);
  const activities = activitiesOfCustomer(c.id);

  $("detail-body").innerHTML = `
    <div class="detail-head">
      <span class="badge ${st.cls}">${esc(st.label)}</span>
      <div class="detail-company">${esc(c.company)}</div>
      <div class="detail-person">${esc([c.person, c.jobTitle].filter(Boolean).join(" / ")) || "担当者未登録"}</div>
      ${c.tags.length ? `<div class="tag-row" style="margin-top:10px">${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
    </div>

    <div class="detail-actions">
      <button class="btn-primary" data-detail-action="activity">活動を記録</button>
      <button class="btn-secondary" data-detail-action="deal">商談を追加</button>
      <button class="btn-secondary" data-detail-action="edit">編集</button>
      <button class="btn-danger" data-detail-action="delete">削除</button>
    </div>

    <div class="detail-section">
      <h4>基本情報</h4>
      <dl class="detail-list">
        <dt>電話</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : "—"}</dd>
        <dt>メール</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"}</dd>
        <dt>住所</dt><dd>${esc(c.address) || "—"}</dd>
        <dt>担当営業</dt><dd>${esc(c.owner) || "—"}</dd>
        <dt>次回アクション</dt><dd>${
          c.nextActionDate || c.nextActionNote
            ? `${formatFullDate(c.nextActionDate)}${c.nextActionNote ? " ／ " + esc(c.nextActionNote) : ""}`
            : "—"
        }</dd>
        <dt>進行中商談</dt><dd class="amount">${yen(openAmount)}${wonAmount ? `<span style="color:var(--success)">（受注 ${yen(wonAmount)}）</span>` : ""}</dd>
      </dl>
    </div>

    ${c.note ? `<div class="detail-section"><h4>備考</h4><div class="note-box">${esc(c.note)}</div></div>` : ""}

    <div class="detail-section">
      <h4>商談（${deals.length}件）</h4>
      ${
        deals.length
          ? `<ul class="mini-list">${deals
              .map(
                (d) => `<li class="mini-item" data-deal-id="${d.id}">
                  <div class="mini-item-head">
                    <strong>${esc(d.title)}</strong>
                    <span class="badge badge-${d.stage === "won" ? "won" : d.stage === "lost" ? "lost" : "negotiating"}">${esc(stageOf(d.stage).label)}</span>
                  </div>
                  <div class="deal-row" style="margin-top:6px">
                    <span class="amount">${yen(d.amount)}・確度${d.probability}%</span>
                    <span>${d.closeDate ? "予定 " + formatDate(d.closeDate) : ""}</span>
                  </div>
                  ${d.note ? `<div class="timeline-text" style="margin-top:6px">${esc(d.note)}</div>` : ""}
                  <div class="btn-row" style="margin-top:8px">
                    <button class="icon-btn" data-deal-edit="${d.id}">編集</button>
                    <button class="icon-btn danger" data-deal-delete="${d.id}">削除</button>
                  </div>
                </li>`
              )
              .join("")}</ul>`
          : `<p class="hint">商談はまだありません。</p>`
      }
    </div>

    <div class="detail-section">
      <h4>活動履歴（${activities.length}件）</h4>
      ${
        activities.length
          ? `<ul class="timeline">${activities
              .map(
                (a) => `<li class="timeline-item">
                  <div class="timeline-date">${esc(a.date)}</div>
                  <div class="timeline-body">
                    <div class="timeline-title">${esc(activityTypeOf(a.type).label)}</div>
                    <div class="timeline-text">${esc(a.summary)}</div>
                  </div>
                  <button class="icon-btn danger" data-activity-delete="${a.id}">削除</button>
                </li>`
              )
              .join("")}</ul>`
          : `<p class="hint">活動履歴はまだありません。</p>`
      }
    </div>
  `;
}

$("detail-body").addEventListener("click", async (e) => {
  const action = e.target.closest("[data-detail-action]")?.dataset.detailAction;
  if (action === "activity") return openActivityModal(detailCustomerId);
  if (action === "deal") return openDealModal(null, detailCustomerId);
  if (action === "edit") return openCustomerModal(detailCustomerId);
  if (action === "delete") {
    const c = customerOf(detailCustomerId);
    const ok = await askConfirm(`「${c.company}」を削除しますか？関連する商談・活動履歴もすべて削除されます。`);
    if (!ok) return;
    deleteCustomer(detailCustomerId);
    closeDetail();
    return;
  }

  const dealEdit = e.target.closest("[data-deal-edit]")?.dataset.dealEdit;
  if (dealEdit) return openDealModal(dealEdit);

  const dealDelete = e.target.closest("[data-deal-delete]")?.dataset.dealDelete;
  if (dealDelete) {
    const ok = await askConfirm("この商談を削除しますか？");
    if (!ok) return;
    const before = snapshot();
    state.deals = state.deals.filter((d) => d.id !== dealDelete);
    commit();
    renderDetail();
    showToast("商談を削除しました。", before);
    return;
  }

  const activityDelete = e.target.closest("[data-activity-delete]")?.dataset.activityDelete;
  if (activityDelete) {
    const before = snapshot();
    state.activities = state.activities.filter((a) => a.id !== activityDelete);
    commit();
    renderDetail();
    showToast("活動履歴を削除しました。", before);
  }
});

function deleteCustomer(id) {
  const before = snapshot();
  state.customers = state.customers.filter((c) => c.id !== id);
  state.deals = state.deals.filter((d) => d.customerId !== id);
  state.activities = state.activities.filter((a) => a.customerId !== id);
  commit();
  showToast("顧客を削除しました。", before);
}

/* ==========================================================
   フィルタ操作
   ========================================================== */

$("status-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  statusFilter = chip.dataset.status;
  render();
});

$("owner-filter").addEventListener("change", (e) => {
  ownerFilter = e.target.value;
  render();
});

$("customer-sort").addEventListener("change", (e) => {
  customerSort = e.target.value;
  render();
});

$("deal-owner-filter").addEventListener("change", (e) => {
  dealOwnerFilter = e.target.value;
  render();
});

$("deal-hide-closed").addEventListener("change", (e) => {
  hideClosedDeals = e.target.checked;
  render();
});

$("activity-type-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  activityTypeFilter = chip.dataset.type;
  render();
});

/* ==========================================================
   絞り込みロジック
   ========================================================== */

function matchesSearch(c) {
  if (!searchQuery) return true;
  const haystack = [c.company, c.person, c.jobTitle, c.email, c.phone, c.address, c.owner, c.note, ...c.tags]
    .join(" ")
    .toLowerCase();
  return haystack.includes(searchQuery);
}

function openAmountOf(customerId) {
  return dealsOfCustomer(customerId)
    .filter((d) => OPEN_STAGES.includes(d.stage))
    .reduce((sum, d) => sum + d.amount, 0);
}

function visibleCustomers() {
  let list = state.customers.filter(
    (c) => matchesSearch(c) && (!statusFilter || c.status === statusFilter) && (!ownerFilter || c.owner === ownerFilter)
  );

  const sorters = {
    updated: (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    created: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
    name: (a, b) => a.company.localeCompare(b.company, "ja"),
    next: (a, b) => (a.nextActionDate || "9999-99-99").localeCompare(b.nextActionDate || "9999-99-99"),
    amount: (a, b) => openAmountOf(b.id) - openAmountOf(a.id),
  };
  return list.sort(sorters[customerSort] || sorters.updated);
}

/* ==========================================================
   描画
   ========================================================== */

function render() {
  $("nav-count-customers").textContent = state.customers.length || "";
  $("nav-count-deals").textContent = state.deals.filter((d) => OPEN_STAGES.includes(d.stage)).length || "";

  if (currentView === "dashboard") renderDashboard();
  if (currentView === "customers") renderCustomers();
  if (currentView === "deals") renderDeals();
  if (currentView === "activities") renderActivities();
}

/* ---------- ダッシュボード ---------- */

function renderDashboard() {
  const openDeals = state.deals.filter((d) => OPEN_STAGES.includes(d.stage));
  const openAmount = openDeals.reduce((sum, d) => sum + d.amount, 0);
  const weighted = openDeals.reduce((sum, d) => sum + (d.amount * d.probability) / 100, 0);

  const month = todayStr().slice(0, 7);
  const wonThisMonth = state.deals.filter(
    (d) => d.stage === "won" && (d.closeDate || "").startsWith(month)
  );
  const wonAmount = wonThisMonth.reduce((sum, d) => sum + d.amount, 0);

  const todos = upcomingTodos();
  const overdue = todos.filter((t) => t.diff < 0).length;

  $("kpi-grid").innerHTML = `
    ${kpi("顧客数", state.customers.length + "<small>社</small>", `商談中 ${state.customers.filter((c) => c.status === "negotiating").length}社`)}
    ${kpi("進行中の商談", yen(openAmount), `${openDeals.length}件`)}
    ${kpi("加重予測(確度反映)", yen(Math.round(weighted)), "確度を掛けた見込み額")}
    ${kpi("今月の受注", yen(wonAmount), `${wonThisMonth.length}件`)}
    ${kpi("要フォロー", overdue + "<small>件</small>", "次回アクションが期限切れ", overdue > 0)}
  `;

  // パイプライン
  const maxAmount = Math.max(
    1,
    ...OPEN_STAGES.map((s) => openDeals.filter((d) => d.stage === s).reduce((sum, d) => sum + d.amount, 0))
  );
  $("pipeline-total").textContent = `合計 ${yen(openAmount)}`;
  $("pipeline-chart").innerHTML =
    OPEN_STAGES.map((sid) => {
      const stage = stageOf(sid);
      const list = openDeals.filter((d) => d.stage === sid);
      const amount = list.reduce((sum, d) => sum + d.amount, 0);
      return `<div class="pipeline-row">
        <span class="stage-name">${esc(stage.label)}</span>
        <span class="pipeline-bar"><span style="width:${(amount / maxAmount) * 100}%"></span></span>
        <span class="pipeline-amount">${yen(amount)}<span style="color:var(--muted)">（${list.length}）</span></span>
      </div>`;
    }).join("") || `<p class="hint">商談がまだありません。</p>`;

  // 今日のやること
  $("todo-count").textContent = todos.length ? `${todos.length}件` : "";
  $("todo-list").innerHTML = todos.length
    ? todos
        .slice(0, 12)
        .map((t) => {
          const cls = t.diff < 0 ? "overdue" : t.diff === 0 ? "today" : "";
          const label = t.diff < 0 ? `${-t.diff}日超過` : t.diff === 0 ? "今日" : `あと${t.diff}日`;
          return `<li class="todo-item ${cls}">
            <span class="todo-date">${formatDate(t.customer.nextActionDate)}<br>${label}</span>
            <span class="todo-main">
              <span class="todo-company" data-open-customer="${t.customer.id}">${esc(t.customer.company)}</span>
              <span class="todo-note">${esc(t.customer.nextActionNote) || "（内容未設定）"}</span>
            </span>
            <button class="icon-btn" data-open-activity="${t.customer.id}">記録</button>
          </li>`;
        })
        .join("")
    : `<p class="hint">予定されている次回アクションはありません。</p>`;

  // 最近の活動
  const recent = [...state.activities].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  $("recent-activities").innerHTML = recent.length
    ? recent.map(activityRow).join("")
    : `<p class="hint">活動履歴がまだありません。</p>`;
}

function kpi(label, value, note, alert = false) {
  return `<div class="kpi${alert ? " alert" : ""}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-note">${esc(note)}</div>
  </div>`;
}

function upcomingTodos() {
  return state.customers
    .filter((c) => c.nextActionDate)
    .map((c) => ({ customer: c, diff: dayDiff(c.nextActionDate) }))
    .filter((t) => t.diff <= 14)
    .sort((a, b) => a.diff - b.diff);
}

function activityRow(a) {
  const c = customerOf(a.customerId);
  return `<li class="timeline-item">
    <div class="timeline-date">${esc(a.date)}</div>
    <div class="timeline-body">
      <div class="timeline-title">
        <span class="todo-company" data-open-customer="${esc(a.customerId)}">${esc(c ? c.company : "（削除済み）")}</span>
        <span class="tag" style="margin-left:6px">${esc(activityTypeOf(a.type).label)}</span>
      </div>
      <div class="timeline-text">${esc(a.summary)}</div>
    </div>
  </li>`;
}

$("view-dashboard").addEventListener("click", (e) => {
  const openId = e.target.closest("[data-open-customer]")?.dataset.openCustomer;
  if (openId) return openDetail(openId);
  const actId = e.target.closest("[data-open-activity]")?.dataset.openActivity;
  if (actId) return openActivityModal(actId);
});

/* ---------- 顧客一覧 ---------- */

function renderCustomers() {
  // ステータスチップ
  const counts = STATUSES.map((s) => state.customers.filter((c) => c.status === s.id).length);
  $("status-filters").innerHTML =
    `<button class="chip${statusFilter === "" ? " active" : ""}" data-status="">すべて (${state.customers.length})</button>` +
    STATUSES.map(
      (s, i) =>
        `<button class="chip${statusFilter === s.id ? " active" : ""}" data-status="${s.id}">${esc(s.label)} (${counts[i]})</button>`
    ).join("");

  // 担当者フィルタ
  const owners = ownerNames();
  $("owner-filter").innerHTML =
    `<option value="">すべての担当</option>` +
    owners.map((o) => `<option value="${esc(o)}"${o === ownerFilter ? " selected" : ""}>${esc(o)}</option>`).join("");
  $("customer-sort").value = customerSort;

  const list = visibleCustomers();
  $("customers-empty").hidden = list.length > 0;
  $("customers-empty").innerHTML = state.customers.length
    ? `<p>該当する顧客がありません。</p>`
    : `<p>まだ顧客が登録されていません。右上の「＋ 顧客を追加」から登録するか、<br>「データ」タブでサンプルデータを読み込んでお試しください。</p>`;

  $("customer-grid").innerHTML = list.map(customerCard).join("");
}

function customerCard(c) {
  const st = statusOf(c.status);
  const amount = openAmountOf(c.id);
  const diff = dayDiff(c.nextActionDate);
  const nextCls = diff === null ? "" : diff < 0 ? "overdue" : diff === 0 ? "today" : "";
  const nextText =
    c.nextActionDate
      ? `次回 ${formatDate(c.nextActionDate)}${diff < 0 ? `（${-diff}日超過）` : diff === 0 ? "（今日）" : ""}${
          c.nextActionNote ? " ／ " + esc(c.nextActionNote) : ""
        }`
      : "次回アクション未設定";

  return `<article class="customer-card" data-customer-id="${c.id}">
    <div class="card-top">
      <div>
        <div class="card-company">${esc(c.company)}</div>
        <div class="card-person">${esc([c.person, c.jobTitle].filter(Boolean).join(" / ")) || "担当者未登録"}</div>
      </div>
      <span class="badge ${st.cls}">${esc(st.label)}</span>
    </div>

    <div class="card-meta">
      ${c.phone ? `<span>☎ ${esc(c.phone)}</span>` : ""}
      ${c.email ? `<span>✉ ${esc(c.email)}</span>` : ""}
      ${c.owner ? `<span>担当: ${esc(c.owner)}</span>` : ""}
    </div>

    ${c.tags.length ? `<div class="tag-row">${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}

    <div class="card-foot">
      <span class="next-action ${nextCls}">${nextText}</span>
      <span class="amount">${amount ? yen(amount) : ""}</span>
    </div>

    ${
      c.phone || c.email
        ? `<div class="quick-actions">
            ${c.phone ? `<a href="tel:${esc(c.phone)}" data-quick>電話する</a>` : ""}
            ${c.email ? `<a href="mailto:${esc(c.email)}" data-quick>メール</a>` : ""}
          </div>`
        : ""
    }
  </article>`;
}

$("customer-grid").addEventListener("click", (e) => {
  if (e.target.closest("[data-quick]")) return; // 電話・メールはカードを開かずに実行
  const card = e.target.closest("[data-customer-id]");
  if (card) openDetail(card.dataset.customerId);
});

/* ---------- 商談ボード ---------- */

function renderDeals() {
  const owners = ownerNames();
  $("deal-owner-filter").innerHTML =
    `<option value="">すべての担当</option>` +
    owners
      .map((o) => `<option value="${esc(o)}"${o === dealOwnerFilter ? " selected" : ""}>${esc(o)}</option>`)
      .join("");

  const stages = hideClosedDeals ? STAGES.filter((s) => OPEN_STAGES.includes(s.id)) : STAGES;
  const deals = state.deals.filter((d) => {
    const c = customerOf(d.customerId);
    if (dealOwnerFilter && (!c || c.owner !== dealOwnerFilter)) return false;
    if (searchQuery) {
      const hay = [d.title, d.note, c ? c.company : ""].join(" ").toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });

  $("deal-board").innerHTML = stages
    .map((stage) => {
      const list = deals.filter((d) => d.stage === stage.id).sort((a, b) => b.amount - a.amount);
      const total = list.reduce((sum, d) => sum + d.amount, 0);
      return `<section class="board-col" data-stage="${stage.id}">
        <div class="board-col-head">
          <span>${esc(stage.label)} (${list.length})</span>
          <span>${yen(total)}</span>
        </div>
        ${
          list
            .map((d) => {
              const c = customerOf(d.customerId);
              return `<article class="deal-card" draggable="true" data-deal-open="${d.id}">
                <div class="deal-title">${esc(d.title)}</div>
                <div class="deal-company">${esc(c ? c.company : "（削除済み）")}</div>
                <div class="deal-row">
                  <span class="amount">${yen(d.amount)}</span>
                  <span>確度 ${d.probability}%</span>
                </div>
                ${d.closeDate ? `<div class="deal-row" style="margin-top:4px"><span>受注予定 ${formatDate(d.closeDate)}</span></div>` : ""}
                <select class="deal-stage-select" data-stage-select="${d.id}" aria-label="フェーズを変更">
                  ${STAGES.map(
                    (s) => `<option value="${s.id}"${s.id === d.stage ? " selected" : ""}>${esc(s.label)}</option>`
                  ).join("")}
                </select>
              </article>`;
            })
            .join("") || `<p class="hint">なし</p>`
        }
      </section>`;
    })
    .join("");
}

$("deal-board").addEventListener("click", (e) => {
  if (e.target.closest("[data-stage-select]")) return; // プルダウン操作でカードを開かない
  const id = e.target.closest("[data-deal-open]")?.dataset.dealOpen;
  if (id) openDealModal(id);
});

/* タッチ端末向け: プルダウンでフェーズを変更 */
$("deal-board").addEventListener("change", (e) => {
  const id = e.target.dataset.stageSelect;
  if (id) moveDealToStage(id, e.target.value);
});

/** 商談のフェーズを変更し、確度と顧客ステータスを合わせる。 */
function moveDealToStage(dealId, stage) {
  const deal = state.deals.find((d) => d.id === dealId);
  if (!deal || deal.stage === stage) return render();

  const before = snapshot();
  deal.stage = stage;
  deal.probability = stageOf(stage).probability;
  deal.updatedAt = new Date().toISOString();

  // 受注・失注に動かしたら顧客ステータスも合わせる
  const c = customerOf(deal.customerId);
  if (c) {
    if (stage === "won") c.status = "won";
    else if (stage === "lost" && dealsOfCustomer(c.id).every((d) => d.stage === "lost")) c.status = "lost";
    c.updatedAt = new Date().toISOString();
  }

  commit();
  showToast(`「${deal.title}」を${stageOf(stage).label}に移動しました。`, before);
}

/* ドラッグ＆ドロップでフェーズを変更 */
let draggingDealId = null;
const board = $("deal-board");

board.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".deal-card");
  if (!card) return;
  draggingDealId = card.dataset.dealOpen;
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", draggingDealId);
});

board.addEventListener("dragend", (e) => {
  e.target.closest(".deal-card")?.classList.remove("dragging");
  board.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  draggingDealId = null;
});

board.addEventListener("dragover", (e) => {
  const col = e.target.closest(".board-col");
  if (!col || !draggingDealId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  board.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  col.classList.add("drop-target");
});

board.addEventListener("drop", (e) => {
  const col = e.target.closest(".board-col");
  if (!col || !draggingDealId) return;
  e.preventDefault();
  const id = draggingDealId;
  draggingDealId = null;
  moveDealToStage(id, col.dataset.stage);
});

/* ---------- 活動履歴 ---------- */

function renderActivities() {
  $("activity-type-filters").innerHTML =
    `<button class="chip${activityTypeFilter === "" ? " active" : ""}" data-type="">すべて</button>` +
    ACTIVITY_TYPES.map(
      (t) =>
        `<button class="chip${activityTypeFilter === t.id ? " active" : ""}" data-type="${t.id}">${esc(t.label)}</button>`
    ).join("");

  const list = state.activities
    .filter((a) => {
      if (activityTypeFilter && a.type !== activityTypeFilter) return false;
      if (!searchQuery) return true;
      const c = customerOf(a.customerId);
      return [a.summary, c ? c.company : "", c ? c.person : ""].join(" ").toLowerCase().includes(searchQuery);
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  $("activities-empty").hidden = list.length > 0;
  $("activity-timeline").innerHTML = list.map(activityRow).join("");
}

$("view-activities").addEventListener("click", (e) => {
  const openId = e.target.closest("[data-open-customer]")?.dataset.openCustomer;
  if (openId) openDetail(openId);
});

/* ==========================================================
   CSV / JSON
   ========================================================== */

const CUSTOMER_CSV_HEADERS = [
  "会社名",
  "担当者名",
  "役職",
  "電話",
  "メール",
  "ステータス",
  "担当営業",
  "タグ",
  "次回アクション日",
  "次回アクション",
  "備考",
];

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/**
 * ファイルを書き出す。
 * 通常のブラウザではリンク経由でダウンロードし、claude.ai の公開ページなど
 * 直接ダウンロードできない環境では保存用の API を使う。
 */
async function download(filename, content, type) {
  const saver =
    typeof window.claude?.use === "function" ? await window.claude.use("downloads").catch(() => null) : null;

  if (saver) {
    try {
      await saver.save({ filename, data: content });
    } catch (err) {
      if (err?.code === "declined") return;
      // csv が許可されていない環境では txt に切り替えて再提示する
      if (err?.code === "extension_not_enabled" && filename.endsWith(".csv")) {
        try {
          await saver.save({ filename: filename.replace(/\.csv$/, ".txt"), data: content });
          return;
        } catch (retryErr) {
          if (retryErr?.code === "declined") return;
        }
      }
      showToast("ファイルを保存できませんでした。");
    }
    return;
  }

  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

$("export-customers-csv").addEventListener("click", () => {
  const rows = state.customers.map((c) => [
    c.company,
    c.person,
    c.jobTitle,
    c.phone,
    c.email,
    statusOf(c.status).label,
    c.owner,
    c.tags.join(" "),
    c.nextActionDate,
    c.nextActionNote,
    c.note,
  ]);
  download(`customers-${todayStr()}.csv`, toCsv(CUSTOMER_CSV_HEADERS, rows), "text/csv;charset=utf-8");
});

$("export-deals-csv").addEventListener("click", () => {
  const headers = ["会社名", "商談名", "金額", "フェーズ", "確度", "受注予定日", "メモ"];
  const rows = state.deals.map((d) => {
    const c = customerOf(d.customerId);
    return [c ? c.company : "", d.title, d.amount, stageOf(d.stage).label, d.probability, d.closeDate, d.note];
  });
  download(`deals-${todayStr()}.csv`, toCsv(headers, rows), "text/csv;charset=utf-8");
});

$("export-json").addEventListener("click", () => {
  download(`sales-crm-backup-${todayStr()}.json`, JSON.stringify(state, null, 2), "application/json");
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

$("import-csv").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = (await file.text()).replace(/^﻿/, "");
  const rows = parseCsv(text);
  if (rows.length < 2) {
    $("import-result").textContent = "取り込める行がありませんでした。";
    return;
  }

  const before = snapshot();
  const header = rows[0].map((h) => h.trim());
  const hasHeader = header.includes("会社名");
  const body = hasHeader ? rows.slice(1) : rows;
  let added = 0;

  body.forEach((r) => {
    const company = (r[0] || "").trim();
    if (!company) return;
    const statusLabel = (r[5] || "").trim();
    const status = STATUSES.find((s) => s.label === statusLabel || s.id === statusLabel)?.id || "lead";
    state.customers.push({
      id: uid(),
      company,
      person: (r[1] || "").trim(),
      jobTitle: (r[2] || "").trim(),
      phone: (r[3] || "").trim(),
      email: (r[4] || "").trim(),
      status,
      owner: (r[6] || "").trim(),
      address: "",
      tags: parseTags((r[7] || "").replace(/\s+/g, ",")),
      nextActionDate: (r[8] || "").trim(),
      nextActionNote: (r[9] || "").trim(),
      note: (r[10] || "").trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    added++;
  });

  commit();
  $("import-result").textContent = `${added}件の顧客を取り込みました。`;
  showToast(`${added}件の顧客を取り込みました。`, before);
  e.target.value = "";
});

$("import-json").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.customers)) throw new Error("形式が違います");
    const ok = await askConfirm("現在のデータをバックアップの内容で置き換えますか？", "復元する");
    if (!ok) {
      e.target.value = "";
      return;
    }
    const before = snapshot();
    state = normalize(parsed);
    commit();
    $("import-result").textContent = "バックアップから復元しました。";
    showToast("バックアップから復元しました。", before);
  } catch (err) {
    $("import-result").textContent = "JSONを読み込めませんでした。ファイル形式をご確認ください。";
  }
  e.target.value = "";
});

$("reset-all").addEventListener("click", async () => {
  const ok = await askConfirm("すべての顧客・商談・活動履歴を削除します。よろしいですか？");
  if (!ok) return;
  const before = snapshot();
  state = emptyState();
  commit();
  showToast("すべてのデータを削除しました。", before);
});

/* ==========================================================
   サンプルデータ
   ========================================================== */

$("load-sample").addEventListener("click", async () => {
  if (state.customers.length) {
    const ok = await askConfirm("既存のデータに加えてサンプルデータを追加しますか？", "追加する");
    if (!ok) return;
  }
  const before = snapshot();
  const now = new Date().toISOString();
  const shift = (days) => todayStr(new Date(Date.now() + days * 86400000));

  const samples = [
    {
      company: "株式会社ミライ製作所",
      person: "山田 太郎",
      jobTitle: "生産管理部 部長",
      phone: "03-1234-5678",
      email: "yamada@mirai-example.co.jp",
      status: "negotiating",
      owner: "自分",
      address: "東京都千代田区丸の内1-1-1",
      tags: ["製造業", "既存顧客"],
      nextActionDate: shift(-2),
      nextActionNote: "見積書の再提出",
      note: "決裁者は工場長。予算は年度末までに執行したい意向。",
      deals: [{ title: "生産管理システム更改", amount: 8000000, stage: "negotiation", probability: 75, closeDate: shift(21) }],
      activities: [
        { type: "visit", date: shift(-9), summary: "本社を訪問し提案書を説明。競合A社も提案中とのこと。" },
        { type: "call", date: shift(-3), summary: "追加要件のヒアリング。帳票のカスタマイズ要望あり。" },
      ],
    },
    {
      company: "ひかりリテール株式会社",
      person: "佐藤 花子",
      jobTitle: "情報システム室",
      phone: "06-9876-5432",
      email: "sato@hikari-example.jp",
      status: "lead",
      owner: "自分",
      address: "大阪府大阪市北区梅田2-2-2",
      tags: ["小売", "新規", "展示会"],
      nextActionDate: shift(0),
      nextActionNote: "資料送付のフォロー電話",
      note: "展示会で名刺交換。まずは情報収集フェーズ。",
      deals: [{ title: "POS連携ツール導入", amount: 1200000, stage: "proposal", probability: 30, closeDate: shift(60) }],
      activities: [{ type: "email", date: shift(-5), summary: "会社紹介資料と導入事例を送付。" }],
    },
    {
      company: "青空ロジスティクス株式会社",
      person: "鈴木 一郎",
      jobTitle: "経営企画部 課長",
      phone: "052-111-2222",
      email: "suzuki@aozora-example.co.jp",
      status: "won",
      owner: "田中",
      address: "愛知県名古屋市中区栄3-3-3",
      tags: ["物流", "既存顧客"],
      nextActionDate: shift(30),
      nextActionNote: "稼働後の定例フォロー",
      note: "今期受注済み。来期は倉庫管理の拡張案件が見込める。",
      deals: [
        { title: "配送管理システム", amount: 4500000, stage: "won", probability: 100, closeDate: shift(-6) },
        { title: "倉庫管理オプション", amount: 2000000, stage: "lead", probability: 10, closeDate: shift(120) },
      ],
      activities: [{ type: "online", date: shift(-6), summary: "オンラインで契約条件を最終確認。発注書受領。" }],
    },
    {
      company: "さくら医療機器株式会社",
      person: "高橋 美咲",
      jobTitle: "購買部",
      phone: "092-333-4444",
      email: "takahashi@sakura-example.jp",
      status: "dormant",
      owner: "田中",
      address: "福岡県福岡市博多区博多駅前4-4-4",
      tags: ["医療", "休眠"],
      nextActionDate: shift(7),
      nextActionNote: "半年ぶりの状況確認",
      note: "前回は予算凍結で見送り。次年度に再検討の可能性。",
      deals: [],
      activities: [{ type: "call", date: shift(-120), summary: "予算凍結のため今期は見送りとの連絡。" }],
    },
  ];

  samples.forEach((s) => {
    const id = uid();
    const { deals, activities, ...customer } = s;
    state.customers.push({ id, createdAt: now, updatedAt: now, ...customer });
    deals.forEach((d) => state.deals.push({ id: uid(), customerId: id, note: "", createdAt: now, updatedAt: now, ...d }));
    activities.forEach((a) => state.activities.push({ id: uid(), customerId: id, createdAt: now, ...a }));
  });

  commit();
  showToast("サンプルデータを追加しました。", before);
});

/* ==========================================================
   起動
   ========================================================== */

render();
