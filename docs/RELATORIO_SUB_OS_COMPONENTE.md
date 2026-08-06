# Relatório de Implementação — Sub OS por Componente

## 1. Resumo

### O que foi implementado

- **Modelagem MySQL-only** com três tabelas: `tab_os_componentes`, `tab_os_sub_os`, `tab_os_sub_os_andamento`.
- **Persistência de componentes livres** na Gerência (MySQL como fonte primária; localStorage como fallback legado).
- **Endpoints REST** para componentes, Sub OS, histórico de Sub OS e summary (`has_sub_os`).
- **Andamento por componente** no `OsHistoryPanel` com espelho automático na `tabAndamento` + gravação MDB.
- **Lista inicial** com indicador `886 +`, expansão lazy e seleção de Sub OS (`886 [Capa]`).
- **Proteção de `UltimoStatus`**: espelho gravado com `UltimoStatus=0`.
- **Congelamento** quando OS principal está Entregue/Cancelada/Cancelado.
- **WebSocket** `sub_os_history_added` + evento `history_added` existente.
- **Auditoria** em `tab_os_audit_log` para componente, Sub OS, andamento e espelho.

### O que foi preservado

- Fluxo normal de andamento da OS principal (`POST /api/os/{ano}/{id}/history`).
- Dual-write MDB via `sync_andamento_from_mysql_to_mdb` (somente no espelho).
- Estrutura do MDB inalterada — nenhuma Sub OS real no Access.
- Busca/paginação server-side (Sub OSs não entram na query de busca).
- Replicação de andamento (`history/replicate`) inalterada — não inclui Sub OS.
- Portal cliente, PCP e painéis sem alteração de contrato.
- Permissão `ctx_detalhes_os` reutilizada (sem nova permissão RBAC).

### O que ficou para fase futura

- Edição/exclusão de andamento de Sub OS (endpoints retornam HTTP 405).
- Exibição explícita de Sub OSs nos painéis/PCP (sem quebrar contadores).
- Typecheck monorepo (`TS6310` em project references — pré-existente).

---

## 2. Decisões técnicas

| Tópico | Decisão |
|--------|---------|
| **Modelagem** | Híbrida: Sub OS e histórico independente no MySQL; espelho na `tabAndamento` para MDB e histórico principal. |
| **Componentes livres** | `tab_os_componentes` com `id` estável, `nome`, `nome_normalizado`, `techspec_json` (lotes). Sync no `POST /os/save` a partir do `TechSpec`. |
| **Renomeação** | Atualiza `nome` mantendo `id`; histórico Sub OS permanece vinculado ao `componente_id`. |
| **Congelamento** | `is_os_frozen()` consulta `UltimoStatus=1` da OS principal; bloqueia criação/andamento; flag `congelada` em `tab_os_sub_os`. |
| **UltimoStatus** | Espelho inserido com **`UltimoStatus=0`** — não reseta o andamento atual da OS principal. Sub OS controla status próprio em `tab_os_sub_os_andamento.ultimo_status`. |
| **MDB** | Apenas espelho replicado via `sync_andamento_from_mysql_to_mdb`; tabelas novas **não** passam pelo `mdb_writer`. |

### Formato da observação espelhada

```
14h26
OS 886 [Capa]
<texto do usuário>
```

A hora é prefixada por `format_andamento_obs()`; o identificador do componente fica na primeira linha após a hora.

---

## 3. Arquivos alterados

| Arquivo | Alteração | Motivo |
|---------|-----------|--------|
| `deploy/sql/create_tab_os_sub_os.sql` | DDL manual das 3 tabelas | Migration documentada |
| `app/backend/os_sub_os_schema.py` | `ensure_os_sub_os_schema()` | Startup idempotente |
| `app/backend/services/os_componentes_service.py` | Lógica de negócio Sub OS | Core da feature |
| `app/backend/routers/os_sub_os_routes.py` | Endpoints REST | API Sub OS |
| `app/backend/routers/os_routes.py` | Sync componentes no save; sync congelamento | Integração Gerência/histórico |
| `app/backend/routers/api.py` | Router + startup schema | Registro da feature |
| `apps/web/src/api/os.ts` | Funções API Sub OS | Cliente HTTP |
| `apps/web/src/api/hooks/useSubOs.ts` | Hooks TanStack Query | Data layer front |
| `apps/web/src/api/query-keys.ts` | Chaves componentes/sub-os | Cache |
| `apps/web/src/features/os/types.ts` | Tipos Sub OS | TypeScript |
| `apps/web/src/features/gerencia/techSpec.ts` | `nome`, `componente_id` livres | Identidade estável |
| `apps/web/src/features/gerencia/components/TrabalhoComponentes.tsx` | UI componentes livres | Gerência |
| `apps/web/src/features/gerencia/components/GerenciaPage.tsx` | Load MySQL componentes | Cross-browser |
| `apps/web/src/features/os/components/OsHistoryPanel.tsx` | Andamento por componente | UX histórico |
| `apps/web/src/features/os/components/OsOrdersTable.tsx` | Expansão `+` Sub OS | Lista inicial |
| `apps/web/src/features/os/components/OsDetailsPanel.tsx` | Badge componente | Detalhes Sub OS |
| `apps/web/src/features/os/osTableRows.ts` | Helpers display/selection | Tabela |
| `apps/web/src/features/os/osRealtimeSync.ts` | WS Sub OS | Tempo real |

---

## 4. Banco de dados

### Tabelas criadas (MySQL-only)

**`tab_os_componentes`**
- `id`, `nro_protocolo`, `ano_protocolo`, `nome`, `nome_normalizado`, `tipo`, `ordem`, `ativo`, `techspec_json`, timestamps, `criado_por`, `atualizado_por`
- Índices: `(ano_protocolo, nro_protocolo, ativo)`, `(ano_protocolo, nro_protocolo, nome_normalizado)`

