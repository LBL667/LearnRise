#!/usr/bin/env python3
"""Deterministic asset corrections for the F1/F4 review findings.

Two jobs, both pixel-surgical and re-runnable:

1. S09/S03 create-competition dialog shows "支持 PDF / Word / Markdown / PPT 等格式"
   while the backend rejects .pptx with 415. Repaint only that caption with the
   formats the pipeline actually accepts. Everything outside the caption band is
   left byte-for-byte identical.

2. S06 socratic captures repeated the *same* assistant answer under two different
   questions in one frame. Recompose each capture so the frame contains exactly
   one question + one answer (the socratic one), keeping the surrounding chat
   chrome (tabs, right rail, composer) untouched.

Run from the project root:

    python3 scripts/fix-review-assets.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "public" / "ui"

# The app renders this caption at 12px Microsoft YaHei in #97a3b8, centred in
# the 1920px capture. Measured ink box before the edit: x 839..1080, y 566..577.
CAPTION_BG = (250, 252, 255)
CAPTION_INK = (151, 163, 184)
CAPTION_TEXT = "支持 PDF / Word / Markdown / 拍照讲义"
CAPTION_CENTER_X = 960
CAPTION_DRAW_Y = 563  # ink lands on rows 566..577, matching the original line
CAPTION_FILL_BOX = (820, 558, 1120, 586)
DIALOG_ASSETS = ("s09-create-competition-dialog.png", "s03-upload-dialog.png")
FONT_CANDIDATES = (
    "/usr/share/fonts/winfonts/msyh.ttc",
    "/usr/share/fonts/windows/msyh.ttc",
    "/usr/share/fonts/truetype/microsoft/msyh.ttc",
)

# Chat card geometry shared by both S06 captures.
CHAT_X0, CHAT_X1 = 240, 1592
CHAT_WHITE = (255, 255, 255)
CHAT_CLEAR_Y0 = 145  # below the tab divider
CHAT_PASTE_Y = 160  # messages sit at the top; the composer stays pinned below
# slice = conversation rows to keep; clear_end = first composer row to preserve
SOCRATIC_ASSETS = {
    # keep the socratic question + its single answer, drop the earlier exchange
    "s06-socratic-bubble1.png": {"slice": (585, 958), "clear_end": 960},
    # keep the socratic question + its single answer, drop the later duplicate
    "s06-socratic-followup.png": {"slice": (280, 620), "clear_end": 960},
}


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size)
    raise FileNotFoundError("Microsoft YaHei not found; cannot match the UI caption")


def mask_ppt_claim(path: Path) -> None:
    image = Image.open(path).convert("RGB")
    draw = ImageDraw.Draw(image)
    draw.rectangle(CAPTION_FILL_BOX, fill=CAPTION_BG)

    font = load_font(12)
    bbox = font.getbbox(CAPTION_TEXT)
    width = bbox[2] - bbox[0]
    left = round(CAPTION_CENTER_X - width / 2)
    draw.text((left, CAPTION_DRAW_Y), CAPTION_TEXT, font=font, fill=CAPTION_INK)

    image.save(path, format="PNG", optimize=False)


def single_qa(path: Path, slice_y: tuple[int, int], clear_end: int) -> None:
    image = Image.open(path).convert("RGB")
    slice_y0, slice_y1 = slice_y
    conversation = image.crop((CHAT_X0, slice_y0, CHAT_X1, slice_y1))

    draw = ImageDraw.Draw(image)
    draw.rectangle(
        (CHAT_X0, CHAT_CLEAR_Y0, CHAT_X1, clear_end),
        fill=CHAT_WHITE,
    )
    image.paste(conversation, (CHAT_X0, CHAT_PASTE_Y))

    image.save(path, format="PNG", optimize=False)


def main() -> None:
    for name in DIALOG_ASSETS:
        mask_ppt_claim(UI / name)
    for name, spec in SOCRATIC_ASSETS.items():
        single_qa(UI / name, spec["slice"], spec["clear_end"])


if __name__ == "__main__":
    main()
