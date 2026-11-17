#!/usr/bin/env python3
# Purpose: Reuse native reference slides/objects through python-pptx's OPC and shape libraries.
# Pattern: Copy bounded part graphs with relationship remapping; never flatten native charts to images.
# Usage: Loaded by presentation-render.py with server-pinned material IDs and owned local inputs.
# Related: presentations/references.rs, reference-materials.py, python-pptx 1.0.2.
from copy import deepcopy
from io import BytesIO
import json
from pathlib import PurePosixPath
from pptx import Presentation
from pptx.oxml.xmlchemy import OxmlElement
from pptx.opc.packuri import PackURI
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.util import Pt
from pptx.parts.image import Image

def validate_native_content(original, copied, visited=None):
    visited = set() if visited is None else visited
    pair = (id(original), id(copied))
    if pair in visited:
        return
    visited.add(pair)
    # Shape text/chart values and binary workbooks must survive OPC remapping unchanged.
    def values(part):
        if not hasattr(part, '_element'):
            return part.blob
        return [(n.tag, n.text) for n in part._element.iter()
                if n.tag.endswith(('}t', '}v', '}f'))]
    if values(original) != values(copied):
        raise ValueError('reference_content_changed')
    old = [r for r in original.rels.values() if not r.is_external and r.reltype.endswith(('/chart', '/package'))]
    new = [r for r in copied.rels.values() if not r.is_external and r.reltype.endswith(('/chart', '/package'))]
    if [(r.reltype, values(r.target_part)) for r in old] != [(r.reltype, values(r.target_part)) for r in new]:
        raise ValueError('reference_chart_changed')
    for a, b in zip(old, new):
        if a.reltype.endswith('/chart'):
            validate_native_content(a.target_part, b.target_part, visited)


def full_reference(spec, refs):
    for obj in spec.get('objects', []):
        entry = refs.get(obj['content'].get('reference_id'))
        f = obj['frame']
        if entry and entry['kind'] in ('slide', 'page') and not f.get('rotation', 0) and (all(f[k] == v for k, v in (('x', 0), ('y', 0), ('width', 100), ('height', 100))) or (spec.get('schema_version')==3 and not spec['block_ids'])):
            return obj, entry
    return None

