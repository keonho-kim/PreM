#!/usr/bin/env python3
# Purpose: Bound generated typography and inspect slide geometry without changing source content.
# Pattern: Conservative deterministic estimates plus native shape checks, not a visual-model verdict.
# Usage: Imported by the native renderer; reports are persisted before a failed candidate exits.
# Related: presentation-render.py, presentation-objects.py, presentations/quality.rs.
import math
from pptx.enum.shapes import MSO_SHAPE_TYPE


def issue(code, severity='error'):
    return {'code': code, 'severity': severity}


def line_count(text, size, width):
    capacity = max(1, width / max(1, size))
    return sum(max(1, math.ceil(sum(1 if ord(c) > 255 else .55 for c in line) / capacity))
               for line in text.split('\n'))


def typography(spec, allow_repair, title_width, title_height, body_width, body_height, baseline=None):
    # All dimensions are SVG pixels. These are explicit bounds, not system-font measurements.
    def fits(size, texts, width, height):
        return max([0]+[line_count(text, size, width) for text in texts]) * len(texts) * size * 1.35 <= height
    attempts, result, issues = 0, {}, []
    for key, texts, width, height, preferred, minimum in (
        ('title', [spec['title']], title_width, title_height, 32, 22),
        ('body', ['• ' + b for b in spec['bullets']], body_width, body_height, 24, 14),
    ):
        preferred = (baseline or {}).get(key, preferred)
        size = preferred
        for attempt in range(3):
            attempts = max(attempts, attempt)
            if fits(size, texts, width, height):
                attempts = max(attempts, attempt)
                break
            if not allow_repair or attempt == 2:
                issues.append(issue('text_overflow'))
                break
            size = max(minimum, preferred * (.82 if attempt == 0 else .64))
        result[key] = size
    return result, attempts, issues


def overlap(a, b):
    return max(0, min(a['x']+a['width'], b['x']+b['width'])-max(a['x'], b['x'])) * max(
        0, min(a['y']+a['height'], b['y']+b['height'])-max(a['y'], b['y']))


def full_reference(spec, refs):
    return any(o['content']['kind'] == 'reference'
               and ((o['frame']['width']==100 and o['frame']['height']==100 and o['frame']['x']==0 and o['frame']['y']==0) or (spec.get('schema_version')==3 and not spec['block_ids']))
               and not o['frame'].get('rotation',0)
               and refs.get(o['content']['reference_id'],{}).get('kind') in ('slide','page')
               for o in spec.get('objects',[]))


def inspect(deck, specs, refs):
    problems = []
    for slide, spec in zip(deck.slides, specs):
        full = full_reference(spec, refs)
        has_source = any(o['content']['kind']=='reference' and o['content']['reference_id'] in refs for o in spec.get('objects', []))
        if not spec['block_ids'] and not has_source and not spec.get('design',{}).get('authored',False):
            problems.append(issue('evidence_missing'))
        if full and spec['bullets']:
            height = sum(line_count(b, 24, deck.slide_width/9525*.9)*24*1.35 for b in spec['bullets'])
            if height > deck.slide_height/9525*.25:
                problems.append(issue('text_overflow'))
        objects = spec.get('objects', [])
        # Overlapping source art and backgrounds can be deliberate. Report rather than move them.
        for i, obj in enumerate(objects):
            for other in objects[i+1:]:
                a, b = obj['frame'], other['frame']
                if overlap(a, b) > .2 * min(a['width']*a['height'], b['width']*b['height']):
                    problems.append(issue('object_overlap', 'warning'))
        for obj in objects:
            if obj['content']['kind'] == 'text':
                f, c = obj['frame'], obj['content']
                if line_count(c['text'], c['font_size']*4/3, f['width']*deck.slide_width/952500) * c['font_size']*1.8 > f['height']*deck.slide_height/952500:
                    problems.append(issue('text_overflow'))
        if not full:
            layout = spec.get('layout') or {'title':{'x':5,'y':83/7.2,'width':85,'height':12}, 'body':{'x':5.625,'y':30,'width':85,'height':56}}
            if overlap(layout['title'], layout['body']) > 1:
                problems.append(issue('text_overlap'))
            for obj in objects:
                if obj['content']['kind'] != 'shape' and overlap(obj['frame'], layout['body']) > 20:
                    problems.append(issue('content_overlap', 'warning'))
        for shape in slide.shapes:
            if full and not shape.name.startswith('PreM:'):
                continue  # Imported artwork is immutable; its typography belongs to its source.
            if shape.name.startswith('PreM:') and (
                shape.left < -12700 or shape.top < -12700
                or shape.left+shape.width > deck.slide_width+12700
                or shape.top+shape.height > deck.slide_height+12700
            ):
                problems.append(issue('outside_slide'))
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                w, h = shape.image.size
                if abs(shape.width/max(1,shape.height)/(w/max(1,h))-1) > .03:
                    problems.append(issue('image_distorted'))
    # Reports contain only fixed codes, never source text or arbitrary exceptions.
    return [dict(t) for t in dict.fromkeys(tuple(i.items()) for i in problems)][:64]
