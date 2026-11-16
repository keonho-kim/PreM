// Purpose: Provide the official shadcn/ui card primitive adapted to Folio.
// Pattern: Upstream Radix composition; local visual and accessibility adjustments.
// Usage: Imported by production feature components.
// Related: frontend/components.sources.json, frontend/THIRD_PARTY_NOTICES.md.
import * as React from 'react';
import { cn } from '@/lib/utils';
const Card = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <article
      ref={ref}
      className={cn('rounded-lg bg-background text-foreground', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';
export { Card };
