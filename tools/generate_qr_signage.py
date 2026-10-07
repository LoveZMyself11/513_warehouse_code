from pathlib import Path

from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.pdfgen import canvas
from reportlab.graphics import renderPDF

ROOT = Path(__file__).resolve().parents[1]
QR_DIR = ROOT / "artifacts" / "qr" / "png"
PDF_PATH = ROOT / "artifacts" / "qr" / "513base-二维码标识套装.pdf"
QR_DIR.mkdir(parents=True, exist_ok=True)
PDF_PATH.parent.mkdir(parents=True, exist_ok=True)

FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"
pdfmetrics.registerFont(TTFont("STHeiti", FONT_PATH, subfontIndex=0))

items = [("登录入口", "LOGIN", "https://lzmyselfai.cn/513base/login", "登录入口")]
for shelf in "ABCD":
    for level in range(1, 5):
        code = f"{shelf}{level}"
        items.append((f"{shelf} 货架 · 第 {level} 层", code, f"513-warehouse:{code}", f"{shelf} 货架"))
items.extend([
    ("地板区域", "FLOOR", "513-warehouse:FLOOR", "其他区域"),
    ("门后区域", "DOOR", "513-warehouse:DOOR", "其他区域"),
])

GREEN = colors.HexColor("#176b50")
DARK = colors.HexColor("#18352d")
MUTED = colors.HexColor("#5d6b66")

def qr_drawing(payload: str, size: float) -> Drawing:
    widget = qr.QrCodeWidget(payload)
    bounds = widget.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, -bounds[0] * size / width, -bounds[1] * size / height])
    drawing.add(widget)
    return drawing

def draw_centered_paragraph(c: canvas.Canvas, text: str, x: float, y: float, w: float, style: ParagraphStyle) -> None:
    p = Paragraph(text, style)
    _, h = p.wrap(w, 30 * mm)
    p.drawOn(c, x, y - h / 2)

def main() -> None:
    png_size = 900
    for _, code, payload, _ in items:
        path = QR_DIR / f"{code}.png"
        # PNG export is optional when the ReportLab raster backend is unavailable.
        try:
            from reportlab.graphics import renderPM
            renderPM.drawToFile(qr_drawing(payload, png_size), str(path), fmt="PNG", dpi=300)
        except Exception:
            pass

    page_w, page_h = A4
    c = canvas.Canvas(str(PDF_PATH), pagesize=A4)
    c.setTitle("513基地二维码标识套装")
    margin_x = 13 * mm
    top = page_h - 14 * mm
    gap_x = 6 * mm
    gap_y = 7 * mm
    card_w = (page_w - 2 * margin_x - gap_x) / 2
    card_h = 78 * mm
    title_style = ParagraphStyle("title", fontName="STHeiti", fontSize=14, leading=18, alignment=TA_CENTER, textColor=DARK)
    code_style = ParagraphStyle("code", fontName="STHeiti", fontSize=11, leading=14, alignment=TA_CENTER, textColor=GREEN)
    payload_style = ParagraphStyle("payload", fontName="STHeiti", fontSize=6.5, leading=8, alignment=TA_CENTER, textColor=MUTED)
    for index, (label, code, payload, group) in enumerate(items):
        slot = index % 6
        if slot == 0:
            c.setFillColor(colors.white)
            c.rect(0, 0, page_w, page_h, stroke=0, fill=1)
            c.setFillColor(DARK)
            c.setFont("STHeiti", 8)
            c.drawString(margin_x, page_h - 8 * mm, "513 BASE · 扫码标识")
            c.setFillColor(MUTED)
            c.drawRightString(page_w - margin_x, page_h - 8 * mm, f"第 {index // 6 + 1} 页")
        col = slot % 2
        row = slot // 2
        x = margin_x + col * (card_w + gap_x)
        y = top - 5 * mm - (row + 1) * card_h - row * gap_y
        c.setFillColor(colors.HexColor("#f5f8f6"))
        c.setStrokeColor(colors.HexColor("#dbe7e1"))
        c.roundRect(x, y, card_w, card_h, 3 * mm, stroke=1, fill=1)
        draw_centered_paragraph(c, label, x + 5 * mm, y + card_h - 10 * mm, card_w - 10 * mm, title_style)
        qr_size = 47 * mm
        qr_drawing(payload, qr_size).drawOn(c, x + (card_w - qr_size) / 2, y + 17 * mm)
        draw_centered_paragraph(c, code, x + 5 * mm, y + 12 * mm, card_w - 10 * mm, code_style)
        draw_centered_paragraph(c, payload, x + 5 * mm, y + 7 * mm, card_w - 10 * mm, payload_style)
        c.setFillColor(GREEN)
        c.rect(x, y, 2 * mm, card_h, stroke=0, fill=1)
        if slot == 5 or index == len(items) - 1:
            c.showPage()
    c.save()
    print(f"Generated {len(items)} QR codes")
    print(PDF_PATH)

if __name__ == "__main__":
    main()
