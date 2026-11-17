#!/usr/bin/env python3
# Purpose: Isolate passive object artwork using PPT Master's native shape metadata.
# Pattern: lxml prunes generated SVG copies; original slide/PPTX bytes stay immutable.
# Usage: Bundled Python after template extraction; Node rasterizes only these owned SVG files.
# Related: presentation-render.py, presentation-previews.mjs, presentations/layers.rs.
from copy import deepcopy
import json
import math
import os
import resource
import threading
import time
from pathlib import Path
import sys
owner=os.getppid()
def watch_parent():
    while True:
        time.sleep(2)
        if os.getppid()!=owner:
            os._exit(1)
threading.Thread(target=watch_parent,daemon=True).start()
resource.setrlimit(resource.RLIMIT_CPU,(60,60))
resource.setrlimit(resource.RLIMIT_FSIZE,(16*1024*1024,)*2)
runtime,folder=map(Path,sys.argv[1:3])
sys.path.insert(0,str(runtime/'python-packages'))
from lxml import etree
specs=json.loads((folder/'specs.json').read_text())
objects=json.loads((folder/'object-map.json').read_text())
files=sorted((folder/'template/svg-flat').glob('slide_*.svg'))
rows=[]
if len(files)!=1 or len(specs)!=1 or len(objects)!=len(specs[0].get('objects',[])):
    (folder/'layers.json').write_text('[]')
    sys.exit(0)
root=etree.parse(str(files[0]),etree.XMLParser(resolve_entities=False,no_network=True,load_dtd=False)).getroot()
view=[float(n) for n in root.get('viewBox','0 0 1280 720').split()]
width,height=view[2:]
name_attr,id_attr='data-pptx-shape-name','data-pptx-shape-id'
selected={str(o['shape_id']):o['name'] for o in objects}
for identity,name in selected.items():
    hits=[n for n in root.iter() if n.get(id_attr)==identity and n.get(name_attr)==name and n.get('data-pptx-shape-scope')=='slide' and not any(a.get(id_attr)==identity and a.get(name_attr)==name for a in n.iterancestors())]
    if len(hits)!=1:
        (folder/'layers.json').write_text('[]')
        sys.exit(0)
background=deepcopy(root)
for node in list(background.iter()):
    if node.get(id_attr) in selected and node.get(name_attr)==selected[node.get(id_attr)]:
        parent=node.getparent()
        if parent is not None:
            parent.remove(node)
(folder/'layer-0.svg').write_bytes(etree.tostring(background))
rows.append({'id':'background','frame':{'x':0,'y':0,'width':100,'height':100,'rotation':0},'file':'layer-0.svg'})
drawables={'path','rect','image','text','circle','ellipse','line','polyline','polygon','use','foreignObject'}
for i,obj in enumerate(objects,1):
    tree=deepcopy(root)
    for node in list(tree.iter()):
        if not isinstance(node.tag,str) or etree.QName(node).localname not in drawables:
            continue
        ancestors=[node,*node.iterancestors()]
        if any(etree.QName(a).localname=='defs' for a in ancestors):
            continue
        keep=any(a.get(id_attr)==str(obj['shape_id']) and a.get(name_attr)==obj['name'] for a in ancestors)
        if not keep and node.getparent() is not None:
            node.getparent().remove(node)
    f=obj['frame']
    angle=math.radians(f.get('rotation',0))
    w,h=f['width']*width/100,f['height']*height/100
    extent_w=abs(w*math.cos(angle))+abs(h*math.sin(angle))
    extent_h=abs(w*math.sin(angle))+abs(h*math.cos(angle))
    cx,cy=(f['x']+f['width']/2)*width/100,(f['y']+f['height']/2)*height/100
    left,top=max(0,cx-extent_w/2-width*.01),max(0,cy-extent_h/2-height*.01)
    right,bottom=min(width,cx+extent_w/2+width*.01),min(height,cy+extent_h/2+height*.01)
    if right<=left or bottom<=top:
        raise ValueError('invalid_layer_bounds')
    tree.set('viewBox',f'{left} {top} {right-left} {bottom-top}')
    tree.set('width',str(right-left));tree.set('height',str(bottom-top))
    filename=f'layer-{i}.svg'
    (folder/filename).write_bytes(etree.tostring(tree))
    rows.append({'id':'object:'+obj['id'],'frame':{'x':left/width*100,'y':top/height*100,'width':(right-left)/width*100,'height':(bottom-top)/height*100,'rotation':0},'file':filename})
(folder/'layers.json').write_text(json.dumps(rows))
