---
name: Seção Entrega Gerência
overview: Criar a seção Entrega à direita de Ordem de Produção na página Gerência, reunindo Prioridade, Data Entrega + Turno, Contato, Responsável na Gráfica e Forma de entrega, com persistência nos campos correspondentes de tabProtocolos.
todos:
  - id: layout-entrega
    content: Criar GerenciaEntregaSection, colocar à direita de Ordem, mover Prioridade/Data/Contato
    status: completed
  - id: form-mapping
    content: Novos campos no form + detailsToForm + formToSavePayload + SaveOsPayload
    status: completed
  - id: lookups
    content: Endpoints aux DISTINCT + hook useGerenciaAux para forma e responsável
    status: completed
  - id: backend-save
    content: Gravar os 3 campos no MySQL, MDB dual-write, auditoria e duplicação
    status: completed
  - id: tests
    content: Testes de mapeamento frontend e persistência backend
    status: completed
isProject: false
---

# Seção Entrega na Gerência

## Layout

Hoje a primeira fileira em [`GerenciaFormGrid.tsx`](apps/web/src/features/gerencia/components/GerenciaFormGrid.tsx) é só Solicitante + Ordem (`lg:grid-cols-[4fr_3fr]`). Passa a três colunas a partir de `lg`:

`Solicitante | Ordem de Produção | Entrega`

Em telas estreitas as seções empilham na mesma ordem. O painel técnico à direita (breakpoint `min-[1900px]`) permanece.

```mermaid
flowchart LR
  solicitante[Solicitante]
  ordem[Ordem de Producao]
  entrega[Entrega]
  solicitante --- ordem --- entrega
```

Campos da seção **Entrega**:

- Prioridade (select já existente `PRIORIDADE_GERENCIA`)
- Data Entrega e Turno **na mesma linha**
- Responsável na Gráfica (select)
- Forma de entrega (select)
- Contato (textarea, como hoje)

## Mover campos existentes

Em [`GerenciaFormSections.tsx`](apps/web/src/features/gerencia/components/GerenciaFormSections.tsx):

- Tirar **Prioridade** e **Data Entrega** de `GerenciaOrdemSection` (layout `page` e `modal`).
- Tirar **Contato** de `GerenciaTecnicosSection` (os dois layouts); **Obs** fica em Detalhes Técnicos.
- Nova `GerenciaEntregaSection` com os seis campos; registrar em `GERENCIA_SECTIONS` / `renderGerenciaSection` para a página e o modal de detalhes da OS.

## Persistência tabProtocolos

O GET `/os/{ano}/{id}/details` **já lê** `EntregPeriodo`, `EntregaFormaLink` e `ResponsavelGrafLink`, mas o formulário e o save ignoram esses campos. O UPDATE/INSERT de OS só grava hoje `EntregPrazoLink`, `EntregData` e `ContatoTrab`.

| UI | Form | tabProtocolos |
|---|---|---|
| Prioridade | `val_prioridade` | `EntregPrazoLink` (já existe) |
| Data Entrega | `val_data` | `EntregData` (já existe) |
| Contato | `txt_contato` | `ContatoTrab` (já existe) |
| Responsável na Gráfica | `val_resp_grafica` (novo) | `ResponsavelGrafLink` |
| Forma de entrega | `val_forma_entrega` (novo) | `EntregaFormaLink` |
| Turno | `val_turno` (novo) | `EntregPeriodo` |

Cadeia a atualizar:

- Frontend: [`types.ts`](apps/web/src/features/gerencia/types.ts), [`defaults.ts`](apps/web/src/features/gerencia/defaults.ts), [`utils.ts`](apps/web/src/features/gerencia/utils.ts) (`detailsToForm`), [`mappers.ts`](apps/web/src/features/gerencia/mappers.ts), [`SaveOsPayload`](apps/web/src/api/os.ts)
- Backend save: modelo + UPDATE/INSERT em [`os_routes.py`](app/backend/routers/os_routes.py)
- Dual-write Access: [`mdb_writer.py`](app/backend/routers/mdb_writer.py), [`mdb_helpers.py`](app/backend/mdb_helpers.py)
- Auditoria: `PROTOCOLO_FIELDS` / labels em [`os_audit_service.py`](app/backend/routers/os_audit_service.py)
- Duplicar OS: incluir as 3 colunas novas na cópia de protocolo em [`os_duplicate_service.py`](app/backend/services/os_duplicate_service.py)

## Lookups dos selects novos

`tabEntregaForma` e `tabRespGraf` existem no MDB legado, **não** no MySQL. Seguir o padrão de produto/máquina: `DISTINCT` em `tabProtocolos`.

- `GET /aux/formas-entrega` → `DISTINCT EntregaFormaLink`
- `GET /aux/responsaveis-grafica` → `DISTINCT ResponsavelGrafLink`
- Turno: constante `Manhã`, `Tarde`, `Noite` (único valor amostrado no legado é `Noite`), unindo o valor atual da OS se for diferente

Wiring no frontend: [`auxiliar_routes.py`](app/backend/routers/auxiliar_routes.py), [`auxLookups.ts`](apps/web/src/api/auxLookups.ts), [`useGerenciaAux.ts`](apps/web/src/api/hooks/useGerenciaAux.ts), [`query-keys.ts`](apps/web/src/api/query-keys.ts). Cada select inclui o valor gravado mesmo que não venha na lista.

## Testes

- Vitest: `detailsToForm` / `formToSavePayload` mapeiam os 3 campos novos.
- Pytest focado no save da OS (UPDATE inclui `ResponsavelGrafLink`, `EntregaFormaLink`, `EntregPeriodo`) se já houver teste de save; senão um caso mínimo no serviço/rota existente.

Não alterar o trabalho de scrollbar desta conversa.
