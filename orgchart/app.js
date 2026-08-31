const STORAGE_KEY = "orgchart.departments";

/** @typedef {"" | "recruiting" | "leaving" | "leave"} PersonStatus */
/** @typedef {{title:string, name:string, status:PersonStatus}} Leader */
/** @typedef {{name:string, status:PersonStatus}} Member */
/** @typedef {{id:string, name:string, parentId:string|null, leaders:Leader[], members:Member[]}} Department */

/** 人の状態（募集中は赤、退職予定・休職はグレーで表示する） */
const STATUS_OPTIONS = [
  { value: "", label: "通常" },
  { value: "recruiting", label: "募集中" },
  { value: "leaving", label: "退職予定" },
  { value: "leave", label: "休職・産育休" },
];

const STATUS_VALUES = STATUS_OPTIONS.map((option) => option.value);

function normalizeStatus(value) {
  const status = String(value ?? "").trim();
  return STATUS_VALUES.includes(status) ? status : "";
}

/** @type {Department[]} */
let departments = load();
let editingId = null;
let selectedId = null;
let zoom = 1;
let pendingDelete = null;

const form = document.getElementById("dept-form");
const nameInput = document.getElementById("dept-name");
const parentSelect = document.getElementById("parent-select");
const leaderRows = document.getElementById("leader-rows");
const addLeaderBtn = document.getElementById("add-leader");
const memberRows = document.getElementById("member-rows");
const addMemberBtn = document.getElementById("add-member");
const titleList = document.getElementById("title-list");

const formMode = document.getElementById("form-mode");
const submitBtn = document.getElementById("submit-btn");
const cancelEditBtn = document.getElementById("cancel-edit");

const deptList = document.getElementById("dept-list");
const deptCount = document.getElementById("dept-count");

const layout = document.querySelector(".layout");
const splitter = document.getElementById("splitter");
const chartPanel = document.querySelector(".chart-panel");
const chartScroll = document.getElementById("chart-scroll");
const chartStage = document.getElementById("chart-stage");
const chart = document.getElementById("chart");
const chartEmpty = document.getElementById("chart-empty");
const toggleMembers = document.getElementById("toggle-members");
const zoomLabel = document.getElementById("zoom-level");

const confirmModal = document.getElementById("confirm-modal");
const confirmText = document.getElementById("confirm-text");
const confirmOk = document.getElementById("confirm-ok");
const confirmCancel = document.getElementById("confirm-cancel");

const importFile = document.getElementById("import-file");

/* ---------------- storage ---------------- */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(departments));
  } catch {
    /* 保存できない環境でも表示は続行する */
  }
}

function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name ?? "").trim();
  if (!name) return null;
  return {
    id: String(raw.id || createId()),
    name,
    parentId: raw.parentId ? String(raw.parentId) : null,
    leaders: normalizeLeaders(raw),
    members: normalizeMembers(raw.members),
  };
}

/** メンバーは氏名だけの旧形式(文字列)でも読めるようにする */
function normalizeMembers(raw) {
  const list = Array.isArray(raw) ? raw : parseNames(String(raw ?? ""));
  return list
    .map((member) =>
      typeof member === "string"
        ? { name: member.trim(), status: "" }
        : { name: String(member?.name ?? "").trim(), status: normalizeStatus(member?.status) }
    )
    .filter((member) => member.name);
}

/** 旧形式(leaderTitle / leaderName)のデータも読めるようにする */
function normalizeLeaders(raw) {
  const list = Array.isArray(raw.leaders) ? raw.leaders : [];
  const leaders = list
    .map((leader) => ({
      title: String(leader?.title ?? "").trim(),
      name: String(leader?.name ?? "").trim(),
      status: normalizeStatus(leader?.status),
    }))
    .filter((leader) => leader.title || leader.name);

  if (!leaders.length && (raw.leaderTitle || raw.leaderName)) {
    leaders.push({
      title: String(raw.leaderTitle ?? "").trim(),
      name: String(raw.leaderName ?? "").trim(),
      status: "",
    });
  }
  return leaders;
}

