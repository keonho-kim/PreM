// Purpose: Separate saved settings, explicit tests and durable request history.
// Pattern: Controlled shadcn tabs with preserved test state and inactive history polling disabled.
// Usage: Directory scopes the group by connection ID; diagnostics pin the immutable config.
// Related: provider-directory.tsx, provider-checks.tsx, provider-history.tsx.
import { ProviderCapacity } from './provider-capacity';
import { ProviderForm } from './connection-form';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { ProviderOption } from './provider-types';
import type { Provider } from './api';
import { DecisionChecks } from './decision-checks';
import { ProviderChecks } from './provider-checks';
import { ProviderHistory } from './provider-history';
export type ProviderTab = 'settings' | 'capacity' | 'tests' | 'decision' | 'history';
export function ProviderPanels({
  decision,
  provider,
  option,
  tab,
  onTabChange,
  catalog,
  onSaved,
}: {
  decision: boolean;
  provider: Provider;
  option: ProviderOption;
  tab: ProviderTab;
  onTabChange: (tab: ProviderTab) => void;
  catalog: ProviderOption[];
  onSaved: (provider: Provider) => void;
}) {
  return (
    <Tabs
      className="provider-tabs"
      value={tab}
      activationMode="manual"
      onValueChange={(value) => onTabChange(value as ProviderTab)}
    >
      <TabsList aria-label="모델 연결 상세">
        <TabsTrigger value="settings">연결 설정</TabsTrigger>
        <TabsTrigger value="capacity">처리 설정</TabsTrigger>
        <TabsTrigger value="tests">연결 테스트</TabsTrigger>
        {decision && <TabsTrigger value="decision">판정 테스트</TabsTrigger>}
        <TabsTrigger value="history">요청 이력</TabsTrigger>
      </TabsList>
      <TabsContent value="settings" forceMount hidden={tab !== 'settings'}>
        <section className="provider-summary" aria-label="선택한 연결 설정">
          <div>
            <h2>{provider.name}</h2>
          </div>
        </section>
        <ProviderForm decision={decision} provider={provider} catalog={catalog} onSaved={onSaved} />
      </TabsContent>
      <TabsContent value="capacity" forceMount hidden={tab !== 'capacity'}>
        <ProviderCapacity providerId={provider.id} active={tab === 'capacity'} />
      </TabsContent>
      <TabsContent value="tests" forceMount hidden={tab !== 'tests'}>
        <ProviderChecks key={provider.config_id} provider={provider} option={option} />
      </TabsContent>
      <TabsContent value="decision" forceMount hidden={tab !== 'decision'}>
        {decision && (
          <DecisionChecks key={provider.config_id} provider={provider} option={option} />
        )}
      </TabsContent>
      <TabsContent value="history" forceMount hidden={tab !== 'history'}>
        <ProviderHistory providerId={provider.id} active={tab === 'history'} />
      </TabsContent>
    </Tabs>
  );
}
