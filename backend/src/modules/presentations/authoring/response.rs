// Purpose: Validate authored slide content and source membership.
// Pattern: Request composition and response validation have separate owners.
// Usage: The feature worker calls this task facade.
// Related: request.rs, template.rs.
use super::*;
pub(in crate::modules::presentations) fn validate(
    plan: &Plan,
    text: &str,
) -> Result<SlideSpec, Error> {
    let spec = super::template::decode(plan, text)?;
    validate_spec(&spec)?;
    super::template::validate(plan, &spec)?;
    if spec.block_ids.iter().any(|b| !plan.block_ids.contains(b)) {
        return Err(Error::Processing("invalid_slide"));
    }
    Ok(spec)
}
pub(in crate::modules::presentations) fn validate_spec(spec: &SlideSpec) -> Result<(), Error> {
    let authored = spec.design.as_ref().is_some_and(|d| d.authored);
    if spec
        .design
        .as_ref()
        .is_some_and(|d| d.layout_key.is_empty() || d.layout_key.len() > 80)
        || (spec.schema_version == 4) != spec.design.is_some()
    {
        return Err(Error::Processing("invalid_slide"));
    }
    if ![1, 2, 3, 4].contains(&spec.schema_version)
        || (!authored && spec.title.trim().is_empty())
        || spec.title.chars().count() > 60
        || (spec.bullets.is_empty() && spec.schema_version != 3 && !authored)
        || spec.bullets.len() > 5
        || spec
            .bullets
            .iter()
            .any(|b| b.trim().is_empty() || b.chars().count() > 90)
        || spec.notes.chars().count() > 800
        || (spec.block_ids.is_empty() && spec.schema_version != 3 && !authored)
        || spec.block_ids.len() > 20
    {
        return Err(Error::Processing("invalid_slide"));
    }
    if spec
        .bullets
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len()
        != spec.bullets.len()
    {
        return Err(Error::Processing("invalid_slide"));
    }
    super::objects::validate(&spec.objects, &spec.layout)?;
    if serde_json::to_vec(spec).map_err(|_| Error::Storage)?.len() > 65536 {
        return Err(Error::Processing("invalid_slide"));
    }
    if spec.schema_version == 1 && (!spec.objects.is_empty() || spec.layout.is_some()) {
        return Err(Error::Processing("invalid_slide"));
    }
    let unique: std::collections::HashSet<_> = spec.block_ids.iter().collect();
    if unique.len() != spec.block_ids.len() {
        return Err(Error::Processing("invalid_slide"));
    }
    Ok(())
}