function createId() {
  return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------------- helpers ---------------- */

function parseNames(text) {
  return text
    .split(/[\n,、，;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function byId(id) {
  return departments.find((d) => d.id === id) || null;
}

function childrenOf(id) {
  return departments.filter((d) => d.parentId === id);
}

/** ルート（親が存在しないもの）を返す。孤児も root 扱いにして必ず描画する。 */
function roots() {
  return departments.filter((d) => !d.parentId || !byId(d.parentId));
}

/** id の子孫（自分自身を含む）の id 集合 */
function descendantIds(id) {
  const ids = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const d of departments) {
      if (d.parentId && ids.has(d.parentId) && !ids.has(d.id)) {
        ids.add(d.id);
        added = true;
      }
    }
  }
  return ids;
}

function depthOf(dept) {
  let depth = 0;
  let current = dept;
  const seen = new Set([dept.id]);
  while (current.parentId) {
    const parent = byId(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
    depth += 1;
  }
  return depth;
}

/** 一覧表示用に、ツリー順（親→子）に並べ替える */
function flattenTree() {
  const out = [];
  const walk = (list, depth) => {
    for (const d of list) {
      out.push({ dept: d, depth });
      walk(childrenOf(d.id), depth + 1);
    }
  };
  walk(roots(), 0);
  // ループなどで漏れたものを末尾に追加
  for (const d of departments) {
    if (!out.some((row) => row.dept.id === d.id)) out.push({ dept: d, depth: 0 });
  }
  return out;
}

/* ---------------- form ---------------- */

function renderParentOptions() {
  const excluded = editingId ? descendantIds(editingId) : new Set();
  const current = parentSelect.value;

  parentSelect.innerHTML = '<option value="">（最上位）</option>';
  for (const { dept, depth } of flattenTree()) {
    if (excluded.has(dept.id)) continue;
    const option = document.createElement("option");
    option.value = dept.id;
    option.textContent = "　".repeat(depth) + dept.name;
    parentSelect.appendChild(option);
  }

  if (current && parentSelect.querySelector(`option[value="${CSS.escape(current)}"]`)) {
    parentSelect.value = current;
  }
}

function renderTitleSuggestions() {
  const titles = [
    ...new Set(departments.flatMap((d) => d.leaders.map((l) => l.title)).filter(Boolean)),
  ];
  const defaults = ["社長", "本部長", "部長", "次長", "課長", "係長", "マネージャー", "リーダー", "チーフ"];
  titleList.innerHTML = "";
  for (const t of [...new Set([...titles, ...defaults])]) {
    const option = document.createElement("option");
    option.value = t;
    titleList.appendChild(option);
  }
}

function createStatusSelect(status) {
  const select = document.createElement("select");
  select.className = "status-select";
  select.setAttribute("aria-label", "状態");
  for (const option of STATUS_OPTIONS) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    select.appendChild(el);
  }
  select.value = status;
  return select;
}

function createTextInput(className, placeholder, label, value) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = className;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  input.value = value;
  return input;
}

function createRemoveButton(label, onRemove) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-remove";
  button.textContent = "×";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onRemove);
  return button;
}

function addLeaderRow(leader = { title: "", name: "", status: "" }, focus = false) {
  const row = document.createElement("div");
  row.className = "person-row";

  const titleInput = createTextInput("leader-title", "例: 部長", "役職名", leader.title);
  titleInput.setAttribute("list", "title-list");
  const nameInputField = createTextInput("leader-name", "例: 山田 太郎", "氏名", leader.name);

  row.append(
    titleInput,
    nameInputField,
    createStatusSelect(leader.status),
    createRemoveButton("この責任者を削除", () => {
      row.remove();
      if (!leaderRows.children.length) addLeaderRow();
    })
  );

  leaderRows.appendChild(row);
  if (focus) titleInput.focus();
}

function setLeaderRows(leaders) {
  leaderRows.innerHTML = "";
  if (leaders.length) leaders.forEach((leader) => addLeaderRow(leader));
  else addLeaderRow();
}

