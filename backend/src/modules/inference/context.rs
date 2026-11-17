// Purpose: Fit source evidence into an exact serialized request budget without hidden prefix clipping.
// Pattern: Preserve complete short sources; fairly allocate remaining space with explicit head/tail ranges.
// Usage: Authoring tasks supply their source-array JSON pointers and remaining request byte budget.
// Related: outlines/model/request.rs, presentations/authoring/request.rs, editing/request.rs.
use serde_json::{Value, json};

pub(crate) fn bounded_context(context: &Value, paths: &[&str], budget: usize) -> Option<String> {
    let mut longest = 0;
    for path in paths {
        for source in context.pointer(path)?.as_array()? {
            longest = longest.max(source.get("text")?.as_str()?.chars().count());
        }
    }
    let render = |cap| {
        let mut value = context.clone();
        for path in paths {
            let sources = value.pointer_mut(path)?.as_array_mut()?;
            for source in sources {
                let text = source.get("text")?.as_str()?.to_owned();
                let chars: Vec<_> = text.chars().collect();
                let n = chars.len();
                let partial = n > cap;
                source["partial"] = json!(partial);
                source["source_chars"] = json!(n);
                if partial {
                    let head = cap.div_ceil(2);
                    let tail = cap / 2;
                    source["text"] = json!(format!(
                        "{}\n[중간 원문 생략]\n{}",
                        chars[..head].iter().collect::<String>(),
                        chars[n - tail..].iter().collect::<String>()
                    ));
                    source["excerpt_ranges"] = json!([[0, head], [n - tail, n]]);
                } else {
                    source["excerpt_ranges"] = json!([[0, n]]);
                }
            }
        }
        serde_json::to_string(&value).ok()
    };
    let full = render(longest)?;
    if full.len() <= budget {
        return Some(full);
    }
    // Do not admit a request with identifiers but no usable evidence.
    let mut low = longest.min(128);
    let mut high = longest;
    let mut best = render(low)?;
    if best.len() > budget {
        return None;
    }
    while low < high {
        let middle = low + (high - low).div_ceil(2);
        let candidate = render(middle)?;
        if candidate.len() <= budget {
            low = middle;
            best = candidate;
        } else {
            high = middle - 1;
        }
    }
    Some(best)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_korean_sources_are_preserved_when_the_request_fits() {
        let original = "앞 문맥과 끝의 중요한 조건입니다. ".repeat(35);
        let context = json!({"sources":[{"id":"b1","text":original}]});
        let wire = bounded_context(&context, &["/sources"], 20000).unwrap();
        let value: Value = serde_json::from_str(&wire).unwrap();
        assert_eq!(value["sources"][0]["text"], original);
        assert_eq!(value["sources"][0]["partial"], false);
    }
    #[test]
    fn budgeted_evidence_preserves_short_sources_and_marks_missing_middle() {
        let text = format!("시작 조건 {} 끝의 예외 조건", "본문😀\"\n".repeat(1000));
        let context = json!({"sources":[{"id":"short","text":"짧은 근거"},{"id":"long","text":text}],"user_request":"유지"});
        let wire = bounded_context(&context, &["/sources"], 2500).unwrap();
        assert!(wire.len() <= 2500);
        let value: Value = serde_json::from_str(&wire).unwrap();
        assert_eq!(value["user_request"], "유지");
        assert_eq!(value["sources"][0]["text"], "짧은 근거");
        let excerpt = &value["sources"][1];
        assert_eq!(excerpt["partial"], true);
        assert!(excerpt["text"].as_str().unwrap().starts_with("시작 조건"));
        assert!(
            excerpt["text"]
                .as_str()
                .unwrap()
                .ends_with("끝의 예외 조건")
        );
        for range in excerpt["excerpt_ranges"].as_array().unwrap() {
            let start = range[0].as_u64().unwrap() as usize;
            let end = range[1].as_u64().unwrap() as usize;
            assert!(
                excerpt["text"].as_str().unwrap().contains(
                    &text
                        .chars()
                        .skip(start)
                        .take(end - start)
                        .collect::<String>()
                )
            );
        }
        assert_eq!(context["sources"][1]["text"], text);
    }
    #[test]
    fn oversized_instructions_fail_without_silently_dropping_sources() {
        let context = json!({"sources":[{"text":"근거"}],"request":"가".repeat(2000)});
        assert!(bounded_context(&context, &["/sources"], 500).is_none());
    }
}
