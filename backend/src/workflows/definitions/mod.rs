// Purpose: Pin implemented feature graphs and node versions.
// Pattern: Static validated DAG, independent from business handlers and persisted input records.
// Usage: New and recovered presentation runs must match this supported definition exactly.
// Related: engine/graph.rs, presentations/execution.rs, V23 migration.
use super::engine::{Definition, Node};
pub(crate) const PRESENTATION: Definition = Definition {
    key: "presentation",
    version: 1,
    signature: "presentation-v1:write@1>render@1>publish@1",
    nodes: &[
        Node {
            key: "write",
            version: 1,
            dependencies: &[],
        },
        Node {
            key: "render",
            version: 1,
            dependencies: &["write"],
        },
        Node {
            key: "publish",
            version: 1,
            dependencies: &["render"],
        },
    ],
};

// Extraction includes conditional OCR, normalized block storage and the existing atomic FTS update.
pub(crate) const DOCUMENT: Definition = Definition {
    key: "document",
    version: 1,
    signature: "document-v1:extract@1>classify@1>ready@1",
    nodes: &[
        Node {
            key: "extract",
            version: 1,
            dependencies: &[],
        },
        Node {
            key: "classify",
            version: 1,
            dependencies: &["extract"],
        },
        Node {
            key: "ready",
            version: 1,
            dependencies: &["classify"],
        },
    ],
};
pub(crate) const TEMPLATE: Definition = Definition {
    key: "template",
    version: 1,
    signature: "template-v1:extract@1>ready@1",
    nodes: &[
        Node {
            key: "extract",
            version: 1,
            dependencies: &[],
        },
        Node {
            key: "ready",
            version: 1,
            dependencies: &["extract"],
        },
    ],
};

pub(crate) const OUTLINE: Definition = Definition {
    key: "outline",
    version: 1,
    signature: "outline-v1:compose@1>publish@1",
    nodes: &[
        Node {
            key: "compose",
            version: 1,
            dependencies: &[],
        },
        Node {
            key: "publish",
            version: 1,
            dependencies: &["compose"],
        },
    ],
};
pub(crate) const MAPPING: Definition = Definition {
    key: "mapping",
    version: 1,
    signature: "mapping-v1:map@1>publish@1",
    nodes: &[
        Node {
            key: "map",
            version: 1,
            dependencies: &[],
        },
        Node {
            key: "publish",
            version: 1,
            dependencies: &["map"],
        },
    ],
};

pub(crate) const RELATION: Definition = Definition {
    key: "relation",
    version: 1,
    signature: "relation-v1:retrieve@1>review@1>publish@1",
    nodes: &[
        Node {
            key: "retrieve",
            version: 1,
            dependencies: &[],
        },
        Node {
            key: "review",
            version: 1,
            dependencies: &["retrieve"],
        },
        Node {
            key: "publish",
            version: 1,
            dependencies: &["review"],
        },
    ],
};

pub(crate) const SLIDE_EDIT: Definition = Definition {
    key: "slide_edit",
    version: 1,
    signature: "slide-edit-v1:propose@1>render@1",
    nodes: &[
        Node {
            key: "propose",
            version: 1,
            dependencies: &[],
        },
        Node {
            key: "render",
            version: 1,
            dependencies: &["propose"],
        },
    ],
};
