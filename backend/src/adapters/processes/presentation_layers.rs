// Purpose: Parse the bounded file manifest emitted by passive artwork rasterization.
// Pattern: File identity is checked against fixed owned filenames before Blob publication.
// Usage: Presentation renderer; no input paths or URLs can be supplied by a model.
// Related: presentation-previews.mjs, presentations/layers.rs.
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LayerFile {
    pub id: String,
    pub frame: crate::modules::presentations::Frame,
    pub file: String,
}
