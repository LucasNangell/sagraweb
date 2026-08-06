# Relatório — Status Atual da Sub OS sem alterar UltimoStatus da OS Principal

## 1. Veredito

**Corrigido com ressalvas.**

- Status atual da Sub OS passa a vir exclusivamente de `tab_os_sub_os_andamento.ultimo_status=1` (com fallback seguro por data/id).
- Espelho em `tabAndamento` e MDB permanece com `UltimoStatus=0`.
- UI de novo andamento exige escolha explícita de destino quando a OS possui Sub OSs ativas.
- Painéis operacionais (Painel Global, Dashboard Setor) **não** exibem Sub OSs — documentado como fase futura.

## 2. Problema encontrado

| Área | Problema |
|------|----------|
| Lista expandida | `buildDisplayRows` fazia fallback `sub.situacao ?? row.situacao`, exibindo status da OS principal quando a Sub OS não tinha andamento ou cache desatualizado. |
| Cache da expansão | `OsOrdersTable` reutilizava `subOsCache` sem refetch ao reexpandir ou após WebSocket — status da Sub OS ficava obsoleto. |
| Serviço `list_sub_os` | JOIN simples em `ultimo_status=1` sem fallback; sem campos `situacao_atual`, `has_history`, `row_kind`. |
| Formulário de andamento | Checkbox “Andamento por componente” não impedia lançamento acidental na OS principal quando Sub OSs existiam. |
| Backend `POST /history` | Aceitava andamento da OS principal sem confirmação mesmo com Sub OSs ativas. |
| Painéis | Não renderizam linhas Sub OS (comportamento esperado nesta fase). |

A lógica transacional de `add_sub_os_history` **já estava correta** desde correções anteriores:
- zera `ultimo_status` anteriores da mesma Sub OS;
- insere novo com `ultimo_status=1`;
- espelho com `UltimoStatus=0`;
- MDB recebe espelho com `UltimoStatus=0`.

## 3. Solução aplicada

### Separação de conceitos

| Conceito | Fonte | Uso |
|----------|-------|-----|
| Status OS principal | `tabAndamento.UltimoStatus=1` | MDB, filtros, busca, relatórios, lógica legada |
| Status Sub OS | `tab_os_sub_os_andamento.ultimo_status=1` | Lista expandida, GET `/sub-os`, histórico de componente |

### Backend

- `get_sub_os_current_status(sub_os_id)` — busca por `ultimo_status=1`; fallback `ORDER BY data DESC, id DESC LIMIT 1`.
- `_map_sub_os_list_row()` + `list_sub_os()` refatorados para usar a função central.
- `SubOsRow` enriquecido com campos opcionais retrocompatíveis.
- `HistoryItem.confirm_main_os_target` + validação em `add_os_history` (HTTP 403 se OS tem Sub OSs e confirmação ausente).

### Front-end

- Lista: status da Sub OS sem fallback para OS principal; refetch ao expandir e quando a busca atualiza.
- `OsHistoryPanel`: bloco “Destino do andamento”, seletor obrigatório “Lançar andamento em:”, checkbox de confirmação para OS principal, roteamento para endpoint correto.

## 4. Fluxo de criação de andamento de Sub OS

1. **Transação MySQL** (`add_sub_os_history`):
   - Valida Sub OS pertence à OS; OS/Sub OS não congeladas.
   - `UPDATE tab_os_sub_os_andamento SET ultimo_status=0 WHERE sub_os_id=? AND ultimo_status=1`.
   - `INSERT` novo andamento com `ultimo_status=1`.
   - `INSERT` espelho em `tabAndamento` com **`UltimoStatus=0`**.
   - Atualiza `cod_status_espelho` no andamento da Sub OS.
   - Auditoria + log.
2. **MDB**: `sync_andamento_from_mysql_to_mdb(mirror_cod)` — espelho com `UltimoStatus=0`.
3. **WebSocket**: `sub_os_history_added` com `scope: sub_os`.
4. **Commit** (rollback em falha).

## 5. Endpoints alterados

| Endpoint | Campos adicionados | Compatibilidade |
|----------|-------------------|-----------------|
| `GET /api/os/{ano}/{id}/sub-os` | `situacao_atual`, `setor_atual`, `observacao_atual`, `data_atual`, `ultimo_status_id`, `has_history`, `row_kind` | Campos antigos `situacao`, `setor`, `data` mantidos |
| `POST /api/os/{ano}/{id}/history` | `confirm_main_os_target` (opcional, default `false`) | Endpoints antigos sem o campo passam a receber 403 se OS tem Sub OSs — **apenas fluxo UI principal envia confirmação**; scripts externos devem enviar `confirm_main_os_target=true` explicitamente |

