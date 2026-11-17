#!/usr/bin/env python3
# Purpose: Read real template layouts and build empty or authored native slide canvases.
# Pattern: Pinned python-pptx preserves template masters/backgrounds; no model or package downloads.
# Usage: catalog CLI for layout choices; render() is called by presentation-render.py.
# Related: presentations/canvas.rs, presentation-render.py, V30 manual designs.
import json
from pathlib import Path
import sys
from pptx import Presentation
from pptx.enum.shapes import PP_PLACEHOLDER
from pptx.util import Pt

ROLES = {PP_PLACEHOLDER.TITLE:'title', PP_PLACEHOLDER.CENTER_TITLE:'title',
         PP_PLACEHOLDER.BODY:'body', PP_PLACEHOLDER.SUBTITLE:'body', PP_PLACEHOLDER.OBJECT:'body',
         PP_PLACEHOLDER.PICTURE:'image', PP_PLACEHOLDER.CHART:'chart', PP_PLACEHOLDER.TABLE:'table'}

def font_pixels(placeholder,master,role):
    if placeholder.has_text_frame:
        for paragraph in placeholder.text_frame.paragraphs:
            if paragraph.font.size:
                return paragraph.font.size.pt*4/3
            for run in paragraph.runs:
                if run.font.size:
                    return run.font.size.pt*4/3
    raw=placeholder._element.xpath('.//a:defRPr[@sz] | .//a:rPr[@sz]')
    if not raw:
        style='titleStyle' if role=='title' else 'bodyStyle'
        raw=master._element.xpath(f'.//p:txStyles/p:{style}/a:lvl1pPr/a:defRPr[@sz]')
    return int(raw[0].get('sz'))/100*4/3 if raw else (32 if role=='title' else 18)*4/3


def catalog(source):
    if source is None:
        frame = lambda x,y,w,h: {'x':x,'y':y,'width':w,'height':h,'rotation':0}
        return [{'key':'blank','name':'빈 장표','slots':[],'preview_page':None},
                {'key':'title-body','name':'제목과 본문','slots':[{'id':'slot-0','role':'title','max_chars':60,'font_size':32,'frame':frame(5,8,90,15)}, {'id':'slot-1','role':'body','max_chars':450,'font_size':24,'frame':frame(5,28,90,60)}],'preview_page':None}]
    deck = Presentation(source)
    rows = []
    for m, master in enumerate(deck.slide_masters):
        for n, layout in enumerate(master.slide_layouts):
            slots=[]
            for p in layout.placeholders:
                role=ROLES.get(p.placeholder_format.type)
                if not role:
                    continue
                f={'x':p.left/deck.slide_width*100,'y':p.top/deck.slide_height*100,
                   'width':p.width/deck.slide_width*100,'height':p.height/deck.slide_height*100,'rotation':p.rotation}
                if f['x']<0 or f['y']<0 or f['width']<1 or f['height']<1 or f['x']+f['width']>100.01 or f['y']+f['height']>100.01:
                    continue
                pixels=(p.width/9525,p.height/9525)
                font=font_pixels(p,master,role)
                text_chars=max(1,int(pixels[0]/font)*int(pixels[1]/(font*1.35)))
                slots.append({'id':f'slot-{p.placeholder_format.idx}','role':role,'max_chars':min(60 if role=='title' else 450,text_chars),'font_size':font,'frame':f})
            page=next((i+1 for i,s in enumerate(deck.slides) if s.slide_layout.part is layout.part),None)
            rows.append({'key':f'{m}:{n}','name':(layout.name or f'레이아웃 {len(rows)+1}')[:120],'slots':slots,'preview_page':page})
            if len(rows)>128:
                raise ValueError('layout_limit')
    return rows

def render(spec, folder, objects, quality, options):
    source=folder/'template.pptx'
    deck=Presentation(source) if source.exists() else Presentation()
    key=spec['design']['layout_key']
    selected=next((row for row in catalog(source if source.exists() else None) if row['key']==key),None)
    if selected is None:
        raise ValueError('unknown_template_layout')
    if source.exists():
        allowed={r['key'] for r in catalog(source)}
        if key not in allowed:
            raise ValueError('unknown_template_layout')
        master,layout=map(int,key.split(':'))
        layout=deck.slide_masters[master].slide_layouts[layout]
    else:
        if key not in ('blank','title-body'):
            raise ValueError('unknown_template_layout')
        layout=deck.slide_layouts[6 if key=='blank' else 1]
        deck.slide_width,deck.slide_height=12192000,6858000
    for slide_id in list(deck.slides._sldIdLst):
        deck.part.drop_rel(slide_id.rId)
        deck.slides._sldIdLst.remove(slide_id)
    slide=deck.slides.add_slide(layout)
    for p in slide.placeholders:
        if p.has_text_frame:
            p.text_frame.clear()
    def text_shape(role, content, default):
        kinds={PP_PLACEHOLDER.TITLE,PP_PLACEHOLDER.CENTER_TITLE} if role=='title' else {PP_PLACEHOLDER.BODY,PP_PLACEHOLDER.OBJECT,PP_PLACEHOLDER.SUBTITLE}
        shape=next((p for p in slide.placeholders if p.placeholder_format.type in kinds and p.has_text_frame),None)
        if shape is None:
            shape=slide.shapes.add_textbox(*objects.box(default,deck))
        if spec.get('layout'):
            objects.place(shape,spec['layout'][role],deck)
        shape.text_frame.clear()
        shape.text_frame.word_wrap=True
        for i,text in enumerate(content):
            p=shape.text_frame.paragraphs[0] if i==0 else shape.text_frame.add_paragraph()
            p.text=text
            p.line_spacing=1.35
            p.space_before=p.space_after=Pt(0)
        return shape
    title=text_shape('title',[spec['title']],{'x':5,'y':8,'width':90,'height':15}) if spec['title'] else None
    body=text_shape('body',spec['bullets'],{'x':5,'y':28,'width':90,'height':60}) if spec['bullets'] else None
    def usable(shape):
        if shape is None:
            return 1280,720
        t=shape.text_frame
        return (max(1,shape.width-t.margin_left-t.margin_right)/9525,max(1,shape.height-t.margin_top-t.margin_bottom)/9525)
    preferred={role:next((s['font_size'] for s in selected['slots'] if s['role']==role),fallback) for role,fallback in [('title',32),('body',24)]}
    sizes,attempts,issues=quality.typography(spec,options['repair'],*usable(title),*usable(body),options.get('typography') or preferred)
    for shape,role in [(title,'title'),(body,'body')]:
        if shape is not None:
            for paragraph in shape.text_frame.paragraphs:
                paragraph.font.size=Pt(sizes[role]*.75)
    if spec['notes']:
        slide.notes_slide.notes_text_frame.text=spec['notes']
    deck.save(folder/'output.pptx')
    return sizes,attempts,issues

if __name__=='__main__':
    import os,resource,threading,time
    owner=os.getppid()
    def watch_parent():
        while True:
            time.sleep(2)
            if os.getppid()!=owner:
                os._exit(1)
    threading.Thread(target=watch_parent,daemon=True).start()
    resource.setrlimit(resource.RLIMIT_CPU,(60,60))
    resource.setrlimit(resource.RLIMIT_FSIZE,(8*1024*1024,)*2)
    runtime,folder=map(Path,sys.argv[1:3])
    source=folder/'template.pptx'
    (folder/'layouts.json').write_text(json.dumps(catalog(source if source.exists() else None),ensure_ascii=False))
