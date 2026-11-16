#!/usr/bin/env python3
# Purpose: Catalog source slide/shape identities without converting references into templates.
# Pattern: PPT Master supplies ordered slide parts, XML readers and original media mappings.
# Usage: Run after native import in the same bounded workspace; writes materials.json only.
# Related: template-extract.py, reference-previews.mjs, modules/documents/materials.rs.
import json
import hashlib
import os
import threading
import time
from pathlib import Path
import resource
import sys
import zipfile
runtime, source, output = map(Path, sys.argv[1:4])
owner = os.getppid()
def watch_parent():
    while True:
        time.sleep(2)
        if os.getppid() != owner:
            os._exit(1)
threading.Thread(target=watch_parent, daemon=True).start()
resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024,) * 2)
sys.path.insert(0, str(runtime / 'ppt-master/source/skills/ppt-master/scripts'))
from template_import.manifest import NS, load_xml_from_zip, parse_relationships, extract_image_targets

manifest = json.loads((output / 'template/analysis/manifest.json').read_text())
image_map = manifest['images']['imageMap']
items = []

def box(shape):
    for query in ('p:spPr/a:xfrm', 'p:grpSpPr/a:xfrm', 'p:xfrm'):
        node = shape.find(query, NS)
        if node is None:
            continue
        off, ext = node.find('a:off', NS), node.find('a:ext', NS)
        if off is not None and ext is not None and not node.get('rot'):
            return [int(off.get('x', 0))/914400*96, int(off.get('y', 0))/914400*96,
                    int(ext.get('cx', 0))/914400*96, int(ext.get('cy', 0))/914400*96]
    return None

with zipfile.ZipFile(source) as archive:
    for slide in manifest['slides']:
        number, part = slide['index'], slide['slidePath']
        if part not in archive.namelist() or not part.startswith('ppt/slides/'):
            raise ValueError('invalid_slide_part')
        root = load_xml_from_zip(archive, part)
        tree = root.find('p:cSld/p:spTree', NS)
        if tree is None:
            raise ValueError('missing_slide_tree')
        def add(kind, key, title, ids, bounds=None, image=None):
            asset = image_map.get(image) if image else None
            if asset and not asset.startswith('images/'):
                asset = 'images/' + asset
            items.append({'key':key, 'source_page':number, 'kind':kind, 'title':title[:200],
                'locator':{'slide_part':part, 'shape_ids':ids, 'image_part':image, 'image_asset':asset},
                'preview':None, 'preview_scope':'none', 'bbox':bounds})
        add('slide', f'slide:{number}', f'슬라이드 {number}', [])
        rels = parse_relationships(archive, part)
        for shape in tree:
            tag = shape.tag.rsplit('}', 1)[-1]
            nv = shape.find('.//p:cNvPr', NS)
            if nv is None:
                continue
            identity = nv.get('id')
            if not identity or not identity.isdigit():
                raise ValueError('invalid_shape_id')
            kind = None
            if tag == 'pic': kind = 'image'
            elif tag == 'grpSp': kind = 'diagram'
            elif tag == 'graphicFrame':
                tags = {node.tag.rsplit('}',1)[-1] for node in shape.iter()}
                if tags.intersection({'chart', 'chartEx'}): kind = 'chart'
                elif 'tbl' in tags: kind = 'table'
                elif 'relIds' in tags: kind = 'diagram'
            elif tag == 'cxnSp': kind = 'diagram'
            elif tag == 'sp':
                textbox = shape.find('p:nvSpPr/p:cNvSpPr', NS)
                if shape.find('p:nvSpPr/p:nvPr/p:ph', NS) is None and (textbox is None or textbox.get('txBox') not in ('1','true')):
                    kind = 'diagram'
            if not kind:
                continue
            images = extract_image_targets(shape, rels) if kind == 'image' else []
            image = images[0] if images and images[0] in archive.namelist() else None
            add(kind, f'shape:{number}:{identity}', nv.get('name') or f'{kind} {identity}', [identity], box(shape), image)
            # A grouped diagram remains intact; its pictures are also independently reusable.
            if tag == 'grpSp':
                for picture in shape.findall('.//p:pic', NS):
                    props = picture.find('p:nvPicPr/p:cNvPr', NS)
                    if props is None: continue
                    targets = extract_image_targets(picture, rels)
                    target = targets[0] if targets and targets[0] in archive.namelist() else None
                    add('image', f'shape:{number}:{props.get("id")}', props.get('name') or '그룹 이미지', [props.get('id')], None, target)
        # Backgrounds and inherited layout/master pictures are usable images as well.
        assets = set(slide.get('imageAssets', []))
        if slide.get('backgroundAsset'): assets.add(slide['backgroundAsset'])
        if slide.get('showInheritedShapes', True):
            layout = next((p for p in manifest.get('layouts', []) if p['path'] == slide.get('layoutPath')), {})
            master = next((p for p in manifest.get('masters', []) if p['path'] == slide.get('masterPath')), {})
            for layer in (layout, master if layout.get('showMasterShapes', True) else {}):
                assets.update(layer.get('imageAssets', []))
                if layer.get('backgroundAsset'): assets.add(layer['backgroundAsset'])
        known = {m['locator']['image_part'] for m in items if m['source_page'] == number}
        for media, asset in image_map.items():
            if asset in assets and media not in known and media in archive.namelist():
                key = hashlib.sha256(media.encode()).hexdigest()[:16]
                add('image', f'media:{number}:{key}', Path(media).name, [], None, media)
        if len(items) > 10000: raise ValueError('material_limit')
(output / 'materials.json').write_text(json.dumps({'slide_size':manifest['slideSize'], 'items':items}, ensure_ascii=False))
