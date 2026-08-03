/**
 * 議事録メーカーの画面制御。
 * 解析ロジックは minutes-parser.js (window.MinutesParser) にある。
 */
(function () {
  "use strict";

  const { parseTranscript, toMarkdown } = window.MinutesParser;

  const tabBtns = document.querySelectorAll(".tab-btn");
  const views = {
    tasks: document.getElementById("view-tasks"),
    minutes: document.getElementById("view-minutes"),
  };

  const transcriptInput = document.getElementById("transcript-input");
  const includeLogInput = document.getElementById("include-log");
  const generateBtn = document.getElementById("generate-btn");
  const sampleBtn = document.getElementById("sample-btn");
  const clearBtn = document.getElementById("clear-transcript");
  const errorEl = document.getElementById("minutes-error");
  const resultEl = document.getElementById("minutes-result");
  const previewEl = document.getElementById("minutes-preview");
  const markdownEl = document.getElementById("minutes-markdown");
  const modeBtns = document.querySelectorAll(".mode-btn");
  const copyBtn = document.getElementById("copy-btn");
  const downloadBtn = document.getElementById("download-btn");
  const toTasksBtn = document.getElementById("to-tasks-btn");

  const DRAFT_KEY = "minutes-draft";

  const SAMPLE = `会議名: 8月リリース定例
日時: 2026年8月3日
場所: オンライン (Zoom)
参加者: 田中、佐藤、山田

■ リリース日程
[00:01:12] 田中: 今日はリリース日程について確認したいです。
佐藤: QAの期間を考えると、現状だと8/20が現実的だと思います。
田中: では、リリース日は8/20で決定ということで進めましょう。
山田: 了解です。告知文は私が作成します。8/15までに用意します。

■ 課題の共有
佐藤: 一点懸念があって、外部APIのレート制限がまだ未定です。
田中: それは持ち帰りで、佐藤さんに来週までに確認をお願いします。
山田: あと、ドキュメントの更新が宿題として残っています。次回までにまとめます。
田中: 予算については追加費用なしということで合意しました。`;

  let currentMinutes = null;
  let currentMarkdown = "";

  /* ---------------- タブ切り替え ---------------- */

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("active", active);
        b.setAttribute("aria-selected", String(active));
      });
      Object.entries(views).forEach(([name, view]) => {
        view.hidden = name !== btn.dataset.view;
      });
    });
  });

  /* ---------------- 表示ヘルパー ---------------- */

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function flash(button, message) {
    const original = button.textContent;
    button.textContent = message;
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1500);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function section(title, count) {
    const wrapper = el("section", "minutes-section");
    const heading = el("h3", null, title);
    if (typeof count === "number") heading.appendChild(el("span", "count-badge", String(count)));
    wrapper.appendChild(heading);
    return wrapper;
  }

  function emptyNote(message) {
    return el("p", "minutes-empty", message);
  }

  /* ---------------- プレビュー描画 ---------------- */

  function renderPreview(minutes) {
    previewEl.innerHTML = "";

    previewEl.appendChild(el("h2", "minutes-title", `議事録: ${minutes.title}`));

    const metaList = el("dl", "minutes-meta");
    const metaRows = [
      ["日時", minutes.date],
      ["場所", minutes.place],
      ["目的", minutes.purpose],
      ["参加者", minutes.attendees.length ? minutes.attendees.join("、") : "（記載なし）"],
      ["欠席者", minutes.absentees.length ? minutes.absentees.join("、") : ""],
    ];
    metaRows.forEach(([key, value]) => {
      if (!value) return;
      metaList.appendChild(el("dt", null, key));
      metaList.appendChild(el("dd", null, value));
    });
    previewEl.appendChild(metaList);

    // 議題
    const topics = section("議題", minutes.topics.length);
    if (minutes.topics.length) {
      const ol = el("ol", "minutes-list");
      minutes.topics.forEach((t) => ol.appendChild(el("li", null, t)));
      topics.appendChild(ol);
    } else {
      topics.appendChild(emptyNote("議題は検出されませんでした。"));
    }
    previewEl.appendChild(topics);

    // 決定事項
    const decisions = section("決定事項", minutes.decisions.length);
    if (minutes.decisions.length) {
      const ul = el("ul", "minutes-list");
      minutes.decisions.forEach((d) => {
        const li = el("li", null, d.text);
        if (d.speaker) li.appendChild(el("span", "who", d.speaker));
        ul.appendChild(li);
      });
      decisions.appendChild(ul);
    } else {
      decisions.appendChild(emptyNote("決定事項は検出されませんでした。"));
    }
    previewEl.appendChild(decisions);

    // ネクストアクション
    const actions = section("ネクストアクション", minutes.actions.length);
    if (minutes.actions.length) {
      const table = el("table", "minutes-table");
      const thead = el("thead");
      const headRow = el("tr");
      ["担当", "内容", "期限"].forEach((h) => headRow.appendChild(el("th", null, h)));
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = el("tbody");
      minutes.actions.forEach((a) => {
        const row = el("tr");
        row.appendChild(el("td", "cell-assignee", a.assignee || "未定"));
        row.appendChild(el("td", null, a.text));
        row.appendChild(el("td", "cell-due", a.due || "未定"));
        tbody.appendChild(row);
      });
      table.appendChild(tbody);

      const scroller = el("div", "table-scroll");
      scroller.appendChild(table);
      actions.appendChild(scroller);
    } else {
      actions.appendChild(emptyNote("ネクストアクションは検出されませんでした。"));
    }
    previewEl.appendChild(actions);

    // 課題・懸念
    const issues = section("課題・懸念", minutes.issues.length);
    if (minutes.issues.length) {
      const ul = el("ul", "minutes-list");
      minutes.issues.forEach((i) => {
        const li = el("li", null, i.text);
        if (i.speaker) li.appendChild(el("span", "who", i.speaker));
        ul.appendChild(li);
      });
      issues.appendChild(ul);
    } else {
      issues.appendChild(emptyNote("課題・懸念は検出されませんでした。"));
    }
    previewEl.appendChild(issues);

    // 議事詳細
    if (includeLogInput.checked && minutes.log.length) {
      const detail = section("議事詳細", minutes.log.length);
      const wrapper = el("div", "log");
      minutes.log.forEach((entry) => {
        const row = el("div", "log-entry");
        const head = el("div", "log-head");
        head.appendChild(el("span", "log-speaker", entry.speaker || "（発言者不明）"));
        if (entry.time) head.appendChild(el("span", "log-time", entry.time));
        row.appendChild(head);
        row.appendChild(el("p", "log-text", entry.text));
        wrapper.appendChild(row);
      });
      detail.appendChild(wrapper);
      previewEl.appendChild(detail);
    }
  }

  /* ---------------- 生成 ---------------- */

  function generate() {
    const raw = transcriptInput.value.trim();
    if (!raw) {
      showError("文字起こしテキストを入力してください。");
      resultEl.hidden = true;
      return;
    }

    clearError();
    currentMinutes = parseTranscript(raw);
    currentMarkdown = toMarkdown(currentMinutes, { includeLog: includeLogInput.checked });

    renderPreview(currentMinutes);
    markdownEl.textContent = currentMarkdown;
    resultEl.hidden = false;

    if (!currentMinutes.speakers.length) {
      showError("発言者を検出できませんでした。「田中: 発言内容」の形式だとより正確に整形できます。");
    }

    try {
      localStorage.setItem(DRAFT_KEY, transcriptInput.value);
    } catch {
      /* 保存できなくても生成自体は継続する */
    }

    resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------------- 出力操作 ---------------- */

  async function copyMarkdown() {
    if (!currentMarkdown) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentMarkdown);
      } else {
        // file:// などクリップボード API が使えない環境向けのフォールバック
        const helper = document.createElement("textarea");
        helper.value = currentMarkdown;
        helper.setAttribute("readonly", "");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        document.body.removeChild(helper);
      }
      flash(copyBtn, "コピーしました");
    } catch {
      showError("コピーに失敗しました。Markdown タブから手動でコピーしてください。");
    }
  }

  function downloadMarkdown() {
    if (!currentMarkdown) return;
    const safeTitle = (currentMinutes.title || "議事録").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    const blob = new Blob([currentMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${currentMinutes.date}_${safeTitle}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function addActionsToTasks() {
    if (!currentMinutes || typeof window.addTask !== "function") return;
    const actions = currentMinutes.actions;
    if (!actions.length) {
      showError("タスクに追加できるネクストアクションがありません。");
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const soon = new Date(today.getTime());
    soon.setDate(soon.getDate() + 3);

    actions.forEach((action) => {
      const title = `${action.assignee || "未定"}: ${action.text}`;
      const urgent = action.dueDate && new Date(action.dueDate) <= soon;
      window.addTask(title, urgent ? "high" : "medium", action.dueDate || "");
    });

    clearError();
    flash(toTasksBtn, `${actions.length} 件を追加しました`);
  }

  /* ---------------- イベント登録 ---------------- */

  generateBtn.addEventListener("click", generate);

  transcriptInput.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  });

  includeLogInput.addEventListener("change", () => {
    if (currentMinutes) generate();
  });

  sampleBtn.addEventListener("click", () => {
    transcriptInput.value = SAMPLE;
    generate();
  });

  clearBtn.addEventListener("click", () => {
    transcriptInput.value = "";
    currentMinutes = null;
    currentMarkdown = "";
    resultEl.hidden = true;
    clearError();
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* 何もしない */
    }
    transcriptInput.focus();
  });

  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeBtns.forEach((b) => b.classList.toggle("active", b === btn));
      const showMarkdown = btn.dataset.mode === "markdown";
      previewEl.hidden = showMarkdown;
      markdownEl.hidden = !showMarkdown;
    });
  });

  copyBtn.addEventListener("click", copyMarkdown);
  downloadBtn.addEventListener("click", downloadMarkdown);
  toTasksBtn.addEventListener("click", addActionsToTasks);

  // 入力途中の文字起こしを復元する
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) transcriptInput.value = draft;
  } catch {
    /* 何もしない */
  }
})();
