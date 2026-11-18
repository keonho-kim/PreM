// Purpose: Compose Admin-only side navigation and URL-addressable feature views.
// Pattern: Router owns section/provider/tab; shadcn owns disclosure and tab interactions.
// Usage: /home/admin with section, provider and tab query parameters; startup-token gate.
// Related: features/providers/, features/system-status/, admin-layout.css.
import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useUrlSearch } from '@/shared/routing/search';
import { Cable, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ProviderDirectory, type ProviderTab } from '@/features/providers';
import './admin-layout.css';
import { ProcessingSettings } from '@/features/document-processing';
import { AdminGate, GeneralSettings } from '@/features/admin-access';
import { ModelSetupNotice } from './admin/model-setup-notice';
export function AdminPage() {
  const [params] = useUrlSearch();
  return (
    <>
      {params.get('setup') === 'required' && <ModelSetupNotice />}
      <AdminGate>
        <AdminContent />
      </AdminGate>
    </>
  );
}
function AdminContent() {
  const [params, setParams] = useUrlSearch();
  const section =
    params.get('section') === 'general'
      ? 'general'
      : ['decision', 'processing', 'related'].includes(params.get('section') ?? '') ||
          params.get('tab') === 'decision'
        ? 'decision'
        : 'llm';
  const value = params.get('tab');
  const tab: ProviderTab =
    value === 'tests' || value === 'history' || value === 'decision' || value === 'capacity'
      ? value
      : 'settings';
  const [open, setOpen] = useState(true);
  const main = useRef<HTMLElement>(null),
    previous = useRef(section);
  useEffect(() => {
    if (previous.current !== section) {
      main.current?.querySelector<HTMLElement>('h1')?.focus();
      previous.current = section;
    }
  }, [section]);
  const destination = (next: string) => {
    const q = new URLSearchParams(params);
    q.set('section', next);
    q.set('tab', 'settings');
    q.delete('provider');
    return Object.fromEntries(q);
  };
  const update = (key: string, value: string) =>
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set(key, value);
      return next;
    });
  return (
    <div className={`container admin-layout${open ? '' : ' admin-layout-collapsed'}`}>
      <aside className="admin-sidebar" aria-label="Admin 탐색">
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="admin-sidebar-heading">
            {open && <span>Admin</span>}
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={open ? 'Admin 메뉴 접기' : 'Admin 메뉴 펼치기'}
                title={open ? 'Admin 메뉴 접기' : 'Admin 메뉴 펼치기'}
              >
                {open ? (
                  <PanelLeftClose aria-hidden="true" />
                ) : (
                  <PanelLeftOpen aria-hidden="true" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <nav aria-label="Admin 메뉴">
              <ul>
                <li>
                  <Link
                    to="/admin"
                    search={destination('general')}
                    aria-current={section === 'general' ? 'page' : undefined}
                  >
                    <Settings aria-hidden="true" />
                    <span>일반</span>
                  </Link>
                </li>
                <li>
                  <Link
                    to="/admin"
                    search={destination('llm')}
                    aria-current={section === 'llm' ? 'page' : undefined}
                  >
                    <Cable aria-hidden="true" />
                    <span>LLM 연결</span>
                  </Link>
                </li>
                <li>
                  <Link
                    to="/admin"
                    search={destination('decision')}
                    aria-current={section === 'decision' ? 'page' : undefined}
                  >
                    <Cable aria-hidden="true" />
                    <span>Decision Model 연결</span>
                  </Link>
                </li>
              </ul>
            </nav>
          </CollapsibleContent>
        </Collapsible>
      </aside>
      <main ref={main} className="admin-content">
        {section === 'general' ? (
          <GeneralSettings />
        ) : (
          <>
            <ProviderDirectory
              family={section === 'decision' ? 'system' : 'llm'}
              selectedId={params.get('provider')}
              tab={tab}
              onSelect={(id, nextTab) =>
                setParams((old) => {
                  const next = new URLSearchParams(old);
                  next.set('provider', id);
                  if (nextTab) next.set('tab', nextTab);
                  return next;
                })
              }
              onTabChange={(value) => update('tab', value)}
            />
            {section === 'decision' && <ProcessingSettings />}
          </>
        )}
      </main>
    </div>
  );
}
