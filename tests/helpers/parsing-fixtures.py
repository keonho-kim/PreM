# /// script
# requires-python = ">=3.13"
# dependencies = ["python-pptx==1.0.2", "python-docx==1.2.0", "openpyxl==3.1.5", "reportlab==5.1.0", "pillow==13.0.0"]
# ///
# Purpose: Generate bounded Korean business-document cases with deliberately complex structure.
# Pattern: Synthetic originals and pinned OFL font; expected results are authored separately.
# Usage: uv run tests/helpers/parsing-fixtures.py; never reads or writes application data.
# Related: tests/fixtures/parsing-quality/expectations.json, parsing-audit.mjs.
from pathlib import Path
from io import BytesIO
from datetime import datetime
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
from xml.etree import ElementTree as ET
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from docx import Document
from docx.shared import Inches as DocInches
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE
from pptx.enum.chart import XL_CHART_TYPE
from pptx.chart.data import CategoryChartData

ROOT = Path(__file__).resolve().parents[1] / 'fixtures/parsing-quality'
FONT = ROOT / 'fonts/NanumGothic-Regular.ttf'
EPOCH = datetime(2026, 1, 1)
pdfmetrics.registerFont(TTFont('QualityKorean', str(FONT)))


def picture():
    image = Image.new('RGB', (400, 220), '#ffffff')
    draw = ImageDraw.Draw(image)
    draw.rectangle((20, 30, 150, 170), fill='#406b91')
    draw.ellipse((210, 30, 350, 170), fill='#d17b4f')
    draw.line((150, 100, 210, 100), fill='#222222', width=5)
    data = BytesIO()
    image.save(data, format='PNG')
    return data.getvalue()


def pdf_line(pdf, x, y, text, size=12):
    pdf.setFont('QualityKorean', size)
    pdf.drawString(x, y, text)


def make_pdfs():
    pdf = canvas.Canvas(str(ROOT / 'korean-columns.pdf'), pagesize=(595, 842), invariant=1)
    pdf_line(pdf, 45, 790, '업무 개선 검토 보고서', 20)
    # Paint row-wise deliberately; logical reading order must follow complete columns.
    for i, (left, right) in enumerate([
        ('왼쪽 첫째: 현황 조사', '오른쪽 첫째: 실행 계획'),
        ('왼쪽 둘째: 원인 분석', '오른쪽 둘째: 결과 확인'),
        ('왼쪽 셋째: 개선 목표', '오른쪽 셋째: 후속 조치'),
    ]):
        pdf_line(pdf, 45, 720-i*34, left)
        pdf_line(pdf, 320, 720-i*34, right)
    pdf.drawImage(ImageReader(BytesIO(picture())), 45, 460, width=200, height=110)
    pdf_line(pdf, 45, 435, '그림: 두 업무 단계의 연결')
    pdf_line(pdf, 45, 40, '합성 검증 문서 · 1')
    pdf.save()

    image = Image.new('RGB', (1500, 1900), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT), 48)
    scan_lines = ['월간 운영 점검', '대상 부서: 운영지원팀', '점검 항목: 문서 보관 상태',
                  '처리 건수: 120건', '후속 조치: 담당자 확인']
    for i, line in enumerate(scan_lines):
        draw.text((120, 160+i*140), line, font=font, fill='black')
    scan = BytesIO()
    image.save(scan, format='PNG')
    (ROOT / 'korean-scan.png').write_bytes(scan.getvalue())
    pdf = canvas.Canvas(str(ROOT / 'korean-mixed.pdf'), pagesize=(595, 842), invariant=1)
    pdf_line(pdf, 45, 770, '업무 점검 안내', 20)
    pdf_line(pdf, 45, 720, '다음 장은 스캔된 한글 점검표입니다.')
    pdf.showPage()
    pdf.drawImage(ImageReader(BytesIO(scan.getvalue())), 0, 0, width=595, height=842)
    pdf.save()


def make_docx():
    doc = Document()
    doc.core_properties.created = doc.core_properties.modified = EPOCH
    doc.add_heading('분기 운영 보고', 0)
    doc.add_paragraph('보고 개요: 부서별 업무 실적을 검토합니다.')
    table = doc.add_table(rows=4, cols=3)
    table.cell(0, 0).merge(table.cell(0, 2)).text = '분기 실적 집계'
    for cell, text in zip(table.rows[1].cells, ['부서', '처리 건수', '검토 결과']):
        cell.text = text
    for row, values in zip(table.rows[2:], [['운영팀', '120', '완료'], ['지원팀', '85', '확인 중']]):
        for cell, text in zip(row.cells, values):
            cell.text = text
    doc.add_paragraph('표 다음 설명: 완료 항목을 우선 검토합니다.')
    doc.add_picture(BytesIO(picture()), width=DocInches(3))
    doc.add_paragraph('그림 설명: 업무 인계 관계')
    doc.add_page_break()
    doc.add_heading('후속 계획', 1)
    doc.add_paragraph('마지막 확인: 담당 부서가 결과를 공유합니다.')
    doc.save(ROOT / 'merged-report.docx')


