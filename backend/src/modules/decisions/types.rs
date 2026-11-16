// Purpose: Define bounded choice decisions independently of generation protocols.
// Pattern: Caller supplies state and named questions; outputs carry optional reported statistics.
// Usage: HTTP validates a batch before invoking the Decision service.
// Related: mod.rs, validation.rs, adapters/decisions/.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Batch {
    pub state: Value,
    #[serde(deserialize_with = "unique_map")]
    pub questions: BTreeMap<String, Question>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Question {
    Choice {
        instructions: String,
        #[serde(deserialize_with = "unique_map")]
        criteria: BTreeMap<String, String>,
    },
}
impl Question {
    pub fn criteria(&self) -> &BTreeMap<String, String> {
        match self {
            Self::Choice { criteria, .. } => criteria,
        }
    }
    pub fn instructions(&self) -> &str {
        match self {
            Self::Choice { instructions, .. } => instructions,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Answer {
    pub choice: String,
    pub probabilities: Option<BTreeMap<String, f64>>,
    pub confidence: Option<f64>,
}
#[derive(Serialize)]
pub(crate) struct Evaluation {
    pub answers: BTreeMap<String, Answer>,
    pub statistics: &'static str,
    pub model: String,
}
// Prevent overwritten question/option IDs before validation sees a map.
fn unique_map<'de, D, T>(d: D) -> Result<BTreeMap<String, T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Visitor<T>(std::marker::PhantomData<T>);
    impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for Visitor<T> {
        type Value = BTreeMap<String, T>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("an object with unique keys")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(
            self,
            mut map: M,
        ) -> Result<Self::Value, M::Error> {
            let mut result = BTreeMap::new();
            while let Some((key, value)) = map.next_entry::<String, T>()? {
                if result.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom("duplicate key"));
                }
            }
            Ok(result)
        }
    }
    d.deserialize_map(Visitor(std::marker::PhantomData))
}
