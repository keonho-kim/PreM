// Purpose: Decide whether a fixed page is the document's own contents with one compact request.
// Pattern: Page context is shared once; each block is checkpointed against the same page decision.
// Usage: PDF/slide workers, including concurrent document jobs.
// Related: alignment/structure.rs, prompts/documents.rs, results.rs.
use super::*;
use crate::modules::documents::alignment::structure;
pub(super) async fn classify(
    service: &Documents,
    job: &Job,
    config: Uuid,
    pages: &[Page],
    cancel: &CancellationToken,
) -> Result<(), Error> {
    let mut in_contents = false;
    let mut closed = false;
    for page in pages {
        let mut blocks = Vec::new();
        loop {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let rows = service
                .store
                .blocks(
                    job.id,
                    Some(page.id),
                    false,
                    String::new(),
                    blocks.len() as u32,
                )
                .await?;
            let count = rows.len();
            blocks.extend(rows);
            if count < 50 {
                break;
            }
        }
        let pending: Vec<_> = blocks
            .iter()
            .filter(|b| b.kind != "image" && b.is_table_of_contents.is_none())
            .collect();
        let (label, leaders) = structure::page_shape(blocks.iter().map(|b| b.text.as_str()));
        if !label && structure::opens_body(&blocks) {
            closed = true;
        }
        if pending.is_empty() {
            let yes = blocks.iter().any(|b| b.is_table_of_contents == Some(1));
            closed |= in_contents && !yes;
            in_contents = yes;
            continue;
        }
        let excerpt = blocks
            .iter()
            .filter(|b| b.kind != "image")
            .flat_map(|b| b.text.lines())
            .take(9)
            .map(|l| l.chars().take(55).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n")
            .chars()
            .take(260)
            .collect::<String>();
        let batch = Batch {
            state: serde_json::json!({"regions":{"r0":{"text":excerpt,"kind":"page"}}}),
            questions: BTreeMap::from([(
                "r0".into(),
                Question::Choice {
                    instructions: crate::prompts::documents::CONTENTS_PAGE.into(),
                    criteria: BTreeMap::from([
                        ("1".into(), "이 문서 자체의 차례".into()),
                        ("0".into(), "본문·예시·기타".into()),
                    ]),
                },
            )]),
        };
        let (response, record) = service
            .decisions
            .pinned(config, batch, cancel.clone())
            .await?;
        let positive = !closed && (label || (leaders && response.answers["r0"].choice == "1"));
        closed |= in_contents && !positive;
        in_contents = positive;
        let rows=pending.into_iter().map(|b|{
            let entry=b.text.lines().any(|line|structure::contents_label(line) || structure::compact_rows(line)
                || line.trim().chars().count()<=100);
            DecisionCommit{block_id:b.id,value:i64::from(positive && entry),statistics:serde_json::json!({"scope":"page","model":response.model,"page_choice":response.answers["r0"].choice}),request_id:record.id}
        }).collect();
        service.store.decisions(job.clone(), rows).await?;
    }
    Ok(())
}
