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
import { errorMessage } from '@/shared/api/http';
import { getProviderCatalog, listProviders, providerKeys, type Provider } from './api';
import { ConnectionDiagnostic } from './connection-diagnostic';
import { modelSetupKey } from '@/shared/api/model-setup';
import { ProviderForm } from './connection-form';
import { ProviderPanels, type ProviderTab } from './provider-panels';
import './providers.css';
export function ProviderDirectory({
  family,
  selectedId,
  tab,
  onSelect,
  onTabChange,
}: {
  family: 'llm' | 'system';
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
  const eligible = (kind: string) =>
    catalog.data?.some(
      (c) =>
        c.id === kind &&
        (family === 'llm' ? c.category === 'llm' : c.category === 'system' || c.structured),
    );
  const saved = result.data?.find((p) => p.id === selectedId && eligible(p.provider_type));
  const requestedKind =
    selectedId?.startsWith('new:') && eligible(selectedId.slice(4)) ? selectedId.slice(4) : null;
  const provider =
    saved ?? (requestedKind ? null : result.data?.find((p) => eligible(p.provider_type)));
  const option =
    catalog.data?.find((item) => item.id === (provider?.provider_type ?? requestedKind)) ??
    catalog.data?.find((c) => eligible(c.id));
  const choices = catalog.data?.filter((item) => eligible(item.id)) ?? [];
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
    void cache.invalidateQueries({ queryKey: modelSetupKey });
    if (!provider) onSelect(updated.id, 'settings');
    void cache.invalidateQueries({ queryKey: providerKeys.all });
  };
  return (
    <section className="provider-workspace" aria-label="모델 연결 관리">
      <title>모델 연결 · Admin | PreM</title>
      <header className="provider-heading">
        <div>
          <h1 tabIndex={-1}>{family === 'llm' ? 'LLM 연결' : 'Decision Model 연결'}</h1>
          <p>
            {family === 'system'
              ? '문서 처리와 자료 찾기에 사용할 모델입니다.'
              : '문서 작성과 요약에 사용할 모델입니다.'}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="연결 목록 새로고침" onClick={retry}>
          <RefreshCw aria-hidden="true" />
        </Button>
      </header>
      <div className="provider-families">
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
                    <Label htmlFor={`connection-${family}`}>저장된 연결</Label>
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
                            {p.name} · {p.model_identifier}
                          </SelectItem>
                        ))}
                        <SelectItem value={`new:${option.id}`}>다른 모델 설정</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <ConnectionDiagnostic
                key={family + (provider?.config_id ?? 'new')}
                provider={provider ?? null}
                decision={family === 'system'}
              />
              {provider ? (
                <ProviderPanels
                  key={provider.id}
                  provider={provider}
                  option={option}
                  catalog={[option]}
                  decision={family === 'system'}
                  tab={family === 'llm' && tab === 'decision' ? 'settings' : tab}
                  onTabChange={onTabChange}
                  onSaved={onSaved}
                />
              ) : (
                <ProviderForm
                  decision={family === 'system'}
                  key={`new:${option.id}`}
                  provider={null}
                  catalog={[option]}
                  onSaved={onSaved}
                />
              )}
            </>
          )
        )}
      </div>
    </section>
  );
}
