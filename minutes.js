const STORAGE_KEY = "minutes";
const UNDO_TIMEOUT_MS = 6000;

const FORMAT_LABELS = { web: "WEB", onsite: "対面" };

const ICON_EDIT =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 20H21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16.5 3.5C17.3 2.7 18.6 2.7 19.4 3.5C20.2 4.3 20.2 5.6 19.4 6.4L7.5 18.3L3 19.5L4.2 15L16.5 3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const ICON_COPY =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M15 5.5C15 4.67 14.33 4 13.5 4H6C4.9 4 4 4.9 4 6V13.5C4 14.33 4.67 15 5.5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 7H20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9 7V4.8C9 4.35817 9.35817 4 9.8 4H14.2C14.6418 4 15 4.35817 15 4.8V7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 7L6.9 19.2C6.94 19.79 7.43 20.25 8.02 20.25H15.98C16.57 20.25 17.06 19.79 17.1 19.2L18 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const form = document.getElementById("minute-form");
const formTitle = document.getElementById("form-title");
const cancelEditBtn = document.getElementById("cancel-edit");
const submitBtn = document.getElementById("submit-btn");

const datetimeInput = document.getElementById("datetime-input");
const companyInput = document.getElementById("company-input");
const companyList = document.getElementById("company-list");
const personInput = document.getElementById("person-input");
const bodyInput = document.getElementById("body-input");
const bodyCount = document.getElementById("body-count");

const searchInput = document.getElementById("search-input");
const sortSelect = document.getElementById("sort-select");
const companyFilterSelect = document.getElementById("company-filter");
const exportBtn = document.getElementById("export-btn");

const list = document.getElementById("minute-list");
const summary = document.getElementById("summary");
const emptyState = document.getElementById("empty-state");
const emptyStateText = document.getElementById("empty-state-text");
const filterBtns = document.querySelectorAll(".filter-btn");

const confirmModal = document.getElementById("confirm-modal");
const confirmCancelBtn = document.getElementById("confirm-cancel");
const confirmDeleteBtn = document.getElementById("confirm-delete");

const undoToast = document.getElementById("undo-toast");
const undoMessage = document.getElementById("undo-message");
const undoBtn = document.getElementById("undo-btn");

let minutes = loadMinutes();
let formatFilter = "all";
let searchQuery = "";
let sortMode = "date-desc";
let companyFilter = "";
let editingId = null;
const expandedIds = new Set();

let pendingDeleteId = null;
let undoState = null; // { minute, index, timer }

/* ---------- Storage ---------- */

function loadMinutes() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map((m) => ({
      id: m.id || String(Date.now() + Math.random()),
      datetime: typeof m.datetime === "string" ? m.datetime : "",
      company: typeof m.company === "string" ? m.company : "",
      person: typeof m.person === "string" ? m.person : "",
      format: m.format === "onsite" ? "onsite" : "web",
      body: typeof m.body === "string" ? m.body : "",
      updatedAt: m.updatedAt || null,
    }));
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(minutes));
}

/* ---------- Helpers ---------- */

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function formatDateTime(value) {
  if (!value) return "日時未設定";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const week = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}(${week}) ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function getFormatValue() {
  const checked = form.querySelector('input[name="format"]:checked');
  return checked ? checked.value : "web";
}

function setFormatValue(value) {
  const target = form.querySelector(`input[name="format"][value="${value}"]`);
  if (target) target.checked = true;
}

function minuteToText(m) {
  return [
    `日時: ${formatDateTime(m.datetime)}`,
    `顧客: ${m.company}${m.person ? ` / ${m.person}` : ""}`,
    `形式: ${FORMAT_LABELS[m.format]}`,
    "",
    m.body || "(内容の記載なし)",
  ].join("\n");
}

/* ---------- Form ---------- */

datetimeInput.value = nowLocalInput();

function updateBodyCount() {
  const len = bodyInput.value.length;
  bodyCount.textContent = len ? `${len}文字` : "";
}

bodyInput.addEventListener("input", updateBodyCount);

