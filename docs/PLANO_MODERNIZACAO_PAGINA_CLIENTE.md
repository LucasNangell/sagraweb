# Plano Técnico — Modernização do Portal `/cliente`

> **Status:** Auditoria concluída — **nenhum código alterado nesta etapa**  
> **Data:** junho de 2026  
> **Escopo:** Transformar a visualização atual em um painel moderno de acompanhamento de OSs com cards horizontais e régua de progresso por etapa.

---

## Sumário

1. [Diagnóstico atual](#1-diagnóstico-atual)
2. [Análise de dados disponíveis](#2-análise-de-dados-disponíveis)
3. [Viabilidade sem alterar API](#3-viabilidade-sem-alterar-api)
4. [Mapeamento visual das etapas](#4-mapeamento-visual-das-etapas)
5. [Arquitetura proposta](#5-arquitetura-proposta)
6. [Componentes: criar, alterar ou preservar](#6-componentes-criar-alterar-ou-preservar)
7. [Estratégia de preservação das funcionalidades](#7-estratégia-de-preservação-das-funcionalidades)
8. [Design system e UX](#8-design-system-e-ux)
9. [Responsividade](#9-responsividade)
10. [Animações e microinterações](#10-animações-e-microinterações)
11. [React Query — estratégia anti-regressão](#11-react-query--estratégia-anti-regressão)
12. [Plano de implementação por fases](#12-plano-de-implementação-por-fases)
13. [Checklist de validação](#13-checklist-de-validação)
14. [Riscos e mitigação](#14-riscos-e-mitigação)
15. [Decisões em aberto](#15-decisões-em-aberto)

---

## 1. Diagnóstico atual

### 1.1 O que a página faz hoje

A rota `/cliente` é um dashboard autenticado para gabinetes/órgãos acompanharem OSs vinculadas ao seu cadastro. O fluxo atual:

```
ClienteAuthGuard (hydrate → GET /cliente/me)
  └── ClienteDashboardPage (GET /cliente/dashboard, refetch 60s)
        ├── PortalSystemHeader
        ├── Cabeçalho (gabinete, saudação, Atualizar, Sair)
        ├── 4 seções verticais com ClienteOsList
        └── ClienteContasPanel
```

Cada `ClienteOsList` renderiza uma **lista acordeão** (`<ul>` com `divide-y`):

- Linha compacta: OS, título, produto, situação, setor.
- Botão de pendência (seções de pendência + `pendencia_url`).
- Ao expandir: `ClienteOsTimeline` (vertical, lazy fetch).

### 1.2 Pontos fortes do estado atual

| Aspecto | Avaliação |
|---------|-----------|
| Separação auth cliente/staff | Sólida — cookie e store isolados |
| Classificação de pendências | Feita no backend — confiável |
| Timeline detalhada | 7 marcos de produção bem definidos no serviço Python |
| React Query | Query keys estáveis, refetch interval preservado |
| Acessibilidade básica | `aria-expanded`, `aria-controls` no acordeão |
| Estados loading/erro/vazio | Presentes em dashboard, timeline e contas |

### 1.3 Lacunas em relação ao objetivo visual

| Lacuna | Impacto |
|--------|---------|
| Visual de lista simples, não de painel | Baixa percepção de progresso |
| Progresso só visível após expandir | Gabinete não vê etapas de relance |
| `max-w-5xl` estreito para stepper horizontal | Cards com 7 etapas ficarão apertados |
| Sem resumo quantitativo no topo | Dificulta leitura rápida ("3 pendências") |
| Sem distinção visual forte entre seções | Pendências competem visualmente com andamento |
| Timeline vertical na expansão | Adequada para detalhe, mas não para scan rápido |

### 1.4 Componentes fora do escopo de alteração (regra crítica)

Estes arquivos **não serão modificados** na implementação:

- `clienteStore.ts`
- `ClienteAuthGuard.tsx`
- `PortalSystemHeader.tsx` (apenas consumo; sem mudança estrutural)
- `apps/web/src/lib/api.ts`
- `apps/web/src/api/cliente-portal.ts` (contratos intactos)
- Qualquer arquivo em `app/backend/`

---

## 2. Análise de dados disponíveis

### 2.1 `ClienteOsItem` (dashboard — sempre disponível)

Fonte: `GET /api/cliente/dashboard` → arrays por seção.

```typescript
{
  nr_os: number;
  ano: number;
  titulo: string;
  produto: string;
  situacao: string;          // situação atual (último andamento)
  setor: string;             // setor atual
  observacao?: string;
  data_andamento?: string | null;
  pendencia_tipo?: string | null;   // problema_tecnico | aprovacao_prova | envio_arquivo
  pendencia_url?: string | null;
  pendencia_label?: string;
  versao?: string;
}
```

**O que dá para fazer só com dashboard:**

- Identificação completa do card (OS, título, produto, setor, situação).
- Badge de pendência e CTA (`pendencia_url`, `pendencia_label`).
- Data do último andamento (`data_andamento`).
- Estimativa **grosseira** da etapa atual via heurística `situacao` + `setor`.

**O que NÃO dá para fazer só com dashboard:**

- Estado individual dos 7 marcos (concluído / atual / aguardando).
- Datas por marco.
- Pendências anexadas a marcos específicos na timeline.
- Título dinâmico "Análise do arquivo" vs "Preparando Arquivos".

### 2.2 `ClienteTimelineStep` (timeline — lazy)

Fonte: `GET /api/cliente/os/{ano}/{nr_os}/andamentos` — hoje só quando `expanded=true`.

```typescript
{
  ordem: number;
  situacao: string;           // título do marco (ex.: "Enviado para Impressão")
  setor: string;
  concluido: boolean;
  data?: string | null;
  pendencia_tipo?: string | null;
  pendencia_url?: string | null;
  pendencia_label?: string | null;
  pendencia_mensagem?: string | null;
}
```

Também disponível no response: `produto`, `maquina`, `referencia_os_count`.

**Os 7 marcos retornados pelo backend (ordem fixa):**

| ordem | ID interno (backend) | Título típico |
|-------|----------------------|---------------|
| 1 | `entrada_inicial` | Entrada Inicial |
| 2 | `enviada_pre_impressao` | Enviado à Seção de Pré-Impressão |
| 3 | `preparacao_arquivo` | Preparando Arquivos / Análise do arquivo |
| 4 | `enviada_impressao` | Enviado para Impressão |
| 5 | `enviada_acabamento` | Enviado para Acabamento |
| 6 | `enviada_expedicao` | Enviado para Expedição |
| 7 | `entregue` | Entregue |

> **Nota:** OSs entregues/canceladas são filtradas no dashboard e **não aparecem** na `/cliente`. O marco "Entregue" raramente será exibido no painel, mas deve constar no stepper para consistência visual.

### 2.3 Dados por seção do dashboard

| Seção | Campo API | `showPendenciaButton` | Particularidade |
|-------|-----------|----------------------|-----------------|
| Problemas técnicos | `pendencias_pt` | `true` | `pendencia_tipo ≈ problema_tecnico` |
| Aprovação de prova | `pendencias_aprovacao` | `true` | inclui `versao` |
| Envio de arquivos | `pendencias_envio_arquivo` | `true` | |
| OSs em andamento | `em_andamento` | `false` | sem `pendencia_url` no item |

Uma OS aparece em **apenas uma** lista (mutuamente exclusivo no backend).

---

## 3. Viabilidade sem alterar API

### 3.1 Conclusão

**É viável implementar o painel moderno sem alterar endpoints nem contratos**, utilizando:

1. **Dashboard** para metadados do card, badges, CTAs de pendência e skeleton do stepper.
2. **Timeline existente** para régua de progresso precisa — reutilizando a mesma query key do `ClienteOsTimeline`.
3. **Utilitário frontend** (`clienteProgressUtils.ts`) para derivar estados visuais dos steps a partir de `ClienteTimelineStep[]`.

### 3.2 Estratégia recomendada para o stepper no card

**Abordagem híbrida com fetch sob demanda por visibilidade (recomendada):**

```
ClienteWorkCard
  └── useQuery(["cliente", "timeline", ano, nrOs], { enabled: isVisible })
        └── ClienteProgressStepper(steps, loading)
```

| Aspecto | Detalhe |
|---------|---------|
| `isVisible` | `IntersectionObserver` — fetch só quando card entra no viewport |
| Query key | **Idêntica** à do `ClienteOsTimeline` → expandir reutiliza cache |
| `staleTime` | Manter `30_000` (30s) — alinhado ao atual |
| Fallback | Skeleton stepper (7 placeholders) enquanto carrega |
| Sem timeline | Stepper degradado com heurística via `ClienteOsItem` (ver §4.2) |

**Por que não buscar timeline para todas as OSs no mount:**

- Gabinetes podem ter dezenas de OSs → rajada de requests paralelos.
- O refetch do dashboard (60s) não deve disparar refetch em massa das timelines em cache.

**Por que não duplicar lógica de marcos só no frontend:**

- O backend tem matchers complexos (`cliente_os_timeline_service.py`, ~500 linhas).
- Duplicar geraria drift e estados incorretos — inaceitável em sistema institucional.

### 3.3 Backend — alteração necessária?

**Não.** Nenhuma mudança em `cliente_gabinete_routes.py` ou serviços é necessária para o objetivo visual proposto.

Única melhoria futura (fora do escopo, opcional Fase 5+): endpoint batch `GET /cliente/dashboard/progress` — **não recomendado agora** pela regra de não alterar APIs.

---

## 4. Mapeamento visual das etapas

### 4.1 Estados visuais do stepper

| Estado UI | Condição (a partir de `ClienteTimelineStep`) | Tokens visuais |
|-----------|----------------------------------------------|----------------|
| **Concluída** | `step.concluido === true` e sem pendência | Círculo `bg-primary-green`, ícone `Check`, conector verde |
| **Atual / em andamento** | `!concluido` e é o primeiro step após último concluído | Círculo com `ring-primary-green/30`, label em `text-secondary-blue`, pulso sutil |
| **Aguardando** | `!concluido` e step futuro | Círculo `border-neutral-300`, label `text-neutral-400` |
| **Pendência do cliente** | `step.pendencia_label` ou `step.pendencia_url` | Círculo âmbar, ícone `AlertTriangle`, borda `amber-500`, destaque no card |
| **Finalizada** | Todos os steps anteriores concluídos, penúltimo marco ativo | Tratar como "Atual" com label "Em finalização" |
| **Entregue** | Marco 7 `concluido` | Step especial com ícone `PackageCheck` — raro no dashboard |

**Derivação do step "atual"** (reutilizar lógica já validada em `ClienteOsTimeline.tsx`):

```typescript
const lastCompletedIndex = steps.reduce(
  (acc, step, index) => (step.concluido ? index : acc),
  -1,
);
const isCurrent = (index, step) =>
  step.pendencia_label ||
  index === lastCompletedIndex + 1 ||
  (index === 0 && !step.concluido);
```

### 4.2 Fallback heurístico (sem timeline carregada)

Quando `steps` ainda não disponíveis, estimar índice atual (0–6) a partir de `ClienteOsItem`:

| situacao (contains) | setor | Índice estimado |
|---------------------|-------|-----------------|
| `Entrada Inicial` | * | 0 |
| `Saída p/` | `SEFOC` | 1 |
| `Em Execução`, `Recebido`, `Problemas Técnicos`, `Aguard. Aprovação`, `Pendência Usuário` | `SEFOC` | 2 |
| `Saída p/` | `SIELT`, `SEIMP` | 3 |
| `Saída p/` | `SEPAC`, `Encadernação` | 4 |
| `Saída p/` | `Expedição`, `Correspondência`, `SEDIR` | 5 |
| `Entregue` | * | 6 |

Steps anteriores ao índice → "concluída" (estimada); posteriores → "aguardando". Exibir indicador `~` ou opacidade reduzida para sinalizar dados provisórios.

### 4.3 Labels curtos para o stepper horizontal

Títulos completos do backend são longos para desktop e inviáveis em mobile. Proposta de labels compactos:

| # | Label desktop | Label mobile |
|---|---------------|--------------|
| 1 | Entrada | Ent. |
| 2 | Pré-impressão | Pré-imp. |
| 3 | Preparação | Prep. |
| 4 | Impressão | Impr. |
| 5 | Acabamento | Acab. |
| 6 | Expedição | Exp. |
| 7 | Entregue | Entreg. |

Tooltip/`title` com o título completo do backend (`step.situacao`) para acessibilidade.

### 4.4 Mapeamento de pendências do dashboard para destaque no card

| `pendencia_tipo` | Badge | Cor de destaque no card |
|------------------|-------|-------------------------|
| `problema_tecnico` | "PT pendente" | Borda esquerda âmbar + ícone `Wrench` |
| `aprovacao_prova` | "Prova v{N}" | Borda âmbar + ícone `FileCheck` |
| `envio_arquivo` | "Envio pendente" | Borda âmbar + ícone `Upload` |
| (nenhum) | Badge situação atual | Borda neutra / verde sutil se em andamento |

---

## 5. Arquitetura proposta

### 5.1 Diagrama de componentes

```
ClienteDashboardPage                    [REFATORAR layout]
├── PortalSystemHeader                  [PRESERVAR]
├── ClienteDashboardToolbar             [NOVO — extrai cabeçalho + resumo]
│   ├── Saudação + nome gabinete
│   ├── ClienteDashboardSummary         [NOVO — contadores opcionais]
│   └── Botões Atualizar / Sair         [PRESERVAR lógica]
├── ClienteWorkBoard                    [NOVO — orquestra seções]
│   ├── ClienteWorkSection × 4          [NOVO]
│   │   ├── SectionHeader               [NOVO — título + contagem + ícone]
│   │   └── ClienteWorkCard × N         [NOVO]
│   │       ├── ClienteOsCardHeader     [NOVO]
│   │       │   ├── OS id + título
│   │       │   ├── ClienteStatusBadge  [NOVO]
│   │       │   └── meta (produto, setor, data)
│   │       ├── ClienteProgressStepper  [NOVO]
│   │       ├── ClientePendingAction    [NOVO — wrapper do CTA]
│   │       ├── ExpandToggle            [NOVO — "Ver detalhes"]
│   │       └── ClienteOsTimeline       [PRESERVAR — área expandida]
└── ClienteContasPanel                  [PRESERVAR — alinhar estilo]
```

### 5.2 Novos arquivos propostos

```
apps/web/src/features/cliente/
├── components/
│   ├── ClienteDashboardPage.tsx        (refatorar)
│   ├── ClienteWorkBoard.tsx            (novo)
│   ├── ClienteWorkSection.tsx          (novo)
│   ├── ClienteWorkCard.tsx             (novo)
│   ├── ClienteOsCardHeader.tsx         (novo)
│   ├── ClienteProgressStepper.tsx      (novo)
│   ├── ClienteStatusBadge.tsx          (novo)
│   ├── ClientePendingAction.tsx        (novo)
│   ├── ClienteDashboardToolbar.tsx     (novo)
│   ├── ClienteOsTimeline.tsx           (preservar, possível extração de lógica)
│   ├── ClienteOsList.tsx               (deprecar → wrapper fino ou remover)
│   └── ClienteContasPanel.tsx          (preservar)
├── hooks/
│   ├── useClienteOsTimeline.ts         (novo — query compartilhada)
│   └── useInViewport.ts                (novo — IntersectionObserver)
├── utils/
│   ├── clienteProgressUtils.ts         (novo — deriveStepVisualState, fallback)
│   └── clienteStepLabels.ts            (novo — labels curtos, constantes)
└── types/
    └── clienteProgress.ts              (novo — StepVisualState, SectionKind)
```

### 5.3 Hook compartilhado de timeline

```typescript
// useClienteOsTimeline.ts — proposta
export function useClienteOsTimeline(
  ano: number,
  nrOs: number,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["cliente", "timeline", ano, nrOs],
    queryFn: () => fetchClienteOsTimeline(ano, nrOs),
    enabled: options?.enabled ?? false,
    staleTime: 30_000,
  });
}
```

`ClienteOsTimeline` e `ClienteWorkCard` passam a consumir este hook — **única fonte de query**, zero duplicação de configuração.

### 5.4 Tipo `SectionKind`

```typescript
type SectionKind =
  | "pendencias_pt"
  | "pendencias_aprovacao"
  | "pendencias_envio_arquivo"
  | "em_andamento";
```

Propaga visual da seção (cor de accent, ícone, prioridade de destaque) sem alterar dados da API.

---

## 6. Componentes: criar, alterar ou preservar

| Componente | Ação | Justificativa |
|------------|------|---------------|
| `ClienteDashboardPage` | **Refatorar** | Trocar `ClienteOsList` por `ClienteWorkBoard`; manter query e handlers intactos |
| `ClienteOsList` | **Substituir** | Lógica de acordeão migra para `ClienteWorkCard`; manter arquivo temporariamente como re-export se necessário para rollback |
| `ClienteOsTimeline` | **Preservar + refatorar leve** | Extrair hook; manter UI vertical na expansão; possível polish visual alinhado ao card |
| `ClienteContasPanel` | **Preservar** | Funcionalidade intacta; opcional harmonizar bordas/sombras com novos cards |
| `ClienteAuthGuard` | **Preservar** | Sem alteração |
| `clienteStore` | **Preservar** | Sem alteração |
| `PortalSystemHeader` | **Preservar** | Sem alteração |
| `ClienteWorkBoard` | **Criar** | Container das 4 seções |
| `ClienteWorkSection` | **Criar** | Título, contagem, lista de cards |
| `ClienteWorkCard` | **Criar** | Card horizontal principal |
| `ClienteProgressStepper` | **Criar** | Régua de etapas responsiva |
| `ClienteStatusBadge` | **Criar** | Situação/pendência compacta |
| `ClientePendingAction` | **Criar** | CTA de pendência reutilizável |
| `ClienteDashboardToolbar` | **Criar** | Cabeçalho modernizado |

---

## 7. Estratégia de preservação das funcionalidades

### 7.1 Matriz de funcionalidades

| Funcionalidade | Como preservar |
|----------------|----------------|
| **Atualizar** | Mesmo `dashboardQuery.refetch()` no toolbar |
| **Sair** | Mesmo `handleLogout` → `logout()` + `navigate("/cliente/login")` |
| **Refetch 60s** | `useQuery` em `ClienteDashboardPage` inalterado |
| **4 seções** | `ClienteWorkBoard` recebe mesmo `data` com 4 arrays |
| **Mensagens vazias** | Prop `emptyMessage` em `ClienteWorkSection` |
| **Botão pendência** | `ClientePendingAction` — mesma condição `showPendenciaButton && pendencia_url` |
| **Link externo** | `target="_blank" rel="noopener noreferrer"` preservado |
| **Acordeão** | `expandedKeys: Set<string>` em `ClienteWorkBoard` ou `ClienteWorkSection` |
| **Timeline lazy** | `ClienteOsTimeline` com `expanded` prop; query via hook compartilhado |
| **Loading dashboard** | Skeleton cards ou texto centralizado |
| **Erro dashboard** | Banner vermelho preservado |
| **Loading timeline** | Spinner na área expandida |
| **Painel contas** | `ClienteContasPanel` no final, sem mudança de lógica |
| **Acessibilidade** | `aria-expanded`, `aria-controls`, `role="region"` nas seções |

### 7.2 Comportamento do acordeão

**Recomendação:** manter estado `expandedKeys` no nível `ClienteWorkBoard` (único ponto):

- Chave: `` `${ano}-${nr_os}` `` (igual ao atual).
- Um card expandido por vez **não** é obrigatório — permitir múltiplos (comportamento atual).
- Ao refetch do dashboard, `expandedKeys` persiste (estado local React — comportamento atual).
- Botão "Ver detalhes" / chevron no card substitui o clique na linha inteira — área de clique mais clara.

### 7.3 CTAs de pendência — dupla exposição

Manter CTA no card (visível sem expandir) **e** links na timeline expandida (comportamento atual). `ClientePendingAction` centraliza markup e classes.

---

## 8. Design system e UX

### 8.1 Princípios para sistema institucional

- **Clareza > decoração** — hierarquia tipográfica forte, poucas cores semânticas.
- **Confiança** — estados explícitos, sem animações chamativas.
- **Consistência DEAPA** — tokens existentes em `index.css`.
- **Scan rápido** — pendências no topo com destaque; andamento abaixo.

### 8.2 Layout do card horizontal (desktop)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ▌ OS 2244/2025 · Título da publicação truncado...          [Badge PT]  │
│   Produto · Setor SEFOC · Atualizado 08/06/2026 14:30                  │
│                                                                         │
│   ●────●────◐────○────○────○────○   [Ver pendência →]  [▼ Detalhes]   │
│   Ent  Pré  Prep Impr Acab Exp  Entreg                                   │
│                                                                         │
│ ┌─ expandido: ClienteOsTimeline vertical ─────────────────────────┐   │
│ └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

- Borda esquerda colorida (`border-l-4`) por tipo de seção.
- `shadow-sm hover:shadow-md transition-shadow duration-200`.
- `rounded-xl` (upgrade de `rounded-lg` para cards principais).
- Fundo branco sobre `bg-sagra-bg`.

### 8.3 Cabeçalho do painel (toolbar)

Além da saudação atual, adicionar **resumo numérico** (derivado do dashboard, sem API extra):

```
[ 3 pendências PT ] [ 1 prova ] [ 0 arquivos ] [ 12 em andamento ]
```

Chips clicáveis com `scrollIntoView` para a seção — melhora UX sem nova funcionalidade de negócio.

### 8.4 Largura do container

Alterar `max-w-5xl` → `max-w-7xl` em `ClienteDashboardPage` para acomodar stepper horizontal. **Justificável** — apenas layout, sem impacto em APIs.

### 8.5 Tokens a utilizar (sem novos tokens CSS)

| Uso | Classes |
|-----|---------|
| Fundo página | `bg-sagra-bg` |
| Card | `bg-white border border-sagra-border shadow-sm` |
| Títulos | `text-secondary-blue font-semibold` |
| Sucesso/concluído | `text-primary-green`, `bg-primary-green` |
| Pendência | `amber-500/600/700`, `bg-amber-50` |
| Erro | `text-red-700`, `bg-red-50` |
| Ação primária pendência | `bg-primary-green` (preservar padrão atual) |
| Ação secundária | `border-sagra-border bg-white hover:bg-slate-50` |

---

## 9. Responsividade

### 9.1 Breakpoints (Tailwind padrão)

| Breakpoint | Layout do card | Stepper |
|------------|----------------|---------|
| **≥ lg (1024px)** | Horizontal — header + stepper + ações na mesma linha | 7 etapas lado a lado com conectores |
| **md (768–1023px)** | Header empilhado; stepper em faixa própria | `overflow-x-auto` com `snap-x snap-mandatory`, scrollbar fina |
| **< md (mobile)** | Vertical — header, badge, stepper compacto, ações | Dots numerados + label só da etapa atual; ou mini-barra de progresso `%` |

### 9.2 Stepper mobile — proposta

Em vez de 7 labels ilegíveis:

```
Etapa 3 de 7 — Preparação
[████████░░░░░░░░░░] 43%
● ● ● ○ ○ ○ ○
```

Percentual = `(lastCompletedIndex + 1) / 7 * 100`.

### 9.3 Toolbar mobile

- Botões Atualizar/Sair: ícones apenas (`aria-label` obrigatório).
- Chips de resumo: `overflow-x-auto` horizontal.

### 9.4 Touch targets

Mínimo 44×44px para botões de expandir e CTAs (WCAG 2.5.5).

---

## 10. Animações e microinterações

**Regra:** apenas CSS/Tailwind, discretas, respeitando `prefers-reduced-motion`.

| Elemento | Animação | Classes |
|----------|----------|---------|
| Card hover | Sombra | `transition-shadow duration-200 hover:shadow-md` |
| Chevron expandir | Rotação | `transition-transform duration-200` (já existe) |
| Step atual | Pulso sutil | `motion-safe:animate-pulse` no ring — **somente** etapa atual com pendência |
| Skeleton stepper | Shimmer | `animate-pulse bg-neutral-200 rounded-full` |
| Entrada de seção | Fade-in | `motion-safe:animate-in fade-in duration-300` — opcional, se `@sagra/ui` suportar |
| CTA pendência | Hover | `hover:bg-primary-green/90 active:scale-[0.98] transition-all` |

**Evitar:** parallax, bounce, animações longas, bibliotecas de animação (Framer Motion, etc.).

### 10.1 `prefers-reduced-motion`

```tsx
// Wrapper condicional
className="motion-reduce:transition-none motion-reduce:animate-none"
```

---

## 11. React Query — estratégia anti-regressão

### 11.1 Query keys — não alterar

| Key | Manter exatamente |
|-----|-------------------|
| `["cliente", "dashboard"]` | Sim — em `ClienteDashboardPage` |
| `["cliente", "timeline", ano, nrOs]` | Sim — hook compartilhado |
| `["cliente", "contas"]` | Sim — em `ClienteContasPanel` |

### 11.2 Configurações — não alterar

| Query | Config | Onde |
|-------|--------|------|
| dashboard | `refetchInterval: 60_000` | `ClienteDashboardPage` |
| timeline | `staleTime: 30_000` | `useClienteOsTimeline` |
| timeline | `enabled` controlado por visibilidade/expansão | `ClienteWorkCard` / `ClienteOsTimeline` |

### 11.3 Regras de fetch do stepper

```
enabled = isVisible || isExpanded
```

- Card visível no viewport → prefetch para stepper.
- Card expandido → garante fetch mesmo fora do viewport.
- Card nunca visível → **sem fetch** (economia).

### 11.4 Invalidação

- Refetch manual (Atualizar) → invalida apenas `["cliente", "dashboard"]`.
- Timeline em cache permanece válida por `staleTime` — aceitável; expandir força revalidate se stale.
- Criar subconta → comportamento atual de `invalidateQueries(["cliente", "contas"])` preservado.

### 11.5 Testes de regressão React Query

- Verificar que `enabled: false` não dispara fetch no mount.
- Verificar cache hit ao expandir após prefetch por viewport.
- Verificar que refetch interval do dashboard não duplica requests de timeline.

---

## 12. Plano de implementação por fases

### Fase 0 — Preparação (sem UI visível)

**Objetivo:** Infraestrutura compartilhada sem mudar a página.

| # | Tarefa | Arquivos |
|---|--------|----------|
| 0.1 | Criar `useClienteOsTimeline` extraindo query de `ClienteOsTimeline` | `hooks/useClienteOsTimeline.ts` |
| 0.2 | Refatorar `ClienteOsTimeline` para usar o hook | `ClienteOsTimeline.tsx` |
| 0.3 | Criar `clienteProgressUtils.ts` + testes unitários | `utils/`, `*.test.ts` |
| 0.4 | Criar `useInViewport` | `hooks/useInViewport.ts` |
| 0.5 | Criar tipos `clienteProgress.ts` | `types/` |

**Critério de aceite:** `ClienteOsTimeline` funciona identicamente; testes passam; build OK.

---

### Fase 1 — Componentes atômicos do design

**Objetivo:** Peças visuais isoladas, testáveis em Storybook ou página temporária (opcional).

| # | Tarefa |
|---|--------|
| 1.1 | `ClienteStatusBadge` — variantes: andamento, pendência PT, prova, envio |
| 1.2 | `ClientePendingAction` — link externo com ícone |
| 1.3 | `ClienteProgressStepper` — aceita `steps`, `loading`, `compact` |
| 1.4 | `ClienteOsCardHeader` — identificação + meta |

**Critério de aceite:** Componentes renderizam com props mock **apenas em testes**; produção usa dados reais.

---

### Fase 2 — Card e seção

**Objetivo:** Compor o card horizontal sem integrar ao dashboard.

| # | Tarefa |
|---|--------|
| 2.1 | `ClienteWorkCard` — compõe header, stepper, pending, expand, timeline |
| 2.2 | `ClienteWorkSection` — título, contagem, lista de cards, empty state |
| 2.3 | `ClienteWorkBoard` — 4 seções, estado `expandedKeys` |

**Critério de aceite:** `ClienteWorkBoard` pode ser renderizado em teste de integração com dados fixture.

---

### Fase 3 — Integração no dashboard

**Objetivo:** Substituir visual mantendo comportamento.

| # | Tarefa |
|---|--------|
| 3.1 | Criar `ClienteDashboardToolbar` (extrair cabeçalho + chips resumo) |
| 3.2 | Refatorar `ClienteDashboardPage` — trocar `ClienteOsList` por `ClienteWorkBoard` |
| 3.3 | Ajustar `max-w-7xl`, espaçamentos, estados loading (skeleton cards) |
| 3.4 | Remover ou deprecar `ClienteOsList.tsx` |

**Critério de aceite:** Feature parity com checklist §13.

---

### Fase 4 — Polish, responsividade e acessibilidade

**Objetivo:** Refinamento final.

| # | Tarefa |
|---|--------|
| 4.1 | Responsividade tablet/mobile no stepper |
| 4.2 | `prefers-reduced-motion` |
| 4.3 | Harmonizar `ClienteContasPanel` visualmente |
| 4.4 | Revisão de contraste WCAG (badges âmbar/verde) |
| 4.5 | Scroll suave dos chips de resumo para seções |

---

### Fase 5 — Testes e documentação

| # | Tarefa |
|---|--------|
| 5.1 | Testes unitários: `clienteProgressUtils`, `deriveStepVisualState` |
| 5.2 | Teste de componente: `ClienteProgressStepper` estados |
| 5.3 | Atualizar `PAGINA_CLIENTE.md` com nova hierarquia |
| 5.4 | Validar em produção `/sagra/cliente` com base path |

---

## 13. Checklist de validação

### 13.1 Testes manuais — autenticação (não regressão)

- [ ] `/cliente` sem cookie → redirect `/cliente/login`
- [ ] Login válido → dashboard carrega
- [ ] Sair → cookie limpo, redirect login
- [ ] Sessão expirada → redirect login
- [ ] Cookie `sagra_cliente_session` inalterado (DevTools → Application)

### 13.2 Testes manuais — dashboard

- [ ] Loading inicial exibe skeleton ou mensagem
- [ ] Erro de API exibe banner vermelho
- [ ] Botão Atualizar refetch sem reload da página
- [ ] Refetch automático após ~60s (Network tab)
- [ ] Gabinete com 0 OSs → 4 mensagens vazias corretas
- [ ] Nome do gabinete/órgão e saudação corretos

### 13.3 Testes manuais — seções e pendências

- [ ] OS em `pendencias_pt` aparece só nessa seção
- [ ] OS em `pendencias_aprovacao` com versão no badge
- [ ] OS em `pendencias_envio_arquivo` com CTA "Enviar arquivos"
- [ ] OS em `em_andamento` sem botão de pendência
- [ ] CTA abre portal externo em nova aba
- [ ] OS sem `pendencia_url` (token expirado) → item visível, sem botão

### 13.4 Testes manuais — stepper e timeline

- [ ] Stepper exibe 7 etapas após carregar
- [ ] Etapas concluídas em verde
- [ ] Etapa atual destacada
- [ ] Pendência em etapa com destaque âmbar
- [ ] Expandir card → timeline vertical com detalhes
- [ ] Expandir após prefetch → sem segundo request (cache hit)
- [ ] Colapsar → timeline desmonta visualmente; re-expandir usa cache
- [ ] Múltiplos cards expandidos simultaneamente

### 13.5 Testes manuais — contas

- [ ] Lista de contas carrega
- [ ] Criar subconta com sucesso → mensagem verde
- [ ] E-mail duplicado → erro 409 exibido
- [ ] Validação client-side nome/e-mail vazios

### 13.6 Testes manuais — responsividade

- [ ] Desktop ≥1280px — cards horizontais legíveis
- [ ] Tablet 768px — stepper com scroll horizontal
- [ ] Mobile 375px — layout vertical, touch targets ≥44px
- [ ] Zoom 200% — conteúdo não truncado criticamente

### 13.7 Testes manuais — acessibilidade

- [ ] Navegação por Tab nos botões e links
- [ ] `aria-expanded` correto no acordeão
- [ ] `aria-label` nos botões só-ícone (mobile)
- [ ] Contraste de texto em badges
- [ ] `prefers-reduced-motion` desativa animações

### 13.8 Testes automatizados propostos

| Arquivo | O que testar |
|---------|--------------|
| `clienteProgressUtils.test.ts` | `deriveStepVisualState`, `estimateStepIndex`, `lastCompletedIndex` |
| `clienteStepLabels.test.ts` | Labels por índice |
| `ClienteProgressStepper.test.tsx` | Renderiza 7 steps, estados concluído/pendência/loading |
| `ClientePendingAction.test.tsx` | Não renderiza sem URL; link com `rel="noopener noreferrer"` |
| `useClienteOsTimeline.test.ts` | `enabled: false` não fetch (mock fetch) |

---

## 14. Riscos e mitigação

| # | Risco | Severidade | Probabilidade | Mitigação |
|---|-------|------------|---------------|-----------|
| R1 | Rajada de requests de timeline ao scroll rápido | Média | Média | `enabled` por viewport; React Query deduplica mesma key |
| R2 | Stepper skeleton prolongado em conexões lentas | Baixa | Alta | Fallback heurístico; não bloquear card |
| R3 | Regressão no refetch 60s | Alta | Baixa | Não tocar config do `useQuery` dashboard |
| R4 | Perda de funcionalidade do acordeão | Alta | Baixa | Testes manuais §13.4; manter `expandedKeys` |
| R5 | Stepper ilegível em mobile | Média | Média | Layout compacto Fase 4; barra de progresso |
| R6 | Cards largos quebram em `max-w-5xl` | Média | Alta | Migrar para `max-w-7xl` |
| R7 | Divergência visual timeline expandida vs stepper | Baixa | Média | Mesma fonte de dados (`useClienteOsTimeline`) |
| R8 | Gabinete com 50+ OSs — performance render | Média | Baixa | Virtualização **não** necessária na Fase 3; avaliar se >100 OSs |
| R9 | Token pendência ausente — UX confusa | Baixa | Média | Manter comportamento atual; badge "Ação pendente" sem link |
| R10 | Alteração acidental em auth/store | Crítica | Baixa | Code review focado; arquivos proibidos em §1.4 |

### Plano de rollback

1. Manter `ClienteOsList.tsx` no repositório até validação em produção.
2. Feature flag local: `const USE_WORK_BOARD = true` em `ClienteDashboardPage` — remover após estabilização.
3. Rollback = trocar import de `ClienteWorkBoard` para `ClienteOsList` (1 linha).

---

## 15. Decisões em aberto

Antes da Fase 3, confirmar com stakeholders:

| # | Decisão | Opções | Recomendação |
|---|---------|--------|--------------|
| D1 | Chips de resumo no toolbar | Sim / Não | **Sim** — melhora scan, zero custo de API |
| D2 | Um ou múltiplos cards expandidos | Manter múltiplos / Apenas um | **Manter múltiplos** (paridade) |
| D3 | Ordenação dentro das seções | Manter ordem API (ano desc, OS desc) / Custom | **Manter ordem API** |
| D4 | Feature flag temporário | Sim / Não | **Sim** — rollback rápido |
| D5 | Virtualização para gabinetes grandes | Fase 3 / Adiar | **Adiar** — medir após deploy |
| D6 | Imagem de referência | Não fornecida nesta auditoria | Validar mockup com usuário antes da Fase 2 |

---

## Apêndice A — Estrutura visual das seções (prioridade)

```
┌─────────────────────────────────────────────┐
│ 🔧 Pendências — Problemas técnicos    (n=3) │  ← borda accent âmbar
├─────────────────────────────────────────────┤
│ [Card] [Card] [Card]                        │
├─────────────────────────────────────────────┤
│ ✓ Pendências — Aprovação de prova   (n=1) │
├─────────────────────────────────────────────┤
│ [Card]                                      │
├─────────────────────────────────────────────┤
│ 📎 Pendências — Envio de arquivos     (n=0) │
├─────────────────────────────────────────────┤
│ (empty state)                               │
├─────────────────────────────────────────────┤
│ ▶ OSs em andamento                   (n=12) │  ← borda accent verde suave
├─────────────────────────────────────────────┤
│ [Card] [Card] ...                           │
├─────────────────────────────────────────────┤
│ 👥 Contas do gabinete                       │
└─────────────────────────────────────────────┘
```

---

## Apêndice B — O que explicitamente NÃO será feito

- Alterar `sagra_cliente_session`, `clienteStore`, `ClienteAuthGuard`
- Alterar endpoints ou payloads de `/api/cliente/*`
- Remover seções de pendência ou unificá-las em uma única lista
- Substituir timeline vertical expandida por modal
- Adicionar WebSocket / tempo real ao portal cliente
- Usar dados mockados em produção
- Adicionar dependências de UI (MUI, Chakra, Framer Motion, etc.)
- Modificar `PortalSystemHeader` ou rotas de login/ativação

---

*Plano gerado com base na auditoria de `PAGINA_CLIENTE.md`, `INVENTARIO_COMPLETO_SISTEMA.md`, `MANUAL_COMPLETO_SAGRA_WEB.md` e código-fonte atual em `apps/web/src/features/cliente/`. Nenhum arquivo de código foi alterado.*