def make_xlsx():
    book = Workbook()
    book.properties.created = book.properties.modified = EPOCH
    sheet = book.active
    sheet.title = '예산'
    sheet.merge_cells('A1:C1')
    sheet['A1'] = '분기 예산'
    sheet.append(['항목', '금액', '상태'])
    sheet.append(['자료 정리', 120, '완료'])
    sheet.append(['자료 검토', 80, '진행'])
    sheet.append(['합계', '=SUM(B3:B4)', '검토 대상'])
    for col in ['A', 'B', 'C']:
        sheet.column_dimensions[col].width = 24
    plan = book.create_sheet('일정')
    plan.append(['단계', '담당'])
    plan.append(['검토 시작', '운영팀'])
    plan.append(['최종 확인', '지원팀'])
    book.save(ROOT / 'multi-sheet.xlsx')
    # Excel persists a formula and its cached displayed value independently.
    with ZipFile(ROOT / 'multi-sheet.xlsx') as archive:
        entries = {n: archive.read(n) for n in archive.namelist()}
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    xml = ET.fromstring(entries['xl/worksheets/sheet1.xml'])
    xml.find('.//s:c[@r="B5"]/s:v', ns).text = '200'
    entries['xl/worksheets/sheet1.xml'] = ET.tostring(xml)
    write_zip(ROOT / 'multi-sheet.xlsx', entries)


def make_pptx():
    deck = Presentation()
    deck.core_properties.created = deck.core_properties.modified = EPOCH
    slide = deck.slides.add_slide(deck.slide_layouts[5])
    slide.shapes.title.text = '운영 현황'
    table = slide.shapes.add_table(3, 2, Inches(.5), Inches(1.4), Inches(4), Inches(1.8)).table
    table.cell(0, 0).merge(table.cell(0, 1))
    table.cell(0, 0).text = '업무 건수'
    for row, vals in zip([1, 2], [('정리', '120'), ('검토', '80')]):
        for col, text in enumerate(vals):
            table.cell(row, col).text = text
    data = CategoryChartData()
    data.categories = ['정리', '검토']
    data.add_series('건수', (120, 80))
    slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(5), Inches(1.4), Inches(4), Inches(3), data)
    slide = deck.slides.add_slide(deck.slide_layouts[5])
    slide.shapes.title.text = '검토 흐름'
    group = slide.shapes.add_group_shape()
    group.name = '검토 단계 그룹'
    for i, text in enumerate(['자료 수집', '내용 검토', '결과 공유']):
        shape = group.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGLE, Inches(.6+i*3), Inches(1.8), Inches(2.3), Inches(.8))
        shape.text = text
        shape.text_frame.paragraphs[0].font.size = Pt(20)
    nested = group.shapes.add_group_shape()
    nested.name = '중첩 이미지 그룹'
    img = nested.shapes.add_picture(BytesIO(picture()), Inches(1), Inches(3.3), width=Inches(3))
    img.rotation = 15
    img.name = '회전된 업무 이미지'
    deck.save(ROOT / 'grouped-slides.pptx')


def write_zip(path, entries):
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data)


make_pdfs()
make_docx()
make_xlsx()
make_pptx()
for suffix in ['docx', 'xlsx', 'pptx']:
    for file in ROOT.glob('*.' + suffix):
        with ZipFile(file) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        core = ET.fromstring(entries['docProps/core.xml'])
        for tag in ['created', 'modified']:
            node = core.find('{http://purl.org/dc/terms/}' + tag)
            if node is not None:
                node.text = '2026-01-01T00:00:00Z'
        entries['docProps/core.xml'] = ET.tostring(core)
        write_zip(file, entries)
generated = ['korean-columns.pdf', 'korean-mixed.pdf', 'korean-scan.png', 'merged-report.docx', 'multi-sheet.xlsx', 'grouped-slides.pptx']
(ROOT / 'generated.json').write_text(json.dumps({
    'generator': 'tests/helpers/parsing-fixtures.py',
    'assets': [{'file': name, 'sha256': hashlib.sha256((ROOT / name).read_bytes()).hexdigest()} for name in generated],
}, indent=2) + '\n')
print('Generated five synthetic documents and the Korean scan source image.')