function startEdit(id) {
  const minute = minutes.find((m) => m.id === id);
  if (!minute) return;
  editingId = id;
  datetimeInput.value = minute.datetime;
  companyInput.value = minute.company;
  personInput.value = minute.person;
  bodyInput.value = minute.body;
  setFormatValue(minute.format);
  formTitle.textContent = "議事録を編集";
  submitBtn.textContent = "更新する";
  cancelEditBtn.hidden = false;
  updateBodyCount();
  render();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  companyInput.focus();
}

function resetForm() {
  editingId = null;
  form.reset();
  datetimeInput.value = nowLocalInput();
  setFormatValue("web");
  formTitle.textContent = "新規作成";
  submitBtn.textContent = "保存する";
  cancelEditBtn.hidden = true;
  updateBodyCount();
}

cancelEditBtn.addEventListener("click", () => {
  resetForm();
  render();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const company = companyInput.value.trim();
  if (!company) return;

  const data = {
    datetime: datetimeInput.value,
    company,
    person: personInput.value.trim(),
    format: getFormatValue(),
    body: bodyInput.value.trim(),
    updatedAt: new Date().toISOString(),
  };

  if (editingId) {
    const minute = minutes.find((m) => m.id === editingId);
    if (minute) Object.assign(minute, data);
  } else {
    const id = String(Date.now() + Math.random());
    minutes.push({ id, ...data });
    expandedIds.add(id);
  }

  save();
  resetForm();
  render();
});

/* ---------- Filters ---------- */

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  render();
});

sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value;
  render();
});

companyFilterSelect.addEventListener("change", () => {
  companyFilter = companyFilterSelect.value;
  render();
});

filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    formatFilter = btn.dataset.filter;
    render();
  });
});

