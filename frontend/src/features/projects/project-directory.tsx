// Purpose: Present real shared projects as a responsive, paginated Home gallery.
// Pattern: Query owns remote state; URL owns filters; native dialogs own mutation sessions.
// Usage: ProjectsPage composes this feature without authentication or per-user filters.
// Related: project-card.tsx, project-filters.tsx, project-dialog.tsx.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Folder, RefreshCw, Plus } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import { notify } from '@/shared/notifications';
import { errorMessage } from '@/shared/api/http';
import {
  defaultFilters,
  listProjects,
  pageSize,
  projectKeys,
  type Project,
  type ProjectFilters,
} from './api';
import { useToday } from './calendar';
import { ProjectCard } from './project-card';
import { ProjectFilterForm } from './project-filters';
import { ProjectDialog } from './project-dialog';
import { ProjectLifecycleDialog } from './project-lifecycle-dialog';
import { ProjectContextMenu, type ProjectCommand } from './project-menu';
import './projects.css';
import './project-gallery.css';
type Session = { command: ProjectCommand; project?: Project; returnFocus?: HTMLElement };
type Props = {
  filters: ProjectFilters;
  offset: number;
  onFilter: (filters: ProjectFilters) => void;
  onPage: (offset: number) => void;
};
export function ProjectDirectory({ filters, offset, onFilter, onPage }: Props) {
  const navigate = useNavigate();
  const client = useQueryClient(),
    today = useToday();
  const [session, setSession] = useState<Session | null>(null),
    [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  const list = useQuery({
    queryKey: projectKeys.list(filters, offset),
    queryFn: ({ signal }) => listProjects(filters, offset, signal),
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const total = list.data?.total;
  useEffect(() => {
    if (total !== undefined && offset > 0 && offset >= total)
      onPage(Math.max(0, Math.ceil(total / pageSize) - 1) * pageSize);
  }, [total, offset, onPage]);
  function command(action: ProjectCommand, project?: Project) {
    const target = project
      ? document.querySelector<HTMLElement>(
          `[data-project-id="${project.id}"] [data-project-menu-trigger]`,
        )
      : document.activeElement instanceof HTMLElement && document.activeElement.matches('h1')
        ? document.activeElement
        : document.getElementById('project-create-button');
    setSession({ command: action, project, returnFocus: target ?? undefined });
  }
  function saved() {
    setSession(null);
    setNotice('프로젝트 변경을 저장했습니다.');
    notify('프로젝트 변경을 저장했습니다.');
    void client.invalidateQueries({ queryKey: projectKeys.all });
    heading.current?.focus();
  }
  const hasFilters = filters.q || filters.due_date || filters.status !== 'active';
  const page = Math.floor(offset / pageSize) + 1,
    pages = Math.max(1, Math.ceil((total ?? 0) / pageSize));
  return (
    <>
      <ProjectContextMenu onCommand={command}>
        <main className="container workspace project-workspace">
          <title>프로젝트 | PreM</title>
          <div className="projects-heading">
            <div>
              <h1 ref={heading} tabIndex={-1}>
                프로젝트
              </h1>
              <p className="muted">함께 사용할 프로젝트를 만들고 관리하세요.</p>
            </div>
            <Button id="project-create-button" onClick={() => command('create')}>
              <Plus aria-hidden="true" />
              프로젝트 만들기
            </Button>
          </div>
          <ProjectFilterForm
            filters={filters}
            onChange={(next) => {
              setNotice('');
              onFilter(next);
            }}
          />
          <div className="projects-summary">
            <p role="status" className="projects-notice">
              {notice ||
                (list.isPending
                  ? '프로젝트를 불러오고 있습니다.'
                  : list.isFetching
                    ? '목록을 갱신하고 있습니다.'
                    : list.isError && !list.data
                      ? '목록을 불러오지 못했습니다.'
                      : `${total ?? 0}개 프로젝트`)}
            </p>
            <Button
              variant="secondary"
              disabled={list.isFetching}
              title="프로젝트 목록 새로고침"
              aria-label="프로젝트 목록 새로고침"
              onClick={() => {
                setNotice('');
                void list.refetch();
              }}
            >
              <RefreshCw size={18} aria-hidden="true" />
            </Button>
          </div>
          {list.isError && (
            <div className="projects-error" role="alert">
              <p>{errorMessage(list.error)}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  void list.refetch();
                }}
              >
                다시 불러오기
              </Button>
            </div>
          )}
          {list.data &&
            (list.data.items.length ? (
              <section className="project-gallery" aria-label="공유 프로젝트 목록">
                {list.data.items.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    today={today}
                    onCommand={command}
                  />
                ))}
              </section>
            ) : (
              <section className="projects-empty">
                <Folder size={32} aria-hidden="true" />
                <h2>
                  {hasFilters ? '조건에 맞는 프로젝트가 없습니다' : '첫 프로젝트를 만들어 보세요'}
                </h2>
                <p className="muted">
                  {hasFilters
                    ? '검색 조건을 변경하거나 초기화하세요.'
                    : '상단의 프로젝트 만들기로 시작하세요. 모든 접속자와 공유됩니다.'}
                </p>
                {hasFilters && (
                  <Button variant="secondary" onClick={() => onFilter(defaultFilters)}>
                    전체 프로젝트 보기
                  </Button>
                )}
              </section>
            ))}
          {list.data && pages > 1 && (
            <Pagination className="projects-pagination" aria-label="프로젝트 목록 페이지">
              <PaginationContent className="w-full justify-between">
                <PaginationItem>
                  <Button
                    variant="secondary"
                    disabled={offset === 0}
                    onClick={() => onPage(Math.max(0, offset - pageSize))}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    이전
                  </Button>
                </PaginationItem>
                <PaginationItem>
                  <span aria-current="page">
                    {page} / {pages} 페이지
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <Button
                    variant="secondary"
                    disabled={offset + pageSize >= (total ?? 0)}
                    onClick={() => onPage(offset + pageSize)}
                  >
                    다음
                    <ArrowRight size={16} aria-hidden="true" />
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </main>
      </ProjectContextMenu>
      {session && ['create', 'rename', 'copy'].includes(session.command) && (
        <ProjectDialog
          returnFocus={session.returnFocus}
          project={session.command === 'rename' ? (session.project ?? null) : null}
          copy={session.command === 'copy' ? session.project : undefined}
          onClose={() => setSession(null)}
          onSaved={(project) => {
            saved();
            if (session.command !== 'rename')
              void navigate({ to: '/studio/$projectId', params: { projectId: project.id } });
          }}
        />
      )}
      {session?.project && (session.command === 'status' || session.command === 'delete') && (
        <ProjectLifecycleDialog
          returnFocus={session.returnFocus}
          project={session.project}
          action={session.command}
          onClose={() => setSession(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}
