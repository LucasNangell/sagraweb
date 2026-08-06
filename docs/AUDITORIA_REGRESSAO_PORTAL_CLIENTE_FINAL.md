# Auditoria final de regressão — Portal do Cliente, PT e Provas

**Data:** 08/06/2026  
**Escopo:** leitura de código + testes automatizados (sem alteração de código)  
**Áreas:** `/cliente`, bridges autenticadas, `/portal/pt/{token}`, `/portal/aprovacao/{token}`

---

## Veredito geral

| Classificação | Quantidade |
|---------------|------------|
| ✅ Aprovado | 22 itens |
| ⚠️ Aprovado com ressalva | 4 itens |
| ❌ Regressão confirmada | 1 item |
| 🔶 Requer validação manual em runtime | 3 itens |

**Conclusão:** a integração PROMPT 3 está estruturalmente sólida e os fluxos públicos por token permanecem isolados da autenticação `/cliente`. Há **uma regressão funcional confirmada** no polling do dashboard (item 4) e ressalvas menores de UX, acessibilidade e código legado.

---

## Matriz de validação (25 itens)

| # | Item | Status | Evidência |
|---|------|--------|-----------|
| 1 | Login e sessão `/cliente` | ✅ | `ClienteLoginPage` → `clienteStore.login` → `POST /auth/cliente/login` → redirect `/cliente`. Rotas autenticadas envolvidas por `ClienteAuthGuard` + `hydrate()` via `GET /cliente/me`. |
| 2 | Cookie `sagra_cliente_session` | ✅ | Backend: `CLIENTE_SESSION_COOKIE_NAME` em `session_auth.py`. Frontend: `clienteFetch` usa `credentials: "include"`. Cookie separado de `sagra_session`. |
| 3 | `clienteStore` | ✅ | Zustand inalterado: `login`, `logout`, `hydrate`, deduplicação `hydrateInFlight`, estados `isHydrating` / `isAuthenticated`. |
| 4 | Refetch 60s | ❌ **Regressão** | Documentação (`PAGINA_CLIENTE.md`) e texto de empty state prometem atualização a cada minuto, mas `ClienteDashboardPage` define apenas `staleTime: 60_000` — **não há `refetchInterval: 60_000`**. Hoje o refresh ocorre por foco de janela (`refetchOnWindowFocus: true`) e botão manual “Atualizar”. |
| 5 | Dashboard | ✅ | `ClienteDashboardPage` carrega via `fetchClienteDashboard`, estados loading/erro/sucesso, hero + board + contas. |
| 6 | Cabeçalho do gabinete | ✅ | `ClienteGabineteSummary` exibe tipo de vínculo, gabinete/órgão, usuário, e-mail, ponto formatado, timestamp relativo. |
| 7 | Contadores | ✅ | `useClienteDashboardStats` + `ClientePortalStats`: PT, aprovação, arquivos, em andamento, total. KPIs clicáveis expandem seção no board. |
| 8 | Seções colapsáveis | ✅ | `ClienteCollapsibleWorkBoard` + `ClienteCollapsibleSection`: `aria-expanded`, `aria-controls`, animação grid, abertura inicial pela pendência prioritária. |
| 9 | Nomes corretos das seções | ✅ | `clienteSectionConfig.ts`: “Problemas Técnicos”, “Aguardando Aprovação”, “Aguardando Arquivos”, “Em andamento”. |
| 10 | Remoção do prefixo “Pendências —” | ⚠️ | **Fluxo ativo:** títulos sem prefixo em `clienteSectionConfig`. **Legado morto:** `ClienteWorkBoard.tsx` ainda contém “Pendências — …” mas **não é importado** em nenhuma rota ativa. |
| 11 | Cards compactos | ✅ | `ClienteCompactOsCard` substitui cards antigos no board e listas de pendências. |
| 12 | Expansão de OS | ✅ | Botão “Detalhes” com `aria-expanded` / `aria-controls`; painel com stepper completo + timeline. |
| 13 | Timeline lazy | ✅ | `useClienteOsTimeline(..., { enabled: expanded })` — fetch só quando card expandido. `ClienteOsTimeline` retorna `null` se `!expanded`. |
| 14 | Problemas Técnicos via `pendencia_url` | ⚠️ | CTA prioriza rota autenticada `/cliente/os/.../problemas-tecnicos`; bridge (`ClientePtBridgePage`) extrai token de `pendencia_url` via `parsePortalLinkFromUrl`. Fallback: `ClientePendingAction` abre URL externa se tipo desconhecido; estado “Aguardando geração do link” se URL ausente. **Não abre mais `pendencia_url` diretamente** para `problema_tecnico` — by design, mas depende do cache do dashboard. |
| 15 | `/portal/pt/{token}` sem login | ✅ | Rota em `routes/portal/pt.$token.tsx`, layout `PortalLayout` sem `AuthGuard`. `PortalPtPage` sem props `embedded` no fluxo público. |
| 16 | Validação de token PT | ✅ | `fetchClientAnalysis` → `GET /analise/client/{ano}/{os_id}?token=`. Backend `_validate_client_token_row` em `tabClientTokens` (expiração, OS/ano). |
| 17 | Upload PT | ✅ | `clientUploadFilesSmart` (gdrive/server), validação nome+ponto, `AnaliseHtmlViewer` mantido. Token passado no upload. |
| 18 | Desconsiderar item PT | ✅ | `clientDesconsiderarItem` → `POST /client/desconsiderar-item`, confirmação `window.confirm`, validação identidade. |
| 19 | Página de prova | ✅ | `ClienteProofPage` + bridges; layout 2 colunas; viewer, ações, modais. Público via `PortalAprovacaoPage` wrapper. |
| 20 | Aprovação / solicitar ajuste | ✅ | `respondProof` → `POST /client/proof/respond`. Backend `proof_portal_routes.py` com `_validate_proof_token`. Ajuste exige observação (`!obsOk` desabilita botão). Ações só via POST. |
| 21 | Estados vazios | ✅ | `ClienteSectionEmptyState` por seção; mensagens específicas em `clienteSectionConfig`; bridges com `ClienteLinkUnavailable`. |
| 22 | Responsividade | ⚠️ | Nav `overflow-x-auto`, cards `flex-col sm:flex-row`, prova `order-1/2` no mobile, alvos `min-h-11`. **Ressalva:** PT público usa `h-screen`; PT embedded no shell pode gerar página muito alta (scroll duplo possível em mobile). |
| 23 | Acessibilidade | ⚠️ | Pontos fortes: `aria-expanded`, `aria-current` na nav, `role="region"` nas seções, `role="alert"` em erros, `sr-only` em labels. **Gaps:** modal de prova sem focus trap nem `Escape`; KPIs `StatCard` como `<button>` sem `aria-label` descritivo; alguns ícones decorativos sem revisão em PT. |
| 24 | Build | ✅ | `pnpm build` — sucesso (08/06/2026). `routeTree.gen.ts` inclui rotas `/cliente/os/$ano/$nrOs/*`. |
| 25 | Testes | ✅ | Frontend: 32/32. Backend: 45/45. `pnpm typecheck`: falha **pré-existente** TS6310 em `tsconfig.app.json`. |

