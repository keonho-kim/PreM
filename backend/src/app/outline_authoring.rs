// Purpose: Save outline edits from generation and refresh the reviewed presentation inputs.
// Pattern: Application orchestration calls feature facades; every write retains its own CAS rules.
// Usage: Explicit save from the generation outline editor; never starts model or rendering work.
// Related: modules/outlines/, modules/presentations/, adapters/http/outline_authoring.rs.
use crate::modules::{outlines, presentations};
use serde::Deserialize;
use uuid::Uuid;
#[derive(Clone)]
pub(crate) struct OutlineAuthoring {
    pub outlines: outlines::Outlines,
    pub presentations: presentations::Presentations,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Edit {
    pub outline: outlines::Edit,
    pub expected_design_version: i64,
    pub template_job_id: Option<Uuid>,
}
impl OutlineAuthoring {
    pub async fn save(
        &self,
        project: Uuid,
        mut input: Edit,
    ) -> Result<presentations::Preparation, String> {
        let mut current = self
            .outlines
            .state(project, None)
            .await
            .map_err(|e| e.to_string())?;
        input
            .outline
            .draft
            .assignments
            .sort_by_key(|a| (a.node_id, a.block_id));
        current
            .draft
            .assignments
            .sort_by_key(|a| (a.node_id, a.block_id));
        for node in &mut input.outline.draft.nodes {
            node.title = node.title.trim().into();
            node.description = node.description.trim().into();
        }
        // A lost response may be retried only if that exact next revision is still current.
        let same = Some(current.version) == input.outline.expected_version.checked_add(1)
            && current.source_snapshot == input.outline.source_snapshot
            && current.guide_version == input.outline.guide_version
            && serde_json::to_value(&current.draft).ok()
                == serde_json::to_value(&input.outline.draft).ok();
        let baseline = self
            .presentations
            .preparation(project)
            .await
            .map_err(|e| e.to_string())?;
        if same
            && Some(baseline.version) == input.expected_design_version.checked_add(1)
            && baseline.design_id.is_some()
            && baseline.template_job_id == input.template_job_id
        {
            return Ok(baseline);
        }
        if baseline.version != input.expected_design_version {
            return Err("발표 준비 상태가 변경되었습니다. 최신 목차를 다시 확인해 주세요.".into());
        }
        let saved = if same {
            current
        } else {
            self.outlines
                .save(project, input.outline)
                .await
                .map_err(|e| e.to_string())?
        };
        self.outlines
            .confirm(project, saved.version)
            .await
            .map_err(|e| e.to_string())?;
        let pre = self
            .presentations
            .preparation(project)
            .await
            .map_err(|e| e.to_string())?;
        let reviewed = self
            .presentations
            .confirm(project, pre.fingerprint)
            .await
            .map_err(|e| e.to_string())?;
        if reviewed.version != input.expected_design_version {
            return Err("발표 준비 상태가 변경되었습니다. 저장한 목차는 유지됩니다.".into());
        }
        self.presentations
            .design(
                project,
                presentations::Design {
                    expected_version: reviewed.version,
                    evidence_review_id: reviewed
                        .evidence_review_id
                        .ok_or("목차와 근거를 다시 확인해 주세요.")?,
                    template_job_id: input.template_job_id,
                },
            )
            .await
            .map_err(|e| e.to_string())
    }
}
