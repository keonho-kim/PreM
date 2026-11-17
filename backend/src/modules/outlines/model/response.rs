// Purpose: Validate proposed outline identities and mappings.
// Pattern: Request composition and response validation have separate owners.
// Usage: The feature worker calls this task facade.
// Related: validation.rs, request.rs.
use super::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Generated {
    nodes: Vec<Proposed>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Proposed {
    key: String,
    parent_key: String,
    title: String,
    description: String,
    block_keys: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Mapped {
    assignments: Vec<Link>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Link {
    block_key: String,
    node_keys: Vec<String>,
}
pub(in crate::modules::outlines) fn validate(
    kind: &str,
    plan: &Plan,
    text: &str,
) -> Result<Value, Error> {
    if kind == "generate" {
        let g: Generated =
            serde_json::from_str(text).map_err(|_| Error::Model("invalid_model_response"))?;
        let value = serde_json::to_value(g).map_err(|_| Error::Storage)?;
        generated_draft(&value, &plan.blocks)?;
        Ok(value)
    } else {
        let m: Mapped =
            serde_json::from_str(text).map_err(|_| Error::Model("invalid_model_response"))?;
        let value = serde_json::to_value(m).map_err(|_| Error::Storage)?;
        mapped_assignments(&value, &plan.blocks, &plan.nodes)?;
        Ok(value)
    }
}
pub(crate) fn generated_draft(value: &Value, blocks: &[(String, Uuid)]) -> Result<Draft, Error> {
    let g: Generated = serde_json::from_value(value.clone()).map_err(|_| Error::Invalid)?;
    let source: HashMap<_, _> = blocks.iter().cloned().collect();
    let mut keys = HashMap::new();
    for n in &g.nodes {
        if n.key.is_empty()
            || n.key.len() > 32
            || n.description.chars().count() > 500
            || n.block_keys.len() > 20
            || keys.insert(n.key.clone(), Uuid::new_v4()).is_some()
        {
            return Err(Error::Invalid);
        }
    }
    let mut draft = Draft {
        nodes: vec![],
        assignments: vec![],
    };
    for n in g.nodes {
        let id = *keys.get(&n.key).ok_or(Error::Invalid)?;
        let parent_id = if n.parent_key.is_empty() {
            None
        } else {
            Some(*keys.get(&n.parent_key).ok_or(Error::Invalid)?)
        };
        draft.nodes.push(Node {
            id,
            parent_id,
            title: n.title,
            description: n.description,
        });
        for key in n.block_keys {
            draft.assignments.push(Assignment {
                node_id: id,
                block_id: *source.get(&key).ok_or(Error::Invalid)?,
            });
        }
    }
    super::validation::draft(&draft)?;
    Ok(draft)
}
pub(crate) fn mapped_assignments(
    value: &Value,
    blocks: &[(String, Uuid)],
    nodes: &[(String, Uuid)],
) -> Result<Vec<Assignment>, Error> {
    let m: Mapped = serde_json::from_value(value.clone()).map_err(|_| Error::Invalid)?;
    let source: HashMap<_, _> = blocks.iter().cloned().collect();
    let targets: HashMap<_, _> = nodes.iter().cloned().collect();
    let mut seen = HashSet::new();
    let mut out = vec![];
    for link in m.assignments {
        let block_id = *source.get(&link.block_key).ok_or(Error::Invalid)?;
        if !seen.insert(link.block_key) || link.node_keys.len() > 2 {
            return Err(Error::Invalid);
        }
        let mut assigned = HashSet::new();
        for n in link.node_keys {
            let node_id = *targets.get(&n).ok_or(Error::Invalid)?;
            if !assigned.insert(node_id) {
                return Err(Error::Invalid);
            }
            out.push(Assignment { node_id, block_id });
        }
    }
    if seen.len() != blocks.len() {
        return Err(Error::Invalid);
    }
    Ok(out)
}