## 6. Front-end

| Área | Alteração |
|------|-----------|
| Lista inicial | OS principal continua com status de `tabAndamento`; indicador `+` inalterado |
| Expansão | Refetch de Sub OSs; situação/setor/data próprios; `—` quando sem andamento |
| Seleção Sub OS | Pré-preenche destino `sub:{id}` no formulário |
| Formulário novo andamento | Bloco azul de destino; seletor obrigatório; aviso amarelo; checkbox confirmação OS principal |
| Painéis | Sem alteração (Sub OS não exibida) |

## 7. Proteções de UltimoStatus

- `add_sub_os_history` insere espelho com `UltimoStatus=0` (inalterado).
- `recalc_ultimo_status_operacional()` continua ignorando espelhos via `cod_status_espelho NOT IN`.
- `_fix_ultimo_status_mdb` e `delete_os_history` não alterados nesta entrega.
- Teste `TestSubOsMirrorUltimoStatusZero` valida SQL do espelho.
- Teste `TestRecalcUltimoStatusOperacional` existente mantido.

## 8. Proteções contra lançamento errado

| Camada | Proteção |
|--------|----------|
| UI | Seletor “Lançar andamento em:” obrigatório quando há Sub OSs; botão Salvar desabilitado até escolha válida |
| UI | Checkbox “Confirmo que este andamento é da OS principal” quando destino = OS principal |
| UI | Sub OS selecionada na lista → destino pré-preenchido |
| UI | OS sem Sub OSs → fluxo simples (destino implícito `main`) |
| Backend | `confirm_main_os_target=true` exigido em `POST /history` quando `count_sub_os > 0` |
| Backend | Andamento de Sub OS continua em `POST /sub-os/{id}/history` (destino explícito pela URL) |

**Endpoint antigo sem confirmação:** `POST /api/os/{ano}/{id}/history` usado por scripts/integrações externas retornará **403** se a OS tiver Sub OSs e o payload não incluir `confirm_main_os_target=true`.

## 9. Testes executados

| Comando | Resultado | Observação |
|---------|-----------|------------|
| `python -m pytest app/backend/tests -q` | 74 passed | Inclui 6 novos testes Sub OS |
| `pnpm build` | OK | Vite build concluído |
| `pnpm lint` | OK | Placeholder Fase 0 |
| `pnpm typecheck` | Falha TS6310 | Pré-existente: referenced projects `api-types`/`ui` com `noEmit` |

### Novos testes (backend)

- `TestGetSubOsCurrentStatus` — preferência `ultimo_status=1` e fallback
- `TestListSubOsWithCurrentStatus` — mapeamento de linha
- `TestAddOsHistoryMainTargetGuard` — 403 sem confirmação; passa guard com confirmação
- `TestSubOsMirrorUltimoStatusZero` — espelho com `UltimoStatus=0`

Testes de UI (Vitest) não existem no projeto — validação de payload/destino coberta por lógica TypeScript (`canSaveNew`) e backend.

## 10. Testes manuais recomendados

1. Lançar dois andamentos para a mesma Sub OS → apenas o último com `ultimo_status=1` na tabela própria.
2. Confirmar espelhos na `tabAndamento` com `UltimoStatus=0`.
3. Confirmar OS principal inalterada após andamento de componente.
4. Selecionar OS principal com Sub OSs → tentar salvar sem seletor/confirmação → bloqueado na UI e 403 no backend.
5. Selecionar OS principal → escolher “OS principal” + checkbox → salvar com sucesso.
6. Selecionar Sub OS na lista expandida → destino pré-preenchido → salvar via endpoint Sub OS.
7. Expandir OS na lista → verificar situação/setor/data da Sub OS após novo andamento (refetch).
8. Excluir andamento operacional da OS principal → espelho não promovido; status Sub OS intacto.

## 11. Pendências

- **Painéis operacionais:** exibir linhas virtuais Sub OS usando `situacao_atual` da tabela própria (fase futura).
- **Otimização:** `list_sub_os` faz N+1 via `get_sub_os_current_status` por linha — aceitável para poucos componentes; batch query se necessário.
- **Scripts externos:** documentar necessidade de `confirm_main_os_target=true` no POST de andamento principal.
- **Edição/exclusão** de andamento de Sub OS — ainda não disponível na UI.
- **typecheck TS6310** — corrigir configuração de project references em fase de tooling.