**`tab_os_sub_os`**
- `id`, `nro_protocolo`, `ano_protocolo`, `componente_id`, `display_name`, `ativo`, `congelada`, `criado_em`, `criado_por`
- UNIQUE `(ano_protocolo, nro_protocolo, componente_id)`

**`tab_os_sub_os_andamento`**
- `id`, `sub_os_id`, `situacao`, `setor`, `observacao`, `data`, `ultimo_status`, `ponto`, `cod_status_espelho`, timestamps
- Índices: `(sub_os_id, ultimo_status)`, `(cod_status_espelho)`

### Migrations

- Automática: `ensure_os_sub_os_schema()` no startup da API.
- Manual: `deploy/sql/create_tab_os_sub_os.sql`.

### Rollback

```sql
DROP TABLE IF EXISTS tab_os_sub_os_andamento;
DROP TABLE IF EXISTS tab_os_sub_os;
DROP TABLE IF EXISTS tab_os_componentes;
```

---

## 5. Fluxo de andamento por componente

1. Usuário marca **"Andamento por componente"** e seleciona componente (`886 [Capa]`).
2. `POST /sub-os` cria ou reutiliza Sub OS para `componente_id`.
3. `POST /sub-os/{id}/history` grava em `tab_os_sub_os_andamento` (`ultimo_status=1` na Sub OS).
4. Gera `CodStatus` espelho na `tabAndamento` com **`UltimoStatus=0`**.
5. `cod_status_espelho` vincula Sub OS ↔ espelho.
6. `_dispatch_mdb_sync` → `sync_andamento_from_mysql_to_mdb` (se `MYSQL_ONLY=false`).
7. WebSocket: `sub_os_history_added` + `history_added`.
8. Histórico principal exibe espelho automaticamente (já está na `tabAndamento`).

---

## 6. Gerência

- Componentes com **nome livre** + presets Capa/Miolo/Encarte.
- Renomeação via input inline (preserva `componente_id`).
- Remoção: sem histórico → DELETE; com histórico → `ativo=0`.
- Salvamento da OS chama `sync_componentes_from_techspec()` na mesma transação MySQL.
- MDB continua recebendo apenas campos legados derivados do TechSpec.

---

## 7. Tela inicial

- OS com Sub OS exibe **`886 +`** (summary prefetch).
- Clique em `+` expande lazy (`GET /sub-os`).
- Sub linha: `886 [Capa]` indentada; não conta na paginação.
- Clique na Sub OS: detalhes herdados + badge **Componente: Capa**; histórico próprio.

---

## 8. Histórico e MDB

| Aspecto | Comportamento |
|---------|---------------|
| Observação espelho | `HHhMM\nOS {nro} [{componente}]\n{obs}` |
| UltimoStatus espelho | **0** — status operacional da OS principal preservado |
| MDB | Upsert padrão por `CodStatus`; sem reset de UltimoStatus (pois espelho é 0) |
| GET history | Retorna **todos** os andamentos (sem filtro UltimoStatus) |

---

## 9. Impacto em módulos

| Módulo | Impacto | Alterado? | Observação |
|--------|---------|-----------|------------|
| OS principal / histórico | Espelhos no histórico | Sim | UltimoStatus protegido |
| Gerência | Componentes MySQL | Sim | localStorage fallback |
| Lista inicial | Expansão Sub OS | Sim | Lazy, sem paginação extra |
| MDB | Espelho andamento | Sim | Padrão existente |
| Portal cliente | Nenhum | Não | — |
| PCP / Painéis | Nenhum contrato | Não | Fase futura para exibir Sub OS |
| Relatórios / Busca | Nenhum | Não | Sub OS não é OS independente |
| Replicação vínculos | Nenhum | Não | — |
| WebSocket | Novo action | Sim | Retrocompatível |

---

## 10. Testes executados

| Comando | Resultado | Observação |
|---------|-----------|------------|
| `pnpm build` | ✅ Sucesso | Vite build OK |
| `pnpm lint` | ✅ Sucesso | Placeholder Fase 0 |
| `pnpm typecheck` | ⚠️ Falha | `TS6310` project references (pré-existente) |
| `python -m pytest app/backend/tests -q` | ✅ 45 passed | Suite backend |

---

## 11. Testes manuais recomendados

1. Andamento normal OS principal + verificar MDB.
2. Criar componente livre na Gerência → salvar → abrir outro navegador.
3. Renomear componente → histórico Sub OS mantido.
4. Andamento por componente → Sub OS + espelho + MDB + observação `OS N [Nome]`.
5. Segundo andamento mesmo componente → reutiliza Sub OS.
6. Outro componente → nova Sub OS.
7. Lista: `+`, expandir, selecionar Sub OS.
8. Histórico principal: normais + espelhos identificados.
9. MDB: espelho gravado; sem Sub OS real.
10. UltimoStatus principal inalterado após andamento de componente.
11. OS Entregue/Cancelada → bloqueio Sub OS.
12. `history/replicate` → não replica Sub OS.
13. Portal cliente → só OS principal.
14. PCP/painéis → funcionamento normal.

---

## 12. Riscos residuais

- **Homologação MDB**: validar com `MYSQL_ONLY=false` que espelho com `UltimoStatus=0` aparece no Access sem alterar status atual.
- **Edição/exclusão**: não implementada — espelho e Sub OS podem divergir se editar manualmente no MySQL.
- **Painéis/PCP**: Sub OSs ainda não exibidas como componente identificado (fase futura).
- **Prefetch summary**: uma requisição por OS na página atual ao carregar lista (leve; monitorar em produção).
