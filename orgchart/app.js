const STORAGE_KEY = "orgchart.departments";

/** @typedef {{title:string, name:string}} Leader */
/** @typedef {{id:string, name:string, parentId:string|null, leaders:Leader[], members:string[]}} Department */

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
    leaders: normalizeLeaders(raw),
    members: Array.isArray(raw.members)
      ? raw.members.map((m) => String(m).trim()).filter(Boolean)
      : parseMembers(String(raw.members ?? "")),
  };
}

/** 旧形式(leaderTitle / leaderName)のデータも読めるようにする */
function normalizeLeaders(raw) {
  const list = Array.isArray(raw.leaders) ? raw.leaders : [];
  const leaders = list
    .map((leader) => ({
      title: String(leader?.title ?? "").trim(),
      name: String(leader?.name ?? "").trim(),
    }))
    .filter((leader) => leader.title || leader.name);

  if (!leaders.length && (raw.leaderTitle || raw.leaderName)) {
    leaders.push({
      title: String(raw.leaderTitle ?? "").trim(),
      name: String(raw.leaderName ?? "").trim(),
    });
  }
  return leaders;
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

function addLeaderRow(title = "", name = "", focus = false) {
  const row = document.createElement("div");
  row.className = "leader-row";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "leader-title";
  titleInput.placeholder = "例: 部長";
  titleInput.setAttribute("list", "title-list");
  titleInput.setAttribute("aria-label", "役職名");
  titleInput.value = title;

  const nameField = document.createElement("input");
  nameField.type = "text";
  nameField.className = "leader-name";
  nameField.placeholder = "例: 山田 太郎";
  nameField.setAttribute("aria-label", "氏名");
  nameField.value = name;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "row-remove";
  removeBtn.textContent = "×";
  removeBtn.title = "この責任者を削除";
  removeBtn.setAttribute("aria-label", "この責任者を削除");
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!leaderRows.children.length) addLeaderRow();
  });

  row.append(titleInput, nameField, removeBtn);
  leaderRows.appendChild(row);
  if (focus) titleInput.focus();
}

function setLeaderRows(leaders) {
  leaderRows.innerHTML = "";
  if (leaders.length) {
    for (const leader of leaders) addLeaderRow(leader.title, leader.name);
  } else {
    addLeaderRow();
  }
}

function readLeaderRows() {
  return [...leaderRows.querySelectorAll(".leader-row")]
    .map((row) => ({
      title: row.querySelector(".leader-title").value.trim(),
      name: row.querySelector(".leader-name").value.trim(),
    }))
    .filter((leader) => leader.title || leader.name);
}

addLeaderBtn.addEventListener("click", () => addLeaderRow("", "", true));

function resetForm() {
  editingId = null;
  form.reset();
  setLeaderRows([]);
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
    leaders: readLeaderRows(),
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

function buildLeaderRow(title, name) {
  const row = document.createElement("div");
  row.className = "leader";

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

  if (dept.leaders.length) {
    const leaders = document.createElement("div");
    leaders.className = "leaders";
    for (const leader of dept.leaders) {
      leaders.appendChild(buildLeaderRow(leader.title, leader.name));
    }
    card.appendChild(leaders);
  }

  if (toggleMembers.checked && dept.members.length) {
    const members = document.createElement("div");
    members.className = "members";
    const ul = document.createElement("ul");
    for (const member of dept.members) {
      const li = document.createElement("li");
      li.textContent = member;
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

/* ---------------- PDF 出力 ---------------- */

/*
 * 公開ページ(iframe)では印刷ダイアログを開けないため、組織図を canvas に
 * 描き直し、その画像を 1 ページの PDF に収めて保存する。
 */

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
  ctx.fillStyle = "#eef2ff";
  ctx.fillRect(r.x, r.y, r.w, deptRect.y + deptRect.h - r.y);
  ctx.fillStyle = "#4f46e5";
  ctx.fillRect(r.x, r.y, r.w, 3);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(r.x, deptRect.y + deptRect.h - 1, r.w, 1);

  // メンバーの背景
  const memberItems = [...card.querySelectorAll(".members li")];
  ctx.fillStyle = "#f8fafc";
  for (const li of memberItems) {
    const lr = rectOf(li);
    roundRectPath(ctx, lr.x, lr.y, lr.w, lr.h, 7);
    ctx.fill();
  }

  // 責任者どうし・責任者とメンバーの区切り線
  ctx.save();
  ctx.strokeStyle = "#e2e8f0";
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
  ctx.strokeStyle = "#e2e8f0";
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
  ctx.strokeStyle = "#cbd5e1";
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

async function renderChartToCanvas() {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  const previousTransform = chart.style.transform;
  chart.style.transform = "none";

  const base = chart.getBoundingClientRect();
  const margin = 24;
  const width = base.width + margin * 2;
  const height = base.height + margin * 2;
  const ratio = Math.min(2, 8000 / Math.max(width, height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(ratio, ratio);
  ctx.translate(margin, margin);

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
  const company = { id: createId(), name: "株式会社サンプル", parentId: null, leaders: [{ title: "代表取締役社長", name: "山田 太郎" }], members: [] };
  const sales = { id: createId(), name: "営業部", parentId: company.id, leaders: [{ title: "部長", name: "佐藤 花子" }, { title: "課長", name: "鈴木 一郎" }], members: ["高橋 二郎", "田村 涼子"] };
  const dev = { id: createId(), name: "開発部", parentId: company.id, leaders: [{ title: "部長", name: "田中 三郎" }], members: ["伊藤 四郎", "渡辺 五郎", "中村 六郎"] };
  const admin = { id: createId(), name: "管理部", parentId: company.id, leaders: [{ title: "部長", name: "小林 七子" }, { title: "係長", name: "森田 恵" }], members: ["加藤 八郎"] };
  const dev1 = { id: createId(), name: "第一開発課", parentId: dev.id, leaders: [{ title: "課長", name: "山本 九郎" }], members: ["松本 十郎"] };

  departments = [company, sales, dev, admin, dev1];
  resetForm();
  selectedId = null;
  save();
  render();
});

/* ---------------- init ---------------- */

resetForm();
render();
