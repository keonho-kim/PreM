// Purpose: Provide the official shadcn/ui checkbox with Folio and mixed-selection bindings.
// Pattern: Radix owns activation, keyboard, form and indeterminate semantics.
// Usage: Production checkbox groups, including generation scope.
// Related: components.sources.json, THIRD_PARTY_NOTICES.md (upstream MIT license).
'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'grid place-content-center peer size-4 shrink-0 rounded-[4px] border border-[var(--color-ink-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--color-ink)] data-[state=checked]:text-[var(--color-paper)] data-[state=indeterminate]:bg-[var(--color-ink)] data-[state=indeterminate]:text-[var(--color-paper)]',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn('grid place-content-center text-current')}>
      {props.checked === 'indeterminate' ? (
        <Minus aria-hidden="true" className="size-3.5" />
      ) : (
        <Check aria-hidden="true" className="size-3.5" />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
