// Purpose: Copy the source contents hierarchy in reading order with original row identities.
// Pattern: Isolate one contents run; child rows never compete for chapter membership.
// Usage: Physical-page alignment and the source outline returned in the document detail.
// Related: structure.rs, anchors.rs, document_source_entries.
use super::*;
use structure::{contents_label, leader, major, numbered, title_number};
fn row(text: &str, b: &Block, line: usize, allow_compact: bool) -> Entry {
    let (title, printed) = if allow_compact || leader(text) {
        title_number(text)
    } else {
        (text, None)
    };
    Entry {
        title: title.to_owned(),
        printed,
        block: b.id,
        line: line as i64,
        children: vec![],
    }
}
fn continues_siblings(children: &[Entry], text: &str) -> bool {
    let Some((n, style)) = structure::number_marker(text) else {
        return false;
    };
    children
        .last()
        .and_then(|e| structure::number_marker(&e.title))
        .map_or(n == 1, |(prior, s)| style == s && n == prior + 1)
}
fn body_outline(pages: &[SourcePage]) -> Vec<Entry> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut last = None;
    for p in pages {
        for b in &p.blocks {
            // Banners may be extracted as single-row tables. Do not read embedded
            // outlines or multi-row tables as sequences of chapter openings.
            let text = b.text.trim();
            if b.position == 0
                && ["【별지", "[별지", "[별첨"]
                    .iter()
                    .any(|prefix| text.starts_with(prefix))
            {
                return if entries.len() >= 2 { entries } else { vec![] };
            }
            if text.contains('\n') {
                continue;
            }
            if let Some((n, _)) = major(text)
                && n == entries.len() + 1
                && last != Some(p.id)
                && (b.kind == "heading" || b.kind == "table" || b.position <= 1)
            {
                let mut e = row(text, b, 0, false);
                if b.kind == "table" {
                    e.title = text
                        .split('|')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join(" ");
                }
                entries.push(e);
                last = Some(p.id);
            } else if let Some(parent) = entries.last_mut()
                && numbered(text)
                && text.chars().count() < 70
                && matches!(b.kind.as_str(), "heading" | "list")
                && !text.contains(':')
            {
                // A restarted list in the body (e.g. required attachments) is not
                // another run of peer headings. Keep the established numbering style.
                if continues_siblings(&parent.children, text) {
                    parent.children.push(row(text, b, 0, false));
                }
            }
        }
    }
    if entries.len() < 2 {
        entries.clear()
    }
    entries
}
pub(super) async fn entries(
    s: &mut Session<'_>,
    pages: &[SourcePage],
) -> Result<Vec<Entry>, Error> {
    let own = |p: &SourcePage| p.blocks.iter().any(|b| b.is_table_of_contents == Some(1));
    let labelled = |p: &SourcePage| p.blocks.iter().take(3).any(|b| contents_label(&b.text));
    let start = pages
        .iter()
        .position(|p| own(p) && labelled(p))
        .or_else(|| pages.iter().position(own));
    let Some(start) = start else {
        return Ok(body_outline(pages));
    };
    let mut lines = Vec::new();
    for p in pages[start..].iter().take_while(|p| own(p)) {
        for b in &p.blocks {
            if b.is_table_of_contents != Some(1) {
                continue;
            }
            for (n, text) in b.text.lines().enumerate() {
                let text = text.trim();
                if !text.is_empty() && !contents_label(text) && text.chars().count() <= 200 {
                    lines.push((text, b, n));
                }
            }
        }
    }
    let explicit = lines.iter().any(|(t, _, _)| major(t).is_some());
    let mut roots: Vec<Entry> = Vec::new();
    for (index, (text, b, line)) in lines.iter().enumerate() {
        let item = row(text, b, *line, false);
        if explicit {
            if major(text).is_some() {
                roots.push(item)
            } else if let Some(parent) = roots.last_mut()
                && (numbered(text) || leader(text))
            {
                parent.children.push(item);
            }
        } else if leader(text) || numbered(text) {
            // A decimal subsection belongs to the immediately preceding numbered chapter.
            let dotted = text
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_end_matches('.');
            if dotted.split('.').count() > 1
                && dotted.split('.').all(|v| v.parse::<u32>().is_ok())
                && let Some(parent) = roots.last_mut()
            {
                parent.children.push(item);
            } else {
                roots.push(item);
            }
        } else {
            // Some PDFs erase leaders and whitespace. Ask about this original row only.
            let batch = Batch {
                state: json!({"lines":[text]}),
                questions: BTreeMap::from([(
                    "r0".into(),
                    question(
                        prompts::TOP,
                        choices(&[
                            "제외",
                            "대목차와 시작 쪽수",
                            "쪽수 없는 대목차",
                            "직전 대목차의 중목차",
                        ]),
                    ),
                )]),
            };
            match s.ask(format!("outline-v2:{index}"), batch).await?["r0"].as_str() {
                "1" => roots.push(row(text, b, *line, true)),
                "2" => roots.push(row(text, b, *line, false)),
                "3" => {
                    if let Some(parent) = roots.last_mut() {
                        parent.children.push(item)
                    }
                }
                _ => {}
            }
        }
    }
    Ok(roots)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_restarted_attachment_checklist_does_not_extend_a_chapter() {
        let children = vec![Entry {
            title: "4. 제출서류".into(),
            printed: None,
            block: Uuid::new_v4(),
            line: 0,
            children: vec![],
        }];
        assert!(!continues_siblings(&children, "01) 신청서 1부"));
        assert!(!continues_siblings(&children, "05) 증빙서류"));
        assert!(!continues_siblings(&children, "1. 예시 목차"));
        assert!(continues_siblings(&children, "5. 계약조건"));
    }
}