function readLeaderRows() {
  return [...leaderRows.querySelectorAll(".person-row")]
    .map((row) => ({
      title: row.querySelector(".leader-title").value.trim(),
      name: row.querySelector(".leader-name").value.trim(),
      status: row.querySelector(".status-select").value,
    }))
    .filter((leader) => leader.title || leader.name);
}

function addMemberRow(member = { name: "", status: "" }, focus = false) {
  const row = document.createElement("div");
  row.className = "person-row member-row";

  const nameField = createTextInput("member-name", "例: 佐藤 花子", "氏名", member.name);

  row.append(
    nameField,
    createStatusSelect(member.status),
    createRemoveButton("このメンバーを削除", () => {
      row.remove();
      if (!memberRows.children.length) addMemberRow();
    })
  );

  memberRows.appendChild(row);
  if (focus) nameField.focus();
}

function setMemberRows(members) {
  memberRows.innerHTML = "";
  if (members.length) members.forEach((member) => addMemberRow(member));
  else addMemberRow();
}

/** 1行に複数名を書いた場合は、同じ状態のまま分割して登録する */
function readMemberRows() {
  const members = [];
  for (const row of memberRows.querySelectorAll(".person-row")) {
    const status = row.querySelector(".status-select").value;
    for (const name of parseNames(row.querySelector(".member-name").value)) {
      members.push({ name, status });
    }
  }
  return members;
}

addLeaderBtn.addEventListener("click", () => addLeaderRow(undefined, true));
addMemberBtn.addEventListener("click", () => addMemberRow(undefined, true));

function resetForm() {
  editingId = null;
  form.reset();
  setLeaderRows([]);
  setMemberRows([]);
  formMode.textContent = "部門を追加";
  submitBtn.textContent = "追加する";
  cancelEditBtn.hidden = true;
  renderParentOptions();
}

function startEdit(id) {
  const dept = byId(id);
  if (!dept) return;

  editingId = id;
  selectedId = id;
  formMode.textContent = "部門を編集";
  submitBtn.textContent = "更新する";
  cancelEditBtn.hidden = false;

  renderParentOptions();
  nameInput.value = dept.name;
  parentSelect.value = dept.parentId && byId(dept.parentId) ? dept.parentId : "";
  setLeaderRows(dept.leaders);
  setMemberRows(dept.members);

  render();
  nameInput.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();
  if (!name) return;

  const payload = {
    name,
    parentId: parentSelect.value || null,
    leaders: readLeaderRows(),
    members: readMemberRows(),
  };

  if (editingId) {
    const dept = byId(editingId);
    if (dept) {
      // 自分の子孫を親に指定すると循環するため無視する
      if (payload.parentId && descendantIds(editingId).has(payload.parentId)) {
        payload.parentId = dept.parentId;
      }
      Object.assign(dept, payload);
      selectedId = dept.id;
    }
  } else {
    const dept = { id: createId(), ...payload };
    departments.push(dept);
    selectedId = dept.id;
  }

  save();
  resetForm();
  render();
});

cancelEditBtn.addEventListener("click", () => {
  resetForm();
  render();
});

/* ---------------- delete ---------------- */

function askDelete(id) {
  const dept = byId(id);
  if (!dept) return;

  pendingDelete = id;
  const kids = childrenOf(id).length;
  confirmText.textContent = kids
    ? `「${dept.name}」を削除します。配下の ${kids} 部門は一つ上の階層に移動します。`
    : `「${dept.name}」を削除します。この操作は取り消せません。`;
  confirmModal.hidden = false;
  confirmOk.focus();
}

function closeConfirm() {
  pendingDelete = null;
  confirmModal.hidden = true;
}

confirmCancel.addEventListener("click", closeConfirm);

