// Purpose: Provide the official shadcn/ui progress primitive for Space.
// Pattern: Radix behavior with Folio color bindings.
// Usage: Shared production component; feature owns its data and state.
// Related: frontend/components.sources.json, frontend/THIRD_PARTY_NOTICES.md.

import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';

import { cn } from '@/lib/utils';

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    value={value}
    className={cn(
      'relative h-2 w-full overflow-hidden rounded-full bg-[var(--color-paper-3)]',
      className,
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-[var(--color-accent)] motion-safe:transition-transform"
      style={value == null ? undefined : { transform: `translateX(-${100 - value}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
