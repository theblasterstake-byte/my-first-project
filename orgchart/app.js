const STORAGE_KEY = "orgchart.departments";

/** @typedef {{id:string, name:string, parentId:string|null, leaderTitle:string, leaderName:string, members:string[]}} Department */

/** @type {Department[]} */
let departments = load();
let editingId = null;
let selectedId = null;
let zoom = 1;
let pendingDelete = null;

const form = document.getElementById("dept-form");
const nameInput = document.getElementById("dept-name");
const parentSelect = document.getElementById("parent-select");
const leaderTitleInput = document.getElementById("leader-title");
const leaderNameInput = document.getElementById("leader-name");
const membersInput = document.getElementById("members-input");
const titleList = document.getElementById("title-list");

const formMode = document.getElementById("form-mode");
const submitBtn = document.getElementById("submit-btn");
const cancelEditBtn = document.getElementById("cancel-edit");

const deptList = document.getElementById("dept-list");
const deptCount = document.getElementById("dept-count");

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
    leaderTitle: String(raw.leaderTitle ?? "").trim(),
    leaderName: String(raw.leaderName ?? "").trim(),
    members: Array.isArray(raw.members)
      ? raw.members.map((m) => String(m).trim()).filter(Boolean)
      : parseMembers(String(raw.members ?? "")),
  };
}

function createId() {
  return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------------- helpers ---------------- */

function parseMembers(text) {
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
  const titles = [...new Set(departments.map((d) => d.leaderTitle).filter(Boolean))];
  const defaults = ["社長", "本部長", "部長", "次長", "課長", "係長", "マネージャー", "リーダー", "チーフ"];
  titleList.innerHTML = "";
  for (const t of [...new Set([...titles, ...defaults])]) {
    const option = document.createElement("option");
    option.value = t;
    titleList.appendChild(option);
  }
}

function resetForm() {
  editingId = null;
  form.reset();
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
  leaderTitleInput.value = dept.leaderTitle;
  leaderNameInput.value = dept.leaderName;
  membersInput.value = dept.members.join("\n");

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
    leaderTitle: leaderTitleInput.value.trim(),
    leaderName: leaderNameInput.value.trim(),
    members: parseMembers(membersInput.value),
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
    if (dept.id === editingId) li.classList.add("editing");

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

    li.append(name, meta, editBtn, delBtn);
    deptList.appendChild(li);
  }
}

function buildCard(dept) {
  const card = document.createElement("div");
  card.className = "card";
  if (dept.id === selectedId) card.classList.add("selected");
  card.tabIndex = 0;
  card.title = "クリックすると編集できます";

  const name = document.createElement("div");
  name.className = "dept";
  name.textContent = dept.name;
  card.appendChild(name);

  const leader = document.createElement("div");
  leader.className = "leader";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = dept.leaderTitle || "責任者";
  const leaderName = document.createElement("span");
  leaderName.className = "name";
  if (dept.leaderName) {
    leaderName.textContent = dept.leaderName;
  } else {
    leaderName.textContent = "（未設定）";
    leader.classList.add("vacant");
  }
  leader.append(title, leaderName);
  card.appendChild(leader);

  if (toggleMembers.checked) {
    const members = document.createElement("div");
    members.className = "members";
    const head = document.createElement("div");
    head.className = "members-head";
    head.textContent = `メンバー ${dept.members.length}名`;
    const ul = document.createElement("ul");
    if (dept.members.length) {
      for (const member of dept.members) {
        const li = document.createElement("li");
        li.textContent = member;
        ul.appendChild(li);
      }
    } else {
      members.classList.add("none");
      const li = document.createElement("li");
      li.textContent = "メンバー未登録";
      ul.appendChild(li);
    }
    members.append(head, ul);
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

function buildNode(dept, visited) {
  const node = document.createElement("div");
  node.className = "node";
  node.appendChild(buildCard(dept));

  const kids = childrenOf(dept.id).filter((c) => !visited.has(c.id));
  if (kids.length) {
    const children = document.createElement("div");
    children.className = "children";
    for (const child of kids) {
      visited.add(child.id);
      const branch = document.createElement("div");
      branch.className = "branch";
      branch.appendChild(buildNode(child, visited));
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
  for (const dept of top) chart.appendChild(buildNode(dept, visited));

  chart.style.transform = `scale(${zoom})`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function render() {
  renderParentOptions();
  renderTitleSuggestions();
  renderList();
  renderChart();
}

/* ---------------- chart tools ---------------- */

toggleMembers.addEventListener("change", renderChart);

document.getElementById("zoom-in").addEventListener("click", () => {
  zoom = Math.min(1.6, Math.round((zoom + 0.1) * 10) / 10);
  renderChart();
});

document.getElementById("zoom-out").addEventListener("click", () => {
  zoom = Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10);
  renderChart();
});

document.getElementById("print-btn").addEventListener("click", () => window.print());

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

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "orgchart.json";
  link.click();
  URL.revokeObjectURL(url);
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
  const company = { id: createId(), name: "株式会社サンプル", parentId: null, leaderTitle: "代表取締役社長", leaderName: "山田 太郎", members: [] };
  const sales = { id: createId(), name: "営業部", parentId: company.id, leaderTitle: "部長", leaderName: "佐藤 花子", members: ["鈴木 一郎", "高橋 二郎"] };
  const dev = { id: createId(), name: "開発部", parentId: company.id, leaderTitle: "部長", leaderName: "田中 三郎", members: ["伊藤 四郎", "渡辺 五郎", "中村 六郎"] };
  const admin = { id: createId(), name: "管理部", parentId: company.id, leaderTitle: "部長", leaderName: "小林 七子", members: ["加藤 八郎"] };
  const dev1 = { id: createId(), name: "第一開発課", parentId: dev.id, leaderTitle: "課長", leaderName: "山本 九郎", members: ["松本 十郎"] };

  departments = [company, sales, dev, admin, dev1];
  resetForm();
  selectedId = null;
  save();
  render();
});

/* ---------------- init ---------------- */

resetForm();
render();