confirmOk.addEventListener("click", () => {
  if (pendingDelete === "__all__") {
    departments = [];
  } else if (pendingDelete) {
    const target = byId(pendingDelete);
    if (target) {
      for (const child of childrenOf(target.id)) child.parentId = target.parentId;
      departments = departments.filter((d) => d.id !== target.id);
    }
  }

  if (editingId && !byId(editingId)) resetForm();
  if (selectedId && !byId(selectedId)) selectedId = null;

  closeConfirm();
  save();
  render();
});

confirmModal.addEventListener("click", (event) => {
  if (event.target === confirmModal) closeConfirm();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !confirmModal.hidden) closeConfirm();
});

/* ---------------- render ---------------- */

function renderList() {
  deptList.innerHTML = "";
  deptCount.textContent = String(departments.length);

  for (const { dept, depth } of flattenTree()) {
    const li = document.createElement("li");
    li.dataset.level = String(depth % LEVEL_COLORS);
    if (dept.id === editingId) li.classList.add("editing");

    const dot = document.createElement("span");
    dot.className = "level-dot";
    dot.title = `第${depth + 1}階層`;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = (depth ? "└ " : "") + dept.name;
    name.style.paddingLeft = `${depth * 10}px`;

    const meta = document.createElement("span");
    meta.className = "depth";
    meta.textContent = `${dept.members.length}名`;

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "mini";
    editBtn.textContent = "編集";
    editBtn.addEventListener("click", () => startEdit(dept.id));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "mini del";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", () => askDelete(dept.id));

    li.append(dot, name, meta, editBtn, delBtn);
    deptList.appendChild(li);
  }
}

function buildLeaderRow(title, name, status) {
  const row = document.createElement("div");
  row.className = "leader";
  if (status) row.classList.add(`status-${status}`);

  if (title) {
    const titleEl = document.createElement("span");
    titleEl.className = "title";
    titleEl.textContent = title;
    row.appendChild(titleEl);
  }

  if (name) {
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name;
    row.appendChild(nameEl);
  }

  return row;
}

const LEVEL_COLORS = 6;

function buildCard(dept, level) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.level = String(level % LEVEL_COLORS);
  if (dept.id === selectedId) card.classList.add("selected");
  card.tabIndex = 0;
  card.title = "クリックすると編集できます";

  const name = document.createElement("div");
  name.className = "dept";
  name.textContent = dept.name;
  card.appendChild(name);

  if (dept.leaders.length) {
    const leaders = document.createElement("div");
    leaders.className = "leaders";
    for (const leader of dept.leaders) {
      leaders.appendChild(buildLeaderRow(leader.title, leader.name, leader.status));
    }
    card.appendChild(leaders);
  }

  if (toggleMembers.checked && dept.members.length) {
    const members = document.createElement("div");
    members.className = "members";
    const ul = document.createElement("ul");
    for (const member of dept.members) {
      const li = document.createElement("li");
      li.textContent = member.name;
      if (member.status) li.classList.add(`status-${member.status}`);
      ul.appendChild(li);
    }
    members.appendChild(ul);
    card.appendChild(members);
  }

  const open = () => startEdit(dept.id);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });

  return card;
}

function buildNode(dept, visited, level = 0) {
  const node = document.createElement("div");
  node.className = "node";
  node.appendChild(buildCard(dept, level));

  const kids = childrenOf(dept.id).filter((c) => !visited.has(c.id));
  if (kids.length) {
    const children = document.createElement("div");
    children.className = "children";
    for (const child of kids) {
      visited.add(child.id);
      const branch = document.createElement("div");
      branch.className = "branch";
      branch.appendChild(buildNode(child, visited, level + 1));
      children.appendChild(branch);
    }
    node.appendChild(children);
  }

  return node;
}

function renderChart() {
  chart.innerHTML = "";
  const top = roots();
  chartEmpty.hidden = departments.length > 0;

  const visited = new Set(top.map((d) => d.id));
  for (const dept of top) chart.appendChild(buildNode(dept, visited, 0));

  applyZoom();
}

