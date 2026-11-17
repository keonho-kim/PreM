# Purpose: Materialize validated picture/chart/shape/text objects as native editable DrawingML.
# Pattern: Existing python-pptx primitives; only UUID-named normalized media in the owned workdir.
# Usage: Imported by presentation-render.py after base text/template rendering.
# Related: modules/presentations/objects.rs, presentation-image.mjs.
from pathlib import Path
from uuid import UUID
from PIL import Image as RasterImage
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from pptx.util import Pt

def box(frame, deck):
    return tuple(int(v) for v in (frame['x'] * deck.slide_width / 100,
        frame['y'] * deck.slide_height / 100, frame['width'] * deck.slide_width / 100,
        frame['height'] * deck.slide_height / 100))

def place(shape, frame, deck):
    shape.left, shape.top, shape.width, shape.height = box(frame, deck)
    shape.rotation = frame.get('rotation', 0)

def apply_objects(deck, specs, folder):
    for slide, spec in zip(deck.slides, specs):
        for obj in spec.get('objects', []):
            if obj['content']['kind'] == 'reference':
                continue
            content, frame = obj['content'], obj['frame']
            bounds = box(frame, deck)
            kind = content['kind']
            if kind == 'image':
                media = str(UUID(content['media_id']))
                filename = Path(folder) / f'media-{media}.png'
                with RasterImage.open(filename) as image:
                    iw, ih = image.size
                left, top, width, height = bounds
                scale = min(width / iw, height / ih)
                fw, fh = int(iw * scale), int(ih * scale)
                shape = slide.shapes.add_picture(str(filename), left + (width-fw)//2, top + (height-fh)//2, fw, fh)
            elif kind == 'chart':
                data = CategoryChartData()
                data.categories = content['categories']
                for series in content['series']:
                    data.add_series(series['name'], series['values'])
                chart_type = {'column': XL_CHART_TYPE.COLUMN_CLUSTERED,
                    'bar': XL_CHART_TYPE.BAR_CLUSTERED, 'line': XL_CHART_TYPE.LINE,
                    'pie': XL_CHART_TYPE.PIE}[content['chart_type']]
                shape = slide.shapes.add_chart(chart_type, *bounds, data)
                chart = shape.chart
                chart.has_title = True
                chart.chart_title.text_frame.text = content['title']
                chart.has_legend = len(content['series']) > 1 or content['chart_type'] == 'pie'
                if chart.has_legend:
                    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
            elif kind == 'shape':
                form = MSO_SHAPE.RECTANGLE if content['shape'] == 'rectangle' else MSO_SHAPE.OVAL
                shape = slide.shapes.add_shape(form, *bounds)
                shape.fill.solid()
                shape.fill.fore_color.rgb = RGBColor.from_string(content['fill'][1:])
                shape.line.fill.background()
            else:
                placeholder = next((p for p in slide.placeholders if f'slot-{p.placeholder_format.idx}'==obj['id'] and p.has_text_frame),None) if spec.get('design') and not spec['design']['authored'] else None
                shape = placeholder or slide.shapes.add_textbox(*bounds)
                if placeholder is not None:
                    place(shape,frame,deck)
                shape.text_frame.word_wrap = True
                shape.text = content['text']
                for paragraph in shape.text_frame.paragraphs:
                    paragraph.font.size = Pt(content['font_size'])
                    if not shape.is_placeholder:
                        paragraph.font.color.rgb = RGBColor.from_string(content['color'][1:])
            shape.name = f"PreM:{obj['id']}:{obj['name']}"
            shape.rotation = frame.get('rotation', 0)


def validate_objects(deck, specs, folder):
    for slide, spec in zip(deck.slides, specs):
        for obj in spec.get('objects', []):
            if obj['content']['kind'] == 'reference':
                continue
            shapes = [s for s in slide.shapes if s.name == f"PreM:{obj['id']}:{obj['name']}"]
            if len(shapes) != 1:
                raise ValueError('object_missing')
            shape, content = shapes[0], obj['content']
            if content['kind'] == 'text' and shape.text != content['text']:
                raise ValueError('object_text_missing')
            if content['kind'] == 'chart':
                chart = shape.chart
                if [c.label for c in chart.plots[0].categories] != content['categories']:
                    raise ValueError('chart_categories_changed')
                if [list(s.values) for s in chart.series] != [s['values'] for s in content['series']]:
                    raise ValueError('chart_values_changed')
            if content['kind'] == 'image':
                expected = (Path(folder) / f"media-{UUID(content['media_id'])}.png").read_bytes()
                if shape.image.blob != expected:
                    raise ValueError('image_content_changed')
