---
name: Sinalizador sidebar gravação
overview: Mostrar o mesmo ponto vermelho usado no ícone de E-mail no item "Gravação" (/gravacao-externa) do sidebar sempre que a lista "OPs p/ Gravação Externa" tiver pelo menos uma OS.
todos:
  - id: hook
    content: Criar useGravacaoPendenteHasItems (limit 1, polling 15s) em useGravacaoPendente.ts
    status: completed
  - id: sidebar
    content: Generalizar indicador no Sidebar e ligar ao item /gravacao-externa com permissão sb_gravacao_pendente
    status: completed
  - id: test
    content: Adicionar Sidebar.test.tsx cobrindo o sinalizador de gravação
    status: completed
  - id: verify
    content: Rodar typecheck e testes frontend
    status: completed
isProject: false
---

# Sinalizador de OSs pendentes no ícone de Gravação Externa

## Como funciona hoje
- Em [apps/web/src/components/layout/Sidebar.tsx](apps/web/src/components/layout/Sidebar.tsx), `useEmailNotificationStatus` (polling a cada 15s) calcula `hasEmailActivity`, e `NavItemContent` desenha um ponto vermelho (`bg-sagra-danger`) sobre o ícone quando `showEmailIndicator` é verdadeiro.
- A lista da aba "OPs p/ Gravação Externa" vem de `GET /gravacao-pendente/os` (`fetchGravacaoPendenteOsList` em [apps/web/src/api/gravacaoPendente.ts](apps/web/src/api/gravacaoPendente.ts)), que já retorna `{ items, total }`. Nenhuma mudança de backend é necessária.

## Mudanças

1. **Novo hook** em [apps/web/src/api/hooks/useGravacaoPendente.ts](apps/web/src/api/hooks/useGravacaoPendente.ts):

```ts
export function useGravacaoPendenteHasItems(enabled = true) {
  return useQuery({
    queryKey: queryKeys.gravacaoPendente.list({ badge: true, limit: 1 }),
    queryFn: () => fetchGravacaoPendenteOsList({ limit: 1 }),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
    staleTime: 10_000,
    select: (data) => (data.total ?? data.items.length) > 0,
  });
}
```

   A chave fica sob o prefixo `gravacaoPendente`, então as mutations existentes (adicionar, enviar, excluir etc.) que invalidam `queryKeys.gravacaoPendente.prefix` já atualizam o sinalizador na hora.

2. **Sidebar** ([apps/web/src/components/layout/Sidebar.tsx](apps/web/src/components/layout/Sidebar.tsx)):
   - Habilitar o hook com `isReady && can("sb_gravacao_pendente")` (mesma permissão que libera a aba).
   - Renomear a prop `showEmailIndicator` de `NavItemContent` para `showIndicator` (genérica).
   - Calcular por item: `item.to === "/email" && hasEmailActivity` ou `item.to === "/gravacao-externa" && hasGravacaoPendente`.
   - Título quando recolhido: manter `"(novos itens)"` para e-mail e usar `"(OSs pendentes)"` para gravação.

3. **Teste** (novo `apps/web/src/components/layout/Sidebar.test.tsx`, seguindo o padrão de mocks de `GravacaoPendenteTab.test.tsx`): mockar `useAccessControl`, `useEmailNotificationStatus` e `useGravacaoPendenteHasItems`; conferir que o ponto aparece no item `/gravacao-externa` quando o hook retorna `true` e some quando retorna `false`.

## Verificação
- `pnpm typecheck` e `pnpm test:frontend` em `apps/web`.
