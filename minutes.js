const { parseTranscript, buildMarkdown } = window.MinutesParser;

const TASKS_STORAGE_KEY = "tasks";
const DRAFT_STORAGE_KEY = "minutes-draft";

const transcriptEl = document.getElementById("transcript");
const generateBtn = document.getElementById("generate-btn");
const sampleBtn = document.getElementById("sample-btn");
const clearBtn = document.getElementById("clear-btn");
const inputStats = document.getElementById("input-stats");

const previewEl = document.getElementById("preview");
const markdownEl = document.getElementById("markdown");
const outputEmpty = document.getElementById("output-empty");
const outputActions = document.getElementById("output-actions");
const outputStats = document.getElementById("output-stats");
const tabBtns = document.querySelectorAll(".tab-btn");

const copyBtn = document.getElementById("copy-btn");
const downloadBtn = document.getElementById("download-btn");
const tasksBtn = document.getElementById("tasks-btn");
const toast = document.getElementById("toast");

const SAMPLE = `2026-08-05 プロダクト週次定例
参加者: 田中、佐藤さん、山田
場所: 会議室A

[00:00:12] 田中: それでは定例を始めます。まず先週の進捗から共有をお願いします。
[00:01:05] 佐藤: ログイン画面のリニューアルですが、デザインのレビューが完了して実装に入っています。想定より少し時間がかかっていて、今週いっぱいはかかりそうです。
佐藤: 一点課題があって、SSO まわりの仕様が固まっていないのが懸念です。
山田: SSO については情報システム部と調整が必要ですね。私が来週水曜までに確認して共有します。

■ リリース計画
田中: リリース日ですが、8/28 で確定ということで決定しました。
佐藤: 了解です。それに合わせてQA期間を2週間確保します。
山田: テスト環境の準備は佐藤さんお願いできますか。
佐藤: はい、明日までに用意します。
田中: 決定: 障害対応の当番制は来月から導入する。

## その他
山田: 採用面談の件ですが、来週から本格的に始まります。
田中: 次回は8/12の同じ時間で。以上です、お疲れ様でした。`;

let currentMinutes = null;
let currentMarkdown = "";
let toastTimer = null;

// ------------------------------------------------------------------ 表示補助

