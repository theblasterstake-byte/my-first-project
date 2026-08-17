/**
 * 議事録管理 — Google Apps Script 版（スプレッドシートを共有データベースとして使用）
 *
 * オーナーのアカウントで動作し、URL を知っている人が同じデータを読み書きします。
 * セットアップ手順は README.md を参照してください。
 */

const SHEET_NAME = "議事録";
const HEADERS = ["id", "日時", "会社名", "担当者名", "形式", "内容", "更新日時"];

/* ---------- Web アプリ ---------- */

function doGet() {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("議事録管理")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/* ---------- シート ---------- */

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.getRange("B:B").setNumberFormat("yyyy/mm/dd hh:mm");
    sheet.getRange("G:G").setNumberFormat("yyyy/mm/dd hh:mm");
    sheet.setColumnWidth(1, 140);
    sheet.setColumnWidth(2, 140);
    sheet.setColumnWidth(3, 180);
    sheet.setColumnWidth(4, 120);
    sheet.setColumnWidth(5, 70);
    sheet.setColumnWidth(6, 460);
    sheet.setColumnWidth(7, 140);
    sheet.getRange("F:F").setWrap(true).setVerticalAlignment("top");
  }

  return sheet;
}

function findRow_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return -1;
}

/* ---------- 日時の変換 ---------- */

function timezone_() {
  return Session.getScriptTimeZone();
}

/** シートの値 → <input type="datetime-local"> 用の文字列 */
function toInputDate_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, timezone_(), "yyyy-MM-dd'T'HH:mm");
  }
  return String(value).slice(0, 16);
}

/** <input type="datetime-local"> の文字列 → シートに書く Date */
function fromInputDate_(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(text || ""));
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

/* ---------- 行 ↔ オブジェクト ---------- */

function rowToMinute_(row) {
  return {
    id: String(row[0]),
    datetime: toInputDate_(row[1]),
    company: String(row[2] == null ? "" : row[2]),
    person: String(row[3] == null ? "" : row[3]),
    format: String(row[4]) === "対面" ? "onsite" : "web",
    body: String(row[5] == null ? "" : row[5]),
    updatedAt: toInputDate_(row[6]),
  };
}

function minuteToRow_(minute, updatedAt) {
  return [
    minute.id,
    fromInputDate_(minute.datetime),
    minute.company,
    minute.person,
    minute.format === "onsite" ? "対面" : "WEB",
    minute.body,
    updatedAt,
  ];
}

/* ---------- API（画面から google.script.run で呼び出す） ---------- */

function listMinutes() {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet
    .getRange(2, 1, last - 1, HEADERS.length)
    .getValues()
    .filter(function (row) {
      return row[0] !== "" && row[0] != null;
    })
    .map(rowToMinute_);
}

function saveMinute(input) {
  const company = String((input && input.company) || "").trim();
  if (!company) throw new Error("会社名を入力してください。");

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    const now = new Date();
    const minute = {
      id: input.id ? String(input.id) : "m" + Date.now() + Math.floor(Math.random() * 1000),
      datetime: String(input.datetime || ""),
      company: company,
      person: String(input.person || "").trim(),
      format: input.format === "onsite" ? "onsite" : "web",
      body: String(input.body || "").trim(),
      updatedAt: toInputDate_(now),
    };

    const row = minuteToRow_(minute, now);
    const rowIndex = findRow_(sheet, minute.id);
    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    return minute;
  } finally {
    lock.releaseLock();
  }
}

function deleteMinute(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    const rowIndex = findRow_(sheet, String(id));
    if (rowIndex < 0) return null;
    const removed = rowToMinute_(sheet.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0]);
    sheet.deleteRow(rowIndex);
    return removed;
  } finally {
    lock.releaseLock();
  }
}
