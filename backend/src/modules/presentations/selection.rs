// Purpose: Resolve selected outline branches into ordered, unique presentation sections.
// Pattern: Pure scope rules over an immutable outline projection; no text copies or I/O.
// Usage: Generation admission and the scope preview API.
// Related: types.rs, sqlite/presentations/scope.rs, generation-scope.tsx.
use super::{Error, Uuid};
use serde::Serialize;
use std::collections::HashSet;
#[derive(Clone, Serialize)]
pub(crate) struct GenerationSection {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub title: String,
}
#[derive(Serialize)]
pub(crate) struct GenerationScope {
    pub outline_revision_id: Uuid,
    pub sections: Vec<GenerationSection>,
}
pub(crate) fn resolve_scope(
    sections: &[GenerationSection],
    requested: Option<&[Uuid]>,
) -> Result<Vec<Uuid>, Error> {
    let chosen: HashSet<_> = requested.map_or_else(
        || sections.iter().map(|n| n.id).collect(),
        |ids| ids.iter().copied().collect(),
    );
    if chosen.is_empty()
        || requested.is_some_and(|ids| ids.len() != chosen.len())
        || chosen
            .iter()
            .any(|id| !sections.iter().any(|n| n.id == *id))
    {
        return Err(Error::Invalid);
    }
    let mut selected = vec![];
    for leaf in sections
        .iter()
        .filter(|n| !sections.iter().any(|c| c.parent_id == Some(n.id)))
    {
        let mut current = Some(leaf.id);
        let mut steps = 0;
        while let Some(id) = current {
            if chosen.contains(&id) {
                selected.push(leaf.id);
                break;
            }
            steps += 1;
            if steps > sections.len() {
                return Err(Error::Invalid);
            }
            current = sections
                .iter()
                .find(|n| n.id == id)
                .ok_or(Error::Invalid)?
                .parent_id;
        }
    }
    if selected.is_empty() || selected.len() > 24 {
        return Err(Error::Invalid);
    }
    Ok(selected)
}
impl super::Presentations {
    pub async fn generation_scope(&self, p: Uuid, design: Uuid) -> Result<GenerationScope, Error> {
        self.store.generation_scope(p, design).await
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn branches_expand_without_duplicates_and_keep_outline_order() {
        let ids: Vec<_> = (0..5).map(|_| Uuid::new_v4()).collect();
        let rows: Vec<_> = ids
            .iter()
            .enumerate()
            .map(|(i, id)| GenerationSection {
                id: *id,
                parent_id: match i {
                    1 | 2 => Some(ids[0]),
                    4 => Some(ids[3]),
                    _ => None,
                },
                title: String::new(),
            })
            .collect();
        assert_eq!(
            resolve_scope(&rows, Some(&[ids[3], ids[0], ids[1]])).unwrap(),
            vec![ids[1], ids[2], ids[4]]
        );
        assert_eq!(resolve_scope(&rows, Some(&[ids[2]])).unwrap(), vec![ids[2]]);
        assert!(resolve_scope(&rows, Some(&[])).is_err());
        assert!(resolve_scope(&rows, Some(&[ids[0], ids[0]])).is_err());
        assert!(resolve_scope(&rows, Some(&[Uuid::new_v4()])).is_err());
    }
}
