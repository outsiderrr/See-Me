#!/usr/bin/env python3
"""Convert flomo's self-contained HTML export into a readable Markdown archive.

The original ZIP/HTML remains the lossless source. This converter is deliberately
stdlib-only so it can be rerun on a clean Mac without installing a HTML library.
"""

from __future__ import annotations

import argparse
import html
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path


@dataclass
class Memo:
    created_at: str = ""
    content: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)


def classes(attrs: list[tuple[str, str | None]]) -> set[str]:
    value = next((v for k, v in attrs if k == "class"), "") or ""
    return set(value.split())


class FlomoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.memos: list[Memo] = []
        self.memo: Memo | None = None
        self.div_stack: list[set[str]] = []
        self.in_time = 0
        self.in_content = 0
        self.in_files = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        cls = classes(attrs)
        if tag == "div":
            self.div_stack.append(cls)
        if tag == "div" and "memo" in cls:
            self.memo = Memo()
        if self.memo is None:
            return
        if tag == "div" and "time" in cls:
            self.in_time += 1
        if tag == "div" and "content" in cls:
            self.in_content += 1
        if tag == "div" and "files" in cls:
            self.in_files += 1
        if self.in_content:
            if tag in {"p", "div", "ul", "ol"}:
                self._break(2)
            elif tag == "li":
                self._break(1)
                self.memo.content.append("- ")
            elif tag == "br":
                self._break(1)
        if self.in_files and tag in {"img", "audio", "source"}:
            path = next((v for k, v in attrs if k in {"src", "href"} and v), None)
            if path and path not in self.memo.files:
                self.memo.files.append(path)

    def handle_endtag(self, tag: str) -> None:
        cls = self.div_stack.pop() if tag == "div" and self.div_stack else set()
        if self.memo is not None:
            if self.in_content and tag in {"p", "li", "div", "ul", "ol"}:
                self._break(2 if tag in {"p", "div"} else 1)
            if tag == "div" and "time" in cls:
                self.in_time -= 1
            if tag == "div" and "content" in cls:
                self.in_content -= 1
            if tag == "div" and "files" in cls:
                self.in_files -= 1
            if tag == "div" and "memo" in cls:
                self.memo.content = [normalise("".join(self.memo.content))]
                self.memos.append(self.memo)
                self.memo = None

    def handle_data(self, data: str) -> None:
        if self.memo is None:
            return
        if self.in_time:
            self.memo.created_at += data
        elif self.in_content:
            self.memo.content.append(data)

    def _break(self, count: int) -> None:
        if self.memo is None:
            return
        suffix = "".join(self.memo.content[-2:])
        current = len(suffix) - len(suffix.rstrip("\n"))
        if current < count:
            self.memo.content.append("\n" * (count - current))


def normalise(text: str) -> str:
    text = html.unescape(text).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def render(source: Path, memos: list[Memo]) -> str:
    dates = [m.created_at.strip() for m in memos if m.created_at.strip()]
    lines = [
        "# flomo 全量原始记录",
        "",
        f"- 导出时间：2026-08-07（导出文件名标记）",
        f"- 原始 HTML：`{source.as_posix()}`",
        f"- 笔记数：{len(memos)}",
        f"- 时间范围：{dates[-1] if dates else '未显示'} 至 {dates[0] if dates else '未显示'}",
        "- 顺序：按 flomo 导出页面原始顺序（新到旧）",
        "- 完整性：本 Markdown 供阅读与检索；原 ZIP、HTML 和附件目录为无损底稿。",
        "",
        "## 逐条记录",
        "",
    ]
    for index, memo in enumerate(memos, 1):
        content = memo.content[0] if memo.content else ""
        tags = []
        for tag in re.findall(r"(?<!\S)#([^\s#]+)", content):
            if tag not in tags:
                tags.append(tag)
        lines.extend([
            f"## 第 {index} 条",
            "",
            f"- 创建时间：{memo.created_at.strip() or '未显示'}",
            f"- 标签：{'、'.join(tags) if tags else '无'}",
        ])
        if memo.files:
            lines.append("- 附件：")
            lines.extend(f"  - `{item}`" for item in memo.files)
        else:
            lines.append("- 附件：无")
        lines.extend(["", "### 正文", "", content or "（无文字正文）", ""])
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("html", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source_text = args.html.read_text(encoding="utf-8")
    flomo = FlomoParser()
    flomo.feed(source_text)
    if not flomo.memos:
        raise SystemExit("0 memos parsed; refusing to write an empty archive")
    if any(not memo.created_at.strip() for memo in flomo.memos):
        raise SystemExit("at least one memo has no visible creation time; refusing partial conversion")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render(args.html, flomo.memos), encoding="utf-8")
    print(f"wrote {len(flomo.memos)} memos to {args.output}")


if __name__ == "__main__":
    main()