---

## Detalhamento por área

### A. Autenticação e sessão (itens 1–3)

Fluxo preservado:

```
/cliente/login → POST /auth/cliente/login (cookie HttpOnly)
              → clienteStore.user preenchido
/cliente/*     → ClienteAuthGuard.hydrate() → GET /cliente/me
              → sem sessão → redirect /cliente/login
```

Nenhuma alteração detectada em `clienteStore.ts`, `ClienteAuthGuard.tsx` ou nome do cookie no backend.

### B. Dashboard e UX (itens 4–13)

**Ponto crítico — item 4:**

```typescript
// ClienteDashboardPage.tsx (estado atual)
const dashboardQuery = useQuery({
  queryKey: ["cliente", "dashboard"],
  queryFn: fetchClienteDashboard,
  staleTime: 60_000,
  refetchOnWindowFocus: true,
  // refetchInterval: 60_000  ← AUSENTE (documentado como obrigatório)
});
```

`ClienteSectionEmptyState` informa ao usuário: *“Os dados são atualizados automaticamente a cada minuto”* — texto **inconsistente** com o comportamento real.

**Timeline lazy (item 13):** implementação correta — query desabilitada até expansão; passagem de `timelineQuery` evita dupla instância no card.

### C. Problemas Técnicos (itens 14–18)

| Fluxo | Rota | Auth | Token |
|-------|------|------|-------|
| Público (e-mail/link antigo) | `/portal/pt/{token}?os=&ano=` | Não | Query param |
| Autenticado (novo) | `/cliente/os/{ano}/{os}/problemas-tecnicos` | Sim | Extraído de `pendencia_url` |

`clientApiFetch` em `client-portal.ts` **não** envia cookies — portal PT permanece público.

Upload e desconsiderar mantêm validações de identidade (nome + ponto) e confirmações.

### D. Provas / Aprovação (itens 19–20)

Endpoints existentes reutilizados (sem duplicação):

| Método | Path | Uso |
|--------|------|-----|
| GET | `/client/proof/{ano}/{os_id}?token=` | Metadados |
| GET | `/client/proof/{ano}/{os_id}/pdf?token=` | Viewer / download |
| POST | `/client/proof/respond` | Aprovar ou solicitar ajuste |

Após resposta, `ClienteProofPage` invalida `["cliente", "dashboard"]` para refletir remoção da pendência no próximo fetch.

### E. Qualidade (itens 21–25)

**Testes cobertos:** `pendenciaBridge.test.ts`, `clienteSectionConfig.test.ts`, `clienteProgressMapper.test.ts`, `test_public_tokens.py` (tokens PT/prova).

