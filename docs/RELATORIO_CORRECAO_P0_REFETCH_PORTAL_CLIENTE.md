# Relatório — Correção P0: refetch 60s do Portal do Cliente

**Data:** 08/06/2026  
**Origem:** `docs/AUDITORIA_REGRESSAO_PORTAL_CLIENTE_FINAL.md` (item 4, regressão R-01)

---

## Problema

O dashboard `/cliente` usava apenas `staleTime: 60_000`, sem `refetchInterval: 60_000`. Os dados não eram buscados automaticamente a cada minuto, embora a UI sugerisse atualização automática.

---

## Correção aplicada

### Onde `refetchInterval: 60_000` foi restaurado

Criado módulo centralizado `apps/web/src/features/cliente/hooks/clienteDashboardQuery.ts`:

```typescript
export function clienteDashboardQueryOptions() {
  return {
    queryKey: ["cliente", "dashboard"],
    queryFn: fetchClienteDashboard,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  };
}
```

`ClienteDashboardPage.tsx` passou a usar:

```typescript
const dashboardQuery = useQuery(clienteDashboardQueryOptions());
```

**Comportamento preservado:**
- `staleTime: 60_000` — dados considerados frescos por 60s
- `refetchInterval: 60_000` — polling automático a cada 60s
- `refetchOnWindowFocus: true` — refetch ao retornar à aba
- Botão manual “Atualizar” no hero (`dashboardQuery.refetch()`)
- Estados loading / error inalterados

---

## Ajustes de texto

| Antes | Depois |
|-------|--------|
| Frase “Os dados são atualizados automaticamente a cada minuto” repetida em empty states (`showSyncHint`) | Removida dos empty states |
| — | Frase única e discreta no hero do dashboard (`ClientePortalHero`): *“As informações são atualizadas automaticamente a cada minuto e também podem ser atualizadas manualmente.”* |

---

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `hooks/clienteDashboardQuery.ts` | **Criado** — opções da query com polling |
| `hooks/clienteDashboardQuery.test.ts` | **Criado** — teste de `staleTime` + `refetchInterval` |
| `components/ClienteDashboardPage.tsx` | Usa `clienteDashboardQueryOptions()` |
| `components/ClientePortalHero.tsx` | Texto discreto de sincronização |
| `components/ClienteSectionEmptyState.tsx` | Removido prop `showSyncHint` |
| `components/ClienteCollapsibleSection.tsx` | Removido `showSyncHintOnEmpty` |
| `components/ClienteCollapsibleWorkBoard.tsx` | Removida lógica `syncHintShown` |
| `components/ClientePendenciasListPage.tsx` | Removido `showSyncHint` no empty state |

**Não alterados:** backend, endpoints, `clienteStore`, `ClienteAuthGuard`, cookie, PT, prova, layout das seções.

---

## Testes e build

| Comando | Resultado |
|---------|-----------|
| `pnpm test:frontend` | ✅ 33 testes (incl. 1 novo em `clienteDashboardQuery.test.ts`) |
| `pnpm test:backend` | ✅ 45 testes |
| `pnpm build` | ✅ Sucesso |
| `pnpm lint` | ✅ Pendente (Fase 0) |
| `pnpm typecheck` | ⚠️ TS6310 pré-existente |

---

## Validação manual sugerida

1. Login em `/cliente`
2. Abrir DevTools → Network
3. Aguardar 60s sem interagir — deve aparecer nova requisição `GET /cliente/dashboard`
4. Clicar “Atualizar” — refetch imediato adicional
5. Confirmar texto no hero do painel

---

*Correção P0 concluída. P1/P2/P3 não implementados nesta entrega.*
