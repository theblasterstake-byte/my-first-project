const STORAGE_KEY = "tasks";
const UNDO_TIMEOUT_MS = 6000;

const form = document.getElementById("task-form");
const input = document.getElementById("task-input");
const priorityInput = document.getElementById("priority-input");
const categoryInput = document.getElementById("category-input");
const categoryList = document.getElementById("category-list");
const createdInput = document.getElementById("created-input");
const dueToggle = document.getElementById("due-toggle");
const dueInput = document.getElementById("due-input");
const notesInput = document.getElementById("notes-input");

const searchInput = document.getElementById("search-input");
const sortSelect = document.getElementById("sort-select");
const categoryFilterSelect = document.getElementById("category-filter");

const list = document.getElementById("task-list");
const summary = document.getElementById("summary");
const emptyState = document.getElementById("empty-state");
const dragHint = document.getElementById("drag-hint");
const clearDoneBtn = document.getElementById("clear-done");
const filterBtns = document.querySelectorAll(".filter-btn");

const confirmModal = document.getElementById("confirm-modal");
const confirmCancelBtn = document.getElementById("confirm-cancel");
const confirmDeleteBtn = document.getElementById("confirm-delete");

const undoToast = document.getElementById("undo-toast");
const undoMessage = document.getElementById("undo-message");
const undoBtn = document.getElementById("undo-btn");

let tasks = loadTasks();
let statusFilter = "all";
let searchQuery = "";
let sortMode = "manual";
let categoryFilter = "";
let editingId = null;
const expandedIds = new Set();

let pendingDeleteId = null;
let undoState = null; // { task, index, timer }
let dragId = null;

function todayStr() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

createdInput.value = todayStr();

function loadTasks() {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    raw = [];
  }
  if (!Array.isArray(raw)) raw = [];
  return raw.map((t, i) => normalizeTask(t, i));
}

function normalizeTask(t, i) {
  return {
    id: t.id || crypto.randomUUID(),
    title: t.title || "",
    priority: t.priority || "medium",
    category: t.category || "",
    createdAt: t.createdAt || todayStr(),
    due: t.due || null,
    notes: t.notes || "",
    done: !!t.done,
    subtasks: Array.isArray(t.subtasks)
      ? t.subtasks.map((s) => ({
          id: s.id || crypto.randomUUID(),
          title: s.title || "",
          done: !!s.done,
        }))
      : [],
  };
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function priorityLabel(priority) {
  return { high: "高", medium: "中", low: "低" }[priority] || "中";
}

function priorityRank(priority) {
  return { high: 0, medium: 1, low: 2 }[priority] ?? 1;
}

function isOverdue(task) {
  if (!task.due || task.done) return false;
  return task.due < todayStr();
}

function getCategories() {
  const set = new Set();
  tasks.forEach((t) => {
    if (t.category) set.add(t.category);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
}

function updateCategoryOptions() {
  const categories = getCategories();

  categoryList.innerHTML = "";
  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    categoryList.appendChild(opt);
  });

  const prevValue = categoryFilterSelect.value;
  categoryFilterSelect.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "すべてのカテゴリ";
  categoryFilterSelect.appendChild(allOpt);
  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    categoryFilterSelect.appendChild(opt);
  });
  if (categories.includes(prevValue)) {
    categoryFilterSelect.value = prevValue;
  } else {
    categoryFilter = "";
    categoryFilterSelect.value = "";
  }
}

