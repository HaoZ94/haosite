"""Build the two-page academic CV from cv/content.json.

Requires reportlab. Uses Georgia, Arial, and Arial Unicode from macOS,
or CV_FONT_DIR and CV_CJK_FONT overrides.
Run: python3 scripts/build-cv.py [--output output/pdf/haozhu_cv_redesigned.pdf]
"""

import argparse
import json
import os
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
INK = colors.HexColor("#253234")
TEAL = colors.HexColor("#245D60")
MUTED = colors.HexColor("#5D6A6A")
RULE = colors.HexColor("#C9D6D3")
WIDTH, HEIGHT = A4
LEFT, RIGHT = 43, WIDTH - 43
BODY_X = LEFT + 79
TEXT_WIDTH = RIGHT - BODY_X


def register_fonts():
    folder = Path(os.environ.get("CV_FONT_DIR", "/System/Library/Fonts/Supplemental"))
    for family in ("Arial", "Georgia"):
        for suffix, filename in (
            ("", f"{family}.ttf"),
            ("-Bold", f"{family} Bold.ttf"),
            ("-Italic", f"{family} Italic.ttf"),
            ("-BoldItalic", f"{family} Bold Italic.ttf"),
        ):
            pdfmetrics.registerFont(TTFont(family + suffix, str(folder / filename)))
        pdfmetrics.registerFontFamily(
            family,
            normal=family,
            bold=family + "-Bold",
            italic=family + "-Italic",
            boldItalic=family + "-BoldItalic",
        )
    chinese_font = Path(os.environ.get("CV_CJK_FONT", str(folder / "Arial Unicode.ttf")))
    pdfmetrics.registerFont(TTFont("Chinese", str(chinese_font)))


def style(name="body", **options):
    return ParagraphStyle(name, **dict({
        "fontName": "Arial", "fontSize": 10.2, "leading": 13.5,
        "textColor": INK, "alignment": TA_LEFT,
        "splitLongWords": False, "spaceBefore": 0, "spaceAfter": 0,
    }, **options))


