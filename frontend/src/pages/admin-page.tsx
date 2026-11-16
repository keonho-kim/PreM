// Purpose: Compose Admin-only side navigation and URL-addressable feature views.
// Pattern: Router owns section/provider/tab; shadcn owns disclosure and tab interactions.
// Usage: /home/admin with section, provider and tab query parameters; startup-token gate.
// Related: features/providers/, features/system-status/, admin-layout.css.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Cable, Activity, FileCog, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ProviderDirectory, type ProviderTab } from '@/features/providers';
import { RelationSettings } from '@/features/related-documents';
import { ProcessingSettings } from '@/features/document-processing';
import { ServiceStatus } from '@/features/system-status';
import './admin-layout.css';
import { AdminGate, GeneralSettings } from '@/features/admin-access';
export function AdminPage() {
  return (
    <AdminGate>
      <AdminContent />
    </AdminGate>
  );
}
function AdminContent() {
  const [params, setParams] = useSearchParams();
  const section =
    params.get('section') === 'general'
      ? 'general'
      : params.get('section') === 'related'
        ? 'related'
        : params.get('section') === 'processing'
          ? 'processing'
          : params.get('section') === 'system'
            ? 'system'
            : 'providers';
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
    return `?${q}`;
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
                    to={destination('general')}
                    aria-current={section === 'general' ? 'page' : undefined}
                  >
                    <Settings aria-hidden="true" />
                    <span>일반 설정</span>
                  </Link>
                </li>
                <li>
                  <Link
                    to={destination('providers')}
                    aria-current={section === 'providers' ? 'page' : undefined}
                  >
                    <Cable aria-hidden="true" />
                    <span>모델 연결</span>
                  </Link>
                </li>
                <li>
                  <Link
                    to={destination('system')}
                    aria-current={section === 'system' ? 'page' : undefined}
                  >
                    <Activity aria-hidden="true" />
                    <span>시스템 상태</span>
                  </Link>
                </li>
                <li>
                  <Link
                    to={destination('processing')}
                    aria-current={section === 'processing' ? 'page' : undefined}
                  >
                    <FileCog aria-hidden="true" />
                    <span>문서 처리</span>
                  </Link>
                </li>
                <li>
                  <Link
                    to={destination('related')}
                    aria-current={section === 'related' ? 'page' : undefined}
                  >
                    <FileCog aria-hidden="true" />
                    <span>자료 찾기</span>
                  </Link>
                </li>
              </ul>
            </nav>
            <p className="admin-sidebar-note">팀 공용 설정</p>
          </CollapsibleContent>
        </Collapsible>
      </aside>
      <main ref={main} className="admin-content">
        {section === 'general' ? (
          <GeneralSettings />
        ) : section === 'providers' ? (
          <ProviderDirectory
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
        ) : section === 'related' ? (
          <RelationSettings />
        ) : section === 'processing' ? (
          <ProcessingSettings />
        ) : (
          <section className="admin-system">
            <title>시스템 상태 · Admin | PuPuTyX</title>
            <header className="provider-heading">
              <div>
                <p className="muted">Admin</p>
                <h1 tabIndex={-1}>시스템 상태</h1>
                <p>서버의 연결 상태와 실행 버전을 확인합니다.</p>
              </div>
            </header>
            <ServiceStatus />
            <p className="field-hint">
              DB 무결성·스토리지·OCR 도구의 상세 진단은 아직 제공하지 않습니다.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
