// Purpose: Provide official shadcn collapsible source for persistent work feedback.
// Pattern: Existing Radix family and light-only Folio adaptation.
// Usage: Composed by application feedback and the upload work panel.
// Related: components.sources.json, THIRD_PARTY_NOTICES.md.

import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';

const Collapsible = CollapsiblePrimitive.Root;

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
