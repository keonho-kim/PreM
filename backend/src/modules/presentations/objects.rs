// Purpose: Define bounded native slide objects and placement independently from app chrome.
// Pattern: Versioned typed data; no URLs, executable markup or filesystem paths in model output.
// Usage: SlideSpec v2, proposal validation and the native PPTX renderer.
// Related: editing/request.rs, media.rs, backend/tools/presentation-objects.py.
use super::Error;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub rotation: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Layout {
    pub title: Frame,
    pub body: Frame,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct SlideObject {
    pub id: String,
    pub name: String,
    pub frame: Frame,
    pub content: ObjectContent,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ObjectContent {
    Text {
        text: String,
        font_size: f64,
        color: String,
    },
    Shape {
        shape: String,
        fill: String,
    },
    Image {
        media_id: Uuid,
    },
    Reference {
        reference_id: Uuid,
    },
    Chart {
        chart_type: String,
        title: String,
        categories: Vec<String>,
        series: Vec<Series>,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Series {
    pub name: String,
    pub values: Vec<f64>,
}
impl Frame {
    pub fn validate(&self) -> Result<(), Error> {
        if [self.x, self.y, self.width, self.height, self.rotation]
            .iter()
            .any(|x| !x.is_finite())
            || self.x < 0.
            || self.y < 0.
            || self.width < 1.
            || self.height < 1.
            || self.x + self.width > 100.
            || self.y + self.height > 100.
            || self.rotation.abs() > 180.
        {
            return Err(Error::EditInvalid);
        }
        Ok(())
    }
}
fn color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
}
fn text(s: &str, limit: usize) -> bool {
    !s.trim().is_empty()
        && s.chars().count() <= limit
        && !s.chars().any(|c| c.is_control() && c != '\n' && c != '\t')
}
pub(super) fn validate(objects: &[SlideObject], layout: &Option<Layout>) -> Result<(), Error> {
    if objects.len() > 20 {
        return Err(Error::EditInvalid);
    }
    if let Some(l) = layout {
        l.title.validate()?;
        l.body.validate()?;
    }
    let mut ids = std::collections::HashSet::new();
    for o in objects {
        o.frame.validate()?;
        if !ids.insert(&o.id)
            || o.id.is_empty()
            || o.id.len() > 64
            || !o
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || !text(&o.name, 60)
        {
            return Err(Error::EditInvalid);
        }
        let valid = match &o.content {
            ObjectContent::Reference { .. } => true,
            ObjectContent::Text {
                text: t,
                font_size,
                color: c,
            } => {
                text(t, 1000)
                    && font_size.is_finite()
                    && (8. ..=72.).contains(font_size)
                    && color(c)
            }
            ObjectContent::Shape { shape, fill } => {
                ["rectangle", "ellipse"].contains(&shape.as_str()) && color(fill)
            }
            ObjectContent::Image { .. } => true,
            ObjectContent::Chart {
                chart_type,
                title,
                categories,
                series,
            } => {
                ["column", "bar", "line", "pie"].contains(&chart_type.as_str())
                    && text(title, 80)
                    && (1..=20).contains(&categories.len())
                    && categories.iter().all(|v| text(v, 40))
                    && categories
                        .iter()
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        == categories.len()
                    && series
                        .iter()
                        .map(|s| &s.name)
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        == series.len()
                    && (1..=4).contains(&series.len())
                    && series.iter().all(|s| {
                        text(&s.name, 40)
                            && s.values.len() == categories.len()
                            && s.values.iter().all(|v| v.is_finite() && v.abs() <= 1e12)
                    })
                    && (chart_type != "pie"
                        || (series.len() == 1
                            && series[0].values.iter().all(|v| *v >= 0.)
                            && series[0].values.iter().any(|v| *v > 0.)))
            }
        };
        if !valid {
            return Err(Error::EditInvalid);
        }
    }
    Ok(())
}
