// Purpose: Validate bounded inputs and complete choice results before routing or history success.
// Pattern: Reject missing/unknown answers and invalid statistics; never interpret failures as zero.
// Usage: Service input admission and both adapter output paths.
// Related: types.rs, mod.rs, adapters/decisions/.
use super::{Batch, Evaluation};
use crate::modules::{model_execution::Error, model_registry};
impl Batch {
    pub fn validate(&self) -> Result<(), Error> {
        let invalid = || {
            Error::Registry(model_registry::Error::Invalid(
                "판정 입력은 32 KiB 이내, 질문은 1~16개, 선택지는 2~16개로 입력하세요. ID는 영문·숫자·밑줄·하이픈 1~64자입니다.",
            ))
        };
        if !(self.state.is_string() || self.state.is_object() || self.state.is_array())
            || self.state.as_str().is_some_and(|s| s.trim().is_empty())
            || serde_json::to_vec(self).map_err(|_| invalid())?.len() > 32 * 1024
            || !(1..=16).contains(&self.questions.len())
        {
            return Err(invalid());
        }
        for (id, q) in &self.questions {
            if !identifier(id)
                || q.instructions().trim().is_empty()
                || q.instructions().len() > 2048
                || !(2..=16).contains(&q.criteria().len())
            {
                return Err(invalid());
            }
            for (label, description) in q.criteria() {
                if !identifier(label) || description.trim().is_empty() || description.len() > 2048 {
                    return Err(invalid());
                }
            }
        }
        Ok(())
    }
    pub fn validate_result(&self, r: &Evaluation) -> Result<(), Error> {
        if r.answers.len() != self.questions.len()
            || r.model.is_empty()
            || r.model.len() > 200
            || r.model.chars().any(char::is_control)
        {
            return Err(Error::InvalidResponse);
        }
        for (id, q) in &self.questions {
            let a = r.answers.get(id).ok_or(Error::InvalidResponse)?;
            if !q.criteria().contains_key(&a.choice) {
                return Err(Error::InvalidResponse);
            }
            match (&a.probabilities, a.confidence, r.statistics) {
                (None, None, "unavailable") => (),
                (Some(p), Some(c), "provider_reported") => {
                    if !unit(c)
                        || p.len() != q.criteria().len()
                        || p.iter()
                            .any(|(k, v)| !q.criteria().contains_key(k) || !unit(*v))
                        || (p.values().sum::<f64>() - 1.0).abs() > 0.001
                    {
                        return Err(Error::InvalidResponse);
                    }
                    let selected = p.get(&a.choice).ok_or(Error::InvalidResponse)?;
                    if p.values().any(|v| *v > *selected + 0.000001) {
                        return Err(Error::InvalidResponse);
                    }
                }
                _ => return Err(Error::InvalidResponse),
            }
        }
        Ok(())
    }
}
fn identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn unit(v: f64) -> bool {
    v.is_finite() && (0.0..=1.0).contains(&v)
}
