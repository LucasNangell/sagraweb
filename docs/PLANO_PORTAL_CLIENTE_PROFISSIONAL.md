# Plano Técnico/UX — Portal do Cliente Profissional (`/cliente`)

> **Status:** Auditoria concluída — **nenhum código alterado nesta etapa**  
> **Data:** junho de 2026  
> **Escopo:** Evoluir `/cliente` para um portal executivo, integrando visualmente dashboard, Problemas Técnicos e Aprovação de Provas — **sem alterar backend, auth, APIs ou comportamento de produção nesta fase de planejamento**.

---

## Sumário

1. [Diagnóstico da tela atual](#1-diagnóstico-da-tela-atual)
2. [Problemas de UX encontrados](#2-problemas-de-ux-encontrados)
3. [Mapeamento técnico (dados, pendências, portais)](#3-mapeamento-técnico-dados-pendências-portais)
4. [Proposta de nova arquitetura](#4-proposta-de-nova-arquitetura)
5. [Componentes novos sugeridos](#5-componentes-novos-sugeridos)
6. [Componentes existentes a preservar](#6-componentes-existentes-a-preservar)
7. [Componentes existentes a refatorar](#7-componentes-existentes-a-refatorar)
8. [Estratégia para seções colapsáveis](#8-estratégia-para-seções-colapsáveis)
9. [Estratégia para topo com dados do gabinete](#9-estratégia-para-topo-com-dados-do-gabinete)
10. [Estratégia para integração de Problemas Técnicos](#10-estratégia-para-integração-de-problemas-técnicos)
11. [Estratégia para página de Provas/Aprovação](#11-estratégia-para-página-de-provasaprovação)
12. [Estratégia de responsividade](#12-estratégia-de-responsividade)
13. [Estratégia de acessibilidade](#13-estratégia-de-acessibilidade)
14. [Arquivos que provavelmente serão alterados](#14-arquivos-que-provavelmente-serão-alterados)
15. [Arquivos que NÃO devem ser alterados](#15-arquivos-que-não-devem-ser-alterados)
16. [Plano por fases](#16-plano-por-fases)
17. [Checklist de testes](#17-checklist-de-testes)
18. [Riscos e mitigação](#18-riscos-e-mitigação)

---

## 1. Diagnóstico da tela atual

### 1.1 Estrutura real (pós-modernização visual)

A documentação em `docs/PAGINA_CLIENTE.md` ainda descreve `ClienteOsList`, mas o código em produção no repositório já foi modernizado para o modelo **WorkBoard + WorkCard + Stepper** (implementação da fase anterior documentada em `docs/PLANO_MODERNIZACAO_PAGINA_CLIENTE.md` e `docs/HISTORICO_CHAT_PAGINA_CLIENTE.md`).

Hierarquia **atual**:

```
/cliente (routes/cliente/index.tsx)
└── ClienteAuthGuard → hydrate GET /cliente/me
    └── ClienteDashboardPage
        ├── PortalSystemHeader
        ├── Toolbar (gabinete, saudação, chips PT/prova/arquivo/andamento, Atualizar, Sair)
        ├── ClienteWorkBoard
        │   ├── ClienteWorkSection — "Pendências — Problemas técnicos"
        │   ├── ClienteWorkSection — "Pendências — Aprovação de prova"
        │   ├── ClienteWorkSection — "Pendências — Envio de arquivos"
        │   └── ClienteWorkSection — "OSs em andamento"
        │       └── ClienteWorkCard (×N por seção)
        │           ├── Identificação OS + badges
        │           ├── ClienteProgressStepper (sempre visível)
        │           ├── ClientePendingAction (link externo, se pendência)
        │           └── ClienteOsTimeline (expandido sob demanda)
        └── ClienteContasPanel
```

### 1.2 O que já funciona bem

| Aspecto | Estado |
|---------|--------|
| Auth isolada (`sagra_cliente_session`, `clienteStore`) | Sólido |
| Dashboard com 4 buckets de OS | Correto e confiável (backend) |
| Stepper horizontal + timeline detalhada | Implementado |
| Prefetch timeline no viewport (`useInViewport`) | Performance ok |
| Refetch 60s (`staleTime: 60_000`) | Preservado |
| Botões de pendência com `pendencia_url` | Funcionais |
| Skeleton, erro amigável, animações `fadeIn`/`shimmer` | Presentes |
| Portais públicos por token (PT, aprovação, arquivos) | Existem e operam fora do `/cliente` |

### 1.3 Gap em relação ao objetivo desta etapa

| Expectativa do produto | Estado atual |
|------------------------|--------------|
| Portal executivo com resumo institucional | Toolbar simples com número/nome do vínculo |
| Seções colapsáveis por padrão | Seções sempre abertas com todos os cards |
| Títulos sem prefixo "Pendências —" | Prefixo ainda presente em `ClienteWorkBoard` |
| Cards compactos no modo resumido | Stepper + badges sempre expostos no card |
| Integração fluida PT / Prova / Arquivos | Links externos (`target="_blank"`) apenas |
| Página profissional de aprovação **dentro** da jornada do portal | `PortalAprovacaoPage` existe, mas desconectada visualmente do `/cliente` |
| Linguagem para cliente leigo | Termos como "PT", "SEFOC", situações técnicas do andamento |

---

## 2. Problemas de UX encontrados

### 2.1 Hierarquia visual e carga cognitiva

1. **Quatro seções expandidas simultaneamente** — em gabinetes com muitas OSs, a página exige scroll longo antes de qualquer ação.
2. **Prefixo "Pendências —"** — redundante; o contador e o ícone já comunicam urgência.
3. **Cards densos no estado fechado** — o stepper de 7 etapas ocupa espaço mesmo quando o usuário só quer saber "o que preciso fazer agora".
4. **Chips "PT" no topo** — sigla interna; cliente leigo pode não associar a "corrigir arquivos".
5. **Dupla navegação** — chips no topo fazem scroll para seção, mas seções não colapsam; o benefício é limitado.

### 2.2 Cabeçalho / identidade do gabinete

1. Exibe principalmente `gabinete` (vínculo) e `user.nome` — **não** apresenta painel institucional com KPIs.
2. Não mostra e-mail principal do gabinete (apenas implícito no usuário logado).
3. Não há "última atualização" explícita (o refetch existe, mas não é comunicado).
4. Para contas `orgao`, o vínculo é `NomeUsuario`; para `gabinete`, é `GabSalaUsuario` — **não há campo separado "nome do parlamentar"** no payload atual.

### 2.3 Fluxos de pendência

1. **Problemas Técnicos** — botão abre `/portal/pt/{token}` em nova aba; quebra continuidade do portal autenticado.
2. **Aprovação de prova** — idem para `/portal/aprovacao/{token}`; a página de aprovação já é razoável, mas parece "outro sistema".
3. **Envio de arquivos** — idem para `/portal/os-arquivos/{token}`.
4. Quando `pendencia_url` é `null` (token ausente/expirado), o card aparece **sem CTA** — usuário não sabe o próximo passo.

### 2.4 Linguagem e confiança

1. Badges exibem `situacao` e `setor` crus do banco (ex.: "Encam. de Docum.", "SEFOC").
2. Labels de botão: "Ver pendência — Problemas Técnicos" — longas e técnicas.
3. Seção "OSs em andamento" mistura acompanhamento passivo com visual de pendência (borda verde, mas mesmo peso visual).

### 2.5 Documentação desatualizada

`docs/PAGINA_CLIENTE.md` referencia `ClienteOsList` e layout `max-w-5xl`; o código usa `ClienteWorkBoard` e `max-w-7xl`. O plano deve tratar o **código** como fonte de verdade.

---

## 3. Mapeamento técnico (dados, pendências, portais)

### 3.1 Payload atual — `GET /api/cliente/dashboard`

```typescript
// apps/web/src/api/cliente-portal.ts
interface ClienteDashboardResponse {
  gabinete: string;           // vínculo: GabSalaUsuario ou NomeUsuario
  tipo_conta: "gabinete" | "orgao";
  vinculo_label: string;      // "gabinete" ou "órgão" (humanizado)
  em_andamento: ClienteOsItem[];
  pendencias_pt: ClienteOsItem[];
  pendencias_aprovacao: ClienteOsItem[];
  pendencias_envio_arquivo: ClienteOsItem[];
}
```

Cada `ClienteOsItem`:

| Campo | Uso atual |
|-------|-----------|
| `nr_os`, `ano`, `titulo`, `produto` | Identificação no card |
| `situacao`, `setor`, `data_andamento` | Badges e "Atualizado em" |
| `observacao` | Não exibido no card (só backend/timeline) |
| `pendencia_tipo` | `problema_tecnico` \| `aprovacao_prova` \| `envio_arquivo` \| null |
| `pendencia_url` | Link absoluto para portal público |
| `pendencia_label` | Texto do botão CTA |
| `versao` | Prova (ex.: `v2`) |

### 3.2 Payload — `GET /api/cliente/me` (via `clienteStore`)

```typescript
interface ClienteUser {
  id: number;
  nome: string;              // usuário logado
  email: string;             // e-mail da conta logada
  gabinete: string;          // mesmo vínculo do dashboard
  tipo_conta: ClienteTipoConta;
  is_principal: boolean;
}
```

### 3.3 Dados do gabinete/parlamentar — o que existe hoje

| Informação desejada | Disponível hoje? | Fonte |
|-------------------|------------------|-------|
| Nome do vínculo (gabinete/órgão) | Sim | `dashboard.gabinete` / `user.gabinete` |
| Tipo de conta | Sim | `tipo_conta`, `vinculo_label` |
| Usuário logado | Sim | `user.nome` |
| E-mail do usuário logado | Sim | `user.email` |
| E-mail principal do gabinete | Parcial | `GET /cliente/contas` → conta com `is_principal` (query separada, já existe) |
| Nome do parlamentar | **Não** no dashboard/me | Existe em `tabProtocolos.NomeUsuario` por OS; agregado não exposto |
| Ponto do gabinete | **Não** | Não há no schema cliente |
| Contagens (OS, pendências, provas, andamento) | **Derivável** | Somar arrays do dashboard no frontend |
| Última atualização | **Derivável** | `max(data_andamento)` nos itens ou `dataUpdatedAt` do React Query |

**Conclusão para esta fase (sem backend):** o topo institucional pode ser montado com `me` + `dashboard` + contagem derivada + opcionalmente `contas` para e-mail principal. Nome de parlamentar dedicado exigiria ampliação futura de API ou inferência frágil a partir das OSs.

### 3.4 Classificação de pendências (backend)

`app/backend/routers/cliente_gabinete_routes.py` — `_classify_pendencia`:

| Situação + observação | `pendencia_tipo` | Array no dashboard |
|----------------------|------------------|------------------|
| `Problemas Técnicos` OU `Pendência Usuário` + "ptv" | `problema_tecnico` | `pendencias_pt` |
| `Aguard. Aprovação` | `aprovacao_prova` | `pendencias_aprovacao` |
| `Pendência Usuário` + "pendente o envio de arquivo" | `envio_arquivo` | `pendencias_envio_arquivo` |
| Demais | `null` | `em_andamento` |

URLs geradas:

| Tipo | Padrão | Token |
|------|--------|-------|
| PT | `{base}/portal/pt/{token}?os=&ano=` | `tabClientTokens` |
| Prova | `{base}/portal/aprovacao/{token}?os=&ano=` | `tabProofTokens` |
| Arquivos | `build_os_arquivos_url(...)` | `tabOsArquivosTokens` |

### 3.5 Como o portal PT é aberto hoje

1. `ClienteWorkCard` renderiza `ClientePendingAction` com `href={item.pendencia_url}`.
2. `ClientePendingAction` — `<a target="_blank" rel="noopener noreferrer">`.
3. Destino: `PortalPtPage` em `/portal/pt/$token` (público, sem cookie cliente).
4. Fluxo detalhado documentado em `docs/PAGINA_PORTAL_PT_PROBLEMAS_TECNICOS.md`.

### 3.6 Rotas/páginas de prova e aprovação existentes

| Rota | Componente | Função |
|------|------------|--------|
| `/portal/aprovacao/$token` | `PortalAprovacaoPage` | **Aprovação/rejeição de prova** (iframe PDF + formulário) |
| `/portal/prova/$token` | `PortalProvaPage` | Comprovante somente leitura de PT (não é aprovação) |
| `/portal/pt/$token` | `PortalPtPage` | Tratamento de problemas técnicos |
| `/portal/os-arquivos/$token` | `PortalOsArquivosPage` | Upload de arquivos de nova OS |

API de aprovação: `apps/web/src/api/proof-portal.ts` → `GET /client/proof/{ano}/{os}?token=`, `POST` respond.

**Não existe** hoje rota autenticada `/cliente/aprovacao` ou `/cliente/prova` — apenas portais por token.

### 3.7 Necessidade de ampliar `/dashboard` ou `/me`

| Cenário | Precisa backend? |
|---------|------------------|
| KPIs e contagens | **Não** — calcular no frontend |
| Última atualização global | **Não** — derivar ou usar timestamp da query |
| E-mail principal | **Não** — reutilizar `fetchClienteContas` |
| Nome parlamentar agregado | **Sim (futuro)** — não disponível de forma confiável sem novo campo |
| `stats` pré-calculados no JSON | Opcional (performance marginal; listas já vêm prontas) |

**Decisão do plano:** Fase 1–3 implementam topo institucional **sem alterar endpoints**. Fase 4 (opcional, pós-aprovação) pode propor extensão read-only de `/cliente/dashboard` com bloco `summary` se o produto exigir nome parlamentar.

---

## 4. Proposta de nova arquitetura

### 4.1 Visão de produto

Transformar `/cliente` em um **hub autenticado** com três camadas:

```
┌─────────────────────────────────────────────────────────────┐
│  ClientePortalLayout (shell autenticado, max-w-7xl)         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ClientePortalHeader + ClienteGabineteSummary          │  │
│  │ ClientePortalStats (KPIs)                             │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ClienteCollapsibleWorkBoard                           │  │
│  │  ├─ Problemas Técnicos      [colapsado ▼]             │  │
│  │  ├─ Aguardando Aprovação    [colapsado ▼]             │  │
│  │  ├─ Aguardando Arquivos     [colapsado ▼]             │  │
│  │  └─ Em andamento            [colapsado ▼]             │  │
│  │       └─ ClienteCompactOsCard → expand → detalhes     │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ClienteContasPanel (colapsável, secundário)           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

Rotas filhas autenticadas (novas, opcionais):
  /cliente/acoes/pt/$ano/$nrOs      → ClienteTechnicalProblemsBridge
  /cliente/acoes/aprovacao/$ano/$nrOs → ClienteProofApprovalBridge
  /cliente/acoes/arquivos/$ano/$nrOs  → ClienteFilesBridge
```

### 4.2 Princípios arquiteturais

1. **Dashboard permanece a home** (`/cliente`).
2. **Zero mudança de contrato API** nas fases iniciais.
3. **Portais por token permanecem públicos** — bridges autenticadas apenas reutilizam o token já presente em `pendencia_url` (parse no frontend + cache React Query).
4. **Separação visual clara:** pendências = âmbar/ação; andamento = verde/informativo.
5. **Progressive disclosure:** seção colapsada → card compacto → expansão com stepper + timeline + CTAs.

### 4.3 Fluxo de navegação ideal

```mermaid
flowchart TD
  Login[/cliente/login] --> Dash[/cliente]
  Dash --> SecPT[Seção Problemas Técnicos]
  Dash --> SecApr[Seção Aguardando Aprovação]
  Dash --> SecArq[Seção Aguardando Arquivos]
  Dash --> SecAnd[Seção Em andamento]

  SecPT -->|CTA principal| BridgePT[/cliente/acoes/pt/ano/os]
  SecApr -->|CTA principal| BridgeApr[/cliente/acoes/aprovacao/ano/os]
  SecArq -->|CTA principal| BridgeArq[/cliente/acoes/arquivos/ano/os]

  BridgePT --> PortalPT[PortalPtPage - mesmo token]
  BridgeApr --> PortalApr[PortalAprovacaoPage - mesmo token]
  BridgeArq --> PortalArq[PortalOsArquivosPage - mesmo token]

  BridgePT -->|fallback| ExtPT[nova aba /portal/pt/token]
  SecAnd -->|expandir card| Detail[Stepper + Timeline - sem CTA agressivo]
```

**Fallback em nova aba:** manter `ClientePendingAction` ou link secundário "Abrir em nova janela" para compatibilidade com bookmarks/e-mail.

---

## 5. Componentes novos sugeridos

| Componente | Responsabilidade |
|------------|------------------|
| `ClientePortalLayout` | Shell com `PortalSystemHeader`, container, breadcrumb/voltar em rotas filhas |
| `ClientePortalHeader` | Título "Portal do Cliente", ações Atualizar/Sair, slot para stats |
| `ClienteGabineteSummary` | Cartão institucional: vínculo, tipo, usuário, e-mail principal |
| `ClientePortalStats` | Grid de KPIs: total OSs, pendências, provas, em produção, atualizado em |
| `ClienteCollapsibleWorkBoard` | Orquestra 4 seções colapsáveis; substitui `ClienteWorkBoard` |
| `ClienteCollapsibleSection` | Cabeçalho accordion: ícone, título, contador, resumo, prioridade, chevron |
| `ClienteCompactOsCard` | Modo resumido: OS, título, 1 linha de status amigável, CTA único |
| `ClienteOsDetailPanel` | Painel expandido: stepper, timeline, metadados, links secundários |
| `ClienteActionHub` | Barra de ação contextual por tipo de pendência (verbos em linguagem simples) |
| `ClienteTechnicalProblemsBridge` | Rota autenticada que monta `PortalPtPage` + header "Voltar ao portal" |
| `ClienteProofApprovalBridge` | Idem para `PortalAprovacaoPage` |
| `ClienteFilesBridge` | Idem para `PortalOsArquivosPage` |
| `ClientePortalEmptyState` | Empty states unificados por seção |
| `ClientePortalSkeleton` | Skeleton do topo + seções colapsadas |
| `useClienteDashboardStats` | Hook: deriva KPIs e `lastUpdated` do payload |
| `useClientePendenciaBridge` | Hook: resolve token/URL a partir do cache `["cliente","dashboard"]` |
| `clienteFriendlyLabels` | Util: situações/setores → texto leigo |

---

## 6. Componentes existentes a preservar

| Arquivo | Motivo |
|---------|--------|
| `clienteStore.ts` | Regra crítica — auth intacta |
| `ClienteAuthGuard.tsx` | Fluxo hydrate/login |
| `apps/web/src/api/cliente-portal.ts` | Contratos API |
| `ClientePendingAction.tsx` | CTA externo (fallback) |
| `ClienteProgressStepper.tsx` | Stepper maduro |
| `ClienteOsTimeline.tsx` | Timeline detalhada |
| `ClienteStatusBadge.tsx` | Badges e `pendenciaBadgeLabel` |
| `portal-item-utils.ts` | Lógica PT pública |
| `PortalPtPage.tsx` | Portal PT por token — não quebrar |
| `PortalAprovacaoPage.tsx` | Base da aprovação de prova |
| `PortalOsArquivosPage.tsx` | Fluxo envio arquivos |
| `PortalSystemHeader.tsx` | Identidade DEAPA (consumo) |
| `hooks/useClienteOsTimeline.ts`, `useInViewport.ts` | Performance |
| `utils/clienteProgressMapper.ts`, `types/clienteProgress.ts` | Mapeamento etapas |

---

## 7. Componentes existentes a refatorar

| Arquivo | Refatoração proposta |
|---------|---------------------|
| `ClienteDashboardPage.tsx` | Adotar `ClientePortalLayout`, stats, remover chips PT técnicos |
| `ClienteWorkBoard.tsx` | Evoluir → `ClienteCollapsibleWorkBoard` ou delegar |
| `ClienteWorkSection.tsx` | Evoluir → `ClienteCollapsibleSection` com estado open/closed |
| `ClienteWorkCard.tsx` | Dividir em `ClienteCompactOsCard` + `ClienteOsDetailPanel` |
| `ClienteContasPanel.tsx` | Tornar colapsável; mover para área "Configurações" |
| `ClienteDashboardSkeleton.tsx` | Alinhar ao novo layout de topo + accordions |
| `PortalAprovacaoPage.tsx` | Polish visual + props `embedded` / `onBack` (sem mudar API pública token) |
| `PortalPtPage.tsx` | Opcional: modo `embedded` com botão voltar (props only) |

**Componente legado:** `ClienteOsList.tsx` — não usado no dashboard atual; candidato a remoção em fase de limpeza (após confirmar zero imports).

---

## 8. Estratégia para seções colapsáveis

### 8.1 Comportamento

| Regra | Detalhe |
|-------|---------|
| Estado inicial | **Todas colapsadas** |
| Exceção | Auto-expandir **uma** seção se houver pendência, por prioridade: PT → Aprovação → Arquivos |
| Em andamento | Sempre inicia colapsada (informativa) |
| Cabeçalho fechado | Título + contador + resumo (1 linha) + ícone + badge prioridade + chevron |
| Cabeçalho aberto | Lista de `ClienteCompactOsCard` |
| Persistência | Opcional: `sessionStorage` com chaves `cliente.section.{kind}.open` |

### 8.2 Títulos e resumos (linguagem leiga)

| Antigo | Novo título | Resumo fechado (exemplo) |
|--------|-------------|--------------------------|
| Pendências — Problemas técnicos | **Problemas Técnicos** | "3 publicações precisam de correção nos arquivos" |
| Pendências — Aprovação de prova | **Aguardando Aprovação** | "2 provas aguardam sua conferência" |
| Pendências — Envio de arquivos | **Aguardando Arquivos** | "1 publicação aguarda envio de arquivos" |
| OSs em andamento | **Em andamento** | "12 publicações em produção na gráfica" |

### 8.3 Indicador de prioridade

| Seção | Visual |
|-------|--------|
| Problemas Técnicos | Âmbar forte + ícone `AlertTriangle` |
| Aguardando Aprovação | Âmbar médio + `FileCheck` |
| Aguardando Arquivos | Âmbar claro + `Upload` |
| Em andamento | Verde suave + `ClipboardList` (sem urgência) |

### 8.4 Implementação técnica sugerida

- Usar padrão `<button aria-expanded>` + região `role="region"` (sem dependência obrigatória de Radix).
- Animação: `grid-rows-[0fr]` / `[1fr]` (mesmo padrão já usado no card).
- `motion-reduce`: desabilitar animações (já há precedente em `index.css`).

---

## 9. Estratégia para topo com dados do gabinete

### 9.1 Layout proposto (desktop)

```
┌──────────────────────────────────────────────────────────────────┐
│ [Logo DEAPA já no PortalSystemHeader]                            │
├──────────────────────────────────────────────────────────────────┤
│ Portal do Cliente                          [Atualizar] [Sair]    │
│ ┌─────────────────────────────┐  ┌─────┐ ┌─────┐ ┌─────┐ ┌────┐ │
│ │ Gabinete 214 — Dep. Fulano  │  │ 18  │ │  5  │ │  2  │ │ 12 │ │
│ │ Conta: Maria (principal)    │  │ OSs │ │Pend.│ │Prov.│ │Prod│ │
│ │ maria@gabinete...           │  └─────┘ └─────┘ └─────┘ └────┘ │
│ │ Atualizado há 2 min         │                                  │
│ └─────────────────────────────┘                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 9.2 Mapeamento de campos (sem backend)

| UI | Fonte |
|----|-------|
| Nome do vínculo | `dashboard.gabinete` |
| Tipo | `dashboard.vinculo_label` |
| Usuário logado | `user.nome` + badge Principal/Subconta |
| E-mail exibido | `user.email`; se `!is_principal`, buscar principal em `contas` |
| Total OSs | soma dos 4 arrays (cada OS em um único bucket) |
| Pendências | pt + aprovacao + arquivos |
| Provas aguardando | `pendencias_aprovacao.length` |
| Em produção | `em_andamento.length` |
| Última atualização | `formatRelative(max(data_andamento))` ou hora do `dataUpdatedAt` |

### 9.3 Limitação explícita — parlamentar

O nome do parlamentar **não** está em `/me` nem `/dashboard`. O campo `gabinete` é o identificador de vínculo (`GabSalaUsuario`), não necessariamente o nome parlamentar. Exibir como **"Gabinete {vinculo}"** ou **"Órgão {vinculo}"** até extensão futura da API.

---

## 10. Estratégia para integração de Problemas Técnicos

### 10.1 Objetivo

Levar o cliente à experiência PT **sem quebrar** o fluxo por token nem exigir mudança de backend.

### 10.2 Abordagem recomendada — Bridge autenticada

1. Nova rota: `/cliente/acoes/pt/$ano/$nrOs` (protegida por `ClienteAuthGuard`).
2. Hook `useClientePendenciaBridge('problema_tecnico', ano, nrOs)`:
   - Lê `["cliente", "dashboard"]` do React Query.
   - Localiza item em `pendencias_pt`.
   - Faz parse de `pendencia_url` → `token`, valida `os`/`ano`.
3. Renderiza `PortalPtPage` dentro de `ClientePortalLayout` com:
   - Barra superior: "← Voltar ao painel", contexto OS.
   - Mesmo token e mesmas APIs públicas (`fetchClientAnalysis`, upload, etc.).

### 10.3 Fallbacks

| Caso | Comportamento |
|------|---------------|
| `pendencia_url` null | Mensagem amigável + "Atualize o painel" + contato gráfica |
| Token expirado (403 API) | Instrução clara; link e-mail se aplicável |
| Usuário abriu rota direta sem cache | Refetch dashboard; se não achar, redirect `/cliente` |

### 10.4 CTA no card compacto

- Primário: **"Corrigir arquivos"** → navega bridge interna.
- Secundário (ícone link externo): abre `pendencia_url` em nova aba (preserva comportamento atual).

### 10.5 Portal PT público

`/portal/pt/$token` **permanece inalterado** para links de e-mail e acesso sem login. A bridge é camada UX adicional, não substituto.

---

## 11. Estratégia para página de Provas/Aprovação

### 11.1 Estado atual

`PortalAprovacaoPage` (`/portal/aprovacao/$token`) já oferece:

- Header institucional
- iframe PDF da prova (`proofPdfUrl`)
- Formulário nome + observação
- Botões Aprovar / Rejeitar
- Tela de conclusão

É funcional e superior a uma implementação do zero.

### 11.2 Proposta — `ClienteProofApprovalBridge`

1. Rota autenticada: `/cliente/acoes/aprovacao/$ano/$nrOs`.
2. Reutiliza token de `pendencias_aprovacao[].pendencia_url`.
3. Embute `PortalAprovacaoPage` com:
   - `embedded={true}` — oculta duplicata de header ou usa variante compacta.
   - `onBack={() => navigate('/cliente')}`.
4. Polish em `PortalAprovacaoPage`:
   - Tipografia e espaçamento alinhados ao novo dashboard.
   - Mensagens em linguagem simples ("Confira o PDF antes de aprovar").
   - Melhor estado mobile do iframe (altura dinâmica, botão "Tela cheia").

### 11.3 `ClienteProofApprovalPage` vs bridge

Não duplicar lógica de aprovação. O componente `ClienteProofApprovalPage` pode ser **alias/wrapper** fino sobre `PortalAprovacaoPage` + layout cliente.

### 11.4 Envio de arquivos

Mesmo padrão bridge → `PortalOsArquivosPage` em `/cliente/acoes/arquivos/$ano/$nrOs`.

CTA sugerido: **"Enviar arquivos"**.

### 11.5 `PortalProvaPage` (`/portal/prova`)

É comprovante de **problemas técnicos** (leitura), não aprovação de prova. **Não** confundir com a seção "Aguardando Aprovação". Manter fora do fluxo principal de aprovação.

---

## 12. Estratégia de responsividade

### 12.1 Desktop (≥1024px)

- Topo: grid 2 colunas (summary | stats).
- Seções: accordion full width.
- Card compacto: linha única — OS + título truncado + status + CTA.
- Expandido: stepper horizontal (como hoje) + timeline abaixo.

### 12.2 Tablet (768–1023px)

- Stats em 2×2.
- Stepper compact mode no detalhe (`compact` prop já existe).

### 12.3 Mobile (<768px)

- Summary empilhado; stats em carrossel horizontal ou 2 colunas.
- Seções: touch target ≥44px (`min-h-11` — já usado).
- Card compacto: sem stepper até expandir.
- Bridge PT/Aprovação: header fixo com voltar; iframe/pdf 60–70vh.
- Evitar `ClienteOsDetailDrawer` lateral — preferir expansão inline (menos complexidade, melhor a11y mobile).

### 12.4 Tokens de design

Reutilizar tokens em `apps/web/src/index.css`:

- `--primary-green`, `--secondary-blue`, `--bg-color`, `--border-color`
- Fonte Inter
- Classes utilitárias `rounded-2xl`, `border-sagra-border`, `shadow-sm`

Não há `tailwind.config.*` no app; tema via `@theme` no CSS (Tailwind v4).

---

## 13. Estratégia de acessibilidade

| Requisito | Implementação |
|-----------|---------------|
| Accordions | `aria-expanded`, `aria-controls`, foco no header ao abrir |
| CTAs | Verbos claros; não depender só de cor |
| Stepper | `aria-label` por etapa; estado atual em texto |
| Timeline | Lista ordenada `<ol>` (já usado) |
| Animações | `prefers-reduced-motion` (estender para accordions) |
| Contraste | Manter badges âmbar com texto escuro |
| Links externos | `rel="noopener noreferrer"` + indicar nova janela quando aplicável |
| iframe prova | `title` descritivo (já presente) |

---

## 14. Arquivos que provavelmente serão alterados

### Novos (previstos)

```
apps/web/src/features/cliente/layout/ClientePortalLayout.tsx
apps/web/src/features/cliente/components/ClientePortalHeader.tsx
apps/web/src/features/cliente/components/ClienteGabineteSummary.tsx
apps/web/src/features/cliente/components/ClientePortalStats.tsx
apps/web/src/features/cliente/components/ClienteCollapsibleWorkBoard.tsx
apps/web/src/features/cliente/components/ClienteCollapsibleSection.tsx
apps/web/src/features/cliente/components/ClienteCompactOsCard.tsx
apps/web/src/features/cliente/components/ClienteOsDetailPanel.tsx
apps/web/src/features/cliente/components/ClienteActionHub.tsx
apps/web/src/features/cliente/components/ClientePortalEmptyState.tsx
apps/web/src/features/cliente/bridges/ClienteTechnicalProblemsBridge.tsx
apps/web/src/features/cliente/bridges/ClienteProofApprovalBridge.tsx
apps/web/src/features/cliente/bridges/ClienteFilesBridge.tsx
apps/web/src/features/cliente/hooks/useClienteDashboardStats.ts
apps/web/src/features/cliente/hooks/useClientePendenciaBridge.ts
apps/web/src/features/cliente/utils/clienteFriendlyLabels.ts
apps/web/src/routes/cliente/acoes/pt.$ano.$nrOs.tsx
apps/web/src/routes/cliente/acoes/aprovacao.$ano.$nrOs.tsx
apps/web/src/routes/cliente/acoes/arquivos.$ano.$nrOs.tsx
```

### Alterados

```
apps/web/src/features/cliente/components/ClienteDashboardPage.tsx
apps/web/src/features/cliente/components/ClienteWorkBoard.tsx (ou deprecar)
apps/web/src/features/cliente/components/ClienteWorkSection.tsx
apps/web/src/features/cliente/components/ClienteWorkCard.tsx
apps/web/src/features/cliente/components/ClienteContasPanel.tsx
apps/web/src/features/cliente/components/ClienteDashboardSkeleton.tsx
apps/web/src/features/portal/PortalAprovacaoPage.tsx (props embedded/polish)
apps/web/src/features/portal/PortalPtPage.tsx (opcional: onBack)
apps/web/src/index.css (utilitários mínimos se necessário)
```

### Documentação (pós-implementação)

```
docs/PAGINA_CLIENTE.md (atualizar hierarquia)
```

---

## 15. Arquivos que NÃO devem ser alterados

| Arquivo / área | Motivo |
|----------------|--------|
| `clienteStore.ts` | Regra crítica do prompt |
| `ClienteAuthGuard.tsx` | Auth intacta |
| `apps/web/src/api/cliente-portal.ts` | Sem mudança de contrato |
| `apps/web/src/lib/api.ts` | Prefixo API |
| `app/backend/**` | Sem alteração de backend nesta iniciativa |
| Cookie `sagra_cliente_session` | Infra auth |
| Query key `["cliente", "dashboard"]` + staleTime 60s | Anti-regressão |
| `apps/web/src/api/proof-portal.ts` | APIs públicas prova |
| `apps/web/src/api/client-portal.ts` | APIs públicas PT |
| `portal-item-utils.ts` | Lógica estável PT |
| Rotas públicas `/portal/pt`, `/portal/aprovacao`, `/portal/os-arquivos` | Links históricos em e-mails |

---

## 16. Plano por fases

### Fase 1 — Fundação do portal (layout + topo + stats)

**Objetivo:** Cara de portal executivo sem mudar listas.

- Criar `ClientePortalLayout`, `ClientePortalHeader`, `ClienteGabineteSummary`, `ClientePortalStats`.
- Hook `useClienteDashboardStats`.
- Refatorar `ClienteDashboardPage` para usar o layout.
- Atualizar skeleton.
- **Entregável:** topo institucional + KPIs; seções ainda no formato atual.

### Fase 2 — Seções colapsáveis + linguagem

**Objetivo:** Reduzir ruído visual.

- `ClienteCollapsibleWorkBoard` + `ClienteCollapsibleSection`.
- Renomear títulos (remover "Pendências —").
- `clienteFriendlyLabels` para resumos e status.
- Auto-expand regra de prioridade.
- `ClientePortalEmptyState` unificado.
- **Entregável:** dashboard escaneável, seções fechadas por padrão.

### Fase 3 — Cards compactos + detalhe sob demanda

**Objetivo:** Progressive disclosure por OS.

- `ClienteCompactOsCard` + `ClienteOsDetailPanel`.
- Stepper/timeline só no expand.
- `ClienteActionHub` com CTAs em linguagem simples.
- `ClienteContasPanel` colapsável no rodapé.
- **Entregável:** cards leves; detalhe rico ao expandir.

### Fase 4 — Bridges de ação (PT, Aprovação, Arquivos)

**Objetivo:** Integrar fluxos sem quebrar token.

- Rotas `/cliente/acoes/*` + hooks bridge.
- Parse seguro de `pendencia_url`.
- `PortalAprovacaoPage` / `PortalPtPage` com modo embedded.
- Fallback nova aba preservado.
- **Entregável:** jornada unificada dentro do portal autenticado.

### Fase 5 — Polish, a11y e documentação

- Auditoria mobile real.
- `prefers-reduced-motion` nos accordions.
- Atualizar `docs/PAGINA_CLIENTE.md`.
- Remover `ClienteOsList.tsx` se órfão.
- Testes manuais completos (checklist §17).

### Fase 6 (opcional, futuro) — Backend read-only

Somente se o produto exigir nome parlamentar dedicado:

- Estender `GET /cliente/dashboard` com `summary: { parlamentar?, email_principal, stats, last_sync }`.
- **Fora do escopo imediato** conforme regras do prompt.

---

## 17. Checklist de testes

### Autenticação e sessão

- [ ] Login/logout funcionam; hydrate em refresh.
- [ ] Rotas `/cliente/acoes/*` redirecionam se não autenticado.
- [ ] Subconta vê mesmas OSs do vínculo.

### Dashboard e dados

- [ ] Refetch 60s e botão Atualizar mantidos.
- [ ] KPIs batem com contagem manual das seções.
- [ ] Última atualização muda após refetch.
- [ ] Erro de rede exibe mensagem amigável + retry.

### Seções colapsáveis

- [ ] Todas iniciam fechadas (exceto regra de pendência crítica).
- [ ] Chevron e `aria-expanded` corretos.
- [ ] Títulos novos sem "Pendências —".

### Cards e detalhes

- [ ] Modo compacto não mostra stepper.
- [ ] Expandir carrega timeline (lazy).
- [ ] Stepper estimado antes da timeline; real após fetch.
- [ ] Seção "Em andamento" sem CTA agressivo.

### Problemas Técnicos

- [ ] CTA navega para bridge ou abre PT em nova aba (fallback).
- [ ] Portal PT funciona com token da pendência.
- [ ] Upload e desconsiderar item funcionam na bridge.
- [ ] Link público `/portal/pt/{token}` de e-mail antigo continua válido.

### Aprovação de prova

- [ ] CTA navega para bridge de aprovação.
- [ ] PDF exibe no iframe; aprovar/rejeitar registra resposta.
- [ ] Token já respondido exibe erro claro.
- [ ] Link público `/portal/aprovacao/{token}` de e-mail continua válido.

### Envio de arquivos

- [ ] CTA abre bridge ou portal os-arquivos.
- [ ] Upload completo exibe tela de sucesso.

### Responsivo e a11y

- [ ] Mobile: alvos de toque ≥44px.
- [ ] Teclado: accordions e CTAs focáveis.
- [ ] `prefers-reduced-motion`: sem animações obrigatórias.

### Regressão

- [ ] `ClienteContasPanel`: criar subconta.
- [ ] Portais externos não autenticados inalterados.
- [ ] Produção: base path `/sagra` nas rotas.

---

## 18. Riscos e mitigação

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Parse de `pendencia_url` frágil se formato mudar | Bridge quebra | Função util centralizada + testes unitários + fallback nova aba |
| Cache dashboard stale ao abrir bridge | Token ausente | Refetch on mount na rota bridge; loading state |
| Duplicar headers (PortalSystemHeader × 2) | UX ruim em embedded | Prop `embedded` oculta header duplicado |
| Accordions aumentam cliques | Fricção | Auto-expand seção com pendência; resumo actionable no header |
| Nome parlamentar ausente | Expectativa frustrada | Copy honesto "Gabinete X"; documentar fase 6 API |
| `pendencia_url` null | OS sem ação | Empty CTA com instrução + refresh |
| Regressão stepper/timeline | Perda confiança | Preservar hooks e queries; apenas mudar quando renderizar |
| Links e-mail antigos | Clientes bloqueados | **Não** alterar rotas `/portal/*` públicas |
| Scope creep em PortalPtPage | Atraso | Modo embedded mínimo (só barra voltar) na fase 4 |
| Documentação desatualizada | Retrabalho | Atualizar docs na fase 5 |

---

## Referências analisadas

| Documento / arquivo | Uso na auditoria |
|---------------------|------------------|
| `docs/PAGINA_CLIENTE.md` | Baseline funcional (parcialmente desatualizado) |
| `docs/HISTORICO_CHAT_PAGINA_CLIENTE.md` | Contexto da modernização WorkBoard |
| `docs/PAGINA_PORTAL_PT_PROBLEMAS_TECNICOS.md` | Fluxo PT e integração pendência |
| `docs/PLANO_MODERNIZACAO_PAGINA_CLIENTE.md` | Decisões prévias de stepper/cards |
| `ClienteDashboardPage.tsx` … `ClienteWorkCard.tsx` | Estado real do frontend |
| `cliente_gabinete_routes.py` | Payload dashboard e classificação |
| `PortalAprovacaoPage.tsx`, `PortalPtPage.tsx` | Portais públicos existentes |

---

## Decisão executiva

A evolução para **Portal do Cliente profissional** é **viável sem alterar backend** nas fases 1–5, reutilizando:

1. Payload atual do dashboard para KPIs e seções.
2. `pendencia_url` para bridges autenticadas aos portais por token.
3. `PortalAprovacaoPage` como núcleo da experiência de aprovação.

O maior ganho de UX virá de **seções colapsáveis**, **cards compactos**, **topo institucional** e **navegação bridge** — não de nova API.

**Próximo passo recomendado:** implementar Fase 1 após aprovação deste plano.
