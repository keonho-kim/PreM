// Purpose: Reserve the actual sticky navigation/stepper height for Studio reading surfaces.
// Pattern: One observer lifecycle per mounted Studio stepper, with resize fallback and cleanup.
// Usage: StudioStepper owns the ref; editor and evidence panes consume the shared CSS variable.
// Related: stepper.tsx, studio.css, features/related-documents/evidence-workbench.css.
import { useLayoutEffect, useRef } from 'react';
export function useStudioChrome() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = ref.current,
      header = document.querySelector('.app-header');
    if (!nav || !header) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue('--studio-sticky-height');
    const measure = () => {
      const top = header.getBoundingClientRect().height;
      nav.style.setProperty('--studio-nav-offset', `${top}px`);
      root.style.setProperty(
        '--studio-sticky-height',
        `${top + nav.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(header);
    observer?.observe(nav);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      if (previous) root.style.setProperty('--studio-sticky-height', previous);
      else root.style.removeProperty('--studio-sticky-height');
    };
  }, []);
  return ref;
}
