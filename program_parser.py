from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Iterable


@dataclass
class HtmlNode:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list["HtmlNode | str"] = field(default_factory=list)

    @property
    def classes(self) -> set[str]:
        return set(self.attrs.get("class", "").split())

    def text(self) -> str:
        parts: list[str] = []

        def collect(node: HtmlNode | str) -> None:
            if isinstance(node, str):
                parts.append(node)
                return
            if node.tag == "br":
                parts.append("\n")
            for child in node.children:
                collect(child)

        collect(self)
        return _normalize_text(" ".join(parts))

    def descendants(self, tag: str | None = None) -> Iterable["HtmlNode"]:
        for child in self.children:
            if not isinstance(child, HtmlNode):
                continue
            if tag is None or child.tag == tag:
                yield child
            yield from child.descendants(tag)

    def first_with_class(self, class_name: str) -> "HtmlNode | None":
        for node in self.descendants():
            if class_name in node.classes:
                return node
        return None


class _TreeParser(HTMLParser):
    VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = HtmlNode("document")
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = HtmlNode(tag, {key: value or "" for key, value in attrs})
        self.stack[-1].children.append(node)
        if tag not in self.VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if self.stack[-1].tag == tag:
            self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        self.stack[-1].children.append(data)


def _normalize_text(value: str) -> str:
    value = value.replace("\xa0", " ")
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    return value.strip()


def _first_direct_content(node: HtmlNode) -> HtmlNode | None:
    for child in node.children:
        if isinstance(child, HtmlNode) and child.tag == "div" and "accordion-content" in child.classes:
            return child
    for descendant in node.descendants("div"):
        if "accordion-content" in descendant.classes:
            return descendant
    return None


def _task_description(content: HtmlNode | None) -> str:
    if content is None:
        return ""

    paragraphs: list[str] = []
    for paragraph in content.descendants("p"):
        value = paragraph.text()
        if not value or value.lower() == "reward":
            continue
        if re.match(r"^[\d,]+\s*/\s*[\d,]+(?:\s|$)", value):
            continue
        paragraphs.append(value)

    return "\n\n".join(dict.fromkeys(paragraphs))


def _integer(value: str | None, default: int = 0) -> int:
    if value is None:
        return default
    match = re.search(r"-?[\d,]+", value)
    return int(match.group(0).replace(",", "")) if match else default


def parse_mlb26_program_html(html: str) -> list[dict]:
    """Parse the task accordions from an MLB The Show 26 program page fragment."""
    parser = _TreeParser()
    parser.feed(html)

    categories: list[dict] = []
    for node in parser.root.descendants("div"):
        classes = node.classes
        if "mlb26-program-accordion" not in classes or "mlb26-program-accordion-sub" in classes:
            continue

        label = node.first_with_class("tabs-toggle-label")
        if label is None or not label.text():
            continue

        category = {
            "name": label.text(),
            "description": "",
            "tasks": [],
        }
        category_content = _first_direct_content(node)
        if category_content is not None:
            for paragraph in category_content.descendants("p"):
                paragraph_text = paragraph.text()
                if paragraph_text:
                    category["description"] = paragraph_text
                    break

        for task_node in node.descendants("div"):
            if "mlb26-program-accordion-sub" not in task_node.classes:
                continue

            task_label = task_node.first_with_class("mlb26-program-accordion-label")
            if task_label is None or not task_label.text():
                continue

            content = _first_direct_content(task_node)
            meter = None if content is None else next(
                (candidate for candidate in content.descendants("meter")),
                None,
            )
            reward_node = None if content is None else next(
                (
                    candidate
                    for candidate in content.descendants("div")
                    if "reward" in candidate.classes
                ),
                None,
            )

            target_value = _integer(None if meter is None else meter.attrs.get("max"), 1)
            current_value = _integer(None if meter is None else meter.attrs.get("value"), 0)
            reward_stars = _integer(None if reward_node is None else reward_node.text(), 0)

            category["tasks"].append({
                "title": task_label.text(),
                "description": _task_description(content),
                "target_value": max(1, target_value),
                "current_value": max(0, min(current_value, max(1, target_value))),
                "reward_stars": max(0, reward_stars),
            })

        categories.append(category)

    return categories
