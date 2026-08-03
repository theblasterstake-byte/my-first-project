const STORAGE_KEY = "tasks";

const form = document.getElementById("task-form");
const input = document.getElementById("task-input");
const priorityInput = document.getElementById("priority-input");
const createdInput = document.getElementById("created-input");
const dueToggle = document.getElementById("due-toggle");
const dueInput = document.getElementById("due-input");
const notesInput = document.getElementById("notes-input");
const list = document.getElementById("task-list");
const summary = document.getElementById("summary");
const emptyState = document.getElementById("empty-state");
const clearDoneBtn = document.getElementById("clear-done");
const filterBtns = document.querySelectorAll(".filter-btn");
const confirmModal = document.getElementById("confirm-modal");
const confirmCancelBtn = document.getElementById("confirm-cancel");
const confirmDeleteBtn = document.getElementById("confirm-delete");

let tasks = loadTasks();
let currentFilter = "all";
let pendingDeleteId = null;

function todayStr() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

createdInput.value = todayStr();

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function priorityLabel(priority) {
  return { high: "高", medium: "中", low: "低" }[priority] || "中";
}

function isOverdue(task) {
  if (!task.due || task.done) return false;
  return task.due < todayStr();
}

function render() {
  const filtered = tasks.filter((t) => {
    if (currentFilter === "active") return !t.done;
    if (currentFilter === "done") return t.done;
    return true;
  });

  list.innerHTML = "";
  filtered.forEach((task) => {
    const li = document.createElement("li");
    li.className = "task-item" + (task.done ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.checked = task.done;
    checkbox.addEventListener("change", () => toggleTask(task.id));

    const body = document.createElement("div");
    body.className = "task-body";

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "task-meta";

    const badge = document.createElement("span");
    badge.className = `priority-badge priority-${task.priority}`;
    badge.textContent = priorityLabel(task.priority);
    meta.appendChild(badge);

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

    body.appendChild(title);
    body.appendChild(meta);

    if (task.notes) {
      const notes = document.createElement("span");
      notes.className = "task-notes";
      notes.textContent = task.notes;
      body.appendChild(notes);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", "削除");
    deleteBtn.addEventListener("click", () => requestDelete(task.id));

    li.appendChild(checkbox);
    li.appendChild(body);
    li.appendChild(deleteBtn);
    list.appendChild(li);
  });

  emptyState.hidden = filtered.length > 0;

  const doneCount = tasks.filter((t) => t.done).length;
  summary.textContent = `全 ${tasks.length} 件中 ${doneCount} 件完了`;
}

function addTask(title, priority, createdAt, due, notes) {
  tasks.unshift({
    id: crypto.randomUUID(),
    title,
    priority,
    createdAt: createdAt || todayStr(),
    due: due || null,
    notes: notes || "",
    done: false,
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

function requestDelete(id) {
  pendingDeleteId = id;
  confirmModal.hidden = false;
}

function closeConfirm() {
  pendingDeleteId = null;
  confirmModal.hidden = true;
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
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
  addTask(title, priorityInput.value, createdInput.value, due, notesInput.value.trim());
  input.value = "";
  notesInput.value = "";
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

filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    render();
  });
});

render();
