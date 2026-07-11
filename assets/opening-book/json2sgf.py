#!/usr/bin/env python3
"""
把紧凑开局库 JSON run 转成 SGF 文件。

运行时开局库使用 `B|B34,W35` 这类 canonical key。
这个脚本只做导出，方便 SGF 工具查看五子棋/连珠分支；浏览器仍然使用 JSON，
所以这里不会改变运行时格式。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

SIZE = 15
ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"
SGF_DIR = ROOT / "sgf"


@dataclass
class Entry:
    """从紧凑 JSON 解码出来的一个开局库条目。"""

    turn: str
    stones: Dict[int, str]
    move: int
    score: int
    key: str


@dataclass
class TreeNode:
    """重建出来的 SGF 树节点。"""

    entry: Optional[Entry] = None
    children: List["TreeNode"] = field(default_factory=list)


def main() -> None:
    """把 runs/ 下每个 run JSON 转成 sgf/ 下的同名 SGF 文件。"""
    SGF_DIR.mkdir(parents=True, exist_ok=True)
    run_files = sorted(RUNS_DIR.glob("*.json"))
    if not run_files:
        print(f"no run JSON files found in {RUNS_DIR.relative_to(ROOT)}")
        return

    for run_file in run_files:
        out_file = SGF_DIR / f"{run_file.stem}.sgf"
        entries, metadata = load_run(run_file)
        root = build_tree(entries)
        out_file.write_text(render_sgf(root, metadata, run_file.name), encoding="utf-8")
        print(f"wrote {out_file.relative_to(ROOT)} entries={len(entries)}")


def load_run(path: Path) -> Tuple[List[Entry], dict]:
    """读取一个 run JSON，并解码其中的紧凑 entries。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = []
    for raw in data.get("entries", []):
        if not isinstance(raw, list) or len(raw) < 3:
            continue
        key, move, score = raw[0], int(raw[1]), int(raw[2])
        try:
            turn, stones = parse_key(str(key))
        except ValueError:
            continue
        entries.append(Entry(turn=turn, stones=stones, move=move, score=score, key=str(key)))
    entries.sort(key=lambda entry: (len(entry.stones), entry.key))
    return entries, data


def parse_key(key: str) -> Tuple[str, Dict[int, str]]:
    """把 `B|B34,W35` 这类 key 解码成当前行动方和棋子位置。"""
    if "|" not in key:
        raise ValueError(f"invalid key: {key}")
    turn, payload = key.split("|", 1)
    if turn not in ("B", "W"):
        raise ValueError(f"invalid turn: {key}")

    stones: Dict[int, str] = {}
    if payload:
        for token in payload.split(","):
            if len(token) < 2 or token[0] not in ("B", "W"):
                raise ValueError(f"invalid stone token: {token}")
            # key 中的数字是 base36 的一维棋盘索引。
            index = int(token[1:], 36)
            if index < 0 or index >= SIZE * SIZE:
                raise ValueError(f"index out of board: {token}")
            stones[index] = token[0]
    return turn, stones


def build_tree(entries: List[Entry]) -> TreeNode:
    """
    根据 canonical position 尽量重建 SGF 分支树。

    run JSON 没有显式保存 parent id。为了不改变运行时数据格式，这里用
    “棋子集合包含关系”推断父节点：一个条目会挂到最深的、棋子集合是它子集的
    已有节点下面。这样不能恢复生成时的全部队列语义，但能尽量保留开局库分支。
    """
    root = TreeNode()
    nodes: List[TreeNode] = [root]

    for entry in entries:
        parent = root
        parent_size = -1
        for candidate in nodes:
            if candidate.entry is None:
                candidate_stones: Dict[int, str] = {}
            else:
                candidate_stones = candidate.entry.stones
            size = len(candidate_stones)
            if size >= len(entry.stones) or size <= parent_size:
                continue
            if is_subset(candidate_stones, entry.stones):
                parent = candidate
                parent_size = size
        node = TreeNode(entry=entry)
        parent.children.append(node)
        nodes.append(node)

    sort_children(root)
    return root


