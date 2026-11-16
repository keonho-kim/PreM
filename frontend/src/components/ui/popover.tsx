// Purpose: Provide the official shadcn/ui popover primitive adapted to Folio.
// Pattern: Upstream Radix composition; local visual and accessibility adjustments.
// Usage: Imported by production feature components.
// Related: frontend/components.sources.json, frontend/THIRD_PARTY_NOTICES.md.
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 rounded-lg border bg-[var(--color-paper)] p-4 text-[var(--color-ink)] shadow-md outline-none           origin-[var(--radix-popover-content-transform-origin)]',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
export { Popover, PopoverContent, PopoverTrigger };
