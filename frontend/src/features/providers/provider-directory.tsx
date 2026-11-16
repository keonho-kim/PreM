// Purpose: Keep LLM and Decision setup visible even before any connection is registered.
// Pattern: URL-selected family/provider, inline discovery and independently versioned saved models.
// Usage: Admin owns navigation; each selected form owns its temporary credentials.
// Related: provider-form.tsx, provider-panels.tsx, api.ts.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/shared/notifications';
import { errorMessage } from '@/shared/api/http';
import { getProviderCatalog, listProviders, providerKeys, type Provider } from './api';
import { ProviderForm } from './provider-form';
import { ProviderPanels, type ProviderTab } from './provider-panels';
import './providers.css';
import { authoringModelsKey } from './authoring-api';
export function ProviderDirectory({
  selectedId,
  tab,
  onSelect,
  onTabChange,
}: {
  selectedId: string | null;
  tab: ProviderTab;
  onSelect: (id: string, tab?: ProviderTab) => void;
  onTabChange: (tab: ProviderTab) => void;
}) {
  const cache = useQueryClient();
  const catalog = useQuery({
    queryKey: providerKeys.catalog,
    queryFn: ({ signal }) => getProviderCatalog(signal),
    staleTime: 60000,
  });
  const result = useQuery({
    queryKey: providerKeys.all,
    queryFn: ({ signal }) => listProviders(signal),
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  const saved = result.data?.find((p) => p.id === selectedId);
  const requestedKind = selectedId?.startsWith('new:') ? selectedId.slice(4) : null;
  const provider = saved ?? (requestedKind ? null : result.data?.[0]);
  const option =
    catalog.data?.find((item) => item.id === (provider?.provider_type ?? requestedKind)) ??
    catalog.data?.[0];
  const category = option?.category ?? 'llm';
  const choices = catalog.data?.filter((item) => item.category === category) ?? [];
  const connections = result.data?.filter((item) => item.provider_type === option?.id) ?? [];
  const retry = () => {
    void catalog.refetch();
    void result.refetch();
  };
  const selectKind = (kind: string) =>
    onSelect(result.data?.find((p) => p.provider_type === kind)?.id ?? `new:${kind}`, 'settings');
  const onSaved = (updated: Provider) => {
    cache.setQueryData<Provider[]>(providerKeys.all, (items) => [
      ...(items ?? []).filter((p) => p.id !== updated.id),
      updated,
    ]);
    if (!provider) onSelect(updated.id, 'settings');
    void cache.invalidateQueries({ queryKey: providerKeys.all });
    void cache.invalidateQueries({ queryKey: authoringModelsKey });
    notify('모델 연결 설정을 저장했습니다.');
  };
  return (
    <section className="provider-workspace" aria-label="모델 연결 관리">
      <title>모델 연결 · Admin | PuPuTyX</title>
      <header className="provider-heading">
        <div>
          <p className="muted">Admin</p>
          <h1 tabIndex={-1}>모델 연결</h1>
          <p>Provider에 연결해 모델을 조회하고, 사용할 모델을 선택하세요.</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="연결 목록 새로고침" onClick={retry}>
          <RefreshCw aria-hidden="true" />
        </Button>
      </header>
      <Tabs
        className="provider-families"
        value={category}
        activationMode="manual"
        onValueChange={(family) => {
          const current = result.data?.find(
            (p) => catalog.data?.find((c) => c.id === p.provider_type)?.category === family,
          );
          const preferred =
            catalog.data?.find(
              (c) => c.id === (family === 'system' ? 'lm_studio_decision' : 'lm_studio_native'),
            ) ?? catalog.data?.find((c) => c.category === family);
          if (current) onSelect(current.id, 'settings');
          else if (preferred) onSelect(`new:${preferred.id}`, 'settings');
        }}
      >
        <TabsList aria-label="모델 종류" className="provider-family-tabs">
          <TabsTrigger value="llm" data-family="llm" disabled={!catalog.data}>
            LLM
          </TabsTrigger>
          <TabsTrigger value="system" data-family="system" disabled={!catalog.data}>
            Decision
          </TabsTrigger>
        </TabsList>
        {['llm', 'system'].map((family) => (
          <TabsContent key={family} value={family}>
            {catalog.isError || result.isError ? (
              <div role="status">
                <p>{errorMessage(catalog.error ?? result.error)}</p>
                <Button variant="secondary" onClick={retry}>
                  다시 시도
                </Button>
              </div>
            ) : catalog.isPending || result.isPending ? (
              <p role="status">연결 설정을 불러옵니다.</p>
            ) : (
              option && (
                <>
                  <p className="provider-family-help">
                    {family === 'system'
                      ? 'Decision 모델은 문서 분류와 판단에 사용합니다.'
                      : 'LLM은 문서 작성과 요약에 사용합니다.'}
                  </p>
                  <div className="provider-choice-fields">
                    <div>
                      <Label htmlFor={`provider-${family}`}>Provider</Label>
                      <Select value={option.id} onValueChange={selectKind}>
                        <SelectTrigger id={`provider-${family}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {choices.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {connections.length > 0 && (
                      <div>
                        <Label htmlFor={`connection-${family}`}>연결 설정</Label>
                        <Select
                          value={provider?.id ?? `new:${option.id}`}
                          onValueChange={(id) => onSelect(id, 'settings')}
                        >
                          <SelectTrigger id={`connection-${family}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {connections.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.model_identifier} · {p.name}
                              </SelectItem>
                            ))}
                            <SelectItem value={`new:${option.id}`}>다른 모델 설정</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  {provider ? (
                    <ProviderPanels
                      key={provider.id}
                      provider={provider}
                      option={option}
                      catalog={[option]}
                      tab={tab}
                      onTabChange={onTabChange}
                      onSaved={onSaved}
                    />
                  ) : (
                    <ProviderForm
                      key={`new:${option.id}`}
                      provider={null}
                      catalog={[option]}
                      onSaved={onSaved}
                    />
                  )}
                </>
              )
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
