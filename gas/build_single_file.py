#!/usr/bin/env python3
"""gas/index.html と gas/Code.gs から、貼り付け1回で済む単一ファイル版を生成する。

出力: gas/CodeSingleFile.gs
    Apps Script のエディタに、このファイルの中身だけを貼り付ければ動く。
使い方: python3 gas/build_single_file.py
"""

import pathlib
import re

here = pathlib.Path(__file__).parent
html = (here / "index.html").read_text(encoding="utf-8")
code = (here / "Code.gs").read_text(encoding="utf-8")

# テンプレートリテラルに埋め込むためのエスケープ（バックスラッシュ → バッククォート → ${ の順）
escaped = html.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

# doGet を、HTML 定数を返す実装に差し替える
new_do_get = '''function doGet() {
  return HtmlService.createHtmlOutput(HTML_PAGE)
    .setTitle("議事録管理")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}'''

code, count = re.subn(
    r"function doGet\(\) \{.*?\n\}",
    lambda _: new_do_get,
    code,
    count=1,
    flags=re.DOTALL,
)
if count != 1:
    raise SystemExit("doGet() が見つかりませんでした。Code.gs の構造を確認してください。")

header = (
    "/**\n"
    " * 議事録管理 — 単一ファイル版（このファイルだけを Apps Script に貼り付ければ動きます）\n"
    " *\n"
    " * gas/build_single_file.py が gas/Code.gs と gas/index.html から生成しています。\n"
    " * 直接編集せず、元のファイルを直してから再生成してください。\n"
    " */\n\n"
)

# 元ファイル冒頭のコメントブロックは、この単一ファイル版の見出しに置き換える
body = re.sub(r"\A/\*\*.*?\*/\s*", "", code, count=1, flags=re.DOTALL)

out = header + "const HTML_PAGE = `" + escaped + "`;\n\n" + body
(here / "CodeSingleFile.gs").write_text(out, encoding="utf-8")
print("生成しました: gas/CodeSingleFile.gs", len(out.encode()), "バイト")
