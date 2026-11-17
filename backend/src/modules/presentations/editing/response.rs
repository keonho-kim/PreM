// Purpose: Own slide editing response rules.
// Pattern: Request composition and response validation have separate owners.
// Usage: The feature worker calls this task facade.
// Related: prompts/editing.rs, commands.rs.
use super::*;
use serde_json::Value;
pub(in crate::modules::presentations) fn validate(
    edit: &Edit,
    plan: &EditPlan,
    text: &str,
) -> Result<EditOutput, Error> {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Proposal {
        tool: String,
        message: String,
        changes: serde_json::Map<String, Value>,
    }
    let proposal: Proposal =
        serde_json::from_str(text).map_err(|_| Error::Processing("invalid_edit"))?;
    if proposal.tool != "propose_slide_patch"
        || proposal.message.trim().is_empty()
        || proposal.message.chars().count() > 500
        || proposal.changes.len() != edit.fields.len()
        || proposal.changes.keys().any(|k| !edit.fields.contains(k))
    {
        return Err(Error::Processing("invalid_edit"));
    }
    let mut spec = plan.original.clone();
    for (field, value) in proposal.changes {
        if value.is_null() {
            continue;
        }
        match field.as_str() {
            "title" => {
                spec.title =
                    serde_json::from_value(value).map_err(|_| Error::Processing("invalid_edit"))?
            }
            "bullets" => {
                spec.bullets =
                    serde_json::from_value(value).map_err(|_| Error::Processing("invalid_edit"))?
            }
            "notes" => {
                spec.notes =
                    serde_json::from_value(value).map_err(|_| Error::Processing("invalid_edit"))?
            }
            "layout" => {
                spec.layout = Some(
                    serde_json::from_value(value).map_err(|_| Error::Processing("invalid_edit"))?,
                );
                spec.schema_version = spec.schema_version.max(2);
            }
            "objects" => {
                let changes: Vec<SlideObject> =
                    serde_json::from_value(value).map_err(|_| Error::Processing("invalid_edit"))?;
                if !edit.object_ids.is_empty() {
                    if edit
                        .object_ids
                        .iter()
                        .any(|id| !plan.original.objects.iter().any(|o| &o.id == id))
                        || changes.iter().any(|o| !edit.object_ids.contains(&o.id))
                    {
                        return Err(Error::Processing("invalid_edit"));
                    }
                    spec.objects = plan
                        .original
                        .objects
                        .iter()
                        .filter_map(|o| {
                            if edit.object_ids.contains(&o.id) {
                                changes.iter().find(|c| c.id == o.id).cloned()
                            } else {
                                Some(o.clone())
                            }
                        })
                        .collect();
                } else {
                    spec.objects = changes;
                }
                spec.schema_version = spec.schema_version.max(2);
            }
            _ => return Err(Error::Processing("invalid_edit")),
        }
    }
    super::super::authoring::validate_spec(&spec)?;
    if spec.objects.iter().any(|o| match &o.content {
        ObjectContent::Reference { reference_id } => {
            !edit.references.iter().any(|m| m.id == *reference_id)
        }
        ObjectContent::Image { media_id } => !edit.media.iter().any(|m| m.id == *media_id),
        _ => false,
    }) {
        return Err(Error::Processing("invalid_edit"));
    }
    Ok(EditOutput {
        spec,
        message: proposal.message,
    })
}
