// Purpose: Show stored project metadata without fabricated document previews or counts.
// Pattern: Semantic content card with independent contextual commands.
// Usage: ProjectDirectory renders one card per server result.
// Related: project-menu.tsx, calendar.ts, project-gallery.css.
import { Link } from '@tanstack/react-router';
import { Card } from '@/components/ui/card';
import { Folder } from 'lucide-react';
import type { Project } from './api';
import { deadline } from './calendar';
import { ProjectContextMenu, ProjectMenu, type ProjectCommand } from './project-menu';
const dateTime = (value: number) =>
  new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
export function ProjectCard({
  project,
  today,
  onCommand,
}: {
  project: Project;
  today: string;
  onCommand: (command: ProjectCommand, project?: Project) => void;
}) {
  const due = deadline(project.due_date, today);
  return (
    <ProjectContextMenu project={project} onCommand={onCommand}>
      <Card
        className="project-card"
        aria-label={project.name}
        data-project-id={project.id}
        tabIndex={-1}
      >
        <Link
          data-project-link
          to="/studio/$projectId"
          params={{ projectId: project.id }}
          className="project-card-preview"
          aria-label={`${project.name} 열기`}
        >
          <Folder size={28} aria-hidden="true" />
          <span>아직 생성된 PPT가 없습니다</span>
        </Link>
        <header>
          <div className="project-card-status">
            <span>{project.status === 'active' ? '진행 중' : '보관됨'}</span>
            <span className={due.urgent ? 'deadline urgent' : 'deadline'}>{due.label}</span>
          </div>
          <h2>
            <Link data-project-link to="/studio/$projectId" params={{ projectId: project.id }}>
              {project.name}
            </Link>
          </h2>
        </header>
        <dl>
          <div>
            <dt>마감일</dt>
            <dd>
              {project.due_date ? (
                <time dateTime={project.due_date}>{project.due_date.replaceAll('-', '.')}</time>
              ) : (
                '미정'
              )}
            </dd>
          </div>
          <div>
            <dt>생성일</dt>
            <dd>
              <time dateTime={new Date(project.created_at).toISOString()}>
                {dateTime(project.created_at)}
              </time>
            </dd>
          </div>
        </dl>
        <footer>
          <span>
            최근 변경
            <br />
            <time dateTime={new Date(project.updated_at).toISOString()}>
              {dateTime(project.updated_at)}
            </time>
          </span>
          <ProjectMenu project={project} onCommand={onCommand} />
        </footer>
      </Card>
    </ProjectContextMenu>
  );
}
