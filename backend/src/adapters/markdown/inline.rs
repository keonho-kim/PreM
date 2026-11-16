// Purpose: Project Comrak inline nodes into inert text and link/image metadata.
// Pattern: AST traversal preserves destinations as data; no URL resolution or HTML conversion.
// Usage: Block and table-cell extraction share this converter.
// Related: blocks.rs, Comrak nodes::NodeValue.
use comrak::nodes::{AstNode, NodeValue};
use serde_json::{Value, json};
pub(super) fn content<'a>(node: &'a AstNode<'a>) -> (String, Vec<Value>) {
    let mut text = String::new();
    let mut references = Vec::new();
    for child in node.descendants() {
        match &child.data.borrow().value {
            NodeValue::Text(value) => text.push_str(value),
            NodeValue::Code(value) => text.push_str(&value.literal),
            NodeValue::SoftBreak | NodeValue::LineBreak => text.push('\n'),
            NodeValue::HtmlInline(value) => text.push_str(value),
            NodeValue::FootnoteReference(value) => text.push_str(&format!("[^{}]", value.name)),
            NodeValue::Link(link) | NodeValue::Image(link) => {
                let kind = if matches!(child.data.borrow().value, NodeValue::Image(_)) {
                    "image"
                } else {
                    "link"
                };
                references.push(json!({"kind":kind,"destination":link.url,"title":link.title}));
                if kind == "image" {
                    text.push_str("[이미지] ");
                }
            }
            _ => (),
        }
    }
    (text, references)
}
