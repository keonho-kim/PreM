// Purpose: Show the open presentation and its file actions above the editor.
// Pattern: The title stays in place while a Radix menu owns revision selection and focus.
// Usage: Generation supplies the selected run, available history and revision command.
// Related: generation.tsx, generation-form.tsx, presentations.css.
import { useRef, useState, type Ref } from 'react';
import { Check, Download, Ellipsis, Files, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { WorkflowStatus } from './workflow-status';
import { QualityStatus } from './quality-status';
import { downloadUrl, type Run } from './api';

const labels = {
  succeeded: '완료',
  failed: '확인 필요',
  cancelled: '중단',
  queued: '대기',
  running: '만드는 중',
} as const;
export function PresentationHeader({
  project,
  run,
  history,
  titleRef,
  canCreate,
  onCreate,
  onSelect,
}: {
  project: string;
  run: Run;
  history: Run[];
  titleRef: Ref<HTMLHeadingElement>;
  canCreate: boolean;
  onCreate: () => void;
  onSelect: (id: string) => void;
}) {
  const afterMenu = useRef<'create' | 'results' | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [report, setReport] = useState<Run | null>(null);
  const complete = run.status === 'succeeded';
  const multiple = history.length > 1;
  const hasReport = complete && !!(run.steps?.length || run.quality?.length);
  return (
    <div className="presentation-command-row">
      <h2 tabIndex={-1} ref={titleRef}>
        {run.title}
      </h2>
      <div className="presentation-file-actions">
        {complete && (
          <Button asChild variant="ghost" size="icon">
            <a href={downloadUrl(project, run.id)} aria-label="PPTX 다운로드" title="PPTX 다운로드">
              <Download aria-hidden="true" />
            </a>
          </Button>
        )}
        {(multiple || hasReport || (complete && canCreate)) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                ref={menuButton}
                aria-label="발표자료 더보기"
                title="발표자료 더보기"
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="presentation-file-menu"
              onCloseAutoFocus={(e) => {
                const action = afterMenu.current;
                if (!action) return;
                e.preventDefault();
                afterMenu.current = null;
                if (action === 'create') onCreate();
                else setReport(run);
              }}
            >
              {complete && (
                <DropdownMenuItem
                  disabled={!canCreate}
                  onSelect={() => {
                    afterMenu.current = 'create';
                  }}
                >
                  <Files aria-hidden="true" />새 버전 만들기
                </DropdownMenuItem>
              )}
              {hasReport && (
                <DropdownMenuItem
                  onSelect={() => {
                    afterMenu.current = 'results';
                  }}
                >
                  <ClipboardCheck aria-hidden="true" />
                  처리 및 검사 결과
                </DropdownMenuItem>
              )}
              {multiple && (
                <>
                  {complete && <DropdownMenuSeparator />}
                  <p className="presentation-menu-label">발표자료 기록</p>
                  {history.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      onSelect={() => onSelect(item.id)}
                      aria-current={item.id === run.id ? 'true' : undefined}
                    >
                      <span className="presentation-menu-copy">
                        <span>{item.title}</span>
                        <small>
                          {new Date(item.created_at).toLocaleString('ko-KR')} ·{' '}
                          {labels[item.status]}
                        </small>
                      </span>
                      {item.id === run.id && <Check aria-hidden="true" />}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Dialog
        open={!!report}
        onOpenChange={(open) => {
          if (!open) setReport(null);
        }}
      >
        {report && (
          <DialogContent
            className="presentation-report-dialog"
            onCloseAutoFocus={(event) => {
              if (menuButton.current) {
                event.preventDefault();
                menuButton.current.focus();
              }
            }}
          >
            <DialogTitle>처리 및 검사 결과</DialogTitle>
            <DialogDescription>{report.title}</DialogDescription>
            <WorkflowStatus run={report} />
            <QualityStatus rows={report.quality} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
