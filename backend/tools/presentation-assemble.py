#!/usr/bin/env python3
# Purpose: Assemble previously validated single-slide PPTX parts without rerendering their artwork.
# Pattern: Existing bounded OPC reference copier preserves native chart workbooks and source themes.
# Usage: Bundled Python receives runtime root and an owned workspace with parts.json.
# Related: presentation-references.py, processes/presentation_assembly.rs, presentations/quality.rs.
import importlib.util
import json
import os
from pathlib import Path
import resource
import sys
import threading
import time

runtime, folder = map(Path, sys.argv[1:3])
sys.path.insert(0, str(runtime / 'python-packages'))
from pptx import Presentation
owner = os.getppid()
def watch_parent():
    while True:
        time.sleep(2)
        if os.getppid() != owner:
            os._exit(1)
threading.Thread(target=watch_parent, daemon=True).start()
resource.setrlimit(resource.RLIMIT_CPU, (150, 150))
resource.setrlimit(resource.RLIMIT_FSIZE, (50*1024*1024,)*2)
parts = json.loads((folder / 'parts.json').read_text())
if not 1 <= len(parts) <= 24:
    raise ValueError('slide_limit')
spec = importlib.util.spec_from_file_location('references', runtime / 'presentation-references.py')
refs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refs)
first = Presentation(folder / f'ref-{parts[0]}.pptx')
deck = Presentation()
deck.slide_width, deck.slide_height = first.slide_width, first.slide_height
entries, specs, expected = [], [], []
for i, part in enumerate(parts):
    source = Presentation(folder / f'ref-{part}.pptx')
    if len(source.slides) != 1 or (source.slide_width, source.slide_height) != (deck.slide_width, deck.slide_height):
        raise ValueError('invalid_slide_part')
    expected.append(source.slides[0].part)
    deck.slides.add_slide(deck.slide_layouts[6])
    entries.append({'id':str(i),'title':'','kind':'slide','source_hash':part,'source_page':1,'locator':{'shape_ids':[]}})
    specs.append({'title':'','bullets':[],'notes':'','objects':[{'id':str(i),'name':'','frame':{'x':0,'y':0,'width':100,'height':100},'content':{'kind':'reference','reference_id':str(i)}}]})
(folder / 'references.json').write_text(json.dumps(entries))
refs.apply_references(deck, specs, folder, canonical_slides=True)
deck.save(folder / 'output.pptx')
result = Presentation(folder / 'output.pptx')
if len(result.slides) != len(parts):
    raise ValueError('assembly_count_changed')
for original, slide in zip(expected, result.slides):
    refs.validate_native_content(original, slide.part)