**Não coberto por testes automatizados:** fluxo E2E de upload PT, modais de prova, polling 60s, render mobile real.

---

## Regressões e riscos

### ❌ Regressão confirmada

| ID | Severidade | Descrição |
|----|------------|-----------|
| R-01 | **Alta** | Polling automático de 60s do dashboard removido/ausente. Comportamento documentado e prometido na UI não corresponde ao código. |

### ⚠️ Ressalvas (não bloqueantes)

| ID | Severidade | Descrição |
|----|------------|-----------|
| W-01 | Média | Texto “atualizados automaticamente a cada minuto” enganoso sem `refetchInterval`. |
| W-02 | Baixa | `ClienteWorkBoard` legado com prefixo “Pendências —” (código morto, risco de reutilização acidental). |
| W-03 | Baixa | Modal de decisão da prova sem focus trap / tecla Escape. |
| W-04 | Baixa | PT embedded dentro do shell pode ter scroll longo em mobile. |
| W-05 | Info | CTA de PT no dashboard não abre mais `pendencia_url` em nova aba — usa bridge interna (token ainda vem da URL do backend). |

### 🔶 Validação manual recomendada

| Cenário | Motivo |
|---------|--------|
| Upload real de arquivo corrigido no PT | Depende de ambiente com token válido e storage gdrive/server |
| Aprovação/reprovação com token real | POST contra backend com prova pendente |
| Cookie em navegador anônimo em `/portal/pt/{token}` | Confirmar ausência de redirect para login |

---

## Plano de correção (separado — não implementado)

### Prioridade P0 — corrigir antes de release

**R-01 — Restaurar refetch 60s**

| Ação | Arquivo | Detalhe |
|------|---------|---------|
| Adicionar `refetchInterval: 60_000` | `ClienteDashboardPage.tsx` | Restaurar comportamento documentado em `PAGINA_CLIENTE.md` |
| Opcional: mesmo intervalo | `ClientePendenciasListPage.tsx`, `useClienteDashboardOs.ts` | Manter bridges sincronizadas com dashboard |
| Alinhar texto OU código | `ClienteSectionEmptyState.tsx` | Se não restaurar polling, remover frase “a cada minuto” |

**Estimativa:** 15 min. **Risco:** baixo.

### Prioridade P1 — consistência UX

| Ação | Detalhe |
|------|---------|
| W-05 | Documentar no manual que CTA interno substitui link direto; manter fallback `ClientePendingAction` para tipos não mapeados |
| W-01 | Resolver junto com R-01 |

### Prioridade P2 — qualidade e manutenção

| Ação | Detalhe |
|------|---------|
| W-02 | Remover ou marcar `@deprecated` em `ClienteWorkBoard`, `ClienteWorkCard`, `ClienteWorkSection` se rollback não for mais necessário |
| W-03 | Adicionar focus trap + `Escape` em `ClienteProofDecisionModal` |
| W-04 | Limitar altura do PT embedded (`max-h-[calc(100vh-...)]`) ou scroll interno |

### Prioridade P3 — cobertura

| Ação | Detalhe |
|------|---------|
| Teste unitário | Mock de `useQuery` options para garantir `refetchInterval: 60_000` no dashboard |
| Teste E2E (futuro) | Fluxo login → card PT → upload; login → prova → aprovar |

---

## Comandos executados nesta auditoria

```text
pnpm test:frontend  → 32 passed
pnpm test:backend   → 45 passed
pnpm build          → OK
pnpm typecheck      → TS6310 pré-existente (não introduzido por esta integração)
```

---

## Checklist manual pós-correção (R-01)

- [ ] Abrir `/cliente` logado e aguardar 60s sem interagir — dashboard deve refetch sozinho (Network tab)
- [ ] Confirmar que seção “Aguardando Aprovação” atualiza após aprovar prova em outra aba
- [ ] Confirmar que texto de empty state corresponde ao comportamento real
- [ ] Reexecutar `pnpm test:frontend` e `pnpm build`

---

## Referências de código auditadas

| Área | Arquivos principais |
|------|---------------------|
| Auth | `clienteStore.ts`, `ClienteAuthGuard.tsx`, `session_auth.py` |
| Dashboard | `ClienteDashboardPage.tsx`, `ClienteCollapsibleWorkBoard.tsx`, `clienteSectionConfig.ts` |
| Bridges | `pendenciaBridge.ts`, `ClientePtBridgePage.tsx`, `ClienteProofBridgePage.tsx` |
| PT público | `routes/portal/pt.$token.tsx`, `PortalPtPage.tsx`, `client-portal.ts` |
| Prova | `ClienteProofPage.tsx`, `proof-portal.ts`, `proof_portal_routes.py` |
| Rotas cliente | `routes/cliente/*`, `routeTree.gen.ts` |

---

*Auditoria realizada por análise estática e testes automatizados. Nenhum arquivo de código foi alterado nesta etapa.*
