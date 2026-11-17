// Purpose: Keep readable slide content, speaker notes and canonical evidence in the right panel.
// Pattern: Manual Radix tabs stay mounted across panel collapse; reads are scoped to the current slide.
// Usage: DeckPreview owns panel visibility and slide identity.
// Related: slide-evidence.tsx, api.ts, mock/js/views/presentations.js.
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MaterialSources } from './material-sources';
import { MaterialInsertion } from './material-insertion';
import { SlideEvidence } from './slide-evidence';
import { SlideChat } from './slide-chat';
import { ObjectTools } from './object-tools';
import { useChatDrafts } from './chat-drafts';
import type { EditThread } from './use-edit-thread';
import type { Slide, Run } from './api';
export function DeckInspector({
  project,
  run,
  slide,
  active,
  canEdit,
  targetSlides,
  objectIds,
  onObjectSelect,
  history,
  session,
  previewing,
  onResult,
}: {
  project: string;
  run: Run;
  slide: Slide | undefined;
  active: boolean;
  canEdit: boolean;
  targetSlides: Slide[];
  objectIds: string[];
  onObjectSelect: (id: string, multiple: boolean) => void;
  history: EditThread;
  session: string | null;
  previewing: boolean;
  onResult: (id: string) => void;
}) {
  const [tab, setTab] = useState('chat');
  return (
    <Tabs value={tab} onValueChange={setTab} activationMode="manual">
      <TabsList aria-label="슬라이드 도구">
        <TabsTrigger value="chat">AI와 대화</TabsTrigger>
        <TabsTrigger value="objects">객체</TabsTrigger>
        <TabsTrigger value="content">내용</TabsTrigger>
        <TabsTrigger value="references">참고 자료</TabsTrigger>
      </TabsList>
      <TabsContent className="slide-chat-tab" value="chat" forceMount hidden={tab !== 'chat'}>
        {slide ? (
          <SlideChat
            key={`${run.id}:${slide.id}`}
            project={project}
            run={run}
            slide={slide}
            canEdit={canEdit}
            targetSlides={targetSlides}
            objectIds={objectIds}
            history={history}
            session={session}
            reviewing={previewing}
            onResult={onResult}
          />
        ) : (
          <p>슬라이드를 준비하고 있습니다.</p>
        )}
      </TabsContent>
      <TabsContent value="objects" forceMount hidden={tab !== 'objects'}>
        {slide && (
          <ObjectTools
            key={`${run.id}:${slide.id}`}
            project={project}
            slide={slide}
            active={active && tab === 'objects'}
            editable={canEdit && run.is_current && run.status === 'succeeded' && !previewing}
            selected={objectIds}
            onSelect={onObjectSelect}
            onAsk={(prompt, keepSelection) => {
              if (!keepSelection) onObjectSelect('', false);
              useChatDrafts.getState().update(`${project}:${run.id}:${slide.id}`, { prompt });
              setTab('chat');
            }}
          />
        )}
      </TabsContent>
      <TabsContent value="content" forceMount hidden={tab !== 'content'}>
        {slide && (
          <MaterialSources
            project={project}
            run={run.id}
            slide={slide.id}
            active={active && tab === 'references'}
          />
        )}
        {slide?.spec ? (
          <div className="presentation-inspector-copy">
            <p className="field-hint">슬라이드 {slide.position}</p>
            <h3>{slide.spec.title}</h3>
            <ul>
              {slide.spec.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <h4>발표 메모</h4>
            <p>{slide.spec.notes || '작성된 발표 메모가 없습니다.'}</p>
          </div>
        ) : (
          <p className="related-empty">내용을 작성하고 있습니다.</p>
        )}
      </TabsContent>
      <TabsContent value="references" forceMount hidden={tab !== 'references'}>
        {slide && (
          <MaterialInsertion
            key={`${run.id}:${slide.id}`}
            project={project}
            run={run}
            slide={slide.id}
            editable={canEdit}
            session={session}
            onResult={onResult}
          />
        )}
        {slide && (
          <MaterialSources
            project={project}
            run={run.id}
            slide={slide.id}
            active={active && tab === 'references'}
          />
        )}
        {slide?.spec ? (
          <SlideEvidence
            key={slide.id}
            project={project}
            run={run.id}
            slide={slide.id}
            count={slide.spec.block_ids.length}
            active={active && tab === 'references'}
          />
        ) : (
          <p className="related-empty">내용이 준비되면 연결된 원문을 확인할 수 있습니다.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
