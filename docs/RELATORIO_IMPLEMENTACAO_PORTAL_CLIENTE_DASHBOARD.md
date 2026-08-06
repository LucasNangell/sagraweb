# Relatório — Implementação Dashboard Portal do Cliente

> **Data:** junho de 2026  
> **Escopo:** Nova experiência visual em `/cliente` — cabeçalho institucional, indicadores, seções colapsáveis e cards compactos.  
> **Backend:** não alterado.

---

## 1. Resumo

O dashboard `/cliente` foi reestruturado conforme `docs/PLANO_PORTAL_CLIENTE_PROFISSIONAL.md` (Fases 1–3), mantendo toda a lógica de negócio, autenticação, APIs, timeline lazy, stepper, pendências e painel de contas.

---

## 2. Arquivos criados

| Arquivo | Função |
|---------|--------|
| `apps/web/src/features/cliente/hooks/useClienteDashboardStats.ts` | KPIs derivados + `resolveVinculoDisplay` (fallback gabinete) |
| `apps/web/src/features/cliente/utils/clienteSectionConfig.ts` | Configuração das 4 seções (títulos, empty states, IDs) |
| `apps/web/src/features/cliente/utils/clienteSectionConfig.test.ts` | Testes unitários |
| `apps/web/src/features/cliente/components/ClientePortalHero.tsx` | Cabeçalho institucional + ações |
| `apps/web/src/features/cliente/components/ClienteGabineteSummary.tsx` | Identificação gabinete/usuário/e-mail |
| `apps/web/src/features/cliente/components/ClientePortalStats.tsx` | Cards de indicadores clicáveis |
| `apps/web/src/features/cliente/components/ClienteCollapsibleWorkBoard.tsx` | Orquestra seções colapsáveis |
| `apps/web/src/features/cliente/components/ClienteCollapsibleSection.tsx` | Accordion por seção |
| `apps/web/src/features/cliente/components/ClienteCompactOsCard.tsx` | Card OS compacto + expansão |
| `apps/web/src/features/cliente/components/ClienteSectionEmptyState.tsx` | Empty states profissionais |

---

## 3. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `apps/web/src/features/cliente/components/ClienteDashboardPage.tsx` | Integra hero + board colapsável |
| `apps/web/src/features/cliente/components/ClienteDashboardSkeleton.tsx` | Skeleton alinhado ao novo layout |
| `apps/web/src/lib/format.ts` | `formatRelativeTimeBr` para “última atualização” |

---

## 4. Arquivos preservados (não removidos)

Componentes anteriores mantidos para rollback:

- `ClienteWorkBoard.tsx`
- `ClienteWorkSection.tsx`
- `ClienteWorkCard.tsx`
- `ClienteOsList.tsx`
- `clienteStore.ts`, `ClienteAuthGuard.tsx`, `cliente-portal.ts`
- `ClienteProgressStepper`, `ClientePendingAction`, `ClienteOsTimeline`, `ClienteContasPanel`, `ClienteStatusBadge`

---

## 5. O que foi preservado

| Requisito | Status |
|-----------|--------|
| Backend / endpoints | Intactos |
| `clienteStore` / cookie `sagra_cliente_session` | Intactos |
| Query `["cliente", "dashboard"]` + `staleTime: 60_000` | Intacto |
| Classificação de pendências (backend) | Intacta |
| `ClientePendingAction` + `pendencia_url` | Intacto |
| Timeline lazy (`enabled: expanded`) | Intacto — sem prefetch no viewport no card compacto |
| Stepper completo ao expandir OS | Intacto |
| Stepper compacto no modo listado (estimado) | Mantido |
| `ClienteContasPanel` | Intacto no rodapé |
| `PortalSystemHeader` | Intacto |
| Outras páginas do sistema | Não alteradas |

---

## 6. Seções colapsáveis — funcionamento

1. **Estado inicial:** todas as seções **fechadas**, exceto a primeira com pendência (prioridade: Problemas Técnicos → Aprovação → Arquivos).
2. **Cabeçalho da seção:** botão com `aria-expanded`, ícone, título, contador, resumo e chevron.
3. **Destaque visual:** fundo âmbar suave quando há itens em seções de ação; verde suave em “Em andamento”.
4. **Expansão de OS:** independente — estado `expandedOsKeys` no board; timeline só carrega quando OS expandida.
5. **Navegação pelos stats:** clicar em um card do topo abre a seção correspondente e faz scroll suave.
6. **Persistência:** estado em `useState` durante a sessão (recarrega a página reseta conforme regra inicial).

### Títulos finais

- Problemas Técnicos
- Aguardando Aprovação
- Aguardando Arquivos
- Em andamento

Prefixo **“Pendências —”** removido.

---

## 7. Cabeçalho — fallback de dados

`resolveVinculoDisplay` (em `useClienteDashboardStats.ts`):

1. **Primário:** `{vinculo_label} {gabinete}` — ex.: “Gabinete 214”.
2. **Se sem vínculo:** usa título da primeira OS disponível.
3. **Se nada:** exibe apenas o tipo (“Gabinete” / “Órgão”).
4. **Secundário:** título de publicação da primeira OS (quando há vínculo).
5. **Usuário / e-mail:** de `clienteStore.user` — nunca obrigatórios para renderizar.
6. **Ponto/gabinete:** `formatPonto(gabinete)` quando existir.
7. **Última atualização:** `dataUpdatedAt` do React Query ou maior `data_andamento` das OSs → `formatRelativeTimeBr`.

**Nota:** nome do parlamentar não existe no endpoint atual. Documentado como necessidade futura opcional de backend (`summary.parlamentar`). A tela não quebra por campo ausente.

---

## 8. Comandos executados

| Comando | Resultado |
|---------|-----------|
| `pnpm test` (apps/web) | **25/25 pass** (+4 novos) |
| `pnpm build` (apps/web) | **OK** |
| `pnpm lint` | **OK** (placeholders Fase 0) |
| `pnpm typecheck` | **Falha pré-existente** TS6310 em `tsconfig.app.json` (referência `api-types`/`ui`) |
| `pnpm test:backend` | **45/45 pass** |
| `pnpm test` (raiz) | Falha no script por `&&` no PowerShell; subcomandos executados separadamente |

---

## 9. Próximos passos sugeridos (fora deste escopo)

- Fase 4 do plano: bridges autenticadas `/cliente/acoes/*` para PT e aprovação.
- Atualizar `docs/PAGINA_CLIENTE.md` com nova hierarquia de componentes.
- Opcional: endpoint `summary` no dashboard para nome parlamentar agregado.

---

## 10. Hierarquia final

```
ClienteDashboardPage
├── PortalSystemHeader
├── ClientePortalHero
│   ├── ClienteGabineteSummary
│   └── ClientePortalStats
├── ClienteCollapsibleWorkBoard
│   └── ClienteCollapsibleSection (×4)
│       └── ClienteCompactOsCard (×N)
│           ├── ClienteProgressStepper (compacto / completo)
│           ├── ClientePendingAction
│           └── ClienteOsTimeline (lazy)
└── ClienteContasPanel
```
