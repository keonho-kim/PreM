// Purpose: Validate bounded DAG definitions and select dependency-ready nodes deterministically.
// Pattern: No clocks or I/O; graph errors are rejected before a handler can run.
// Usage: Engine executes one ready node at a time; joins require all dependencies to complete.
// Related: definitions/, engine/mod.rs.
#[derive(Clone, Copy)]
pub(crate) struct Node {
    pub key: &'static str,
    pub version: i64,
    pub dependencies: &'static [&'static str],
}
#[derive(Clone, Copy)]
pub(crate) struct Definition {
    pub key: &'static str,
    pub version: i64,
    pub signature: &'static str,
    pub nodes: &'static [Node],
}
impl Definition {
    pub fn valid(&self) -> bool {
        if self.key.is_empty()
            || self.version < 1
            || self.signature.is_empty()
            || self.nodes.is_empty()
            || self.nodes.len() > 64
        {
            return false;
        }
        let keys: std::collections::HashSet<_> = self.nodes.iter().map(|n| n.key).collect();
        if keys.len() != self.nodes.len()
            || self.nodes.iter().any(|n| {
                n.key.is_empty()
                    || n.version < 1
                    || n.dependencies
                        .iter()
                        .any(|d| *d == n.key || !keys.contains(d))
            })
        {
            return false;
        }
        let mut done = vec![];
        while done.len() < self.nodes.len() {
            let Some(n) = self.next(&done) else {
                return false;
            };
            done.push(n.key);
        }
        true
    }
    pub fn next(&self, done: &[&str]) -> Option<Node> {
        self.nodes
            .iter()
            .find(|n| !done.contains(&n.key) && n.dependencies.iter().all(|d| done.contains(d)))
            .copied()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn branching_join_and_invalid_graphs() {
        let d = Definition {
            key: "test",
            version: 1,
            signature: "v1",
            nodes: &[
                Node {
                    key: "a",
                    version: 1,
                    dependencies: &[],
                },
                Node {
                    key: "b",
                    version: 1,
                    dependencies: &[],
                },
                Node {
                    key: "join",
                    version: 1,
                    dependencies: &["a", "b"],
                },
            ],
        };
        assert!(d.valid());
        assert_eq!(d.next(&["a"]).unwrap().key, "b");
        assert_eq!(d.next(&["a", "b"]).unwrap().key, "join");
        assert!(
            !Definition {
                nodes: &[
                    Node {
                        key: "a",
                        version: 1,
                        dependencies: &["b"]
                    },
                    Node {
                        key: "b",
                        version: 1,
                        dependencies: &["a"]
                    }
                ],
                ..d
            }
            .valid()
        );
        assert!(
            !Definition {
                nodes: &[Node {
                    key: "a",
                    version: 1,
                    dependencies: &["missing"]
                }],
                ..d
            }
            .valid()
        );
    }
}
