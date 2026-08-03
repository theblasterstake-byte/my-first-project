/**
 * 会議の文字起こしテキストを解析して、議事録の構造データに変換するモジュール。
 * ブラウザでは window.MinutesParser、Node では module.exports から利用できる。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MinutesParser = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const TIME = "\\d{1,2}:\\d{2}(?::\\d{2})?";

  // 行頭のタイムスタンプ  例) [00:03:12] / (0:03) / 00:03 -
  const LEADING_TIME_RE = new RegExp(`^[\\[（(【]?\\s*(${TIME})\\s*[\\]）)】]?\\s*[-–—]?\\s*`);

  // 発言行  例) 田中: / 田中（00:03）: / Tanaka [00:03]：
  const SPEAKER_RE = new RegExp(
    `^([^\\s:：。、！？!?\\[\\]（）()【】]{1,20})\\s*(?:[\\[（(]\\s*(${TIME})\\s*[\\]）)])?\\s*[:：]\\s*(.*)$`
  );

  // 「日時: …」のようなヘッダー行
  const META_RE =
    /^\s*[■●◆◎□▼▶☆★\-*・[【]?\s*(会議名|議題名|タイトル|件名|日時|日付|開催日|場所|会場|参加者|出席者|メンバー|欠席者|目的)\s*[】\]]?\s*[:：]\s*(.+)$/;

  // 見出し行  例) ■ リリース日程 / ## 議題2 / 【共有事項】 / 1. 予算について
  const MARKER_HEADING_RE = /^\s*(?:[#＃]{1,4}|[■●◆◎□▼▶☆★])\s*(.+?)\s*$/;
  const BRACKET_HEADING_RE = /^\s*【\s*(.+?)\s*】\s*$/;
  const AGENDA_HEADING_RE = /^\s*(?:議題|アジェンダ|トピック|テーマ)\s*\d*\s*[.．)：:、]?\s*(.+?)\s*$/;
  const NUMBERED_HEADING_RE = /^\s*\d{1,2}\s*[.．)、]\s*(.+?)\s*$/;

  const BULLET_RE = /^\s*[-*・>＞]\s+/;
  const URL_RE = /^(?:https?:)?\/\//i;

  // 発言者名として扱わない語（見出しやメモの取りこぼし対策）
  const NON_SPEAKER = new Set([
    "日時", "日付", "開催日", "場所", "会場", "参加者", "出席者", "欠席者", "メンバー",
    "議題", "アジェンダ", "トピック", "テーマ", "会議名", "件名", "タイトル", "目的",
    "備考", "メモ", "次回", "決定", "決定事項", "課題", "宿題", "資料", "補足", "結論",
    "todo", "to-do", "url", "http", "https", "note", "memo", "agenda", "action",
    "参考", "リンク", "参照", "出典",
  ]);

  const DECISION_PATTERNS = [
    /決定/, /決まり/, /決まっ/, /確定/, /合意/, /承認/, /可決/, /採用/, /方針とし/,
    /で行き(?:ま|た)/, /でいき(?:ま|た)/, /で進め(?:る|ます|よう)/, /ということで/,
    /に決め/, /結論/, /とします/, /とする/,
  ];

  const ACTION_PATTERNS = [
    /todo/i, /to-?do/i, /アクション(?:アイテム)?/, /宿題/, /タスク/, /担当/,
    /までに/, /まで対応/, /次回まで/, /やります/, /やっておき/, /対応します/, /対応して/,
    /進めます/, /確認します/, /確認して/, /共有します/, /共有して/, /作成します/, /作って/,
    /用意します/, /準備します/, /送ります/, /送って/, /連絡します/, /調整します/, /調整して/,
    /まとめます/, /まとめて/, /レビューします/, /お願いします/, /お願いし/,
  ];

  const ISSUE_PATTERNS = [
    /課題/, /懸念/, /リスク/, /問題/, /心配/, /未定/, /保留/, /検討中/, /要検討/,
    /持ち帰/, /ペンディング/, /不明/, /わからない/, /分からない/, /難しそう/, /ブロッカー/,
  ];

  const TOPIC_PATTERNS = [
    /について(?:話|議論|相談|確認)/, /の件(?:です|について|ですが)/, /議題は/, /テーマは/,
    /次(?:の|は)(?:議題|トピック|テーマ)/,
  ];

  const FIRST_PERSON_PATTERNS = [
    /(?:私|僕|自分|こちら|うち)(?:が|で|の方で)/, /やります/, /やっておき/, /対応します/,
    /確認します/, /共有します/, /作成します/, /用意します/, /準備します/, /送ります/,
    /連絡します/, /調整します/, /まとめます/, /進めます/, /レビューします/,
  ];

  const RELATIVE_DUE = [
    { re: /本日中|今日中|本日まで|今日まで/, label: "本日中", offset: 0 },
    { re: /明日まで|明日中|明日/, label: "明日", offset: 1 },
    { re: /明後日/, label: "明後日", offset: 2 },
    { re: /今週(?:中|いっぱい|末)/, label: "今週中", offset: "endOfWeek" },
    { re: /来週(?:中|末|まで)?/, label: "来週", offset: 7 },
    { re: /再来週/, label: "再来週", offset: 14 },
    { re: /月末(?:まで)?/, label: "月末", offset: "endOfMonth" },
    { re: /次回(?:の)?(?:MTG|mtg|ミーティング|会議|定例)?まで/, label: "次回まで", offset: null },
  ];

  function splitSentences(text) {
    return String(text)
      .split(/(?<=[。．！？!?])\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function matchesAny(text, patterns) {
    return patterns.some((re) => re.test(text));
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toISO(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function addDays(base, days) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  /**
   * 「8/20」「来週」などの期限表現から、可能なら YYYY-MM-DD を返す。
   * 解決できない場合は null。
   */
  function resolveDueDate(label, baseDate) {
    if (!label) return null;
    const base = baseDate ? new Date(baseDate) : new Date();
    base.setHours(0, 0, 0, 0);

    const absolute = label.match(/^(?:(\d{4})[-/年])?(\d{1,2})[-/月](\d{1,2})日?$/);
    if (absolute) {
      const year = absolute[1] ? Number(absolute[1]) : base.getFullYear();
      const month = Number(absolute[2]);
      const day = Number(absolute[3]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      let d = new Date(year, month - 1, day);
      // 年の指定がなく過去日になる場合は翌年とみなす
      if (!absolute[1] && d < base) d = new Date(year + 1, month - 1, day);
      return toISO(d);
    }

    const relative = RELATIVE_DUE.find((r) => r.label === label);
    if (!relative || relative.offset === null) return null;
    if (relative.offset === "endOfWeek") {
      const toFriday = (5 - base.getDay() + 7) % 7;
      return toISO(addDays(base, toFriday));
    }
    if (relative.offset === "endOfMonth") {
      return toISO(new Date(base.getFullYear(), base.getMonth() + 1, 0));
    }
    return toISO(addDays(base, relative.offset));
  }

  function extractDue(text) {
    const absolute = text.match(/(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?/);
    if (absolute) return `${Number(absolute[1])}/${Number(absolute[2])}`;
    const dayOnly = text.match(/(\d{1,2})\s*日まで/);
    if (dayOnly) return `${Number(dayOnly[1])}日`;
    const relative = RELATIVE_DUE.find((r) => r.re.test(text));
    return relative ? relative.label : null;
  }

  function normalizeDueForResolve(due) {
    if (!due) return null;
    const slash = due.match(/^(\d{1,2})\/(\d{1,2})$/);
    return slash ? `${slash[1]}/${slash[2]}` : due;
  }

  function extractAssignee(text, speaker, knownSpeakers) {
    const requested = text.match(/([^\s、。「」]{1,12}?)(?:さん|くん|ちゃん|氏|部長|課長|さま|様)\s*(?:に|の方で|が)?\s*(?:[^\s。]{0,10})?(?:お願い|やって|対応|確認|共有|作成|用意|準備|送っ|連絡|調整|まとめ)/);
    if (requested) return requested[1];

    const explicit = text.match(/担当\s*(?:は|が|:|：)\s*([^\s、。]{1,12})/);
    if (explicit) return explicit[1].replace(/(?:さん|くん|氏|様)$/, "");

    const mentioned = knownSpeakers.find((name) => name !== speaker && text.includes(name));
    if (mentioned && /(?:お願い|依頼)/.test(text)) return mentioned;

    if (speaker && matchesAny(text, FIRST_PERSON_PATTERNS)) return speaker;
    return speaker || "未定";
  }

  function splitList(value) {
    return String(value)
      .split(/[、,，/／・\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function pushUnique(list, item, keyFn) {
    const key = keyFn ? keyFn(item) : item;
    if (list.some((existing) => (keyFn ? keyFn(existing) : existing) === key)) return;
    list.push(item);
  }

  function detectHeading(line) {
    const bracket = line.match(BRACKET_HEADING_RE);
    if (bracket) return bracket[1];

    const marker = line.match(MARKER_HEADING_RE);
    if (marker) {
      // 「■ 田中: …」のような発言行は見出しにしない
      const rest = marker[1];
      return SPEAKER_RE.test(rest) ? null : rest;
    }

    const agenda = line.match(AGENDA_HEADING_RE);
    if (agenda && agenda[1].length <= 60) return agenda[1];

    const numbered = line.match(NUMBERED_HEADING_RE);
    if (numbered && numbered[1].length <= 60 && !/[。．]/.test(numbered[1])) return numbered[1];

    return null;
  }

  function detectDate(text) {
    const iso = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
    const jp = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (jp) return `${jp[1]}-${pad2(jp[2])}-${pad2(jp[3])}`;
    return null;
  }

  /**
   * 文字起こしテキストを議事録データに変換する。
   * @param {string} raw
   * @param {{today?: Date|string}} [options]
   */
  function parseTranscript(raw, options) {
    const opts = options || {};
    const baseDate = opts.today ? new Date(opts.today) : new Date();
    baseDate.setHours(0, 0, 0, 0);

    const lines = String(raw || "").replace(/\r\n?/g, "\n").split("\n");

    const meta = { title: "", date: "", place: "", purpose: "" };
    const attendees = [];
    const absentees = [];
    const speakers = [];
    const topics = [];
    const log = [];

    let lineCount = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      lineCount++;

      const metaMatch = line.match(META_RE);
      if (metaMatch) {
        const key = metaMatch[1];
        const value = metaMatch[2].trim();
        if (["会議名", "議題名", "タイトル", "件名"].includes(key)) meta.title = meta.title || value;
        else if (["日時", "日付", "開催日"].includes(key)) meta.date = meta.date || detectDate(value) || value;
        else if (["場所", "会場"].includes(key)) meta.place = meta.place || value;
        else if (key === "目的") meta.purpose = meta.purpose || value;
        else if (key === "欠席者") splitList(value).forEach((n) => pushUnique(absentees, n));
        else splitList(value).forEach((n) => pushUnique(attendees, n));
        continue;
      }

      const heading = detectHeading(line);
      if (heading) {
        pushUnique(topics, heading);
        continue;
      }

      const isBullet = BULLET_RE.test(line);
      const body = isBullet ? line.replace(BULLET_RE, "") : line;

      let rest = body;
      let time = "";
      const timeMatch = rest.match(LEADING_TIME_RE);
      if (timeMatch) {
        time = timeMatch[1];
        rest = rest.slice(timeMatch[0].length);
      }

      const speakerMatch = URL_RE.test(rest) ? null : rest.match(SPEAKER_RE);
      if (
        speakerMatch &&
        !NON_SPEAKER.has(speakerMatch[1].toLowerCase()) &&
        speakerMatch[3].trim() &&
        !URL_RE.test(speakerMatch[3].trim())
      ) {
        const name = speakerMatch[1].replace(/(?:さん|くん|氏|様)$/, "") || speakerMatch[1];
        pushUnique(speakers, name);
        log.push({ speaker: name, time: time || speakerMatch[2] || "", text: speakerMatch[3].trim() });
        continue;
      }

      // 発言者のない行は、直前の発言の続きとして扱う（箇条書きは独立した行のまま）
      const previous = log[log.length - 1];
      if (previous && !isBullet && !time) {
        previous.text += rest.trim();
        continue;
      }
      log.push({ speaker: "", time, text: rest.trim() });
    }

    const decisions = [];
    const actions = [];
    const issues = [];

    for (const entry of log) {
      const sentences = splitSentences(entry.text);
      const actionSentences = [];

      for (const sentence of sentences) {
        if (matchesAny(sentence, DECISION_PATTERNS)) {
          pushUnique(decisions, { text: sentence, speaker: entry.speaker }, (d) => d.text);
        }

        if (matchesAny(sentence, ACTION_PATTERNS)) {
          // 「告知文は私が作成します。8/15までに用意します。」のように、
          // 期限だけを後続の文で述べるケースは 1 件のアクションにまとめる
          const previous = actionSentences[actionSentences.length - 1];
          const due = extractDue(sentence);
          if (previous && !previous.due && due && sentence.length <= 30) {
            previous.text += sentence;
            previous.due = due;
          } else {
            actionSentences.push({ text: sentence, due });
          }
          continue;
        }

        if (matchesAny(sentence, ISSUE_PATTERNS)) {
          pushUnique(issues, { text: sentence, speaker: entry.speaker }, (i) => i.text);
        }
        if (topics.length < 8 && matchesAny(sentence, TOPIC_PATTERNS)) {
          const trimmed = sentence.replace(/[。．]$/, "");
          const redundant = topics.some((t) => trimmed.includes(t) || t.includes(trimmed));
          if (trimmed.length <= 60 && !redundant) pushUnique(topics, trimmed);
        }
      }

      for (const item of actionSentences) {
        pushUnique(
          actions,
          {
            text: item.text,
            speaker: entry.speaker,
            assignee: extractAssignee(item.text, entry.speaker, speakers),
            due: item.due,
            dueDate: resolveDueDate(normalizeDueForResolve(item.due), baseDate),
          },
          (a) => a.text
        );
      }
    }

    for (const name of speakers) pushUnique(attendees, name);

    return {
      title: meta.title || topics[0] || "会議",
      date: meta.date || toISO(baseDate),
      place: meta.place,
      purpose: meta.purpose,
      attendees,
      absentees,
      speakers,
      topics,
      decisions,
      actions,
      issues,
      log,
      stats: { lines: lineCount, utterances: log.length },
    };
  }

  function escapeCell(text) {
    return String(text).replace(/\|/g, "\\|");
  }

  /**
   * 議事録データを Markdown 文字列に変換する。
   * @param {object} minutes parseTranscript の戻り値
   * @param {{includeLog?: boolean}} [options]
   */
  function toMarkdown(minutes, options) {
    const includeLog = !options || options.includeLog !== false;
    const out = [];

    out.push(`# 議事録: ${minutes.title}`, "");
    out.push(`- **日時**: ${minutes.date}`);
    if (minutes.place) out.push(`- **場所**: ${minutes.place}`);
    if (minutes.purpose) out.push(`- **目的**: ${minutes.purpose}`);
    out.push(`- **参加者**: ${minutes.attendees.length ? minutes.attendees.join("、") : "（記載なし）"}`);
    if (minutes.absentees.length) out.push(`- **欠席者**: ${minutes.absentees.join("、")}`);
    out.push(
      `- **サマリー**: 議題 ${minutes.topics.length} 件 / 決定事項 ${minutes.decisions.length} 件 / ネクストアクション ${minutes.actions.length} 件 / 課題 ${minutes.issues.length} 件`
    );
    out.push("");

    out.push("## 議題", "");
    if (minutes.topics.length) minutes.topics.forEach((t, i) => out.push(`${i + 1}. ${t}`));
    else out.push("（議題は検出されませんでした）");
    out.push("");

    out.push("## 決定事項", "");
    if (minutes.decisions.length) {
      minutes.decisions.forEach((d) => out.push(`- ${d.text}${d.speaker ? ` （${d.speaker}）` : ""}`));
    } else {
      out.push("（決定事項は検出されませんでした）");
    }
    out.push("");

    out.push("## ネクストアクション", "");
    if (minutes.actions.length) {
      out.push("| 担当 | 内容 | 期限 |", "| --- | --- | --- |");
      minutes.actions.forEach((a) => {
        out.push(`| ${escapeCell(a.assignee || "未定")} | ${escapeCell(a.text)} | ${escapeCell(a.due || "未定")} |`);
      });
    } else {
      out.push("（ネクストアクションは検出されませんでした）");
    }
    out.push("");

    out.push("## 課題・懸念", "");
    if (minutes.issues.length) {
      minutes.issues.forEach((i) => out.push(`- ${i.text}${i.speaker ? ` （${i.speaker}）` : ""}`));
    } else {
      out.push("（課題・懸念は検出されませんでした）");
    }
    out.push("");

    if (includeLog && minutes.log.length) {
      out.push("## 議事詳細", "");
      minutes.log.forEach((entry) => {
        const head = [entry.speaker && `**${entry.speaker}**`, entry.time && `(${entry.time})`]
          .filter(Boolean)
          .join(" ");
        if (head) out.push(`${head}`);
        out.push(`> ${entry.text}`, "");
      });
    }

    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  return { parseTranscript, toMarkdown, resolveDueDate, splitSentences };
});
