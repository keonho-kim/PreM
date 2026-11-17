#!/usr/bin/env python3
# Purpose: Render validated slide specs through PPT Master and native template layouts.
# Pattern: Bounded local inputs, escaped SVG text, editable DrawingML and immutable source files.
# Usage: Bundled Python receives runtime root and one owned generation directory.
# Related: adapters/processes/presentations.rs, presentation-validate.mjs.
import importlib.util
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
module_spec = importlib.util.spec_from_file_location('slide_objects', runtime / 'presentation-objects.py')
objects = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(objects)
quality_spec = importlib.util.spec_from_file_location('quality', runtime / 'presentation-quality.py')
quality = importlib.util.module_from_spec(quality_spec)
quality_spec.loader.exec_module(quality)


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
options = json.loads((folder / 'render-options.json').read_text())
reference_entries = {item['id']:item for item in json.loads((folder / 'references.json').read_text())}
report = {'schema_version':1, 'passed':True, 'repair_attempts':0, 'issues':[]}
if not 1 <= len(specs) <= 24:
    raise ValueError('slide_limit')

def lines(text, limit):
    # Conservative CJK/Latin width budget; rendered text remains ordinary editable shapes.
    result, current, width = [], '', 0
    for char in text:
        if char == '\n':
            result.append(current)
            current, width = '', 0
            continue
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
        layout = spec.get('layout')
        title = layout['title'] if layout else {'x': 5, 'y': 83 / 7.2, 'width': 85, 'height': 12}
        body = layout['body'] if layout else {'x': 5.625, 'y': 30, 'width': 85, 'height': 56}
        def positioned(text, frame, size, y_offset=0):
            x, y = frame['x'] * 12.8, frame['y'] * 7.2
            value = text_svg(text, x, y + size + y_offset, size, max(6, frame['width'] * 12.8 / size), '#262824')
            angle = frame.get('rotation', 0)
            return f'<g transform="rotate({angle} {x + frame["width"] * 6.4} {y + frame["height"] * 3.6})">{value}</g>'
        sizes, attempts, issues = quality.typography(spec, options['repair'], title['width']*12.8, title['height']*7.2, body['width']*12.8, body['height']*7.2, options.get('typography'))
        if quality.full_reference(spec, reference_entries):
            sizes, attempts, issues = {'title':32,'body':24}, 0, []
        report['repair_attempts'] = max(report['repair_attempts'], attempts)
        report['issues'].extend(issues)
        report['typography'] = sizes
        shapes = ['<rect width="1280" height="720" fill="#FFFEFA"/>',
                  '<rect x="64" y="58" width="44" height="5" fill="#9C3D1E"/>',
                  positioned(spec['title'], title, sizes['title'])]
        row_height = body['height'] * 7.2 / max(1, len(spec['bullets']))
        for row, bullet in enumerate(spec['bullets']):
            shapes.append(positioned('• ' + bullet, body, sizes['body'], row * row_height))
        shapes.append(text_svg(f'{index + 1 + options["offset"]:02}', 1170, 680, 16, 5, '#575A55'))
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
        if spec.get('layout'):
            objects.place(title, spec['layout']['title'], deck)
            objects.place(body, spec['layout']['body'], deck)
        title.text = spec['title']
        title.text_frame.word_wrap = True
        body.text_frame.word_wrap = True
        def usable(shape):
            text = shape.text_frame
            return ((shape.width-text.margin_left-text.margin_right)/9525,
                    (shape.height-text.margin_top-text.margin_bottom)/9525)
        sizes, attempts, issues = quality.typography(spec, options['repair'], *usable(title), *usable(body), options.get('typography'))
        if quality.full_reference(spec, reference_entries):
            sizes, attempts, issues = {'title':32,'body':24}, 0, []
        report['repair_attempts'] = max(report['repair_attempts'], attempts)
        report['issues'].extend(issues)
        report['typography'] = sizes
        font_size = sizes['body']*72/96
        for paragraph in title.text_frame.paragraphs:
            paragraph.font.size = Pt(sizes['title']*72/96)
            paragraph.line_spacing = 1.35
            paragraph.space_before = paragraph.space_after = Pt(0)
        for index, bullet in enumerate(spec['bullets']):
            paragraph = body.text_frame.paragraphs[0] if index == 0 else body.text_frame.add_paragraph()
            paragraph.text = bullet
            paragraph.font.size = Pt(font_size)
            paragraph.line_spacing = 1.35
            paragraph.space_before = paragraph.space_after = Pt(0)
        slide.notes_slide.notes_text_frame.text = spec['notes']
    deck.save(folder / 'output.pptx')

try:
    if specs[0].get('design'):
        design_spec=importlib.util.spec_from_file_location('canvas',runtime/'presentation-canvas.py')
        canvas=importlib.util.module_from_spec(design_spec)
        design_spec.loader.exec_module(canvas)
        sizes,attempts,issues=canvas.render(specs[0],folder,objects,quality,options)
        report['typography']=sizes
        report['repair_attempts']=attempts
        report['issues'].extend(issues)
    elif (folder / 'template.pptx').exists():
        template_deck()
    else:
        free_deck()
    result = Presentation(folder / 'output.pptx')
    ref_spec = importlib.util.spec_from_file_location('slide_references', runtime / 'presentation-references.py')
    references = importlib.util.module_from_spec(ref_spec)
    ref_spec.loader.exec_module(references)
    refs = references.apply_references(result, specs, folder)
    objects.apply_objects(result, specs, folder)
    result.save(folder / 'output.pptx')
    result = Presentation(folder / 'output.pptx')
    objects.validate_objects(result, specs, folder)
    object_map=[]
    for obj in specs[0].get('objects',[]):
        name=f"PreM:{obj['id']}:{obj['name']}"
        shapes=[s for s in result.slides[0].shapes if s.name==name]
        if len(shapes)==1:
            object_map.append({'id':obj['id'],'name':name,'shape_id':shapes[0].shape_id,'frame':obj['frame']})
    (folder/'object-map.json').write_text(json.dumps(object_map))
    report['issues'].extend(quality.inspect(result, specs, refs))
    report['issues'] = [dict(t) for t in dict.fromkeys(tuple(i.items()) for i in report['issues'])][:64]
    report['passed'] = not any(i['severity']=='error' for i in report['issues'])
    (folder / 'quality.json').write_text(json.dumps(report))
    if not report['passed']:
        raise ValueError('slide_quality_failed')
    if len(result.slides) != len(specs):
        raise ValueError('slide_count_mismatch')
    def texts(shapes):
        for shape in shapes:
            if shape.has_text_frame:
                yield shape.text
            if hasattr(shape, 'shapes'):
                yield from texts(shape.shapes)
    for slide, spec in zip(result.slides, specs):
        text = ''.join(texts(slide.shapes))
        compact = ''.join(text.split())
        if references.full_reference(spec, refs):
            continue
        if any(''.join(value.split()) not in compact for value in [spec['title'], *spec['bullets']]):
            raise ValueError('missing_editable_text')
except Exception as error:
    if report['passed']:
        report['passed'] = False
        report['issues'].append(quality.issue('native_content_missing'))
        (folder / 'quality.json').write_text(json.dumps(report))
    (folder / 'render-error.txt').write_text(type(error).__name__ + ':' + str(error)[:160])
    raise
