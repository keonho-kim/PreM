// Purpose: Identify page membership, chapter openings, title dividers and uncertain evidence.
// Pattern: Compare bounded source candidates with neighboring excerpts and optional calibrated hints.
// Usage: One observation per physical page; checkpoint every successful model request.
// Related: catalog.rs, numbering.rs, prompts/page_alignment.rs.
use super::*;
fn body(p: &SourcePage) -> Vec<&Block> {
    p.blocks
        .iter()
        .filter(|b| b.kind != "image" && b.kind != "separator" && b.is_table_of_contents != Some(1))
        .collect()
}
fn neighbor(p: Option<&SourcePage>) -> String {
    p.map(|p| {
        body(p)
            .iter()
            .take(3)
            .map(|b| b.text.chars().take(100).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n")
    })
    .unwrap_or_default()
}
pub(super) async fn observe(
    s: &mut Session<'_>,
    pages: &[SourcePage],
    i: usize,
    entries: &[Entry],
    offset: Option<i64>,
) -> Result<Observation, Error> {
    let p = &pages[i];
    let blocks = body(p);
    if blocks.is_empty() {
        return Ok(Observation::empty(
            if p.blocks.iter().any(|b| b.is_table_of_contents == Some(1)) {
                "contents"
            } else {
                "unknown"
            },
        ));
    }
    if entries.is_empty() {
        return Ok(Observation::empty("unknown"));
    }
    let sample: Vec<_> = if blocks.len() <= 6 {
        blocks
    } else {
        (0..6).map(|j| blocks[j * (blocks.len() - 1) / 5]).collect()
    };
    let texts: Vec<_> = sample
        .iter()
        .map(|b| json!({"kind":b.kind,"text":b.text.chars().take(70).collect::<String>()}))
        .collect();
    let context = json!({"previous":neighbor(i.checked_sub(1).and_then(|j|pages.get(j))),"current":texts,"next":neighbor(pages.get(i+1)),"physical":p.physical});
    let mut pool: Vec<_> = (0..entries.len()).collect();
    let mut round = 0;
    let selected = loop {
        let mut winners = Vec::new();
        for (group, ids) in pool.chunks(15).enumerate() {
            let mut options = choices(&["해당 없음 또는 근거 부족"]);
            for (j, &id) in ids.iter().enumerate() {
                let e = &entries[id];
                let hint = match (e.start_number(), offset) {
                    (Some(n), Some(d)) => {
                        format!(" (목차 {n}쪽, 이전 시작점 기준 예상 위치 {})", n + d)
                    }
                    (Some(n), None) => format!(" (목차 {n}쪽)"),
                    _ => String::new(),
                };
                options.insert((j + 1).to_string(), format!("{}{}", e.title, hint));
            }
            let b = Batch {
                state: context.clone(),
                questions: BTreeMap::from([("section".into(), question(prompts::MATCH, options))]),
            };
            let ans = s
                .ask(format!("match-v2:{}:{round}:{group}", p.id), b)
                .await?;
            let choice = ans["section"]
                .parse::<usize>()
                .map_err(|_| Error::Storage)?;
            if choice != 0 {
                winners.push(ids[choice - 1]);
            }
        }
        if winners.len() < 2 {
            break winners.first().copied();
        }
        pool = winners;
        round += 1;
    };
    let Some(id) = selected else {
        return Ok(Observation::empty(
            if p.blocks.iter().any(|b| b.is_table_of_contents == Some(1)) {
                "contents"
            } else {
                "unknown"
            },
        ));
    };
    let mut state = context;
    state["chapter"] = json!(entries[id].title);
    state["toc_printed_start"] = json!(entries[id].start_number());
    let mut evidence = choices(&["직접 근거 없음"]);
    for j in 0..sample.len() {
        evidence.insert((j + 1).to_string(), format!("current[{j}]"));
    }
    let batch = Batch {
        state,
        questions: BTreeMap::from([
            (
                "role".into(),
                question(
                    prompts::ROLE,
                    choices(&[
                        "불확실",
                        "본문 시작",
                        "이전 페이지에서 이어지는 본문",
                        "장 제목 중심의 간지",
                        "한 페이지 중간에서 앞 장이 끝나고 새 장 시작",
                        "간지 자체가 목차의 장 시작점임이 확인됨",
                    ]),
                ),
            ),
            ("evidence".into(), question(prompts::EVIDENCE, evidence)),
        ]),
    };
    let ans = s.ask(format!("role-v2:{}", p.id), batch).await?;
    let j = ans["evidence"]
        .parse::<usize>()
        .map_err(|_| Error::Storage)?;
    let role = match ans["role"].as_str() {
        "1" | "4" => "start",
        "2" => "body",
        "3" => "divider",
        "5" => "divider_start",
        _ => "unknown",
    };
    if j == 0 || role == "unknown" {
        return Ok(Observation::empty("unknown"));
    }
    Ok(Observation {
        section: Some(id),
        role: role.into(),
        evidence: Some(sample[j - 1].id),
        mid_page: ans["role"] == "4",
    })
}
