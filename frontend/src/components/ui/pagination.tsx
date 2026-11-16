// Purpose: Provide the official shadcn/ui pagination primitive adapted to Folio.
// Pattern: Upstream Radix composition; local visual and accessibility adjustments.
// Usage: Imported by production feature components.
// Related: frontend/components.sources.json, frontend/THIRD_PARTY_NOTICES.md.
import * as React from 'react';
import { cn } from '@/lib/utils';
const Pagination = ({ className, ...props }: React.ComponentProps<'nav'>) => (
  <nav
    aria-label="페이지 이동"
    className={cn('mx-auto flex w-full justify-center', className)}
    {...props}
  />
);
Pagination.displayName = 'Pagination';
const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('flex flex-row items-center gap-1', className)} {...props} />
  ),
);
PaginationContent.displayName = 'PaginationContent';
const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn('', className)} {...props} />,
);
PaginationItem.displayName = 'PaginationItem';
export { Pagination, PaginationContent, PaginationItem };
