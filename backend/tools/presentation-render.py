#!/usr/bin/env python3
# Purpose: Render validated slide specs through PPT Master and native template layouts.
# Pattern: Bounded local inputs, escaped SVG text, editable DrawingML and immutable source files.
# Usage: Bundled Python receives runtime root and one owned generation directory.
# Related: adapters/processes/presentations.rs, presentation-validate.mjs.
import json
import os
from pathlib import Path
import resource
import sys
import threading
import time
from xml.sax.saxutils import escape

runtime, folder = map(Path, sys.argv[1:3])
sys.path[:0] = [str(runtime / 'python-packages'), str(runtime / 'ppt-master/source/skills/ppt-master/scripts')]
from pptx import Presentation
from pptx.util import Pt
from pptx.enum.shapes import PP_PLACEHOLDER
from svg_to_pptx.pptx_package.builder import create_pptx_with_native_svg

owner = os.getppid()
def watch_parent():
    while True:
        time.sleep(2)
        if os.getppid() != owner:
            os._exit(1)
threading.Thread(target=watch_parent, daemon=True).start()
resource.setrlimit(resource.RLIMIT_CPU, (150, 150))
resource.setrlimit(resource.RLIMIT_FSIZE, (50 * 1024 * 1024,) * 2)
specs = json.loads((folder / 'specs.json').read_text(encoding='utf-8'))
if not 1 <= len(specs) <= 24:
    raise ValueError('slide_limit')

def lines(text, limit):
    # Conservative CJK/Latin width budget; rendered text remains ordinary editable shapes.
    result, current, width = [], '', 0
    for char in text:
        size = 1 if ord(char) > 255 else 0.55
        if width + size > limit:
            result.append(current)
            current, width = '', 0
        current += char
        width += size
    return result + [current]

def text_svg(text, x, y, size, limit, color):
    content = ''.join(f'<tspan x="{x}" y="{y + i * size * 1.35:.2f}">{escape(line)}</tspan>'
                      for i, line in enumerate(lines(text, limit)))
    return f'<text font-family="Arial, Apple SD Gothic Neo, sans-serif" font-size="{size}" fill="{color}">{content}</text>'

def free_deck():
    paths = []
    for index, spec in enumerate(specs):
        shapes = ['<rect width="1280" height="720" fill="#FFFEFA"/>',
                  '<rect x="64" y="58" width="44" height="5" fill="#9C3D1E"/>',
                  text_svg(spec['title'], 64, 115, 32, 34, '#262824')]
        for row, bullet in enumerate(spec['bullets']):
            shapes.append(text_svg('• ' + bullet, 72, 240 + row * 80, 24, 45, '#262824'))
        shapes.append(text_svg(f'{index + 1:02}', 1170, 680, 16, 5, '#575A55'))
        path = folder / f'slide_{index+1:02}.svg'
        path.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">' + ''.join(shapes) + '</svg>', encoding='utf-8')
        paths.append(path)
    success = create_pptx_with_native_svg(paths, folder / 'output.pptx', resource_root=folder,
        verbose=False, workers=1, transition=None, use_native_shapes=True,
        pptx_structure='flat', expected_viewbox='0 0 1280 720', primary_language='ko-KR',
        notes={path.stem: specs[i]['notes'] for i, path in enumerate(paths)})
    if not success:
        raise ValueError('native_export_failed')

def template_deck():
    deck = Presentation(folder / 'template.pptx')
    title_types = {PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE}
    body_types = {PP_PLACEHOLDER.BODY, PP_PLACEHOLDER.OBJECT, PP_PLACEHOLDER.SUBTITLE}
    candidates = []
    for master in deck.slide_masters:
        for layout in master.slide_layouts:
            titles = [p for p in layout.placeholders if p.placeholder_format.type in title_types]
            bodies = [p for p in layout.placeholders if p.placeholder_format.type in body_types]
            if titles and bodies:
                body = max(bodies, key=lambda p: p.width * p.height)
                candidates.append((body.width * body.height, layout, titles[0].placeholder_format.idx, body.placeholder_format.idx))
    if not candidates:
        raise ValueError('template_has_no_text_layout')
    _, layout, title_idx, body_idx = max(candidates, key=lambda x: x[0])
    # python-pptx has no public remove-slide API. This isolated adapter preserves masters/layouts.
    for slide_id in list(deck.slides._sldIdLst):
        deck.part.drop_rel(slide_id.rId)
        deck.slides._sldIdLst.remove(slide_id)
    for spec in specs:
        slide = deck.slides.add_slide(layout)
        for placeholder in slide.placeholders:
            if placeholder.has_text_frame:
                placeholder.text_frame.clear()
        title = slide.placeholders[title_idx]
        body = slide.placeholders[body_idx]
        title.text = spec['title']
        title.text_frame.word_wrap = True
        body.text_frame.word_wrap = True
        available_lines = sum(len(lines(b, max(12, body.width / 914400 * 4))) for b in spec['bullets'])
        # Use inherited theme font/color, lowering size only to keep this bounded first delivery readable.
        font_size = min(24, max(16, body.height / 12700 / max(1, available_lines) / 1.7))
        if available_lines * font_size * 1.35 > body.height / 12700:
            raise ValueError('template_text_overflow')
        for index, bullet in enumerate(spec['bullets']):
            paragraph = body.text_frame.paragraphs[0] if index == 0 else body.text_frame.add_paragraph()
            paragraph.text = bullet
            paragraph.font.size = Pt(font_size)
        slide.notes_slide.notes_text_frame.text = spec['notes']
    deck.save(folder / 'output.pptx')

try:
    if (folder / 'template.pptx').exists():
        template_deck()
    else:
        free_deck()
    result = Presentation(folder / 'output.pptx')
    if len(result.slides) != len(specs):
        raise ValueError('slide_count_mismatch')
    for slide, spec in zip(result.slides, specs):
        text = ''.join(shape.text for shape in slide.shapes if shape.has_text_frame)
        compact = ''.join(text.split())
        if any(''.join(value.split()) not in compact for value in [spec['title'], *spec['bullets']]):
            raise ValueError('missing_editable_text')
except Exception as error:
    (folder / 'render-error.txt').write_text(type(error).__name__ + ':' + str(error)[:160])
    raise