class CV:
    def __init__(self, output, data):
        self.data = data
        self.c = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
        self.c.setTitle(f'{data["name"]} / {data["chinese_name"]} | Curriculum Vitae')
        self.c.setAuthor(f'{data["name"]} / {data["chinese_name"]}')
        self.c.setSubject("Academic appointments, education, publications and presentations")
        self.c.setCreator("Hao Zhu CV / ReportLab")
        self.y = HEIGHT - 43

    def paragraph(self, text, x, y, width, paragraph_style=None):
        p = Paragraph(text, paragraph_style or style())
        _, height = p.wrap(width, HEIGHT)
        if y - height < 54:
            raise ValueError(f"Content exceeds page area: {text[:75]}")
        p.drawOn(self.c, x, y - height)
        return height

    def section(self, title, gap=18, note=None):
        self.y -= gap
        self.c.setFillColor(TEAL)
        self.c.setFont("Georgia", 14)
        self.c.drawString(LEFT, self.y - 14, title)
        label_width = pdfmetrics.stringWidth(title, "Georgia", 14)
        self.c.setStrokeColor(RULE)
        self.c.setLineWidth(0.6)
        rule_start = LEFT + label_width + 14
        if note:
            self.c.setFont("Arial", 8.2)
            self.c.setFillColor(MUTED)
            self.c.drawRightString(RIGHT, self.y - 12, note)
            rule_end = RIGHT - pdfmetrics.stringWidth(note, "Arial", 8.2) - 12
        else:
            rule_end = RIGHT
        self.c.line(rule_start, self.y - 9, rule_end, self.y - 9)
        self.y -= 26

    def date(self, text, y, x=LEFT, width=65):
        return self.paragraph(text, x, y, width, style("date", fontSize=9.2, leading=13.5, textColor=TEAL, alignment=TA_RIGHT))

    def entry(self, entry, gap=10):
        self.date(entry["date"], self.y)
        text = "<b>" + entry["title"] + "</b><br/>" + "<br/>".join(entry["lines"])
        self.y -= self.paragraph(text, BODY_X, self.y, TEXT_WIDTH) + gap

    def footer(self, page):
        self.c.setStrokeColor(RULE)
        self.c.setLineWidth(0.6)
        self.c.line(LEFT, 43, RIGHT, 43)
        self.c.setFont("Arial", 7.8)
        self.c.setFillColor(MUTED)
        self.c.drawString(LEFT, 29, "Hao Zhu  |  Curriculum Vitae")
        self.c.drawCentredString(WIDTH / 2 + 35, 29, "Updated " + self.data["content_updated"])
        self.c.drawRightString(RIGHT, 29, f"{page} / 2")

    def header(self):
        d = self.data
        self.c.setFillColor(TEAL)
        self.c.rect(LEFT, self.y - 2, 34, 2, fill=1, stroke=0)
        self.y -= 19
        self.c.setFont("Georgia", 36)
        self.c.setFillColor(INK)
        self.c.drawString(LEFT - 1, self.y - 34, d["name"])
        chinese_x = LEFT - 1 + pdfmetrics.stringWidth(d["name"], "Georgia", 36) + 16
        self.c.setFont("Chinese", 23)
        self.c.setFillColor(TEAL)
        self.c.drawString(chinese_x, self.y - 34, d["chinese_name"])
        self.c.setFont("Arial", 9)
        self.c.setFillColor(MUTED)
        self.c.drawRightString(RIGHT, self.y - 13, "CURRICULUM VITAE")
        self.c.setFont("Arial", 11)
        self.c.setFillColor(TEAL)
        self.c.drawRightString(RIGHT, self.y - 33, d["credential"])
        self.y -= 48
        self.y -= self.paragraph(d["institute"] + "  |  " + d["university"], LEFT, self.y, RIGHT - LEFT, style(fontSize=10.2, leading=14))
        self.y -= 5
        self.y -= self.paragraph(d["address"], LEFT, self.y, RIGHT - LEFT, style(fontSize=9.3, leading=12, textColor=MUTED))
        self.y -= 4
        contact = f'<link href="mailto:{d["email"]}" color="#245D60">{d["email"]}</link> &nbsp;&nbsp; / &nbsp;&nbsp; <link href="https://{d["website"]}" color="#245D60">{d["website"]}</link>'
        self.y -= self.paragraph(contact, LEFT, self.y, RIGHT - LEFT, style(fontSize=9.6, leading=13))

    def first_page(self):
        self.header()
        self.section("Academic Appointments", gap=23)
        for e in self.data["appointments"]:
            self.entry(e)
        self.section("Education", gap=7)
        for e in self.data["education"]:
            self.entry(e)
        self.section("Awards and Honors", gap=7)
        for date, title, institution in self.data["awards"]:
            self.date(date, self.y)
            self.y -= self.paragraph(f"{title}, {institution}", BODY_X, self.y, TEXT_WIDTH) + 4
        self.section("Teaching Experience", gap=14)
        for e in self.data["teaching"]:
            self.entry(e, gap=0)
        self.section("Skills", gap=18)
        for label, text in self.data["skills"]:
            self.paragraph(label, LEFT, self.y, 68, style(fontSize=9.2, leading=13.5, textColor=TEAL, alignment=TA_RIGHT))
            self.y -= self.paragraph(text, BODY_X, self.y, TEXT_WIDTH) + 6
        print(f"Page 1 content ends {self.y:.1f} pt above the page bottom")
        self.footer(1)
        self.c.showPage()

    def second_page(self):
        self.y = HEIGHT - 43
        self.c.setFont("Georgia", 14)
        self.c.setFillColor(INK)
        self.c.drawString(LEFT, self.y - 11, self.data["name"])
        chinese_x = LEFT + pdfmetrics.stringWidth(self.data["name"], "Georgia", 14) + 10
        self.c.setFont("Chinese", 11)
        self.c.setFillColor(TEAL)
        self.c.drawString(chinese_x, self.y - 11, self.data["chinese_name"])
        self.c.setFont("Arial", 8.3)
        self.c.setFillColor(MUTED)
        self.c.drawRightString(RIGHT, self.y - 9, "CURRICULUM VITAE")
        self.y -= 19
        self.section("Publications", gap=9, note="* Equal contribution")
        # A narrower date gutter gives long academic citations enough room.
        citation_x = LEFT + 43
        citation_width = RIGHT - citation_x
        for pub in self.data["publications"]:
            self.date(pub["year"], self.y, width=29)
            text = f'<font size="9.4" color="#5D6A6A">{pub["authors"]}</font><br/>{pub["title"]} <i>{pub["journal"]}.</i>'
            self.y -= self.paragraph(text, citation_x, self.y, citation_width, style(fontSize=10.2, leading=13.5)) + 7
        self.section("Presentations", gap=7)
        for talk in self.data["presentations"]:
            self.date(talk["year"], self.y, width=29)
            text = f'<b>Zhu, H.</b> (Presenter). {talk["title"]}<br/><font size="9.5" color="#5D6A6A"><i>{talk["venue"]}</i></font>'
            self.y -= self.paragraph(text, citation_x, self.y, citation_width, style(fontSize=10.2, leading=14)) + 9
        self.section("References", gap=7)
        column_gap = 17
        column_width = (RIGHT - LEFT - 2 * column_gap) / 3
        heights = []
        for i, ref in enumerate(self.data["references"]):
            x = LEFT + i * (column_width + column_gap)
            h = self.paragraph(f'<b>{ref["name"]}</b>', x, self.y, column_width, style(fontSize=9.2, leading=12))
            h += 5
            text = "<br/>".join(ref[k] for k in ("title", "department", "university", "location"))
            h += self.paragraph(text, x, self.y - h, column_width, style(fontSize=9.2, leading=12, textColor=MUTED))
            heights.append(h)
        self.y -= max(heights)
        print(f"Page 2 content ends {self.y:.1f} pt above the page bottom")
        self.footer(2)
        self.c.save()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "output/pdf/haozhu_cv_redesigned.pdf")
    args = parser.parse_args()
    register_fonts()
    data = json.loads((ROOT / "cv/content.json").read_text())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    document = CV(args.output, data)
    document.first_page()
    document.second_page()
    print(args.output)


if __name__ == "__main__":
    main()