/** 拡大率を反映し、スクロールできるよう土台の実寸も合わせる */
function applyZoom() {
  chart.style.transform = `scale(${zoom})`;
  chartStage.style.width = `${chart.offsetWidth * zoom}px`;
  chartStage.style.height = `${chart.offsetHeight * zoom}px`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;

function setZoom(value) {
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
  applyZoom();
}

/** 組織図全体が表示領域に収まる拡大率にする */
function fitChartToView() {
  if (!chart.offsetWidth || !chart.offsetHeight) return;

  const style = getComputedStyle(chartScroll);
  const availableWidth =
    chartScroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availableHeight =
    chartScroll.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

  setZoom(Math.min(availableWidth / chart.offsetWidth, availableHeight / chart.offsetHeight, MAX_ZOOM));
}

function render() {
  renderParentOptions();
  renderTitleSuggestions();
  renderList();
  renderChart();
}

/* ---------------- chart tools ---------------- */

toggleMembers.addEventListener("change", renderChart);

document.getElementById("zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
document.getElementById("zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
document.getElementById("fit-btn").addEventListener("click", fitChartToView);

const fullBtn = document.getElementById("full-btn");

function setFullScreen(on) {
  document.body.classList.toggle("chart-full", on);
  fullBtn.textContent = on ? "全画面を終了" : "全画面";
  // レイアウトが変わってから収まる倍率を計算する
  requestAnimationFrame(fitChartToView);
}

fullBtn.addEventListener("click", () => setFullScreen(!document.body.classList.contains("chart-full")));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("chart-full")) setFullScreen(false);
});

/* ---------------- パネルの大きさ ---------------- */

const UI_KEY = "orgchart.ui";
const DEFAULT_SIDE_WIDTH = 440;
const MIN_SIDE_WIDTH = 260;

let ui = loadUi();

function loadUi() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
    return {
      sideWidth: Number(saved.sideWidth) || DEFAULT_SIDE_WIDTH,
      chartHeight: Number(saved.chartHeight) || 0,
    };
  } catch {
    return { sideWidth: DEFAULT_SIDE_WIDTH, chartHeight: 0 };
  }
}

function saveUi() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    /* 保存できない環境でも操作は続行する */
  }
}

function applyUi() {
  document.documentElement.style.setProperty("--side-width", `${ui.sideWidth}px`);
  if (ui.chartHeight) chartScroll.style.height = `${ui.chartHeight}px`;
}

function setSideWidth(width) {
  const bounds = layout.getBoundingClientRect();
  const max = Math.max(MIN_SIDE_WIDTH, bounds.width - 360);
  ui.sideWidth = Math.round(Math.min(Math.max(width, MIN_SIDE_WIDTH), max));
  applyUi();
}

let resizingPanels = false;

splitter.addEventListener("pointerdown", (event) => {
  resizingPanels = true;
  splitter.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing");
});

splitter.addEventListener("pointermove", (event) => {
  if (!resizingPanels) return;
  setSideWidth(event.clientX - layout.getBoundingClientRect().left);
});

function endPanelResize() {
  if (!resizingPanels) return;
  resizingPanels = false;
  document.body.classList.remove("resizing");
  saveUi();
}

splitter.addEventListener("pointerup", endPanelResize);
splitter.addEventListener("pointercancel", endPanelResize);

splitter.addEventListener("dblclick", () => {
  setSideWidth(DEFAULT_SIDE_WIDTH);
  saveUi();
});

splitter.addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 40 : 12;
  if (event.key === "ArrowLeft") setSideWidth(ui.sideWidth - step);
  else if (event.key === "ArrowRight") setSideWidth(ui.sideWidth + step);
  else return;
  event.preventDefault();
  saveUi();
});

// 高さのつまみで変えた値を覚えておく
let heightSaveTimer = 0;
new ResizeObserver(() => {
  if (document.body.classList.contains("chart-full")) return;
  ui.chartHeight = chartScroll.offsetHeight;
  clearTimeout(heightSaveTimer);
  heightSaveTimer = setTimeout(saveUi, 400);
}).observe(chartScroll);

document.getElementById("print-btn").addEventListener("click", () => window.print());