def picture(slide, file, bounds):
    width, height = Image.from_file(file).size
    if hasattr(file, 'seek'):
        file.seek(0)
    left, top, available_w, available_h = bounds
    scale = min(available_w/width, available_h/height)
    w, h = int(width*scale), int(height*scale)
    return slide.shapes.add_picture(file, left+(available_w-w)//2, top+(available_h-h)//2, w, h)

def apply_references(deck, specs, folder, canonical_slides=False):
    refs = {item['id']: item for item in json.loads((folder / 'references.json').read_text())}
    sources, memo, slide_names = {}, {}, {}
    sizes = [0, 0]
    def copy_part(part):
        if part in memo:
            return memo[part]
        sizes[0] += 1
        sizes[1] += len(part.blob)
        if sizes[0] > 5000 or sizes[1] > 150 * 1024 * 1024:
            raise ValueError('reference_part_limit')
        name = slide_names.get(part) or f'/ppt/prem_refs/{sizes[0]}/{PurePosixPath(str(part.partname)).name}'
        if canonical_slides:
            if part.content_type.endswith('drawingml.chart+xml'):
                name = f'/ppt/charts/chart{sizes[0]}.xml'
            elif part.content_type.startswith('image/'):
                name = f'/ppt/media/image{sizes[0]}{PurePosixPath(str(part.partname)).suffix}'
            elif part.content_type.endswith('spreadsheetml.sheet'):
                name = f'/ppt/embeddings/Microsoft_Excel_Sheet{sizes[0]}.xlsx'
        copied = type(part).load(PackURI(name), part.content_type, deck.part.package, part.blob)
        memo[part] = copied
        ids = {}
        for rel in part.rels.values():
            if rel.is_external:
                if rel.reltype != RT.HYPERLINK or not rel.target_ref.startswith(('https://', 'http://', 'mailto:')):
                    raise ValueError('external_reference_not_supported')
                ids[rel.rId] = copied.relate_to(rel.target_ref, rel.reltype, is_external=True)
            else:
                ids[rel.rId] = copied.relate_to(copy_part(rel.target_part), rel.reltype)
        if hasattr(copied, '_element'):
            remap(copied._element, ids)
        validate_native_content(part, copied)
        return copied
    def remap(element, ids):
        for node in element.iter():
            for attr, value in list(node.attrib.items()):
                if value in ids and 'relationships' in attr:
                    node.set(attr, ids[value])
    def register_masters():
        root = deck.part._element
        masters = root.find('{http://schemas.openxmlformats.org/presentationml/2006/main}sldMasterIdLst')
        if masters is None:
            masters = OxmlElement('p:sldMasterIdLst')
            root.insert(0, masters)
        known = {rel.target_part for rel in deck.part.rels.values() if not rel.is_external and rel.reltype == RT.SLIDE_MASTER}
        for original, copied in list(memo.items()):
            if original.content_type.endswith('slideMaster+xml') and copied not in known:
                identity = OxmlElement('p:sldMasterId')
                identity.set('id', str(max([2147483647] + [int(n.get('id')) for n in masters]) + 1))
                identity.set('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id', deck.part.relate_to(copied, RT.SLIDE_MASTER))
                masters.append(identity)
                known.add(copied)
    def source(entry):
        if entry['source_hash'] not in sources:
            sources[entry['source_hash']] = Presentation(folder / f"ref-{entry['source_hash']}.pptx")
        doc = sources[entry['source_hash']]
        page = entry['source_page']
        if not isinstance(page, int) or not 1 <= page <= len(doc.slides):
            raise ValueError('reference_page_missing')
        return doc, doc.slides[page - 1]
    for index, spec in enumerate(specs):
        whole = full_reference(spec, refs)
        if whole and whole[1]['locator']:
            obj, entry = whole
            doc, original = source(entry)
            if canonical_slides:
                slide_names[original.part] = f"/ppt/slides/slide{index+1}.xml"
            memo.clear()
            part = copy_part(original.part)
            register_masters()
            old = deck.slides._sldIdLst[index]
            old_rid = old.rId
            old.rId = deck.part.relate_to(part, RT.SLIDE)
            deck.part.drop_rel(old_rid)
            # Preserve source slide colors and native objects; fit nonmatching aspect ratios explicitly.
            slide = deck.slides[index]
            f=obj['frame']
            available_w,available_h=deck.slide_width*f['width']/100,deck.slide_height*f['height']/100
            sx = sy = min(available_w / doc.slide_width, available_h / doc.slide_height)
            dx, dy = deck.slide_width*f['x']/100+(available_w-doc.slide_width*sx)/2, deck.slide_height*f['y']/100+(available_h-doc.slide_height*sy)/2
            for shape in slide.shapes:
                shape.left, shape.top = int(shape.left * sx + dx), int(shape.top * sy + dy)
                shape.width, shape.height = int(shape.width * sx), int(shape.height * sy)
            if spec['title'] != entry['title']:
                title = slide.shapes.title
                if title is None:
                    title = slide.shapes.add_textbox(int(deck.slide_width*.05), int(deck.slide_height*.04), int(deck.slide_width*.9), int(deck.slide_height*.12))
                title.text = spec['title']
            if spec['notes']:
                slide.notes_slide.notes_text_frame.text = spec['notes']
            # Metadata/body additions are explicit edits; initial source reuse does not overlay generated text.
            if spec['bullets']:
                text = slide.shapes.add_textbox(int(deck.slide_width*.05), int(deck.slide_height*.7), int(deck.slide_width*.9), int(deck.slide_height*.25))
                text.text = '\n'.join(spec['bullets'])
                text.text_frame.word_wrap = True
                for paragraph in text.text_frame.paragraphs:
                    paragraph.font.size = Pt(18)
                    paragraph.line_spacing = 1.35
                    paragraph.space_before = paragraph.space_after = Pt(0)
        else:
            slide = deck.slides[index]
        for obj in spec.get('objects', []):
            if obj['content']['kind'] != 'reference' or (whole and obj is whole[0] and whole[1]['locator']):
                continue
            entry = refs.get(obj['content']['reference_id'])
            if not entry:
                raise ValueError('unregistered_reference')
            f = obj['frame']
            bounds = tuple(int(value / 100 * size) for value, size in zip((f['x'], f['y'], f['width'], f['height']), (deck.slide_width, deck.slide_height, deck.slide_width, deck.slide_height)))
            if whole and obj is whole[0]:
                for shape in list(slide.shapes):
                    slide.shapes._spTree.remove(shape._element)
            if entry['locator']:
                doc, original = source(entry)
                ids = entry['locator']['shape_ids']
                def walk(shapes):
                    for shape in shapes:
                        yield shape
                        if hasattr(shape, 'shapes'):
                            yield from walk(shape.shapes)
                selected = list(original.shapes) if entry['kind'] == 'slide' else [shape for shape in walk(original.shapes) if str(shape.shape_id) in ids]
                if not selected and entry['locator'].get('image_part'):
                    image = next(p for p in doc.part.package.iter_parts() if str(p.partname).lstrip('/') == entry['locator']['image_part'])
                    shape = picture(slide, BytesIO(image.blob), bounds)
                else:
                    if not selected:
                        raise ValueError('reference_shape_missing')
                    group = slide.shapes.add_group_shape()
                    memo.clear()
                    rels = {}
                    for rel in original.part.rels.values():
                        if rel.is_external:
                            continue
                        if rel.reltype in (RT.SLIDE_LAYOUT, RT.NOTES_SLIDE, RT.SLIDE):
                            continue
                        rels[rel.rId] = slide.part.relate_to(copy_part(rel.target_part), rel.reltype)
                    next_id = max([1] + [int(n.get('id')) for n in slide.shapes._spTree.iter() if n.tag.endswith('}cNvPr')])
                    for selected_shape in selected:
                        element = deepcopy(selected_shape._element)
                        shape_ids = {}
                        for props in element.iter():
                            if props.tag.endswith('}cNvPr'):
                                next_id += 1
                                shape_ids[props.get('id')] = str(next_id)
                                props.set('id', str(next_id))
                        for connector in element.iter():
                            if connector.tag.endswith(('}stCxn', '}endCxn')) and connector.get('id') in shape_ids:
                                connector.set('id', shape_ids[connector.get('id')])
                        remap(element, rels)
                        group.shapes._spTree.insert_element_before(element, 'p:extLst')
                    group.shapes._recalculate_extents()
                    left, top, width, height = bounds
                    scale = min(width/max(1,group.width), height/max(1,group.height))
                    fw, fh = int(group.width*scale), int(group.height*scale)
                    group.left, group.top, group.width, group.height = left+(width-fw)//2, top+(height-fh)//2, fw, fh
                    shape = group
            elif entry['kind'] in ('text', 'table'):
                shape = slide.shapes.add_textbox(*bounds)
                shape.text = (entry.get('text') or '')[:4000]
                shape.text_frame.word_wrap = True
                for paragraph in shape.text_frame.paragraphs:
                    paragraph.font.size = Pt(18)
            else:
                shape = picture(slide, str(folder / f"ref-{entry['id']}.png"), bounds)
            shape.name = f"PreM:{obj['id']}:{obj['name']}"
            shape.rotation = f.get('rotation', 0)
    return refs
