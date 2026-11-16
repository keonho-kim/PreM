// Purpose: Validate a two-level ordered outline and duplicate-free canonical assignments.
// Pattern: Deterministic rules are shared by manual commits and model proposal application.
// Usage: Domain facade and atomic revision commit.
// Related: types.rs, model.rs.
use super::*;
use std::collections::HashSet;
pub(super) fn draft(d: &Draft) -> Result<(), Error> {
    if d.nodes.is_empty() || d.nodes.len() > 24 || d.assignments.len() > 4000 {
        return Err(Error::Invalid);
    }
    let mut seen = HashSet::new();
    let mut roots = HashSet::new();
    let mut current = None;
    for n in &d.nodes {
        if !seen.insert(n.id)
            || n.title.trim().is_empty()
            || n.title.chars().count() > 120
            || n.description.chars().count() > 1000
        {
            return Err(Error::Invalid);
        }
        if let Some(parent) = n.parent_id {
            if !roots.contains(&parent) || current != Some(parent) {
                return Err(Error::Invalid);
            }
        } else {
            roots.insert(n.id);
            current = Some(n.id);
        }
    }
    let mut links = HashSet::new();
    for a in &d.assignments {
        if !seen.contains(&a.node_id) || !links.insert((a.node_id, a.block_id)) {
            return Err(Error::Invalid);
        }
    }
    Ok(())
}
