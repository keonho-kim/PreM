// Purpose: Locate original chapter openings and assign ordered spans on physical pages.
// Pattern: Match whole source heading lines, then use the confirmed sequence as boundaries.
// Usage: Decision still handles paraphrased, ambiguous and unanchored pages.
// Related: catalog.rs, observation.rs, numbering.rs.
use super::*;
use structure::{compact, major};
fn equivalent(a: &str, b: &str) -> bool {
    match (major(a), major(b)) {
        (Some((n, x)), Some((m, y))) => n == m && compact(x) == compact(y),
        _ => compact(a) == compact(b),
    }
}
fn appendix(p: &SourcePage) -> bool {
    p.blocks.first().is_some_and(|b| {
        let t = compact(&b.text);
        ["【별지", "[별지", "[별첨", "【별첨"]
            .iter()
            .any(|prefix| t.starts_with(prefix))
    })
}
pub(super) fn locate(pages: &[SourcePage], entries: &[Entry]) -> Vec<Option<Observation>> {
    let toc_end = pages.iter().rposition(|p| {
        p.blocks.iter().any(|b| {
            entries
                .iter()
                .any(|e| e.block == b.id && b.is_table_of_contents == Some(1))
        })
    });
    let mut hits = vec![None; entries.len()];
    for (n, e) in entries.iter().enumerate() {
        let mut candidates = pages
            .iter()
            .enumerate()
            .filter(|(i, _)| toc_end.is_none_or(|end| *i > end))
            .flat_map(|(i, p)| {
                p.blocks
                    .iter()
                    .filter(move |b| b.kind != "image" && equivalent(&e.title, b.text.trim()))
                    .map(move |b| (i, b))
            });
        if let Some((i, b)) = candidates.next()
            && candidates.next().is_none()
        {
            hits[n] = Some((i, b));
        }
    }
    let mut result = vec![None; pages.len()];
    if let Some(end) = toc_end {
        for (i, p) in pages[..=end].iter().enumerate() {
            result[i] = Some(Observation::empty(
                if p.blocks.iter().any(|b| b.is_table_of_contents == Some(1)) {
                    "contents"
                } else {
                    "unknown"
                },
            ));
        }
    }
    let mut prior = None;
    for (n, hit) in hits.iter().enumerate() {
        let Some((i, b)) = hit else { continue };
        if prior.is_some_and(|j| j > *i) || hits[n + 1..].iter().flatten().any(|(j, _)| j < i) {
            continue;
        }
        prior = Some(*i);
        result[*i] = Some(Observation {
            section: Some(n),
            role: if pages[*i]
                .blocks
                .iter()
                .filter(|b| b.kind != "image" && b.kind != "separator")
                .count()
                == 1
            {
                "divider_start"
            } else {
                "start"
            }
            .into(),
            evidence: Some(b.id),
            mid_page: b.position > 1,
        });
        let end = if let Some(Some((j, _))) = hits.get(n + 1) {
            *j
        } else if n + 1 == entries.len() {
            pages.len()
        } else {
            continue;
        };
        for k in i + 1..end {
            if appendix(&pages[k]) {
                for v in &mut result[k..end] {
                    *v = Some(Observation::empty("unknown"));
                }
                break;
            }
            result[k] = Some(Observation {
                section: Some(n),
                role: "range".into(),
                evidence: None,
                mid_page: false,
            });
        }
    }
    result
}