/* ---------------- PDF 出力 ---------------- */

/*
 * 公開ページ(iframe)では印刷ダイアログを開けないため、組織図を canvas に
 * 描き直し、その画像を 1 ページの PDF に収めて保存する。
 */

/** CSS の色トークンを読み、canvas 描画と配色を揃える */
function token(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function roundRectPath(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return [text];

  const lines = [];
  let line = "";
  for (const char of text) {
    const next = line + char;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextElement(ctx, el, rect) {
  const text = el.textContent.trim();
  if (!text) return;

  const style = getComputedStyle(el);
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.fillStyle = style.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) || 0;
  const lines = wrapText(ctx, text, Math.max(rect.w - padX - 2, 10));
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
  const top = rect.y + rect.h / 2 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, i) => ctx.fillText(line, rect.x + rect.w / 2, top + i * lineHeight));
}

function drawCardToCanvas(ctx, card, rectOf) {
  const r = rectOf(card);

  roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
  ctx.clip();

  // 部門名の帯と上端のアクセント
  const dept = card.querySelector(".dept");
  const deptRect = rectOf(dept);
  const cardStyle = getComputedStyle(card);
  ctx.fillStyle = cardStyle.getPropertyValue("--card-band").trim() || "#e0e7ff";
  ctx.fillRect(r.x, r.y, r.w, deptRect.y + deptRect.h - r.y);
  ctx.fillStyle = cardStyle.getPropertyValue("--card-bar").trim() || "#4338ca";
  ctx.fillRect(r.x, r.y, r.w, 4);
  ctx.fillStyle = token("--border", "#cbd5e1");
  ctx.fillRect(r.x, deptRect.y + deptRect.h - 1, r.w, 1);

  // メンバーの背景
  const memberItems = [...card.querySelectorAll(".members li")];
  for (const li of memberItems) {
    const lr = rectOf(li);
    const liStyle = getComputedStyle(li);
    roundRectPath(ctx, lr.x, lr.y, lr.w, lr.h, 7);
    ctx.fillStyle = liStyle.backgroundColor;
    ctx.fill();
    ctx.strokeStyle = liStyle.borderTopColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 責任者どうし・責任者とメンバーの区切り線
  ctx.save();
  ctx.strokeStyle = "#b6c2d2";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  const leaderRows = [...card.querySelectorAll(".leader")];
  const separators = leaderRows.slice(1).map((row) => rectOf(row).y);
  const membersEl = card.querySelector(".members");
  if (membersEl && leaderRows.length) separators.push(rectOf(membersEl).y);
  for (const y of separators) {
    ctx.beginPath();
    ctx.moveTo(r.x, y + 0.5);
    ctx.lineTo(r.x + r.w, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();

  roundRectPath(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 12);
  ctx.strokeStyle = token("--border", "#cbd5e1");
  ctx.lineWidth = 1;
  ctx.stroke();

  drawTextElement(ctx, dept, deptRect);

  for (const row of leaderRows) {
    // 氏名はインライン要素なので、行の内側の幅を折り返し幅として使う
    const rowRect = rectOf(row);
    const rowStyle = getComputedStyle(row);
    const left = rowRect.x + parseFloat(rowStyle.paddingLeft);
    const innerWidth =
      rowRect.w - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight);

    for (const el of row.querySelectorAll(".title, .name")) {
      const r = rectOf(el);
      drawTextElement(ctx, el, { x: left, y: r.y, w: innerWidth, h: r.h });
    }
  }

  for (const li of memberItems) drawTextElement(ctx, li, rectOf(li));
}

function drawConnectorsToCanvas(ctx, rectOf) {
  ctx.strokeStyle = token("--line", "#94a3b8");
  ctx.lineWidth = 2;

  for (const node of chart.querySelectorAll(".node")) {
    const children = [...node.children].find((el) => el.classList.contains("children"));
    if (!children) continue;

    const parent = rectOf([...node.children].find((el) => el.classList.contains("card")));
    const childCards = [...children.children].map((branch) => rectOf(branch.querySelector(".card")));
    if (!childCards.length) continue;

    const parentX = parent.x + parent.w / 2;
    const barY = parent.y + parent.h + 22;
    const centers = childCards.map((c) => c.x + c.w / 2);

    ctx.beginPath();
    ctx.moveTo(parentX, parent.y + parent.h);
    ctx.lineTo(parentX, barY);
    if (centers.length > 1) {
      ctx.moveTo(Math.min(...centers), barY);
      ctx.lineTo(Math.max(...centers), barY);
    }
    childCards.forEach((child, i) => {
      ctx.moveTo(centers[i], barY);
      ctx.lineTo(centers[i], child.y);
    });
    ctx.stroke();
  }
}

const STATUS_COLORS = {
  recruiting: "#c02626",
  leaving: "#6b7280",
  leave: "#6b7280",
};

function statusesInUse() {
  const used = new Set();
  for (const dept of departments) {
    for (const person of [...dept.leaders, ...dept.members]) {
      if (person.status) used.add(person.status);
    }
  }
  return STATUS_OPTIONS.filter((option) => option.value && used.has(option.value));
}

/** 出力した図だけでも色の意味が分かるよう、凡例を描く */
function drawLegend(ctx, statuses, fontFamily) {
  let x = 2;
  for (const status of statuses) {
    const color = STATUS_COLORS[status.value] || "#6b7280";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 5, 10, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `${status.value === "leave" ? "italic " : ""}700 15px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(status.label, x + 16, 11);
    x += 16 + ctx.measureText(status.label).width + 24;
  }
}

async function renderChartToCanvas() {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  const previousTransform = chart.style.transform;
  chart.style.transform = "none";

  const base = chart.getBoundingClientRect();
  const margin = 24;
  const legend = statusesInUse();
  const legendHeight = legend.length ? 34 : 0;
  const width = base.width + margin * 2;
  const height = base.height + margin * 2 + legendHeight;
  const ratio = Math.min(2, 8000 / Math.max(width, height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(ratio, ratio);
  ctx.translate(margin, margin);

  if (legendHeight) {
    drawLegend(ctx, legend, getComputedStyle(document.body).fontFamily);
    ctx.translate(0, legendHeight);
  }

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
  };

  drawConnectorsToCanvas(ctx, rectOf);
  for (const card of chart.querySelectorAll(".card")) drawCardToCanvas(ctx, card, rectOf);

  chart.style.transform = previousTransform;
  return canvas;
}

/** JPEG 画像 1 枚を A4 に収めた PDF を組み立てる */
function buildPdfFromJpeg(jpeg, imageWidth, imageHeight) {
  const landscape = imageWidth >= imageHeight;
  const pageWidth = landscape ? 841.89 : 595.28;
  const pageHeight = landscape ? 595.28 : 841.89;
  const margin = 28;
  const scale = Math.min(
    (pageWidth - margin * 2) / imageWidth,
    (pageHeight - margin * 2) / imageHeight
  );
  const w = imageWidth * scale;
  const h = imageHeight * scale;
  const x = (pageWidth - w) / 2;
  const y = (pageHeight - h) / 2;

  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;

  const push = (data) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };

  const addObject = (number, body, stream) => {
    offsets[number] = length;
    push(`${number} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  const content = `q\n${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;

  push("%PDF-1.4\n");
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObject(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] ` +
      "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"
  );
  addObject(
    4,
    "<< /Type /XObject /Subtype /Image " +
      `/Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg
  );
  addObject(5, `<< /Length ${encoder.encode(content).length} >>`, encoder.encode(content));

  const xrefPosition = length;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`);

  const pdf = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    pdf.set(chunk, position);
    position += chunk.length;
  }
  return pdf;
}

function saveToFile(data, filename, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

document.getElementById("pdf-btn").addEventListener("click", async () => {
  if (!departments.length) {
    window.alert("先に部門を追加してください。");
    return;
  }

  const canvas = await renderChartToCanvas();
  const jpegBlob = await toBlob(canvas, "image/jpeg", 0.92);
  const pdf = buildPdfFromJpeg(
    new Uint8Array(await jpegBlob.arrayBuffer()),
    canvas.width,
    canvas.height
  );

  const downloads = await getDownloads();
  if (!downloads) {
    saveToFile(pdf, "orgchart.pdf", "application/pdf");
    return;
  }

  try {
    await downloads.save({ filename: "orgchart.pdf", data: pdf });
  } catch (error) {
    const code = error && error.code;
    if (code === "declined") return;

    // PDF が許可されていない環境では画像で保存する
    if (code === "rejected_extension" || code === "extension_not_enabled") {
      try {
        await downloads.save({ filename: "orgchart.png", data: await toBlob(canvas, "image/png") });
        window.alert("この環境ではPDFを保存できないため、画像(PNG)で保存しました。");
        return;
      } catch (fallbackError) {
        if (fallbackError && fallbackError.code === "declined") return;
      }
    }
    window.alert("PDFの書き出しに失敗しました。もう一度お試しください。");
  }
});

/* ---------------- import / export / sample ---------------- */

async function getDownloads() {
  // 公開ページ(Artifact)ではホスト経由でしか保存できないため、その窓口を取得する
  if (!window.claude || typeof window.claude.use !== "function") return null;
  try {
    return await window.claude.use("downloads");
  } catch {
    return null;
  }
}

document.getElementById("export-btn").addEventListener("click", async () => {
  const json = JSON.stringify(departments, null, 2);
  const downloads = await getDownloads();

  if (downloads) {
    try {
      await downloads.save({ filename: "orgchart.json", data: json });
    } catch (error) {
      if (error && error.code !== "declined") {
        window.alert("書き出しに失敗しました。もう一度お試しください。");
      }
    }
    return;
  }

  saveToFile(json, "orgchart.json", "application/json");
});

document.getElementById("import-btn").addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = "";
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) throw new Error("配列ではありません");
    const imported = parsed.map(normalize).filter(Boolean);
    if (!imported.length) throw new Error("有効な部門がありません");
    departments = imported;
    resetForm();
    selectedId = null;
    save();
    render();
  } catch (error) {
    window.alert(`読み込みに失敗しました: ${error.message}`);
  }
});

