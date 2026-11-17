#!/usr/bin/env python3
# Purpose: Inspect real-model generated PPTX files for native editability and template preservation.
# Pattern: Read-only package/XML inspection; model output and public sources stay in QA storage.
# Usage: Bundled Python with PYTHONPATH=runtime/python-packages, script template.pptx output-directory.
# Related: e2e/presentation-live.cjs, fixtures/presentation-public.json.
import json
import sys
import zipfile
from pathlib import Path
from pptx import Presentation
from lxml import etree
from pptx.opc.constants import RELATIONSHIP_TYPE as RT

source, folder = map(Path, sys.argv[1:])
report = {}
def canonical(xml):
    parser = etree.XMLParser(resolve_entities=False, no_network=True, remove_blank_text=True)
    root = etree.fromstring(xml, parser)
    for node in root.iter():
        for key in list(node.attrib):
            if key.startswith('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'):
                node.set(key, 'REL')
    return etree.tostring(root, method='c14n', exclusive=True)
def related(part, kind):
    return {canonical(r.target_part.blob) if kind == RT.THEME else r.target_part.blob
            for r in part.rels.values() if not r.is_external and r.reltype == kind}
original = Presentation(source)
masters = {canonical(m.part.blob): m for m in original.slide_masters}
for label in ['basic', 'template', 'edited']:
    file = folder / f'{label}.pptx'
    deck = Presentation(file)
    texts = [[s.text for s in slide.shapes if s.has_text_frame and s.text.strip()] for slide in deck.slides]
    assert all(texts), f'{label}: editable text missing'
    with zipfile.ZipFile(file) as generated:
        if label != 'basic':
            # Assembly remaps OPC filenames; follow the master actually used by each slide.
            for slide in deck.slides:
                master = slide.slide_layout.slide_master
                expected = masters.get(canonical(master.part.blob))
                assert expected is not None, f'{label}: changed native master'
                assert canonical(slide.slide_layout.part.blob) in {
                    canonical(layout.part.blob) for layout in expected.slide_layouts
                }, f'{label}: changed native layout'
                for kind in [RT.THEME, RT.IMAGE]:
                    assert related(master.part, kind) == related(expected.part, kind), f'{label}: changed theme/artwork'
        for name in generated.namelist():
            if name.endswith('.xml'):
                etree.fromstring(generated.read(name), etree.XMLParser(resolve_entities=False, no_network=True))
    report[label] = {'slides': len(deck.slides), 'editable_texts': texts,
                     'size': [deck.slide_width, deck.slide_height], 'template_parts_preserved': label != 'basic'}
assert '접근성 실무 안내' in report['edited']['editable_texts'][0]
assert report['template']['editable_texts'][1:] == report['edited']['editable_texts'][1:]
(folder / 'native-inspection.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print('PASS: editable native text, template master/theme XML, unchanged non-target slides and valid OOXML')
