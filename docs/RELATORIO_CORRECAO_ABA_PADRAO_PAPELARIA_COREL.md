# Relatório — Correção aba padrão Papelaria (Corel)

**Data:** 10/06/2026

---

## 1. Causa encontrada

O novo fluxo Corel **estava implementado e compilado**, mas a página abria sempre na aba **Cartão de visita (SVG)** porque o estado inicial estava fixo em código:

```tsx
const [activeTab, setActiveTab] = useState<PapelariaTab>("cartao");
```

em `PapelariaPage.tsx`.

`PapelariaCorelPanel` já era importado e renderizado corretamente ao selecionar a aba **Corel (modelos)** — o problema era **navegação/UX (aba padrão)**, não ausência do componente nem falha das Fases 1–3.

---

## 2. Classificação do problema

| Hipótese | Resultado |
|----------|-----------|
| Aba padrão fixada em SVG | **Causa principal** |
| `PapelariaCorelPanel` não importado | Não — importado e condicionalmente renderizado |
| Aba Corel não funciona ao clicar | Não — funcionava; só não era a padrão |
| `sessionStorage` / `localStorage` da aba | Não — não havia persistência de aba |
| Sidebar não passa OS | Não — `setPapelariaNavigationContext` grava `sagra_current_os_id`, `sagra_current_os_ano`, `sagra_target_product` |
| Endpoint contexto | Não investigado em runtime (correção só frontend); código chama `GET /api/papelaria/os/{ano}/{nro}/contexto` quando aba Corel monta |
| Build antigo em produção | Build local e `\\cgrafsysvm\...\index-*.js` contêm bundle com `PapelariaCorelPanel` (função minificada `LY`, status de jobs, etc.) — **não é build sem Corel** |
| Cache/PWA | Possível em browsers já abertos, mas o sintoma principal (aba SVG ativa) reproduz-se no código-fonte sem depender de cache |

---

## 3. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `apps/web/src/features/papelaria/components/PapelariaPage.tsx` | Aba inicial via `resolveInitialPapelariaTab()` |
| `apps/web/src/features/papelaria/papelariaSession.ts` | `isPapelariaCorelOs`, `resolveInitialPapelariaTab`, tipo `PapelariaTabId` |
| `apps/web/src/features/papelaria/papelariaSession.test.ts` | 3 testes da regra de aba |
| `docs/RELATORIO_CORRECAO_ABA_PADRAO_PAPELARIA_COREL.md` | Este relatório |

**Não alterados:** backend, banco, `.env`, deploy produção.

---

## 4. Regra de abertura da aba

| Condição | Aba inicial |
|----------|-------------|
| `sagra_current_os_id` ≥ 5000 (OS papelaria no sessionStorage) | **Corel (modelos)** |
| Sem OS ou OS &lt; 5000 | **Cartão de visita (SVG)** |

- Troca manual entre abas continua funcionando.
- Recarregar a página com OS 5024/2025 no sessionStorage abre de novo em **Corel** (não volta para SVG indevidamente).
- Sidebar continua gravando contexto antes da navegação (comportamento existente).

---

## 5. Validação manual

1. Na página **Início**, selecionar OS de papelaria (ex.: **5024/2025**, número ≥ 5000).
2. Clicar **Papelaria** no sidebar.
3. Confirmar aba **Corel (modelos)** ativa por padrão.
4. Confirmar cabeçalho da OS, modelos compatíveis, formulário dinâmico, **Gerar arquivo**, seção **Fila de geração Corel/PDF**.
5. Clicar **Cartão de visita (SVG)** — painel SVG legado deve abrir normalmente.
6. Recarregar (`F5`) — deve permanecer em **Corel** (com OS ainda no sessionStorage).
7. Acessar `/papelaria` sem OS selecionada — deve abrir em **SVG**.

---

## 6. Testes e build

| Comando | Resultado |
|---------|-----------|
| `pnpm test:frontend` | **127 passed** (+3 novos em `papelariaSession.test.ts`) |
| `pnpm build` | **OK** |
| `pnpm lint` | **OK** |

---

## Resumo

Correção mínima de uma linha de comportamento: a aba padrão passou de `"cartao"` fixo para **Corel quando há OS de papelaria (≥ 5000)** no contexto de navegação. O fluxo das Fases 1–3 já existia; faltava exibi-lo como tela principal nesse caminho de uso.

---

## Atualização — erro “Erro ao carregar contexto da OS”

### Causa adicional

1. **Backend:** campos numéricos do MySQL (`Cores`, `FrenteVerso`, `RamalUsuario`, `GabSalaUsuario`, etc.) causavam `AttributeError: 'int' object has no attribute 'strip'` em `build_os_context` / prefill SVG — confirmado nos logs (`Erro prefill SVG OS 5024/2025`).
2. **UI:** mensagem genérica ocultava o detalhe real da API (403, 404, 500).
3. **Console (secundário):** `tabUserPreferences` ausente — não bloqueia contexto Corel, mas gera ruído em `/api/settings/preferences`.

### Correções aplicadas

| Arquivo | Alteração |
|---------|-----------|
| `papelaria_models_service.py` | `_as_str()` — coerce int→str antes de `.strip()` |
| `papelaria_svg_service.py` | Mesmo tratamento em prefill SVG |
| `PapelariaCorelPanel.tsx` | Exibe mensagem da API + botão “Tentar novamente” + `retry: 2` |
| `PapelariaPage.tsx` | `key` por OS para remontar painel ao trocar OS |

### Validação

- Teste novo: `test_build_os_context_com_campos_numericos` — **OK**
- Recarregar `/papelaria` com OS 5024/2025: contexto deve carregar modelos Corel

> **Nota:** alterações no backend Python exigem **recarregar o processo da API** (uvicorn) para surtir efeito — sem isso o erro 500 pode persistir mesmo com o código corrigido.