document.getElementById("reset-btn").addEventListener("click", () => {
  if (!departments.length) return;
  pendingDelete = "__all__";
  confirmText.textContent = `登録済みの ${departments.length} 部門をすべて削除します。この操作は取り消せません。`;
  confirmModal.hidden = false;
  confirmOk.focus();
});

document.getElementById("sample-btn").addEventListener("click", () => {
  const person = (name, status = "") => ({ name, status });
  const lead = (title, name, status = "") => ({ title, name, status });

  const company = { id: createId(), name: "株式会社サンプル", parentId: null, leaders: [lead("代表取締役社長", "山田 太郎")], members: [] };
  const sales = { id: createId(), name: "営業部", parentId: company.id, leaders: [lead("部長", "佐藤 花子"), lead("課長", "（募集中）", "recruiting")], members: [person("高橋 二郎"), person("田村 涼子", "leave")] };
  const dev = { id: createId(), name: "開発部", parentId: company.id, leaders: [lead("部長", "田中 三郎")], members: [person("伊藤 四郎"), person("渡辺 五郎", "leaving"), person("中村 六郎")] };
  const admin = { id: createId(), name: "管理部", parentId: company.id, leaders: [lead("部長", "小林 七子"), lead("係長", "森田 恵")], members: [person("加藤 八郎")] };
  const dev1 = { id: createId(), name: "第一開発課", parentId: dev.id, leaders: [lead("課長", "山本 九郎")], members: [person("エンジニア", "recruiting")] };

  departments = [company, sales, dev, admin, dev1];
  resetForm();
  selectedId = null;
  save();
  render();
});

/* ---------------- init ---------------- */

applyUi();
resetForm();
render();