function showToast(message, isError) {
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.toggle("error", Boolean(isError));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function updateInputStats() {
  const text = transcriptEl.value;
  const lines = text.split("\n").filter((l) => l.trim()).length;
  inputStats.textContent = text.trim() ? `${lines} 行 / ${text.length} 文字` : "";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title) {
  const wrap = el("section", "minutes-section");
  wrap.appendChild(el("h3", null, title));
  return wrap;
}

// ------------------------------------------------------------------ プレビュー描画

function renderPreview(minutes) {
  previewEl.innerHTML = "";

  previewEl.appendChild(el("h2", "minutes-title", `${minutes.title} 議事録`));

  const metaRows = [
    ["日時", minutes.date],
    ["場所", minutes.location],
    ["参加者", minutes.attendees.join("、")],
    ["欠席者", minutes.absentees.join("、")],
    ["記録者", minutes.recorder],
  ].filter(([, value]) => value);

  if (metaRows.length) {
    const dl = el("dl", "minutes-meta");
    metaRows.forEach(([label, value]) => {
      dl.appendChild(el("dt", null, label));
      dl.appendChild(el("dd", null, value));
    });
    previewEl.appendChild(dl);
  }

  if (minutes.decisions.length) {
    const sec = section("決定事項");
    const ol = el("ol", "minutes-list");
    minutes.decisions.forEach((d) => {
      const li = el("li", null, d.text);
      if (d.speaker) li.appendChild(el("span", "by", `（${d.speaker}）`));
      ol.appendChild(li);
    });
    sec.appendChild(ol);
    previewEl.appendChild(sec);
  }

  if (minutes.actions.length) {
    const sec = section("アクションアイテム");
    const table = el("table", "minutes-table");
    const thead = el("thead");
    const headRow = el("tr");
    ["内容", "担当", "期限"].forEach((h) => headRow.appendChild(el("th", null, h)));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    minutes.actions.forEach((a) => {
      const tr = el("tr");
      tr.appendChild(el("td", null, a.text));
      tr.appendChild(el("td", null, a.owner || "未定"));
      tr.appendChild(el("td", a.due ? "due" : null, a.due || "未定"));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sec.appendChild(table);
    previewEl.appendChild(sec);
  }

  if (minutes.topics.length) {
    const sec = section("議題ごとの要点");
    minutes.topics.forEach((t, i) => {
      sec.appendChild(el("h4", null, `${i + 1}. ${t.title}`));
      const ul = el("ul", "minutes-list");
      t.points.forEach((p) => {
        const li = el("li");
        if (p.speaker) li.appendChild(el("strong", null, `${p.speaker}: `));
        li.appendChild(document.createTextNode(p.text));
        ul.appendChild(li);
      });
      sec.appendChild(ul);
    });
    previewEl.appendChild(sec);
  }

  if (minutes.issues.length) {
    const sec = section("課題・懸念事項");
    const ul = el("ul", "minutes-list");
    minutes.issues.forEach((s) => {
      const li = el("li", null, s.text);
      if (s.speaker) li.appendChild(el("span", "by", `（${s.speaker}）`));
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    previewEl.appendChild(sec);
  }

  if (minutes.nextItems.length) {
    const sec = section("次回について");
    const ul = el("ul", "minutes-list");
    minutes.nextItems.forEach((n) => ul.appendChild(el("li", null, n.text)));
    sec.appendChild(ul);
    previewEl.appendChild(sec);
  }
}

function activeTab() {
  const active = document.querySelector(".tab-btn.active");
  return active ? active.dataset.tab : "preview";
}

function syncTabs() {
  if (!currentMinutes) return;
  const tab = activeTab();
  previewEl.hidden = tab !== "preview";
  markdownEl.hidden = tab !== "markdown";
}

// ------------------------------------------------------------------ 生成

function generate() {
  const text = transcriptEl.value;
  if (!text.trim()) {
    showToast("文字起こしを貼り付けてください。", true);
    transcriptEl.focus();
    return;
  }

  currentMinutes = parseTranscript(text);
  currentMarkdown = buildMarkdown(currentMinutes);

  renderPreview(currentMinutes);
  markdownEl.textContent = currentMarkdown;

  outputEmpty.hidden = true;
  outputActions.hidden = false;
  syncTabs();

  const s = currentMinutes;
  outputStats.textContent =
    `決定 ${s.decisions.length} 件 / アクション ${s.actions.length} 件 / 課題 ${s.issues.length} 件`;

  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, text);
  } catch {
    /* 保存できなくても生成自体は続行する */
  }
}

// ------------------------------------------------------------------ 出力操作

async function copyMarkdown() {
  if (!currentMarkdown) return;
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    showToast("Markdown をコピーしました。");
  } catch {
    // クリップボード API が使えない環境向けのフォールバック
    const ta = document.createElement("textarea");
    ta.value = currentMarkdown;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    showToast(ok ? "Markdown をコピーしました。" : "コピーできませんでした。", !ok);
  }
}

function downloadMarkdown() {
  if (!currentMarkdown) return;
  const safeTitle = (currentMinutes.title || "議事録").replace(/[\\/:*?"<>|]/g, "_");
  const stamp = currentMinutes.date ? currentMinutes.date.replace(/[\/年月]/g, "-").replace(/日/g, "") : "";
  const name = `${stamp ? stamp + "_" : ""}${safeTitle}.md`;

  const blob = new Blob([currentMarkdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`${name} を保存しました。`);
}

/** アクションアイテムをタスク管理側の localStorage に追記する。 */
function addActionsToTasks() {
  if (!currentMinutes || !currentMinutes.actions.length) {
    showToast("追加できるアクションアイテムがありません。", true);
    return;
  }

  let tasks = [];
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    tasks = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(tasks)) tasks = [];
  } catch {
    tasks = [];
  }

  const existing = new Set(tasks.map((t) => t && t.title));
  let added = 0;

  currentMinutes.actions.forEach((a) => {
    const title = a.owner ? `【${a.owner}】${a.text}` : a.text;
    if (existing.has(title)) return;
    existing.add(title);
    tasks.unshift({
      id: crypto.randomUUID(),
      title,
      priority: "medium",
      due: a.dueDate || null,
      done: false,
    });
    added += 1;
  });

  if (!added) {
    showToast("すべて追加済みです。");
    return;
  }

  try {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    showToast(`${added} 件のタスクを追加しました。`);
  } catch {
    showToast("タスクの保存に失敗しました。", true);
  }
}

// ------------------------------------------------------------------ イベント

generateBtn.addEventListener("click", generate);
copyBtn.addEventListener("click", copyMarkdown);
downloadBtn.addEventListener("click", downloadMarkdown);
tasksBtn.addEventListener("click", addActionsToTasks);

sampleBtn.addEventListener("click", () => {
  transcriptEl.value = SAMPLE;
  updateInputStats();
  generate();
});

clearBtn.addEventListener("click", () => {
  transcriptEl.value = "";
  currentMinutes = null;
  currentMarkdown = "";
  previewEl.hidden = true;
  markdownEl.hidden = true;
  outputActions.hidden = true;
  outputEmpty.hidden = false;
  updateInputStats();
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* 失敗しても画面はクリア済み */
  }
  transcriptEl.focus();
});

transcriptEl.addEventListener("input", updateInputStats);

// Ctrl / Cmd + Enter で生成
transcriptEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    generate();
  }
});

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    syncTabs();
  });
});

// 前回の入力を復元する
try {
  const draft = localStorage.getItem(DRAFT_STORAGE_KEY);
  if (draft) transcriptEl.value = draft;
} catch {
  /* 復元できなければ空のまま開始 */
}
updateInputStats();
