// Purpose: Own durable slide-scoped chat proposals and explicit apply/reject/retry commands.
// Pattern: One bounded editing pass per worker tick, with pinned model and immutable base input.
// Usage: Presentations facade; runtime reads/rendering reuse existing feature ports.
// Related: edit_types.rs, edit_model.rs, adapters/sqlite/presentations/edits/.
use super::*;
use std::time::Duration;
impl Presentations {
    pub async fn edit(
        &self,
        p: Uuid,
        run: Uuid,
        slide: Uuid,
        key: Uuid,
        mut input: EditRequest,
    ) -> Result<EditView, Error> {
        input.prompt = input.prompt.trim().into();
        input.fields.sort();
        if input.prompt.is_empty()
            || input.prompt.chars().count() > 2000
            || input.fields.is_empty()
            || input.fields.len() > 3
            || input
                .fields
                .iter()
                .any(|f| !["title", "bullets", "notes"].contains(&f.as_str()))
            || input.fields.windows(2).any(|f| f[0] == f[1])
            || input.expected_version < 1
            || input.model_version < 1
        {
            return Err(Error::EditInvalid);
        }
        let edit = self
            .store
            .create_edit(p, run, slide, key, input, self.renderer.profile())
            .await?;
        self.edit_view(edit).await
    }
    pub async fn edits(&self, p: Uuid, run: Uuid, slide: Uuid) -> Result<Vec<EditView>, Error> {
        let mut out = vec![];
        for edit in self.store.edits(p, run, slide).await? {
            out.push(self.edit_view(edit).await?);
        }
        Ok(out)
    }
    pub async fn edit_command(
        &self,
        p: Uuid,
        id: Uuid,
        key: Uuid,
        v: i64,
        action: String,
    ) -> Result<EditView, Error> {
        if !["apply", "reject", "cancel", "retry"].contains(&action.as_str()) {
            return Err(Error::EditInvalid);
        }
        let edit = self.store.edit_command(p, id, key, v, action).await?;
        self.edit_view(edit).await
    }
    async fn spec(&self, hash: String) -> Result<SlideSpec, Error> {
        serde_json::from_slice(
            &self
                .assets
                .bytes(hash, 65536)
                .await
                .map_err(|_| Error::Storage)?,
        )
        .map_err(|_| Error::Storage)
    }
    async fn edit_view(&self, edit: Edit) -> Result<EditView, Error> {
        let before = self.spec(edit.source_spec.clone()).await?;
        let proposal = if let Some(hash) = edit.proposed_spec.clone() {
            Some(self.spec(hash).await?)
        } else {
            None
        };
        Ok(EditView {
            edit,
            before,
            proposal,
        })
    }
    pub(super) async fn process_edit(&self, stop: CancellationToken) {
        let edit = match self.store.claim_edit().await {
            Ok(Some(edit)) => edit,
            Ok(None) => return,
            Err(e) => {
                tracing::warn!(%e,"slide editing scheduling failed");
                return;
            }
        };
        let cancel = stop.child_token();
        let token = cancel.clone();
        let store = self.store.clone();
        let watched = edit.clone();
        let monitor = tokio::spawn(async move {
            loop {
                tokio::select! {()=token.cancelled()=>break,()=tokio::time::sleep(Duration::from_secs(2))=>{if !matches!(store.edit_heartbeat(watched.clone()).await,Ok(true)){token.cancel();break}}}
            }
        });
        let result = self.propose(&edit, cancel.clone()).await;
        cancel.cancel();
        let _ = monitor.await;
        if let Err(e) = result {
            let code = match e {
                Error::Cancelled => "interrupted",
                Error::Conflict => "inputs_changed",
                Error::Processing(c) => c,
                _ => "edit_failed",
            };
            let _ = self.store.edit_fail(edit, code.into()).await;
        }
    }
    async fn propose(&self, edit: &Edit, cancel: CancellationToken) -> Result<(), Error> {
        if edit.runtime_profile != self.renderer.profile() {
            return Err(Error::Processing("runtime_changed"));
        }
        let original = self.spec(edit.source_spec.clone()).await?;
        let context = self.store.edit_context(edit.clone()).await?;
        let plan = EditPlan { context, original };
        let reply = self
            .inference
            .pinned_json(
                edit.config_id,
                super::edit_model::input(edit, &plan)?,
                cancel.clone(),
            )
            .await
            .map_err(|e| match e {
                crate::modules::inference::Error::Cancelled => Error::Cancelled,
                e => Error::Processing(e.code()),
            })?;
        let output = super::edit_model::validate(edit, &plan, &reply.text)?;
        let blob = self
            .assets
            .publish(
                serde_json::to_vec(&output.spec).map_err(|_| Error::Storage)?,
                crate::modules::assets::DerivedFormat::Binary,
            )
            .await
            .map_err(|_| Error::Storage)?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        self.store
            .edit_ready(edit.clone(), blob, output.message, reply.record.id)
            .await
    }
}
