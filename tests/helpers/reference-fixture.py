# /// script
# requires-python = ">=3.13"
# dependencies = ["python-pptx==1.0.2", "pillow==13.0.0"]
# ///
# Purpose: Add an editable grouped diagram and nested image to a synthetic reference fixture.
# Pattern: Development-only python-pptx generator; original fixture stays untouched.
# Usage: uv run tests/helpers/reference-fixture.py.
# Related: tests/fixtures/documents/reference-materials.pptx, backend/tests/reference_materials.rs.
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
from PIL import Image
from pptx import Presentation
from pptx.util import Inches
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE
root = Path(__file__).resolve().parents[1] / 'fixtures/documents'
prs = Presentation(root / 'native-template.pptx')
group = prs.slides[1].shapes.add_group_shape()
group.name = 'Delivery flow'
for index, label in enumerate(['Review', 'Approve']):
    shape = group.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGLE, Inches(1+2*index), Inches(5), Inches(1.5), Inches(.7))
    shape.text = label
picture = group.shapes.add_picture(str(root/'scan.png'), Inches(5), Inches(5), height=Inches(1))
picture.name = 'Group reference image'
buffer = BytesIO(); prs.save(buffer)
with ZipFile(buffer) as archive:
    entries = {entry.filename: archive.read(entry.filename) for entry in archive.infolist()}
ns = {'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
slide = ET.fromstring(entries['ppt/slides/slide1.xml'])
common = slide.find('p:cSld',ns)
background = ET.fromstring('<p:bg xmlns:p="'+ns['p']+'" xmlns:a="'+ns['a']+'" xmlns:r="'+ns['r']+'"><p:bgPr><a:blipFill><a:blip r:embed="rIdBackground"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>')
common.insert(0,background)
entries['ppt/slides/slide1.xml'] = ET.tostring(slide)
relationships = ET.fromstring(entries['ppt/slides/_rels/slide1.xml.rels'])
ET.SubElement(relationships,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',{'Id':'rIdBackground','Type':ns['r']+'/image','Target':'../media/reference-background.png'})
entries['ppt/slides/_rels/slide1.xml.rels'] = ET.tostring(relationships)
pixels = BytesIO(); Image.new('RGB',(120,80),'#e5eee8').save(pixels,format='PNG')
entries['ppt/media/reference-background.png'] = pixels.getvalue()
with ZipFile(root / 'reference-materials.pptx','w',ZIP_DEFLATED) as archive:
    for name,content in entries.items(): archive.writestr(name,content)
print('Synthetic reusable reference fixture generated')
