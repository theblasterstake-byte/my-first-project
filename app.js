const STORAGE_KEY = "tasks";

const form = document.getElementById("task-form");
const input = document.getElementById("task-input");
const priorityInput = document.getElementById("priority-input");
const dueInput = document.getElementById("due-input");
const list = document.getElementById("task-list");
const summary = document.getElementById("summary");
const emptyState = document.getElementById("empty-state");
const clearDoneBtn = document.getElementById("clear-done");
const filterBtns = document.querySelectorAll(".filter-btn");

let tasks = loadTasks();
let currentFilter = "all";

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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(task.due) < today;
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

    if (task.due) {
      const due = document.createElement("span");
      due.textContent = `期限: ${task.due}`;
      if (isOverdue(task)) due.classList.add("due-overdue");
      meta.appendChild(due);
    }

    body.appendChild(title);
    body.appendChild(meta);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", "削除");
    deleteBtn.addEventListener("click", () => deleteTask(task.id));

    li.appendChild(checkbox);
    li.appendChild(body);
    li.appendChild(deleteBtn);
    list.appendChild(li);
  });

  emptyState.hidden = filtered.length > 0;

  const doneCount = tasks.filter((t) => t.done).length;
  summary.textContent = `全 ${tasks.length} 件中 ${doneCount} 件完了`;
}

function addTask(title, priority, due) {
  tasks.unshift({
    id: crypto.randomUUID(),
    title,
    priority,
    due: due || null,
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
  addTask(title, priorityInput.value, dueInput.value);
  input.value = "";
  dueInput.value = "";
  priorityInput.value = "medium";
  input.focus();
});

clearDoneBtn.addEventListener("click", clearDone);

filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    render();
  });
});

render();