function visibleMinutes() {
  let result = minutes.filter((m) => {
    if (formatFilter !== "all" && m.format !== formatFilter) return false;
    if (companyFilter && m.company !== companyFilter) return false;
    if (searchQuery) {
      const haystack = `${m.company} ${m.person} ${m.body}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  });

  result = result.slice().sort((a, b) => {
    if (sortMode === "company") {
      const byCompany = a.company.localeCompare(b.company, "ja");
      if (byCompany !== 0) return byCompany;
      return (b.datetime || "").localeCompare(a.datetime || "");
    }
    const cmp = (a.datetime || "").localeCompare(b.datetime || "");
    return sortMode === "date-asc" ? cmp : -cmp;
  });

  return result;
}

/* ---------- Export ---------- */

exportBtn.addEventListener("click", () => {
  const items = visibleMinutes();
  if (!items.length) {
    showToast("書き出す議事録がありません。", null);
    return;
  }
  const text = items.map(minuteToText).join("\n\n" + "-".repeat(32) + "\n\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `議事録_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

async function copyMinute(id) {
  const minute = minutes.find((m) => m.id === id);
  if (!minute) return;
  const text = minuteToText(minute);
  try {
    await navigator.clipboard.writeText(text);
    showToast("議事録をコピーしました。", null);
  } catch {
    showToast("コピーできませんでした。", null);
  }
}

/* ---------- Delete & undo ---------- */

function requestDelete(id) {
  pendingDeleteId = id;
  confirmModal.hidden = false;
}

confirmCancelBtn.addEventListener("click", () => {
  pendingDeleteId = null;
  confirmModal.hidden = true;
});

confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) {
    pendingDeleteId = null;
    confirmModal.hidden = true;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !confirmModal.hidden) {
    pendingDeleteId = null;
    confirmModal.hidden = true;
  }
});

confirmDeleteBtn.addEventListener("click", () => {
  const index = minutes.findIndex((m) => m.id === pendingDeleteId);
  if (index !== -1) {
    const [removed] = minutes.splice(index, 1);
    if (editingId === removed.id) resetForm();
    save();
    render();
    showToast(`「${removed.company}」の議事録を削除しました。`, () => {
      minutes.splice(Math.min(index, minutes.length), 0, removed);
      save();
      render();
    });
  }
  pendingDeleteId = null;
  confirmModal.hidden = true;
});

function showToast(message, onUndo) {
  if (undoState) clearTimeout(undoState.timer);
  undoMessage.textContent = message;
  undoBtn.hidden = !onUndo;
  undoToast.hidden = false;
  undoState = {
    onUndo,
    timer: setTimeout(() => {
      undoToast.hidden = true;
      undoState = null;
    }, UNDO_TIMEOUT_MS),
  };
}

undoBtn.addEventListener("click", () => {
  if (!undoState || !undoState.onUndo) return;
  clearTimeout(undoState.timer);
  undoState.onUndo();
  undoState = null;
  undoToast.hidden = true;
});

/* ---------- Render ---------- */

function renderCompanyOptions() {
  const companies = [...new Set(minutes.map((m) => m.company).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));

  companyList.innerHTML = companies.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");

  if (companyFilter && !companies.includes(companyFilter)) companyFilter = "";
  companyFilterSelect.innerHTML =
    '<option value="">すべての会社</option>' +
    companies.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  companyFilterSelect.value = companyFilter;
}

function renderSummary() {
  const total = minutes.length;
  const web = minutes.filter((m) => m.format === "web").length;
  const companies = new Set(minutes.map((m) => m.company).filter(Boolean)).size;
  summary.innerHTML = total
    ? [
        `<span class="stat-chip">全 ${total} 件</span>`,
        `<span class="stat-chip">WEB ${web} 件</span>`,
        `<span class="stat-chip">対面 ${total - web} 件</span>`,
        `<span class="stat-chip">顧客 ${companies} 社</span>`,
      ].join("")
    : "";
}

function render() {
  renderCompanyOptions();
  renderSummary();

  const items = visibleMinutes();
  list.innerHTML = "";

  items.forEach((m) => {
    const li = document.createElement("li");
    li.className = `minute-item format-${m.format}`;
    if (editingId === m.id) li.classList.add("editing");

    const expanded = expandedIds.has(m.id);
    const isLong = m.body.length > 160 || m.body.split("\n").length > 4;

    const bodyHtml = m.body
      ? `<span class="minute-text${isLong && !expanded ? " clamped" : ""}">${escapeHtml(m.body)}</span>` +
        (isLong ? `<button class="toggle-body" data-action="toggle">${expanded ? "折りたたむ" : "全文を表示"}</button>` : "")
      : '<span class="no-body">内容の記載はありません</span>';

    li.innerHTML = `
      <div class="minute-body">
        <div class="minute-header-row">
          <span class="minute-company">${escapeHtml(m.company)}</span>
          <span class="format-badge format-${m.format}">${FORMAT_LABELS[m.format]}</span>
        </div>
        <div class="minute-meta">
          <span>${escapeHtml(formatDateTime(m.datetime))}</span>
          ${m.person ? `<span class="person-badge">${escapeHtml(m.person)}</span>` : ""}
        </div>
        ${bodyHtml}
      </div>
      <div class="minute-actions">
        <button class="icon-btn edit-btn" data-action="edit" title="編集" aria-label="編集">${ICON_EDIT}</button>
        <button class="icon-btn copy-btn" data-action="copy" title="コピー" aria-label="コピー">${ICON_COPY}</button>
        <button class="icon-btn delete-btn" data-action="delete" title="削除" aria-label="削除">${ICON_TRASH}</button>
      </div>
    `;

    li.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "edit") startEdit(m.id);
      else if (action === "copy") copyMinute(m.id);
      else if (action === "delete") requestDelete(m.id);
      else if (action === "toggle") {
        if (expandedIds.has(m.id)) expandedIds.delete(m.id);
        else expandedIds.add(m.id);
        render();
      }
    });

    list.appendChild(li);
  });

  const hasFilters = Boolean(searchQuery || companyFilter || formatFilter !== "all");
  emptyState.hidden = items.length > 0;
  emptyStateText.textContent = minutes.length
    ? hasFilters
      ? "条件に一致する議事録がありません。"
      : "議事録はまだありません。"
    : "議事録はまだありません。上のフォームから作成してください。";
}

updateBodyCount();
render();
