// Purpose: Calibrate printed page estimates against independently grounded chapter starts.
// Pattern: Interpolate only inside agreeing anchors; physical positions always count dividers.
// Usage: Build page views after semantic observations are complete.
// Related: observation.rs, document_pages.source_page, PageAlignment.
use super::*;
pub(super) fn assign(
    pages: &[SourcePage],
    entries: &[Entry],
    obs: &[Observation],
) -> Vec<PageAlignment> {
    let mut divider_starts = vec![0; entries.len()];
    let mut starts = vec![0; entries.len()];
    for o in obs {
        if o.role == "start"
            && let Some(s) = o.section
        {
            starts[s] += 1;
        }
        if o.role == "divider_start"
            && let Some(s) = o.section
        {
            divider_starts[s] += 1;
        }
    }
    let anchors: Vec<_> = obs
        .iter()
        .enumerate()
        .filter_map(|(i, o)| {
            let s = o.section?;
            let anchor = match divider_starts[s] {
                0 => o.role == "start" && starts[s] == 1,
                1 => o.role == "divider_start",
                _ => false,
            };
            anchor.then_some(())?;
            Some((i, s, entries[s].start_number()?))
        })
        .collect();
    let mut printed = vec![None; pages.len()];
    let mut inferred = vec![None; pages.len()];
    for &(i, _, n) in &anchors {
        printed[i] = Some(n);
    }
    for pair in anchors.windows(2) {
        let [(i, s, n), (j, t, m)] = [pair[0], pair[1]];
        let physical_span = pages[j].physical - pages[i].physical;
        let printed_span = m - n;
        if t <= s || printed_span <= 0 || physical_span != (j - i) as i64 {
            continue;
        }
        // Restarted or contradictory chapter order cannot support interpolation.
        let mut previous = s;
        if obs[i + 1..j]
            .iter()
            .filter_map(|o| o.section)
            .any(|section| {
                let conflict = section < previous || section > t;
                previous = section;
                conflict
            })
        {
            continue;
        }
        let dividers = obs[i + 1..j].iter().filter(|o| o.role == "divider").count() as i64;
        let skip_dividers = physical_span != printed_span;
        if skip_dividers
            && (physical_span - printed_span != dividers
                || obs[i + 1..j]
                    .iter()
                    .any(|o| !matches!(o.role.as_str(), "divider" | "body")))
        {
            continue;
        }
        let coherent_range = t == s + 1
            && !skip_dividers
            && obs[i + 1..j].iter().all(|o| {
                o.role == "unknown"
                    || (o.section == Some(s) && matches!(o.role.as_str(), "body" | "divider"))
            });
        let mut number = n;
        for k in i + 1..j {
            if skip_dividers && obs[k].role == "divider" {
                continue;
            }
            number += 1;
            // Only textless interiors can inherit a range. Never replace a negative
            // or uncertain model decision about readable content with arithmetic.
            if obs[k].role == "unknown"
                && coherent_range
                && pages[k]
                    .blocks
                    .iter()
                    .all(|b| matches!(b.kind.as_str(), "image" | "separator"))
            {
                inferred[k] = Some(s);
                printed[k] = Some(number);
            }
            if (matches!(obs[k].role.as_str(), "body" | "range")
                && obs[k].section.is_some_and(|id| (s..t).contains(&id)))
                || (obs[k].role == "divider"
                    && obs[k].section.is_some_and(|id| (s..=t).contains(&id)))
            {
                printed[k] = Some(number);
            }
        }
    }
    // Extend only the last grounded chapter with a consistent preceding offset.
    if let [.., (i, _, n), (j, t, m)] = anchors.as_slice()
        && *t + 1 == entries.len()
        && m - n == pages[*j].physical - pages[*i].physical
    {
        for k in j + 1..pages.len() {
            if obs[k].section != Some(*t) || obs[k].role != "range" {
                break;
            }
            printed[k] = Some(m + pages[k].physical - pages[*j].physical);
        }
    }
    obs.iter()
        .enumerate()
        .map(|(i, o)| {
            let entry = o.section.or(inferred[i]).map(|s| &entries[s]);
            let previous = if o.mid_page {
                i.checked_sub(1)
                    .and_then(|j| obs[j].section)
                    .filter(|s| Some(*s) != o.section)
                    .map(|s| entries[s].title.clone())
            } else {
                None
            };
            PageAlignment {
                section: entry.map(|e| e.title.clone()),
                toc_block: entry.map(|e| e.block),
                toc_line: entry.map(|e| e.line),
                toc_printed_start: entry.and_then(|e| e.start_number()),
                preceding_section: previous,
                evidence_block: o.evidence,
                role: if inferred[i].is_some() {
                    "range".into()
                } else {
                    o.role.clone()
                },
                printed_page: printed[i],
            }
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unnumbered_divider_changes_offset_without_shifting_following_pages() {
        let entries: Vec<_> = [1, 4, 6]
            .into_iter()
            .enumerate()
            .map(|(i, n)| Entry {
                title: i.to_string(),
                printed: Some(n),
                block: Uuid::new_v4(),
                line: 0,
                children: vec![],
            })
            .collect();
        let pages: Vec<_> = (4..=10)
            .map(|physical| SourcePage {
                id: Uuid::new_v4(),
                physical,
                blocks: vec![],
            })
            .collect();
        let obs: Vec<_> = [
            (0, "start"),
            (0, "body"),
            (0, "body"),
            (1, "divider"),
            (1, "start"),
            (1, "body"),
            (2, "start"),
        ]
        .into_iter()
        .map(|(s, r)| Observation {
            section: Some(s),
            role: r.into(),
            evidence: Some(Uuid::new_v4()),
            mid_page: false,
        })
        .collect();
        let r = assign(&pages, &entries, &obs);
        assert_eq!(
            r.iter().map(|p| p.printed_page).collect::<Vec<_>>(),
            [Some(1), Some(2), Some(3), None, Some(4), Some(5), Some(6)]
        );
        assert_eq!(r[3].section.as_deref(), Some("1"));
        let mut numbered = entries.clone();
        numbered[1].printed = Some(5);
        assert_eq!(assign(&pages, &numbered, &obs)[3].printed_page, Some(4));
        numbered[1].printed = Some(1);
        assert_eq!(assign(&pages, &numbered, &obs)[1].printed_page, None);
        for entry in &mut numbered {
            entry.printed = None
        }
        let missing = assign(&pages, &numbered, &obs);
        assert!(missing.iter().all(|p| p.printed_page.is_none()));
        assert_eq!(missing[3].section.as_deref(), Some("1"));
    }
}