def is_subset(parent: Dict[int, str], child: Dict[int, str]) -> bool:
    """判断 parent 的每颗棋子是否都原样出现在 child 中。"""
    return all(child.get(index) == color for index, color in parent.items())


def sort_children(node: TreeNode) -> None:
    """固定子节点顺序，让 SGF 输出可重复、方便 diff。"""
    node.children.sort(key=lambda child: (child.entry.key if child.entry else ""))
    for child in node.children:
        sort_children(child)


def render_sgf(root: TreeNode, metadata: dict, source_name: str) -> str:
    """渲染一个包含重建开局树的 SGF collection。"""
    props = [
        "GM[4]",
        "FF[4]",
        f"SZ[{SIZE}]",
        "AP[Gomoku-AI-json2sgf]",
        "RU[freestyle]",
        f"GN[{escape_sgf(source_name)}]",
        f"C[{escape_sgf(root_comment(metadata))}]",
    ]
    lines = ["(", f"  ;{''.join(props)}"]
    for child in root.children:
        lines.extend(render_child(child, 1))
    lines.append(")")
    return "\n".join(lines) + "\n"


def render_child(node: TreeNode, depth: int) -> List[str]:
    """渲染一个 SGF variation 分支，并按层级缩进。"""
    if node.entry is None:
        return []
    indent = "  " * depth
    body = f"{indent};{render_entry(node.entry)}"
    if not node.children:
        return [body]

    branch_indent = "  " * (depth + 1)
    lines = [f"{indent}(", f"{branch_indent};{render_entry(node.entry)}"]
    for child in node.children:
        lines.extend(render_child(child, depth + 1))
    lines.append(f"{indent})")
    return lines


def render_entry(entry: Entry) -> str:
    """
    渲染一个 SGF 局面节点。

    AB/AW 用来摆出 canonical stones。TR 三角标记推荐落子。
    这里不直接把推荐落子写成一手棋，是因为开局库条目表示“某个局面的推荐手”，
    不一定是一盘单线棋谱里的实际下一手。
    """
    black = [sgf_point(index) for index, color in sorted(entry.stones.items()) if color == "B"]
    white = [sgf_point(index) for index, color in sorted(entry.stones.items()) if color == "W"]
    parts: List[str] = []
    if black:
        parts.append("AB" + "".join(f"[{point}]" for point in black))
    if white:
        parts.append("AW" + "".join(f"[{point}]" for point in white))
    move_point = sgf_point(entry.move)
    parts.append(f"TR[{move_point}]")
    parts.append(f"PL[{entry.turn}]")
    parts.append(f"C[{escape_sgf(entry_comment(entry, move_point))}]")
    return "".join(parts)


def sgf_point(index: int) -> str:
    """把 row-major 一维索引转换成 SGF 坐标，SGF 是列在前、行在后。"""
    row, col = divmod(index, SIZE)
    return chr(ord("a") + col) + chr(ord("a") + row)


def entry_comment(entry: Entry, move_point: str) -> str:
    """生成一个条目的 SGF 注释，方便在 SGF 查看器里核对。"""
    row, col = divmod(entry.move, SIZE)
    return "\n".join(
        [
            f"book key: {entry.key}",
            f"side to move: {entry.turn}",
            f"recommended move: {row},{col} / SGF {move_point}",
            f"score: {entry.score}",
        ]
    )


def root_comment(metadata: dict) -> str:
    """生成根节点注释，说明这个 SGF 来自哪个 JSON run 配置。"""
    return "\n".join(
        [
            "Exported from Gomoku-AI opening-book JSON.",
            "Positions are canonicalized by symmetry and translation in the runtime JSON.",
            f"thinkMs: {metadata.get('thinkMs')}",
            f"maxEntries: {metadata.get('maxEntries')}",
            f"maxPly: {metadata.get('maxPly')}",
            f"centerRadius: {metadata.get('centerRadius')}",
            f"branch: {metadata.get('branch')}",
            f"entries: {len(metadata.get('entries', []))}",
        ]
    )


def escape_sgf(value: str) -> str:
    """转义 SGF 属性文本中的反斜杠、右中括号和换行。"""
    return value.replace("\\", "\\\\").replace("]", "\\]").replace("\n", "\\n")


if __name__ == "__main__":
    main()
