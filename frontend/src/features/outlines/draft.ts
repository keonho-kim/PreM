// Purpose: Apply local two-level outline edits while retaining stable node identity.
// Pattern: Pure transitions keep visual order, DOM order and assignment ownership aligned.
// Usage: Editor controls; persistence validates the same hierarchy independently.
// Related: nodes.tsx, api.ts.
import type { Draft, OutlineNode } from './api';
function arrange(nodes: OutlineNode[]) {
  return nodes
    .filter((n) => !n.parent_id)
    .flatMap((root) => [root, ...nodes.filter((n) => n.parent_id === root.id)]);
}
export function update(draft: Draft, id: string, values: Partial<OutlineNode>): Draft {
  return {
    ...draft,
    nodes: arrange(draft.nodes.map((n) => (n.id === id ? { ...n, ...values } : n))),
  };
}
export function add(draft: Draft, parent: string | null): Draft {
  return {
    ...draft,
    nodes: arrange([
      ...draft.nodes,
      {
        id: crypto.randomUUID(),
        parent_id: parent,
        title: parent ? '새 중목차' : '새 대목차',
        description: '',
      },
    ]),
  };
}
export function remove(draft: Draft, id: string): Draft {
  const removed = new Set(
    draft.nodes.filter((n) => n.id === id || n.parent_id === id).map((n) => n.id),
  );
  return {
    nodes: draft.nodes.filter((n) => !removed.has(n.id)),
    assignments: draft.assignments.filter((a) => !removed.has(a.node_id)),
  };
}
export function move(draft: Draft, id: string, delta: number): Draft {
  const node = draft.nodes.find((n) => n.id === id);
  if (!node) return draft;
  const peers = draft.nodes.filter((n) => n.parent_id === node.parent_id),
    index = peers.findIndex((n) => n.id === id),
    next = index + delta;
  if (next < 0 || next >= peers.length) return draft;
  const first = peers[index],
    second = peers[next];
  if (!first || !second) return draft;
  [peers[index], peers[next]] = [second, first];
  let at = 0;
  const nodes = draft.nodes.map((n) => (n.parent_id === node.parent_id ? (peers[at++] ?? n) : n));
  return { ...draft, nodes: arrange(nodes) };
}
