// Purpose: Convert semantic Markdown blocks while preserving source positions and table boundaries.
// Pattern: One canonical text value; metadata references cell byte ranges rather than copying text.
// Usage: Called after bounded Comrak parsing; checks cancellation and output limits during traversal.
// Related: mod.rs, inline.rs, modules/documents/types.rs.
use crate::modules::documents::{Error, ExtractedBlock};
use comrak::nodes::{AstNode, ListType, NodeValue};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
pub(super) fn convert<'a>(
    root: &'a AstNode<'a>,
    cancel: &CancellationToken,
) -> Result<Vec<ExtractedBlock>, Error> {
    let mut blocks = Vec::new();
    for (count, node) in root.descendants().enumerate() {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if count > 200000 || node.ancestors().take(130).count() > 128 {
            return Err(Error::Processing("extraction_limit"));
        }
        if node
            .ancestors()
            .skip(1)
            .any(|p| matches!(p.data.borrow().value, NodeValue::Table(_)))
        {
            continue;
        }
        let data = node.data.borrow();
        let pos = data.sourcepos;
        let mut attributes = json!({"source":{"start_line":pos.start.line,"start_column":pos.start.column,"end_line":pos.end.line,"end_column":pos.end.column,"column_unit":"unicode_characters"}});
        let (kind, text, refs) = match &data.value {
            NodeValue::Heading(heading) => {
                attributes["level"] = json!(heading.level);
                let (s, r) = super::inline::content(node);
                ("heading", s, r)
            }
            NodeValue::Paragraph => {
                let (s, r) = super::inline::content(node);
                let mut list = false;
                let mut quotes = 0;
                for parent in node.ancestors().skip(1) {
                    match &parent.data.borrow().value {
                        NodeValue::List(v) => {
                            list = true;
                            if attributes.get("list").is_none() {
                                attributes["list"] = json!({"ordered":v.list_type==ListType::Ordered,"start":v.start});
                            }
                        }
                        NodeValue::TaskItem(v) => {
                            attributes["checked"] = json!(v.symbol.is_some());
                        }
                        NodeValue::BlockQuote => quotes += 1,
                        _ => (),
                    }
                }
                if quotes > 0 {
                    attributes["quote_depth"] = json!(quotes);
                }
                (if list { "list" } else { "paragraph" }, s, r)
            }
            NodeValue::CodeBlock(code) => {
                attributes["language"] = json!(code.info);
                ("code", code.literal.clone(), vec![])
            }
            NodeValue::HtmlBlock(html) => {
                attributes["language"] = json!("html");
                attributes["literal_html"] = json!(true);
                ("code", html.literal.clone(), vec![])
            }
            NodeValue::Table(table) => {
                attributes["rows"] = json!(table.num_rows);
                attributes["cols"] = json!(table.num_columns);
                attributes["alignments"] = json!(
                    table
                        .alignments
                        .iter()
                        .map(|v| format!("{v:?}").to_lowercase())
                        .collect::<Vec<_>>()
                );
                for (row_number, row) in node.children().enumerate() {
                    let mut attrs = attributes.clone();
                    attrs["row"] = json!(row_number);
                    attrs["header"] =
                        json!(matches!(row.data.borrow().value, NodeValue::TableRow(true)));
                    let mut text = String::new();
                    let mut cells = Vec::new();
                    let mut refs = Vec::new();
                    for (col, cell) in row.children().enumerate() {
                        if col > 0 {
                            text.push('\t');
                        }
                        let (value, links) = super::inline::content(cell);
                        let start = text.len();
                        text.push_str(&value);
                        refs.extend(links);
                        cells.push(json!({"column":col,"start":start,"end":text.len(),"row_span":1,"col_span":1}));
                    }
                    attrs["cells"] = json!(cells);
                    attrs["references"] = json!(refs);
                    emit(&mut blocks, "table", text, attrs)?;
                }
                continue;
            }
            NodeValue::ThematicBreak => ("paragraph", "---".into(), vec![]),
            _ => continue,
        };
        if !refs.is_empty() {
            attributes["references"] = json!(refs);
        }
        emit(&mut blocks, kind, text, attributes)?;
    }
    if serde_json::to_vec(&blocks)
        .map_err(|_| Error::Storage)?
        .len()
        > 15 * 1024 * 1024
    {
        return Err(Error::Processing("extraction_limit"));
    }
    Ok(blocks)
}
fn emit(
    blocks: &mut Vec<ExtractedBlock>,
    kind: &str,
    text: String,
    attributes: Value,
) -> Result<(), Error> {
    if text.is_empty() {
        return Ok(());
    }
    if attributes.to_string().len() > 65536 {
        return Err(Error::Processing("extraction_limit"));
    }
    let mut remaining = text.as_str();
    let mut start = 0;
    while !remaining.is_empty() {
        let end = remaining.floor_char_boundary(remaining.len().min(6000));
        let mut attrs = attributes.clone();
        attrs["text_offset"] = json!(start);
        attrs["offset_unit"] = json!("utf8_bytes");
        blocks.push(ExtractedBlock {
            kind: kind.into(),
            text: remaining[..end].into(),
            attributes: attrs,
        });
        if blocks.len() > 20000 {
            return Err(Error::Processing("extraction_limit"));
        }
        remaining = &remaining[end..];
        start += end;
    }
    Ok(())
}
