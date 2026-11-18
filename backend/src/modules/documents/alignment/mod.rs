// Purpose: Align physical pages to the source document's top-level contents.
// Pattern: Checkpoint closed-choice calls and grounded observations by processing job.
// Usage: Runs after block classification for fixed-page documents and presentations.
// Related: catalog.rs, observation.rs, numbering.rs, sqlite/documents/alignment.rs.
mod anchors;
mod catalog;
mod numbering;
mod observation;
pub(in crate::modules::documents) mod structure;
use super::*;
use crate::modules::decisions::{Batch, Question};
use crate::prompts::page_alignment as prompts;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct PageAlignment {
    pub role: String,
    pub section: Option<String>,
    pub preceding_section: Option<String>,
    pub toc_block: Option<Uuid>,
    pub toc_line: Option<i64>,
    pub toc_printed_start: Option<i64>,
    pub evidence_block: Option<Uuid>,
    pub printed_page: Option<i64>,
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Entry {
    pub title: String,
    pub printed: Option<i64>,
    pub block: Uuid,
    pub line: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Entry>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Observation {
    section: Option<usize>,
    role: String,
    evidence: Option<Uuid>,
    mid_page: bool,
}
impl Entry {
    fn start_number(&self) -> Option<i64> {
        self.printed
            .or_else(|| self.children.first().and_then(|c| c.printed))
    }
}
impl Observation {
    fn empty(role: &str) -> Self {
        Self {
            section: None,
            role: role.into(),
            evidence: None,
            mid_page: false,
        }
    }
}
struct SourcePage {
    id: Uuid,
    physical: i64,
    blocks: Vec<Block>,
}
struct Session<'a> {
    service: &'a Documents,
    job: &'a Job,
    cancel: &'a CancellationToken,
    saved: HashMap<String, Value>,
}
fn question(instructions: &str, options: impl IntoIterator<Item = (String, String)>) -> Question {
    Question::Choice {
        instructions: instructions.into(),
        criteria: options.into_iter().collect(),
    }
}
fn choices(labels: &[&str]) -> BTreeMap<String, String> {
    labels
        .iter()
        .enumerate()
        .map(|(i, t)| (i.to_string(), t.to_string()))
        .collect()
}
impl Session<'_> {
    async fn ask(&mut self, key: String, batch: Batch) -> Result<BTreeMap<String, String>, Error> {
        if self.cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if let Some(value) = self.saved.get(&key) {
            return serde_json::from_value(value.clone()).map_err(|_| Error::Storage);
        }
        let config = self.job.config_id.ok_or(Error::WaitingConfiguration)?;
        let (result, request) = self
            .service
            .decisions
            .pinned(config, batch, self.cancel.clone())
            .await?;
        let answers: BTreeMap<_, _> = result
            .answers
            .into_iter()
            .map(|(k, v)| (k, v.choice))
            .collect();
        self.service
            .store
            .save_alignment(self.job.clone(), key, json!(answers), request.id)
            .await?;
        Ok(answers)
    }
}
impl Documents {
    pub(super) async fn align_pages(
        &self,
        job: &Job,
        cancel: &CancellationToken,
    ) -> Result<(), Error> {
        let detail = self
            .store
            .detail(job.kind.clone(), job.item_id, Some(job.id))
            .await?;
        if !matches!(detail.page_mode.as_deref(), Some("layout" | "slide")) {
            return Ok(());
        }
        if detail
            .pages
            .iter()
            .filter(|p| p.source_page.is_some())
            .all(|p| p.alignment.is_some())
        {
            return Ok(());
        }
        let mut pages = Vec::new();
        for p in detail.pages {
            let Some(physical) = p.source_page else {
                continue;
            };
            pages.push(SourcePage {
                id: p.id,
                physical,
                blocks: Vec::new(),
            });
        }
        if pages.is_empty() {
            return Ok(());
        }
        pages.sort_by_key(|p| p.physical);
        let indices: HashMap<_, _> = pages.iter().enumerate().map(|(i, p)| (p.id, i)).collect();
        let mut offset = 0;
        loop {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let blocks = self
                .store
                .blocks(job.id, None, false, String::new(), offset)
                .await?;
            let n = blocks.len();
            for b in blocks {
                if let Some(i) = indices.get(&b.page_id) {
                    pages[*i].blocks.push(b)
                }
            }
            if n < 50 {
                break;
            }
            offset += n as u32;
        }
        let mut session = Session {
            service: self,
            job,
            cancel,
            saved: self.store.alignment_checkpoints(job.id).await?,
        };
        let entries = catalog::entries(&mut session, &pages).await?;
        let anchored = anchors::locate(&pages, &entries);
        let mut observations = Vec::new();
        let mut offset = None;
        for (i, p) in pages.iter().enumerate() {
            let o = match &anchored[i] {
                Some(o) => o.clone(),
                None => observation::observe(&mut session, &pages, i, &entries, offset).await?,
            };
            if matches!(o.role.as_str(), "start" | "divider_start")
                && let Some(number) = o.section.and_then(|s| entries[s].start_number())
            {
                offset = Some(p.physical - number);
            }
            observations.push(o);
        }
        let results = numbering::assign(&pages, &entries, &observations);
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        self.store
            .publish_alignment(
                job.clone(),
                entries,
                pages.iter().map(|p| p.id).zip(results).collect(),
            )
            .await
    }
}
