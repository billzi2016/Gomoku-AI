#!/usr/bin/env python3
"""
把开局库 JSON 条目渲染成 JPG 棋盘图片。

这个脚本直接读取浏览器运行时使用的紧凑 JSON，而不是读取 SGF。
JSON 是源数据，SGF 是从 JSON 导出的交换格式；从 JSON 渲染可以少一层转换，
也能避免坐标在 JSON -> SGF -> 图片 的链路中被重复解释。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

from PIL import Image, ImageDraw, ImageFont

SIZE = 15
ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"
VIS_DIR = ROOT / "vis"

# 画布宽度按棋盘边框和少量右边距计算，避免右侧出现大面积空白。
CANVAS_W = 920
CANVAS_H = 1080
BOARD_LEFT = 70
BOARD_TOP = 155
GRID = 54
BOARD_SIZE = GRID * (SIZE - 1)
STONE_R = 22

WOOD = (214, 164, 92)
GRID_COLOR = (36, 30, 22)
BLACK = (24, 24, 24)
WHITE = (242, 242, 238)
GREEN = (38, 190, 110)
TEXT = (28, 28, 28)
MUTED = (82, 72, 58)


def main() -> None:
    """把 runs/ 下每个 run JSON 渲染到 vis/<run-name>/*.jpg。"""
    run_files = sorted(RUNS_DIR.glob("*.json"))
    if not run_files:
        print(f"no run JSON files found in {RUNS_DIR.relative_to(ROOT)}")
        return

    for run_file in run_files:
        entries = load_entries(run_file)
        out_dir = VIS_DIR / run_file.stem
        out_dir.mkdir(parents=True, exist_ok=True)
        # 同一个 run 重新导出时先清理旧图片，避免旧 entry 数量更多时残留尾部 JPG。
        remove_old_images(out_dir)
        for index, entry in enumerate(entries, start=1):
            image = render_entry(entry, index, len(entries), run_file.stem)
            image.save(out_dir / f"{index:04d}.jpg", quality=92, optimize=True)
        print(f"wrote {out_dir.relative_to(ROOT)} images={len(entries)}")


def load_entries(path: Path) -> List[dict]:
    """读取一个 run JSON，并把紧凑 entries 解码成渲染所需的数据。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for raw in data.get("entries", []):
        if not isinstance(raw, list) or len(raw) < 3:
            continue
        key, move, score = str(raw[0]), int(raw[1]), int(raw[2])
        turn, stones = parse_key(key)
        out.append({"key": key, "turn": turn, "stones": stones, "move": move, "score": score})
    return out


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
            color = token[0]
            # key 中的数字是 base36 的一维索引：index = row * 15 + col。
            point = int(token[1:], 36)
            if color not in ("B", "W") or point < 0 or point >= SIZE * SIZE:
                raise ValueError(f"invalid stone token: {token}")
            stones[point] = color
    return turn, stones


def render_entry(entry: dict, index: int, total: int, run_name: str) -> Image.Image:
    """渲染一个规范局面，以及这个局面的推荐落子。"""
    image = Image.new("RGB", (CANVAS_W, CANVAS_H), WOOD)
    draw = ImageDraw.Draw(image)
    font_big = load_font(30)
    font_mid = load_font(22)
    font_small = load_font(18)

    draw_header(draw, entry, index, total, run_name, font_big, font_mid)
    draw_board(draw)
    draw_stones(draw, entry["stones"])
    draw_recommended_move(draw, entry["move"], entry["turn"], font_small)
    draw_footer(draw, entry, font_small)
    return image


def draw_header(draw: ImageDraw.ImageDraw, entry: dict, index: int, total: int, run_name: str, font_big: ImageFont.ImageFont, font_mid: ImageFont.ImageFont) -> None:
    """绘制图片顶部信息：run 名称、entry 序号、当前方、推荐落子和评分。"""
    side = "Black" if entry["turn"] == "B" else "White"
    row, col = divmod(entry["move"], SIZE)
    # 顶部两行必须和棋盘边框留出间距，否则长 run 名称会压到棋盘上。
    draw.text((BOARD_LEFT, 26), f"{run_name}  #{index:04d}/{total:04d}", fill=TEXT, font=font_mid)
    draw.text((BOARD_LEFT, 66), f"{side} to move -> {row},{col}   score {entry['score']}", fill=TEXT, font=font_big)


def draw_board(draw: ImageDraw.ImageDraw) -> None:
    """绘制 15x15 五子棋棋盘和星位。"""
    left = BOARD_LEFT
    top = BOARD_TOP
    right = left + BOARD_SIZE
    bottom = top + BOARD_SIZE
    draw.rectangle((left - 32, top - 32, right + 32, bottom + 32), outline=(80, 16, 12), width=10)
    for i in range(SIZE):
        # 棋子落在交叉点上，所以横线和竖线都覆盖 15 个交叉点。
        x = left + i * GRID
        y = top + i * GRID
        draw.line((x, top, x, bottom), fill=GRID_COLOR, width=2)
        draw.line((left, y, right, y), fill=GRID_COLOR, width=2)
    for row, col in [(3, 3), (3, 11), (7, 7), (11, 3), (11, 11)]:
        x, y = point_xy(row * SIZE + col)
        draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=GRID_COLOR)


def draw_stones(draw: ImageDraw.ImageDraw, stones: Dict[int, str]) -> None:
    """按照解码后的棋子表绘制黑白棋子。"""
    for point, color in sorted(stones.items()):
        x, y = point_xy(point)
        fill = BLACK if color == "B" else WHITE
        outline = (0, 0, 0) if color == "B" else (185, 185, 180)
        draw.ellipse((x - STONE_R, y - STONE_R, x + STONE_R, y + STONE_R), fill=fill, outline=outline, width=2)


def draw_recommended_move(draw: ImageDraw.ImageDraw, move: int, turn: str, font: ImageFont.ImageFont) -> None:
    """用绿色圆环标出推荐落子，并在旁边标记当前方。"""
    x, y = point_xy(move)
    draw.ellipse((x - STONE_R - 7, y - STONE_R - 7, x + STONE_R + 7, y + STONE_R + 7), outline=GREEN, width=5)
    label = "B" if turn == "B" else "W"
    # 推荐点可能靠近棋盘边缘，所以标签优先放右侧，越界时放左侧。
    label_x = x + 34
    if label_x > BOARD_LEFT + BOARD_SIZE - 10:
        label_x = x - 44
    draw.text((label_x, y - 12), label, fill=GREEN, font=font)


def draw_footer(draw: ImageDraw.ImageDraw, entry: dict, font: ImageFont.ImageFont) -> None:
    """绘制底部的 canonical key 和编码说明，方便人工核对图片来源。"""
    y = BOARD_TOP + BOARD_SIZE + 55
    draw.text((BOARD_LEFT, y), f"key: {entry['key']}", fill=TEXT, font=font)
    draw.text((BOARD_LEFT, y + 28), "base36 index = row * 15 + col; green ring marks the recommended move", fill=MUTED, font=font)


def point_xy(point: int) -> Tuple[int, int]:
    """把 row-major 一维索引转换成画布坐标。"""
    row, col = divmod(point, SIZE)
    return BOARD_LEFT + col * GRID, BOARD_TOP + row * GRID


def load_font(size: int) -> ImageFont.ImageFont:
    """加载系统字体；找不到时回退到 Pillow 默认字体。"""
    for path in [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/Library/Fonts/Arial.ttf",
    ]:
        font = Path(path)
        if font.exists():
            return ImageFont.truetype(str(font), size)
    return ImageFont.load_default()


def remove_old_images(directory: Path) -> None:
    """重新导出同一个 run 前删除旧 JPG。"""
    for image in directory.glob("*.jpg"):
        image.unlink()


if __name__ == "__main__":
    main()
