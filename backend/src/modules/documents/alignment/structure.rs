// Purpose: Recognize explicit source contents and numbering conventions without synthesizing titles.
// Pattern: Whole-line markers and leader columns carry structure; prose mentions carry none.
// Usage: Shared by physical page classification, catalog extraction and body anchors.
// Related: catalog.rs, anchors.rs, classification/pages.rs.
pub(crate) fn compact(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}
pub(crate) fn contents_label(text: &str) -> bool {
    matches!(
        compact(text.trim_matches(|c: char| "[]【】〈〉:：".contains(c))).as_str(),
        "목차" | "차례" | "contents" | "tableofcontents"
    )
}
pub(super) fn title_number(line: &str) -> (&str, Option<i64>) {
    let clean = line
        .trim()
        .trim_end_matches('|')
        .trim_end()
        .trim_end_matches('쪽')
        .trim_end();
    let prefix = clean.trim_end_matches(|c: char| c.is_ascii_digit());
    let n = clean[prefix.len()..]
        .parse::<i64>()
        .ok()
        .filter(|n| (1..=100000).contains(n));
    if n.is_some() && !prefix.trim().is_empty() {
        (
            prefix.trim_end_matches(|c: char| c.is_whitespace() || ".…·|".contains(c)),
            n,
        )
    } else {
        (line.trim(), None)
    }
}
pub(crate) fn leader(line: &str) -> bool {
    title_number(line).1.is_some()
        && (line.contains('\t')
            || line.contains("..")
            || line.contains('…')
            || line.contains("··")
            || line.contains("  "))
}
pub(super) fn major(line: &str) -> Option<(usize, &str)> {
    let s = line.trim();
    if s.len() > 350 {
        return None;
    }
    if let Some(rest) = s.strip_prefix('제')
        && let Some((digits, title)) = rest.split_once('장')
        && let Ok(n) = digits.trim().parse::<usize>()
    {
        let title = title.trim_start_matches([' ', '.', ':', '|']);
        if n > 0 && !title.is_empty() {
            return Some((n, title));
        }
    }
    let (marker, rest) = s.split_at(s.find(|c: char| c.is_whitespace() || ".．|:、".contains(c))?);
    let title = rest.trim_start_matches(|c: char| c.is_whitespace() || ".．|:、".contains(c));
    const ROMAN: [(&str, &str); 12] = [
        ("Ⅰ", "I"),
        ("Ⅱ", "II"),
        ("Ⅲ", "III"),
        ("Ⅳ", "IV"),
        ("Ⅴ", "V"),
        ("Ⅵ", "VI"),
        ("Ⅶ", "VII"),
        ("Ⅷ", "VIII"),
        ("Ⅸ", "IX"),
        ("Ⅹ", "X"),
        ("Ⅺ", "XI"),
        ("Ⅻ", "XII"),
    ];
    let n = ROMAN
        .iter()
        .position(|(a, b)| marker == *a || marker == *b)?
        + 1;
    (!title.is_empty()).then_some((n, title))
}
pub(super) fn number_marker(line: &str) -> Option<(u32, char)> {
    let s = line.trim_start();
    let digits = s.len() - s.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    if !(1..=3).contains(&digits) {
        return None;
    }
    let delimiter = s[digits..].chars().next()?;
    if !matches!(delimiter, '.' | ')' | '．' | '、') {
        return None;
    }
    Some((s[..digits].parse().ok()?, delimiter))
}
pub(super) fn numbered(line: &str) -> bool {
    number_marker(line).is_some()
}
pub(crate) fn compact_rows(text: &str) -> bool {
    let t = text.trim();
    !t.is_empty() && t.chars().count() <= 150 && (major(t).is_some() || numbered(t) || leader(t))
}
pub(crate) fn page_shape<'a>(texts: impl Iterator<Item = &'a str>) -> (bool, bool) {
    let rows: Vec<_> = texts
        .flat_map(str::lines)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    let label = rows.iter().take(3).any(|t| contents_label(t));
    let leaders = rows
        .iter()
        .filter(|t| leader(t) || (t.chars().count() < 65 && title_number(t).1.is_some()))
        .count();
    let compact = rows.iter().filter(|t| t.chars().count() <= 100).count();
    (
        label && rows.len() > 1,
        leaders >= 2 && compact * 4 >= rows.len() * 3,
    )
}

pub(crate) fn opens_body(blocks: &[super::Block]) -> bool {
    // A standalone chapter banner followed by body paragraphs establishes that
    // later lists describe the body (often a requested deliverable's outline).
    let has_heading = blocks.iter().take(3).any(|b| {
        !b.text.contains('\n')
            && major(&b.text).is_some()
            && (b.kind == "heading" || b.kind == "table" || b.position == 0)
    });
    has_heading
        && blocks
            .iter()
            .any(|b| b.text.chars().count() > 75 && !leader(&b.text))
}
