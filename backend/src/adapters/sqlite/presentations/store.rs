// Purpose: Bind the presentation persistence facade to its single asynchronous SQLite writer.
// Pattern: Thin typed delegation; private modules own actual reads, transactions and domain checks.
// Usage: Application composition injects this one Store implementation.
// Related: mod.rs, modules/presentations/mod.rs, plans.rs, reference_generation.rs.
use super::*;
impl Store for SqlitePresentations {
    fn generation_scope(&self, p: Uuid, design: Uuid) -> Work<GenerationScope> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| scope::current(db, p, design)).await })
    }
    fn material_sources(&self, p: Uuid, r: Uuid, s: Uuid) -> Work<Vec<MaterialSource>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| references::sources(db, p, r, s)).await })
    }
    fn generation_materials(&self, r: Run) -> Work<Vec<ImportedMaterial>> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| reference_generation::materials(db, r))
                .await
        })
    }
    fn generation_imports(&self, r: Run) -> Work<Option<(String, Vec<ImportedMaterial>)>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| reference_generation::plan(db, r)).await })
    }
    fn apply_generation_imports(&self, r: Run, specs: Vec<InsertedSpec>) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| reference_generation::apply(db, r, specs))
                .await
        })
    }

    fn edit_begin_node(&self, e: Edit, n: crate::workflows::engine::Node) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::begin_node(db, e, n)).await })
    }
    fn edit_finish_node(&self, e: Edit, n: crate::workflows::engine::Node) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::finish_node(db, e, n)).await })
    }

    fn imports(&self, p: Uuid) -> Work<Vec<ImportedMaterial>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| references::list(db, p)).await })
    }
    fn insertion_plan(
        &self,
        p: Uuid,
        r: Uuid,
        k: Uuid,
        i: &InsertMaterials,
    ) -> Work<InsertionPlan> {
        let q = self.0.clone();
        let i = i.clone();
        Box::pin(async move { q.call(move |db| references::plan(db, p, r, k, &i)).await })
    }
    fn insert_materials(&self, commit: InsertionCommit) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| references::commit(db, commit)).await })
    }
    fn begin_node(&self, r: Run, n: crate::workflows::engine::Node) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::begin(db, r, n)).await })
    }
    fn finish_node(&self, r: Run, n: crate::workflows::engine::Node) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::finish(db, r, n)).await })
    }
    fn store_render(&self, r: Run, o: Rendered) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::store_render(db, r, o)).await })
    }
    fn rendered(&self, r: Run) -> Work<Option<Rendered>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| execution::rendered(db, r)).await })
    }

    fn open_editor(&self, p: Uuid, r: Uuid, id: Uuid) -> Work<Uuid> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| sessions::open(db, p, r, id)).await })
    }
    fn touch_editor(&self, p: Uuid, id: Uuid) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| sessions::touch(db, p, id)).await })
    }
    fn close_editor(&self, p: Uuid, id: Uuid) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| sessions::close(db, p, id)).await })
    }
    fn expire_editors(&self, all: bool) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| sessions::expire(db, all)).await })
    }

    fn history(&self, p: Uuid, r: Uuid, session: Option<Uuid>) -> Work<History> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| history::read(db, p, r, session)).await })
    }
    fn undo(&self, p: Uuid, r: Uuid, k: Uuid, v: i64, session: Uuid) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| history::undo(db, p, r, k, v, session))
                .await
        })
    }
    fn edit_render_source(&self, e: Edit) -> Work<(Vec<StoredSlide>, Option<String>)> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::render_source(db, e)).await })
    }
    fn edit_render_ready(&self, e: Edit, r: Rendered) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::render_ready(db, e, r)).await })
    }
    fn edit_preview(&self, p: Uuid, id: Uuid, s: Uuid) -> Work<File> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::preview(db, p, id, s)).await })
    }
    fn cached_render(&self, r: Run) -> Work<Option<Rendered>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::cached(db, r)).await })
    }

    fn media(&self, p: Uuid) -> Work<Vec<Media>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| media::list(db, p)).await })
    }
    fn register_media(
        &self,
        p: Uuid,
        key: Uuid,
        name: String,
        original: DerivedBlob,
        image: NormalizedImage,
    ) -> Work<Media> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| media::register(db, p, key, name, original, image))
                .await
        })
    }

    fn create_edit(
        &self,
        p: Uuid,
        r: Uuid,
        s: Uuid,
        k: Uuid,
        i: EditRequest,
        profile: String,
    ) -> Work<Edit> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| edits::create(db, p, r, s, k, i, profile))
                .await
        })
    }
    fn edits(&self, p: Uuid, r: Uuid, s: Uuid) -> Work<Vec<Edit>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::list(db, p, r, s)).await })
    }
    fn edit_command(
        &self,
        p: Uuid,
        id: Uuid,
        k: Uuid,
        v: i64,
        a: String,
        session: Option<Uuid>,
    ) -> Work<Edit> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| edits::command(db, p, id, k, v, a, session))
                .await
        })
    }
    fn claim_edit(&self) -> Work<Option<Edit>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(edits::claim).await })
    }
    fn edit_heartbeat(&self, e: Edit) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::heartbeat(db, e)).await })
    }
    fn edit_context(&self, e: Edit) -> Work<serde_json::Value> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::context(db, e)).await })
    }
    fn edit_ready(
        &self,
        e: Edit,
        target: Uuid,
        b: DerivedBlob,
        m: String,
        r: Uuid,
        assets: UsedAssets,
    ) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| edits::ready(db, e, target, b, m, r, assets))
                .await
        })
    }
    fn edit_fail(&self, e: Edit, c: String) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| edits::fail(db, e, c)).await })
    }

    fn citations(&self, p: Uuid, id: Uuid, slide: Uuid) -> Work<Vec<Citation>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| citations::read(db, p, id, slide)).await })
    }
    fn preparation(&self, p: Uuid) -> Work<Preparation> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| preparation::current(db, p)).await })
    }
    fn confirm(&self, p: Uuid, f: String) -> Work<Preparation> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| preparation::confirm(db, p, f)).await })
    }
    fn design(&self, p: Uuid, i: Design) -> Work<Preparation> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| preparation::design(db, p, i)).await })
    }
    fn create(&self, p: Uuid, k: Uuid, i: Generate, profile: String) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| admission::create(db, p, k, i, profile))
                .await
        })
    }
    fn runs(&self, p: Uuid) -> Work<Vec<Run>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::runs(db, p)).await })
    }
    fn slides(&self, p: Uuid, id: Uuid) -> Work<Vec<StoredSlide>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::slides(db, p, id)).await })
    }
    fn file(&self, p: Uuid, id: Uuid, slide: Option<Uuid>) -> Work<File> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| queries::file(db, p, id, slide)).await })
    }
    fn command(&self, p: Uuid, id: Uuid, k: Uuid, v: i64, a: String) -> Work<Run> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::command(db, p, id, k, v, a)).await })
    }
    fn claim(&self) -> Work<Option<Run>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(jobs::claim).await })
    }
    fn heartbeat(&self, r: Run) -> Work<bool> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::heartbeat(db, r)).await })
    }
    fn plan(&self, r: Run) -> Work<Option<Plan>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| plans::next(db, r)).await })
    }
    fn checkpoint(
        &self,
        r: Run,
        s: Uuid,
        b: DerivedBlob,
        ids: Vec<Uuid>,
        req: Uuid,
        refs: Vec<Uuid>,
    ) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move {
            q.call(move |db| plans::checkpoint(db, r, s, b, ids, req, refs))
                .await
        })
    }
    fn render_source(&self, r: Run) -> Work<Option<String>> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| plans::render_source(db, r)).await })
    }
    fn complete(&self, r: Run, o: Rendered) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| publish::complete(db, r, o)).await })
    }
    fn fail(&self, r: Run, c: String) -> Work<()> {
        let q = self.0.clone();
        Box::pin(async move { q.call(move |db| jobs::fail(db, r, c)).await })
    }
}
