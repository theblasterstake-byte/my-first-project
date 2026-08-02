/**
 * 会議の文字起こしテキストを解析して、議事録の構造データを組み立てる。
 * DOM に依存しないので Node からも読み込めます（末尾の export を参照）。
 */
(function (global) {
  "use strict";

  // 「日時: …」のようなヘッダー行のキー。発言者と誤認しないための一覧でもある。
  const META_FIELDS = [
    { field: "title", keys: ["会議名", "件名", "タイトル", "議題名", "title", "subject"] },
    { field: "date", keys: ["日時", "日付", "開催日", "実施日", "日程", "date"] },
    { field: "location", keys: ["場所", "会議室", "開催場所", "location", "place"] },
    {
      field: "attendees",
      keys: ["参加者", "出席者", "出席", "メンバー", "参加", "attendees", "participants"],
    },
    { field: "absentees", keys: ["欠席者", "欠席", "absentees"] },
    { field: "recorder", keys: ["記録者", "書記", "作成者"] },
  ];

  const META_KEY_SET = new Set(
    META_FIELDS.flatMap((f) => f.keys).concat(["議題", "アジェンダ", "agenda"])
  );

  // 明示的なラベルが付いた行・文（最優先で分類する）
  const EXPLICIT_MARKERS = [
    { kind: "decision", keys: ["決定事項", "決定", "decision"] },
    { kind: "action", keys: ["アクションアイテム", "アクション", "todo", "to-do", "タスク", "action item", "action"] },
    { kind: "issue", keys: ["課題", "懸念", "リスク", "issue", "risk"] },
  ];

  const DECISION_WORDS = [
    "決定", "決まっ", "決まり", "決めま", "決めた", "決めよう", "承認", "合意", "了承",
    "確定", "で行きま", "でいきま", "で進めま", "採用しま", "決議", "方針とし",
    "ということで進め", "approved", "decided", "we agreed",
  ];

  const ACTION_WORDS = [
    "までに", "対応しま", "対応する", "やりま", "やっておき", "進めま", "準備しま",
    "作成しま", "用意しま", "共有しま", "確認しておき", "送りま", "送付しま",
    "連絡しま", "お願いしま", "お願いいたしま", "お願いでき", "していただけ",
    "担当", "引き取り", "巻き取り",
    "宿題", "持ち帰り", "todo", "to-do", "will follow up", "action item",
  ];

  // 進行の合いの手。議事録の中身ではないので丸ごと捨てる。
  const FACILITATION_PATTERNS = [
    /(?:定例|会議|ミーティング|打ち合わせ)を(?:始め|終わ|閉じ)/,
    /^(?:それでは|では|じゃあ|さて)?[、\s]*[^。]{0,12}(?:始めます|始めましょう|終わります)/,
    /以上(?:です|になります|とします)/,
    /お疲れ(?:様|さま)/,
    /^(?:まず|では|それでは|じゃあ|さて)[、\s]*[^。]*(?:お願いします|お願いいたします|いきましょう)[。．!！]?$/,
  ];

  // 「その方向で進めましょう」のような、内容を伴わない決定文
  const VAGUE_DECISION = /^(?:では|それでは|じゃあ|はい)?[、\s]*(?:その|それ|この)(?:方向|形|感じ|線|方針)/;

  const ISSUE_WORDS = [
    "課題", "問題", "懸念", "リスク", "心配", "ブロッカー", "詰まっ", "遅れて",
    "間に合わな", "難しそう", "困って", "issue", "blocker", "risk",
  ];

  const NEXT_WORDS = ["次回", "次のミーティング", "次の会議", "来週の定例", "next meeting"];

  // 相槌・つなぎ言葉。要点として拾わない。
  const FILLERS = [
    "えー", "えーと", "ええと", "あのー", "あの", "まあ", "ま、", "うーん", "そうですね",
    "はい", "うん", "なるほど", "ありがとうございます", "お疲れ様です", "お疲れさまです",
    "よろしくお願いします", "すみません", "そうそう", "ですね",
  ];

  const HONORIFICS = ["さん", "君", "くん", "ちゃん", "氏", "様", "先生", "部長", "課長", "係長", "主任"];

  const WEEKDAYS = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

  // ---------------------------------------------------------------- 前処理

  function normalize(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/　/g, " ")
      .replace(/[：]/g, "：");
  }

  /** 行頭のタイムコード（[00:12:33] / (10:03) / 00:12 など）を取り除く。 */
  function stripTimecode(line) {
    return line
      .replace(/^[\[(（【]?\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\s*(?:[-–~〜]\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*[\])）】]?\s*/, "")
      .replace(/^\d{1,2}:\d{2}(?::\d{2})?\s+/, "")
      .trim();
  }

  function stripHonorific(name) {
    let out = String(name || "").trim();
    for (const h of HONORIFICS) {
      if (out.length > h.length && out.endsWith(h)) {
        out = out.slice(0, -h.length);
        break;
      }
    }
    return out.trim();
  }

  function isMetaKey(key) {
    const k = key.trim().toLowerCase();
    return META_KEY_SET.has(k) || META_KEY_SET.has(key.trim());
  }

  function metaFieldFor(key) {
    const k = key.trim().toLowerCase();
    const hit = META_FIELDS.find((f) => f.keys.some((x) => x.toLowerCase() === k));
    return hit ? hit.field : null;
  }

  function splitNames(value) {
    return String(value)
      .split(/[、,，\/・・]|\s{1,}/)
      .map((s) => stripHonorific(s.trim()))
      .filter(Boolean);
  }

  /** 見出し行（## 議題1 / ■ 進捗 / 1. 共有事項 など）なら見出しテキストを返す。 */
  function headingOf(line) {
    const patterns = [
      /^#{1,4}\s*(.+)$/,
      /^[■●◆▼※*]\s*(.+)$/,
      /^【\s*(.+?)\s*】$/,
      /^[<〈《]\s*(.+?)\s*[>〉》]$/,
      /^(?:議題|アジェンダ|トピック|agenda|topic)\s*[0-9０-９]*\s*[:：.．、]\s*(.+)$/i,
      /^[0-9０-９]{1,2}\s*[.)．）、]\s*(.+)$/,
      /^[-–—]{2,}\s*(.+?)\s*[-–—]{2,}$/,
    ];
    for (const re of patterns) {
      const m = line.match(re);
      if (m && m[1].trim().length >= 2 && m[1].trim().length <= 60) return m[1].trim();
    }
    return null;
  }

  /** 「田中: 進捗ですが…」形式なら {speaker, text} を返す。 */
  function speakerOf(line) {
    const m = line.match(/^([^\s：:]{1,24}?)\s*[：:]\s*(.*)$/);
    if (!m) return null;
    const rawName = m[1].trim();
    if (!rawName || isMetaKey(rawName)) return null;
    if (/^https?$/i.test(rawName)) return null;
    if (/[。．！？!?]/.test(rawName)) return null;
    return { speaker: stripHonorific(rawName), text: m[2].trim() };
  }

  // ---------------------------------------------------------------- 文の分割・判定

  function splitSentences(text) {
    return String(text)
      .split(/(?<=[。．！？!?])\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function trimFillers(sentence) {
    let out = sentence.trim();
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of FILLERS) {
        if (out.startsWith(f) && out.length > f.length) {
          out = out.slice(f.length).replace(/^[、,\s]+/, "");
          changed = true;
        }
      }
    }
    return out.trim();
  }

  function isSmallTalk(sentence) {
    const s = sentence.replace(/[。．！？!?、,\s]/g, "");
    if (!s) return true;
    if (s.length <= 3) return true;
    if (FILLERS.some((f) => s === f.replace(/[、,]/g, ""))) return true;
    return FACILITATION_PATTERNS.some((re) => re.test(sentence));
  }

  function containsAny(text, words) {
    const lower = text.toLowerCase();
    return words.some((w) => lower.includes(w.toLowerCase()));
  }

  /** 文頭の「決定:」「TODO:」等のラベルを取り除きつつ、種別を返す。 */
  function explicitMarker(sentence) {
    const m = sentence.match(/^[\[【(]?\s*([A-Za-z一-龥ぁ-んァ-ヶー\s-]{2,12}?)\s*[\]】)]?\s*[:：]\s*(.+)$/);
    if (!m) return null;
    const label = m[1].trim().toLowerCase();
    for (const marker of EXPLICIT_MARKERS) {
      if (marker.keys.some((k) => label === k.toLowerCase())) {
        return { kind: marker.kind, text: m[2].trim() };
      }
    }
    return null;
  }

  function classify(sentence) {
    const marked = explicitMarker(sentence);
    if (marked) return marked;
    if (containsAny(sentence, DECISION_WORDS)) {
      // 指示語だけの決定文は要点扱いに落とす
      if (VAGUE_DECISION.test(sentence)) return { kind: "point", text: sentence };
      return { kind: "decision", text: sentence };
    }
    if (containsAny(sentence, ACTION_WORDS)) return { kind: "action", text: sentence };
    if (containsAny(sentence, ISSUE_WORDS)) return { kind: "issue", text: sentence };
    if (containsAny(sentence, NEXT_WORDS)) return { kind: "next", text: sentence };
    return { kind: "point", text: sentence };
  }

  // ---------------------------------------------------------------- 期限の解釈

  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(base, n) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  function endOfMonth(base, monthOffset) {
    return new Date(base.getFullYear(), base.getMonth() + monthOffset + 1, 0);
  }

  /** 週の始まり（月曜）を返す。 */
  function startOfWeek(base) {
    return addDays(base, -((base.getDay() + 6) % 7));
  }

  /**
   * 「来週金曜」などを解決する。weekOffset は 0=今週, 1=来週, 2=再来週。
   * 今週指定で既に過ぎている曜日は、翌週の同じ曜日とみなす。
   */
  function weekdayInWeek(base, weekday, weekOffset) {
    const mondayIndex = (weekday + 6) % 7;
    const d = addDays(startOfWeek(base), weekOffset * 7 + mondayIndex);
    return weekOffset === 0 && d < base ? addDays(d, 7) : d;
  }

  /**
   * 文中の期限表現を抜き出す。
   * @returns {{label: string, date: string|null}|null}
   */
  function extractDue(sentence, today) {
    const base = today ? new Date(today.getTime()) : new Date();
    base.setHours(0, 0, 0, 0);

    // 1) 年月日が明示されているもの
    const ymd = sentence.match(/(\d{4})\s*[-\/年]\s*(\d{1,2})\s*[-\/月]\s*(\d{1,2})\s*日?/);
    if (ymd) {
      const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
      return { label: `${ymd[1]}/${ymd[2]}/${ymd[3]}`, date: toISO(d) };
    }

    const md = sentence.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?/);
    if (md) {
      const month = Number(md[1]);
      const day = Number(md[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        let d = new Date(base.getFullYear(), month - 1, day);
        // 過ぎた日付なら翌年の予定とみなす
        if (d < base) d = new Date(base.getFullYear() + 1, month - 1, day);
        return { label: `${month}/${day}`, date: toISO(d) };
      }
    }

    // 2) 相対表現
    const relative = [
      { re: /本日中|今日中|きょう中/, label: "本日中", date: () => base },
      { re: /明後日/, label: "明後日", date: () => addDays(base, 2) },
      { re: /明日/, label: "明日", date: () => addDays(base, 1) },
      { re: /今週末/, label: "今週末", date: () => weekdayInWeek(base, WEEKDAYS["金"], 0) },
      { re: /再来週/, label: "再来週", date: () => addDays(base, 14) },
      { re: /今月末|月末/, label: "今月末", date: () => endOfMonth(base, 0) },
      { re: /来月末/, label: "来月末", date: () => endOfMonth(base, 1) },
      { re: /来月/, label: "来月", date: () => addDays(base, 30) },
    ];

    const weekday = sentence.match(/(今週|来週|再来週)?\s*([日月火水木金土])曜日?/);
    if (weekday) {
      const offset = weekday[1] === "来週" ? 1 : weekday[1] === "再来週" ? 2 : 0;
      const d = weekdayInWeek(base, WEEKDAYS[weekday[2]], offset);
      return { label: `${weekday[1] || ""}${weekday[2]}曜日`, date: toISO(d) };
    }

    for (const r of relative) {
      if (r.re.test(sentence)) return { label: r.label, date: toISO(r.date()) };
    }
    if (/今週中|今週/.test(sentence)) {
      return { label: "今週中", date: toISO(weekdayInWeek(base, WEEKDAYS["金"], 0)) };
    }
    if (/来週中|来週/.test(sentence)) {
      return { label: "来週中", date: toISO(weekdayInWeek(base, WEEKDAYS["金"], 1)) };
    }
    if (/次回(?:の)?(?:会議|ミーティング|定例)?まで/.test(sentence)) {
      return { label: "次回まで", date: null };
    }

    // 3) 「〜までに」表現をそのまま残す
    const until = sentence.match(/([^、。\s]{1,14}?)までに/);
    if (until) return { label: `${until[1]}まで`, date: null };

    return null;
  }

  // ---------------------------------------------------------------- 担当者の推定

  function extractOwner(sentence, speaker, knownNames) {
    // 「田中さんお願いします」「佐藤さんが対応」→ 指名された人
    const assigned = sentence.match(
      /([^\s、。：:]{1,12}?)(?:さん|君|くん|氏|様)?\s*(?:が|に|の方で|の方が)?\s*(?:担当|対応|お願い|やって|巻き取|引き取)/
    );
    if (assigned) {
      const name = stripHonorific(assigned[1]);
      if (name && knownNames.has(name)) return name;
    }
    for (const name of knownNames) {
      const re = new RegExp(`${escapeRegExp(name)}\\s*(?:さん|君|くん|氏|様)?\\s*(?:が|は|に)?\\s*(?:担当|対応|お願い|作成|準備|確認|共有)`);
      if (re.test(sentence)) return name;
    }
    return speaker || null;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ---------------------------------------------------------------- 本体

  /**
   * 文字起こしテキストを議事録データに変換する。
   * @param {string} rawText
   * @param {{today?: Date, maxPointsPerTopic?: number}} [options]
   */
  function parseTranscript(rawText, options) {
    const opts = options || {};
    const today = opts.today instanceof Date ? opts.today : new Date();
    const maxPoints = opts.maxPointsPerTopic || 6;

    const lines = normalize(rawText)
      .split("\n")
      .map((l) => stripTimecode(l))
      .filter((l) => l.length > 0);

    const meta = { title: "", date: "", location: "", recorder: "" };
    const metaAttendees = [];
    const absentees = [];
    const speakers = [];
    const speakerSet = new Set();

    const topics = [];
    let current = null;
    let utteranceCount = 0;

    function ensureTopic(title) {
      current = { title: title, points: [], raw: [] };
      topics.push(current);
      return current;
    }

    const decisions = [];
    const actions = [];
    const issues = [];
    const nextItems = [];

    // --- 1 パス目: ヘッダー情報・見出し・発言を仕分けする
    const entries = [];
    let headerZone = true;

    for (const line of lines) {
      const sp = speakerOf(line);

      if (!sp) {
        // メタ情報行（「日時: …」など）
        const kv = line.match(/^([^\s：:]{1,16})\s*[：:]\s*(.+)$/);
        if (kv && isMetaKey(kv[1])) {
          const field = metaFieldFor(kv[1]);
          if (field === "attendees") metaAttendees.push(...splitNames(kv[2]));
          else if (field === "absentees") absentees.push(...splitNames(kv[2]));
          else if (field) meta[field] = kv[2].trim();
          else ensureTopic(kv[2].trim()); // 議題: 〜
          continue;
        }

        const heading = headingOf(line);
        if (heading) {
          ensureTopic(heading);
          headerZone = false;
          continue;
        }

        // 先頭付近の短い行はタイトル / 日付として扱う
        if (headerZone && !meta.title && line.length <= 40 && !/[。．]/.test(line)) {
          // 「2026-08-05 週次定例」のように日付とタイトルが同居する行を分ける
          const leadingDate = line.match(
            /^(\d{4}[-\/年]\s*\d{1,2}[-\/月]\s*\d{1,2}日?(?:\s*\([日月火水木金土]\))?)\s*(.*)$/
          );
          if (leadingDate) {
            meta.date = meta.date || leadingDate[1].trim();
            const rest = leadingDate[2].trim();
            if (rest) meta.title = rest;
            continue;
          }
          meta.title = line;
          continue;
        }

        // 発言者不明の本文
        entries.push({ speaker: null, text: line, topic: current || ensureTopic("議事内容") });
        utteranceCount += 1;
        headerZone = false;
        continue;
      }

      headerZone = false;
      if (sp.speaker && !speakerSet.has(sp.speaker)) {
        speakerSet.add(sp.speaker);
        speakers.push(sp.speaker);
      }
      if (!sp.text) continue;
      entries.push({ speaker: sp.speaker, text: sp.text, topic: current || ensureTopic("議事内容") });
      utteranceCount += 1;
    }

    const knownNames = new Set([...speakers, ...metaAttendees]);

    // --- 2 パス目: 文単位で分類する
    const seen = { decision: new Set(), action: new Set(), issue: new Set(), next: new Set() };

    for (const entry of entries) {
      const topic = entry.topic;

      for (const rawSentence of splitSentences(entry.text)) {
        const sentence = trimFillers(rawSentence);
        if (!sentence || isSmallTalk(sentence)) continue;

        const { kind, text } = classify(sentence);
        const clean = text.replace(/^[、,\s]+/, "").trim();
        if (!clean) continue;

        if (kind === "decision") {
          if (!seen.decision.has(clean)) {
            seen.decision.add(clean);
            decisions.push({ text: clean, speaker: entry.speaker, topic: topic.title });
          }
        } else if (kind === "action") {
          if (!seen.action.has(clean)) {
            seen.action.add(clean);
            const due = extractDue(clean, today);
            actions.push({
              text: clean,
              owner: extractOwner(clean, entry.speaker, knownNames),
              due: due ? due.label : "",
              dueDate: due ? due.date : null,
              topic: topic.title,
            });
          }
        } else if (kind === "issue") {
          if (!seen.issue.has(clean)) {
            seen.issue.add(clean);
            issues.push({ text: clean, speaker: entry.speaker, topic: topic.title });
          }
        } else if (kind === "next") {
          if (!seen.next.has(clean)) {
            seen.next.add(clean);
            nextItems.push({ text: clean, speaker: entry.speaker });
          }
        } else if (clean.length >= 10) {
          topic.points.push({ text: clean, speaker: entry.speaker });
        }
      }
    }

    // 要点は各議題ごとに上限を設けて読みやすくする
    for (const topic of topics) {
      const uniq = [];
      const used = new Set();
      for (const p of topic.points) {
        if (used.has(p.text)) continue;
        used.add(p.text);
        uniq.push(p);
      }
      topic.points = uniq.slice(0, maxPoints);
    }

    const usedTopics = topics.filter((t) => t.points.length > 0);

    const attendees = [];
    for (const name of [...metaAttendees, ...speakers]) {
      if (name && !attendees.includes(name)) attendees.push(name);
    }

    return {
      title: meta.title || "会議",
      date: meta.date || "",
      location: meta.location || "",
      recorder: meta.recorder || "",
      attendees,
      absentees,
      topics: usedTopics,
      decisions,
      actions,
      issues,
      nextItems,
      stats: {
        lines: lines.length,
        utterances: utteranceCount,
        speakers: speakers.length,
      },
    };
  }

  // ---------------------------------------------------------------- Markdown 出力

  function mdEscapeCell(text) {
    return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
  }

  function buildMarkdown(minutes) {
    const out = [];
    out.push(`# ${minutes.title} 議事録`, "");

    const header = [];
    if (minutes.date) header.push(`- **日時**: ${minutes.date}`);
    if (minutes.location) header.push(`- **場所**: ${minutes.location}`);
    if (minutes.attendees.length) header.push(`- **参加者**: ${minutes.attendees.join("、")}`);
    if (minutes.absentees.length) header.push(`- **欠席者**: ${minutes.absentees.join("、")}`);
    if (minutes.recorder) header.push(`- **記録者**: ${minutes.recorder}`);
    if (header.length) out.push(...header, "");

    if (minutes.decisions.length) {
      out.push("## 決定事項", "");
      minutes.decisions.forEach((d, i) => {
        out.push(`${i + 1}. ${d.text}${d.speaker ? `（${d.speaker}）` : ""}`);
      });
      out.push("");
    }

    if (minutes.actions.length) {
      out.push("## アクションアイテム", "");
      out.push("| # | 内容 | 担当 | 期限 |");
      out.push("| --- | --- | --- | --- |");
      minutes.actions.forEach((a, i) => {
        out.push(
          `| ${i + 1} | ${mdEscapeCell(a.text)} | ${mdEscapeCell(a.owner || "未定")} | ${mdEscapeCell(a.due || "未定")} |`
        );
      });
      out.push("");
    }

    if (minutes.topics.length) {
      out.push("## 議題ごとの要点", "");
      minutes.topics.forEach((t, i) => {
        out.push(`### ${i + 1}. ${t.title}`, "");
        t.points.forEach((p) => {
          out.push(`- ${p.speaker ? `**${p.speaker}**: ` : ""}${p.text}`);
        });
        out.push("");
      });
    }

    if (minutes.issues.length) {
      out.push("## 課題・懸念事項", "");
      minutes.issues.forEach((s) => {
        out.push(`- ${s.text}${s.speaker ? `（${s.speaker}）` : ""}`);
      });
      out.push("");
    }

    if (minutes.nextItems.length) {
      out.push("## 次回について", "");
      minutes.nextItems.forEach((n) => out.push(`- ${n.text}`));
      out.push("");
    }

    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  const api = { parseTranscript, buildMarkdown, extractDue, stripTimecode, speakerOf };

  if (typeof module === "object" && module.exports) module.exports = api;
  else global.MinutesParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