function getVisibleTasks() {
  let result = tasks.filter((t) => {
    if (statusFilter === "active" && t.done) return false;
    if (statusFilter === "done" && !t.done) return false;
    if (categoryFilter && t.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const haystack = `${t.title} ${t.notes} ${t.category}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (sortMode === "priority") {
    result = [...result].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  } else if (sortMode === "due") {
    result = [...result].sort((a, b) => {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
    });
  } else if (sortMode === "created-desc") {
    result = [...result].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  } else if (sortMode === "created-asc") {
    result = [...result].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  return result;
}

function isDragEnabled() {
  return sortMode === "manual" && statusFilter === "all" && !categoryFilter && !searchQuery;
}

function render() {
  updateCategoryOptions();

  const visible = getVisibleTasks();
  const dragEnabled = isDragEnabled();
  dragHint.hidden = !dragEnabled;

  list.innerHTML = "";
  visible.forEach((task) => {
    list.appendChild(task.id === editingId ? renderEditItem(task) : renderTaskItem(task, dragEnabled));
  });

  emptyState.hidden = visible.length > 0;
  if (visible.length === 0) {
    emptyState.textContent =
      tasks.length === 0
        ? "タスクはありません。上のフォームから追加してください。"
        : "条件に一致するタスクはありません。";
  }

  const doneCount = tasks.filter((t) => t.done).length;
  const overdueCount = tasks.filter((t) => isOverdue(t)).length;
  summary.textContent =
    `全 ${tasks.length} 件中 ${doneCount} 件完了` + (overdueCount > 0 ? ` ・ 期限超過 ${overdueCount} 件` : "");
}

function renderTaskItem(task, dragEnabled) {
  const li = document.createElement("li");
  li.className = "task-item" + (task.done ? " done" : "");
  li.dataset.id = task.id;
  li.draggable = dragEnabled;

  if (dragEnabled) {
    li.addEventListener("dragstart", () => {
      dragId = task.id;
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
      dragId = null;
      li.classList.remove("dragging");
      list.querySelectorAll(".task-item").forEach((el) => el.classList.remove("drag-over"));
    });
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (dragId && dragId !== task.id) li.classList.add("drag-over");
    });
    li.addEventListener("dragleave", () => {
      li.classList.remove("drag-over");
    });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("drag-over");
      if (!dragId || dragId === task.id) return;
      reorderTasks(dragId, task.id);
    });
  }

  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.textContent = dragEnabled ? "⋮⋮" : "";
  handle.setAttribute("aria-hidden", "true");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-checkbox";
  checkbox.checked = task.done;
  checkbox.addEventListener("change", () => toggleTask(task.id));

  const body = document.createElement("div");
  body.className = "task-body";

  const headerRow = document.createElement("div");
  headerRow.className = "task-header-row";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;
  headerRow.appendChild(title);

  const subtaskTotal = task.subtasks.length;
  if (subtaskTotal > 0) {
    const subtaskDone = task.subtasks.filter((s) => s.done).length;
    const progress = document.createElement("span");
    progress.className = "subtask-progress";
    progress.textContent = `${subtaskDone}/${subtaskTotal}`;
    headerRow.appendChild(progress);
  }

  body.appendChild(headerRow);

  const meta = document.createElement("div");
  meta.className = "task-meta";

  const badge = document.createElement("span");
  badge.className = `priority-badge priority-${task.priority}`;
  badge.textContent = priorityLabel(task.priority);
  meta.appendChild(badge);

  if (task.category) {
    const catBadge = document.createElement("span");
    catBadge.className = "category-badge";
    catBadge.textContent = task.category;
    meta.appendChild(catBadge);
  }

  if (task.createdAt) {
    const created = document.createElement("span");
    created.textContent = `追加日: ${task.createdAt}`;
    meta.appendChild(created);
  }

  if (task.due) {
    const due = document.createElement("span");
    due.textContent = `期限: ${task.due}`;
    if (isOverdue(task)) due.classList.add("due-overdue");
    meta.appendChild(due);
  }

  body.appendChild(meta);

  if (task.notes) {
    const notes = document.createElement("span");
    notes.className = "task-notes";
    notes.textContent = task.notes;
    body.appendChild(notes);
  }

  const subtasksToggle = document.createElement("button");
  subtasksToggle.type = "button";
  subtasksToggle.className = "subtasks-toggle";
  const expanded = expandedIds.has(task.id);
  subtasksToggle.textContent = expanded
    ? "▾ サブタスクを閉じる"
    : subtaskTotal > 0
    ? `▸ サブタスク (${subtaskTotal})`
    : "▸ サブタスクを追加";
  subtasksToggle.addEventListener("click", () => {
    if (expanded) {
      expandedIds.delete(task.id);
    } else {
      expandedIds.add(task.id);
    }
    render();
  });
  body.appendChild(subtasksToggle);

  if (expanded) {
    body.appendChild(renderSubtasksPanel(task));
  }

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "edit-btn";
  editBtn.textContent = "編集";
  editBtn.setAttribute("aria-label", "編集");
  editBtn.addEventListener("click", () => {
    editingId = task.id;
    render();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "✕";
  deleteBtn.setAttribute("aria-label", "削除");
  deleteBtn.addEventListener("click", () => requestDelete(task.id));

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  li.appendChild(handle);
  li.appendChild(checkbox);
  li.appendChild(body);
  li.appendChild(actions);

  return li;
}

function renderSubtasksPanel(task) {
  const panel = document.createElement("div");
  panel.className = "subtasks-panel";

  const ul = document.createElement("ul");
  ul.className = "subtask-list";
  task.subtasks.forEach((sub) => {
    const li = document.createElement("li");
    li.className = "subtask-item" + (sub.done ? " done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = sub.done;
    cb.addEventListener("change", () => toggleSubtask(task.id, sub.id));

    const title = document.createElement("span");
    title.className = "subtask-title";
    title.textContent = sub.title;

    const del = document.createElement("button");
    del.className = "subtask-delete";
    del.textContent = "✕";
    del.setAttribute("aria-label", "サブタスクを削除");
    del.addEventListener("click", () => deleteSubtask(task.id, sub.id));

    li.appendChild(cb);
    li.appendChild(title);
    li.appendChild(del);
    ul.appendChild(li);
  });
  panel.appendChild(ul);

  const subForm = document.createElement("form");
  subForm.className = "subtask-form";

  const subInput = document.createElement("input");
  subInput.type = "text";
  subInput.placeholder = "サブタスクを追加…";
  subInput.autocomplete = "off";

  const subBtn = document.createElement("button");
  subBtn.type = "submit";
  subBtn.textContent = "追加";

  subForm.appendChild(subInput);
  subForm.appendChild(subBtn);
  subForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = subInput.value.trim();
    if (!title) return;
    addSubtask(task.id, title);
  });

  panel.appendChild(subForm);
  return panel;
}

function renderEditItem(task) {
  const li = document.createElement("li");
  li.className = "task-item";
  li.dataset.id = task.id;

  const form = document.createElement("div");
  form.className = "edit-form";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.value = task.title;

  const row1 = document.createElement("div");
  row1.className = "edit-form-row";

  const prioritySelect = document.createElement("select");
  ["high", "medium", "low"].forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = priorityLabel(p);
    if (p === task.priority) opt.selected = true;
    prioritySelect.appendChild(opt);
  });

  const categoryEdit = document.createElement("input");
  categoryEdit.type = "text";
  categoryEdit.placeholder = "カテゴリ";
  categoryEdit.value = task.category;
  categoryEdit.setAttribute("list", "category-list");

  const createdEdit = document.createElement("input");
  createdEdit.type = "date";
  createdEdit.value = task.createdAt || "";

  row1.appendChild(prioritySelect);
  row1.appendChild(categoryEdit);
  row1.appendChild(createdEdit);

  const row2 = document.createElement("div");
  row2.className = "edit-form-row";

  const dueLabel = document.createElement("label");
  dueLabel.className = "checkbox-label";
  const dueCheck = document.createElement("input");
  dueCheck.type = "checkbox";
  dueCheck.checked = !!task.due;
  dueLabel.appendChild(dueCheck);
  dueLabel.appendChild(document.createTextNode("期限を設定する"));

  const dueEdit = document.createElement("input");
  dueEdit.type = "date";
  dueEdit.value = task.due || "";
  dueEdit.disabled = !task.due;
  dueCheck.addEventListener("change", () => {
    dueEdit.disabled = !dueCheck.checked;
    if (!dueCheck.checked) dueEdit.value = "";
  });

  row2.appendChild(dueLabel);
  row2.appendChild(dueEdit);

  const notesEdit = document.createElement("textarea");
  notesEdit.rows = 2;
  notesEdit.placeholder = "備考(任意)";
  notesEdit.value = task.notes;

  const actions = document.createElement("div");
  actions.className = "edit-form-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary";
  cancelBtn.textContent = "キャンセル";
  cancelBtn.addEventListener("click", () => {
    editingId = null;
    render();
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn-primary";
  saveBtn.textContent = "保存";
  saveBtn.addEventListener("click", () => {
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return;
    }
    task.title = title;
    task.priority = prioritySelect.value;
    task.category = categoryEdit.value.trim();
    task.createdAt = createdEdit.value || todayStr();
    task.due = dueCheck.checked ? dueEdit.value || null : null;
    task.notes = notesEdit.value.trim();
    saveTasks();
    editingId = null;
    render();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  form.appendChild(titleInput);
  form.appendChild(row1);
  form.appendChild(row2);
  form.appendChild(notesEdit);
  form.appendChild(actions);

  li.appendChild(form);
  return li;
}

function reorderTasks(draggedId, targetId) {
  const fromIndex = tasks.findIndex((t) => t.id === draggedId);
  const toIndex = tasks.findIndex((t) => t.id === targetId);
  if (fromIndex === -1 || toIndex === -1) return;
  const [moved] = tasks.splice(fromIndex, 1);
  tasks.splice(toIndex, 0, moved);
  saveTasks();
  render();
}

function addTask(title, priority, category, createdAt, due, notes) {
  tasks.unshift({
    id: crypto.randomUUID(),
    title,
    priority,
    category: category || "",
    createdAt: createdAt || todayStr(),
    due: due || null,
    notes: notes || "",
    done: false,
    subtasks: [],
  });
  saveTasks();
  render();
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (task) task.done = !task.done;
  saveTasks();
  render();
}

function addSubtask(taskId, title) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.subtasks.push({ id: crypto.randomUUID(), title, done: false });
  saveTasks();
  render();
}

function toggleSubtask(taskId, subId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const sub = task.subtasks.find((s) => s.id === subId);
  if (sub) sub.done = !sub.done;
  saveTasks();
  render();
}

function deleteSubtask(taskId, subId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.subtasks = task.subtasks.filter((s) => s.id !== subId);
  saveTasks();
  render();
}

function requestDelete(id) {
  pendingDeleteId = id;
  confirmModal.hidden = false;
}

function closeConfirm() {
  pendingDeleteId = null;
  confirmModal.hidden = true;
}

function deleteTask(id) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [removed] = tasks.splice(index, 1);
  saveTasks();
  render();
  showUndoToast(removed, index);
}

function showUndoToast(task, index) {
  if (undoState) clearTimeout(undoState.timer);
  const timer = setTimeout(() => {
    undoState = null;
    undoToast.hidden = true;
  }, UNDO_TIMEOUT_MS);
  undoState = { task, index, timer };
  undoMessage.textContent = `「${task.title}」を削除しました`;
  undoToast.hidden = false;
}

function undoDelete() {
  if (!undoState) return;
  clearTimeout(undoState.timer);
  const { task, index } = undoState;
  tasks.splice(Math.min(index, tasks.length), 0, task);
  undoState = null;
  undoToast.hidden = true;
  saveTasks();
  render();
}

function clearDone() {
  tasks = tasks.filter((t) => !t.done);
  saveTasks();
  render();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  const due = dueToggle.checked ? dueInput.value : "";
  addTask(title, priorityInput.value, categoryInput.value.trim(), createdInput.value, due, notesInput.value.trim());
  input.value = "";
  notesInput.value = "";
  categoryInput.value = "";
  dueToggle.checked = false;
  dueInput.value = "";
  dueInput.disabled = true;
  createdInput.value = todayStr();
  priorityInput.value = "medium";
  input.focus();
});

dueToggle.addEventListener("change", () => {
  dueInput.disabled = !dueToggle.checked;
  if (!dueToggle.checked) {
    dueInput.value = "";
  } else {
    dueInput.focus();
  }
});

clearDoneBtn.addEventListener("click", clearDone);

confirmCancelBtn.addEventListener("click", closeConfirm);
confirmDeleteBtn.addEventListener("click", () => {
  if (pendingDeleteId) deleteTask(pendingDeleteId);
  closeConfirm();
});
confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) closeConfirm();
});

undoBtn.addEventListener("click", undoDelete);

filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    statusFilter = btn.dataset.filter;
    render();
  });
});

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  render();
});

sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value;
  render();
});

categoryFilterSelect.addEventListener("change", () => {
  categoryFilter = categoryFilterSelect.value;
  render();
});

render();
