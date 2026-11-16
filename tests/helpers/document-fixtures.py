# /// script
# requires-python = ">=3.13"
# dependencies = ["python-pptx==1.0.2", "python-docx==1.2.0", "openpyxl==3.1.5", "reportlab==5.1.0", "pillow==13.0.0"]
# ///
# Purpose: Create small real document fixtures with known text, tables, images and native layouts.
# Pattern: Explicit development-only generators; no real documents or runtime storage is used.
# Usage: uv run tests/helpers/document-fixtures.py.
# Related: tests/fixtures/documents/, backend/tests/document_processing.rs.
from pathlib import Path
from io import BytesIO
from pptx import Presentation
from pptx.util import Inches
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from docx import Document
from openpyxl import Workbook
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parents[1] / 'fixtures/documents'
root.mkdir(parents=True, exist_ok=True)
img = Image.new('RGB', (900, 1200), 'white')
draw = ImageDraw.Draw(img)
font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
font = ImageFont.truetype(font_path, 38) if Path(font_path).exists() else ImageFont.load_default(size=38)
draw.multiline_text((70, 70), 'CONTENTS\n\n1. Project Overview ... 3\n2. Delivery Plan ... 8', font=font, fill='black', spacing=30)
stream = BytesIO(); img.save(stream, format='PNG'); image = stream.getvalue()
(root / 'scan.png').write_bytes(image)
pdf = canvas.Canvas(str(root / 'text.pdf'))
pdf.drawString(70, 750, 'Contents')
pdf.drawString(70, 720, '1. Project Overview ........ 3')
pdf.drawString(70, 690, '2. Delivery Plan ........... 8')
pdf.showPage(); pdf.drawString(70, 750, 'This document describes our delivery process.'); pdf.save()
scan = canvas.Canvas(str(root / 'scan.pdf'), pagesize=(450, 600))
scan.drawImage(ImageReader(BytesIO(image)), 0, 0, width=450, height=600); scan.save()
prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[0]); slide.shapes.title.text = 'Contents'; slide.placeholders[1].text = '1. Overview\n2. Plan'
slide = prs.slides.add_slide(prs.slide_layouts[5]); slide.shapes.title.text = 'Results'
slide.shapes.add_picture(BytesIO(image), Inches(0.5), Inches(1.5), width=Inches(2))
data = CategoryChartData(); data.categories = ['A', 'B']; data.add_series('Revenue', (10, 20))
slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(3), Inches(1.5), Inches(5), Inches(3), data)
prs.save(root / 'native-template.pptx')
doc = Document(); doc.add_heading('Contents', 0); doc.add_paragraph('1. Overview ... 3\n2. Plan ... 8'); table = doc.add_table(rows=2, cols=2); table.cell(0,0).text='Name';table.cell(0,1).text='Value';table.cell(1,0).text='Revenue';table.cell(1,1).text='20';doc.add_picture(BytesIO(image), width=Inches(2));doc.save(root/'office.docx')
book = Workbook(); sheet=book.active;sheet.title='Budget';sheet.append(['Item','Value']);sheet.append(['Revenue',20]);book.save(root/'sheet.xlsx')
(root/'reference.html').write_text('<!doctype html><html><head><title>Ignored metadata</title><script>fetch("https://example.invalid")</script></head><body><h1>목차</h1><ol><li>사업 개요 ... 3</li><li>추진 계획 ... 8</li></ol><p>프로젝트의 목적과 범위를 설명합니다.</p><table><tr><th>항목</th><th>값</th></tr><tr><td>예산</td><td>100</td></tr></table></body></html>',encoding='utf8')
print('Document fixtures generated')
