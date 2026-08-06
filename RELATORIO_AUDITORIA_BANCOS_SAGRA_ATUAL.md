# Relatório de Auditoria dos Bancos SAGRA

_Gerado em: 2026-06-12 19:47 — modo somente leitura, sem alterações no ambiente._

## Índice

1. [Resumo executivo](#1-resumo-executivo)
2. [Bancos encontrados](#2-bancos-encontrados)
3. [Estrutura MySQL/MariaDB](#3-estrutura-mysqlmariadb)
4. [Estrutura MDB/Access](#4-estrutura-mdbaccess)
5. [Scripts de sincronização e integração](#5-scripts-de-sincronizacao-e-integracao)
6. [Dicionário de dados](#6-dicionario-de-dados)
7. [Relacionamentos reais e inferidos](#7-relacionamentos-reais-e-inferidos)
8. [Entidades de negócio](#8-entidades-de-negocio)
9. [Fluxos críticos do sistema](#9-fluxos-criticos-do-sistema)
10. [Fonte da verdade atual por domínio](#10-fonte-da-verdade-atual-por-dominio)
11. [Índices e performance](#11-indices-e-performance)
12. [Problemas estruturais encontrados](#12-problemas-estruturais-encontrados)
13. [Dependências no código](#13-dependências-no-codigo)
14. [Considerações para futura modelagem ideal](#14-consideracões-para-futura-modelagem-ideal)
15. [Considerações para exportador MySQL → MDB](#15-consideracões-para-exportador-mysql--mdb)
16. [Lacunas e dúvidas que precisam de validação humana](#16-lacunas-e-duvidas-que-precisam-de-validacao-humana)
17. [Anexos técnicos](#17-anexos-tecnicos)

---

## 1. Resumo executivo

O SAGRA Web opera sobre o banco **MariaDB/MySQL `sagrafulldb`** (versão **9.7.0**) com **158 tabelas** e aproximadamente **553,766 registros** totais contabilizados.

O legado Access permanece ativo via quatro arquivos MDB principais (**OS Atual**, **Papelaria Atual**, **OS AntigaCore**, **Papelaria Antiga**) mais um ACCDB SAT. A regra de roteamento universal é **`NroProtocolo < 5000 → OS Atual`** e **`≥ 5000 → Papelaria Atual**.

**Achados críticos:**
- No MySQL **auditado**, as tabelas core existem apenas em **lowercase** (`tabandamento` 199.180 reg., `tabprotocolos` 84.083, `tabdetalhesservico` 85.660). **Não há** cópia física `tabAndamento`/`tabProtocolos`/`tabDetalhesServico` neste servidor — porém o **código** ainda resolve ambos os casings (`andamento_table.py`) por compatibilidade histórica.
- Apenas **11 tabelas** possuem foreign keys declaradas no MySQL — relacionamentos são majoritariamente **implícitos** (por `NroProtocolo`, `CodStatus`, tokens).
- O sync `sync_andamentos_v2.py` (raiz) é **unidirecional MDB→MySQL**; a cópia em `app/services/` ainda é **bidirecional** e é a invocada pelo launcher `_iniciar-sync-andamentos.cmd`.
- `sync_andamentos_enabled=false` e `mysql_only=false` no ambiente auditado — dual-write MDB habilitado na API, sync de andamentos desligado por flag.
- Tabelas Web-only (papelaria jobs, tokens, permissões, materialized views) convivem no mesmo schema legado.

**Escopo desta auditoria:** análise e documentação exclusivamente leitura. Nenhuma migration, alteração ou sync foi executada.

---

## 2. Bancos encontrados

### 2.1 MySQL/MariaDB

| Parâmetro | Valor |
|---|---|
| Host | 10.1.1.73 |
| Porta | 3306 |
| Database | sagrafulldb |
| Usuário app | usr_sagraweb |
| Versão | 9.7.0 |
| Tabelas | 158 |

### 2.2 MDB/ACCDB

| Banco | Caminho | Acessível | Tamanho | Modificação | Tabelas |
|---|---|---|---|---|---|
| OS Atual | `\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb` | Sim | 70.41 MB | 2026-06-12T18:58:44.955206 | 46 |
| Papelaria Atual | `\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb` | Sim | 89.22 MB | 2026-06-12T18:15:57.529292 | 45 |
| OS AntigaCore | `\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS AntigaCore.mdb` | Sim | 150.91 MB | 2026-06-12T19:40:13.593690 | 57 |
| Papelaria Antiga | `\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Antiga.mdb` | Sim | 90.2 MB | 2026-03-26T12:47:30.688350 | 46 |
| SAT ACCDB | `\\redecamara\dfsdata\cgraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\BaseDeDados - SAT\Base de dados SAT.accdb` | Sim | 12.04 MB | 2026-06-08T10:51:37.460488 | 11 |

---

## 3. Estrutura MySQL/MariaDB

### 3.1 Inventário por categoria


#### Auxiliar / importação / suspeita (3 tabelas)

| Tabela | Registros | Colunas | FKs | Índices | Origem inferida |
|---|---:|---:|---:|---:|---|
| `_plan1` | 0 | 9 | 0 | 0 | MySQL / inferido |
| `_tabchecageminicial` | 0 | 9 | 0 | 0 | MySQL / inferido |
| `_tabopenform` | 0 | 3 | 0 | 0 | MySQL / inferido |

#### Legado / espelho MDB (14 tabelas)

| Tabela | Registros | Colunas | FKs | Índices | Origem inferida |
|---|---:|---:|---:|---:|---|
| `tabanaliseitens` | 4,017 | 16 | 1 | 1 | Legado / MDB importado |
| `tabanalises` | 760 | 9 | 0 | 1 | Legado / MDB importado |
| `tabandamento` | 199,180 | 9 | 0 | 5 | MDB + MySQL (duplicata de casing) |
| `tabclienttokens` | 22 | 7 | 1 | 2 | Legado / MDB importado |
| `tabdadosdeputados` | 512 | 10 | 0 | 0 | Legado / MDB importado |
| `tabdetalhesservico` | 85,660 | 39 | 0 | 6 | MDB + MySQL (duplicata de casing) |
| `tabmidiadigital` | 0 | 5 | 0 | 0 | Legado / MDB importado |
| `tabnotificacoes` | 178 | 8 | 0 | 1 | Legado / MDB importado |
| `tabosvinculadas` | 2 | 7 | 0 | 2 | Legado / MDB importado |
| `tabosvinculoexcecoes` | 2 | 5 | 0 | 1 | Legado / MDB importado |
| `tabosvinculogrupos` | 2 | 6 | 0 | 0 | Legado / MDB importado |
| `tabproblemaspadrao` | 84 | 4 | 0 | 0 | Legado / MDB importado |
| `tabprotocolos` | 84,083 | 44 | 0 | 7 | MDB + MySQL (duplicata de casing) |
| `tabusuarios` | 13 | 13 | 0 | 1 | Legado / MDB importado |

#### Legado / operacional (provável origem MDB) (59 tabelas)

| Tabela | Registros | Colunas | FKs | Índices | Origem inferida |
|---|---:|---:|---:|---:|---|
| `taband1atiposdepend` | 0 | 2 | 0 | 0 | Legado / MDB importado |
| `taband1tipopend` | 0 | 4 | 0 | 0 | Legado / MDB importado |
| `taband2contatos` | 0 | 7 | 0 | 0 | Legado / MDB importado |
| `taband3aitensdesccompleta` | 0 | 2 | 0 | 0 | Legado / MDB importado |
| `taband3descricaocompleta` | 0 | 3 | 0 | 0 | Legado / MDB importado |
| `tabcalculosos` | 0 | 15 | 0 | 1 | Legado / MDB importado |
| `tabcategorias` | 3 | 1 | 0 | 0 | Legado / MDB importado |
| `tabclientegabinete` | 4 | 15 | 1 | 3 | Legado / MDB importado |
| `tabcores` | 8 | 2 | 0 | 0 | Legado / MDB importado |
| `tabdeputados-old 2013` | 0 | 17 | 0 | 0 | Legado / MDB importado |
| `tabdeputados-old 2014` | 0 | 17 | 0 | 0 | Legado / MDB importado |
| `tabdetalhesservicomdb` | 0 | 51 | 0 | 4 | Legado / MDB importado |
| `tabemailexchangeconfig` | 1 | 12 | 0 | 0 | Legado / MDB importado |
| `tabemailtemplateconfig` | 1 | 3 | 0 | 0 | Legado / MDB importado |
| `tabemailtemplatemodel` | 6 | 15 | 0 | 2 | Legado / MDB importado |
| `tabentregaforma` | 0 | 2 | 0 | 0 | Legado / MDB importado |
| `tabentregaprazo` | 0 | 2 | 0 | 0 | Legado / MDB importado |
| `tabexportarprotocoloanoanterior` | 0 | 41 | 0 | 0 | Legado / MDB importado |
| `tabformatoimpressao` | 0 | 3 | 0 | 0 | Legado / MDB importado |
| `tabformatonormalize` | 0 | 5 | 0 | 2 | Legado / MDB importado |
| `tabformatos` | 78 | 4 | 0 | 0 | Legado / MDB importado |
| `tabindicadores` | 0 | 11 | 0 | 0 | Legado / MDB importado |
| `tabippermitidos` | 0 | 4 | 0 | 1 | Legado / MDB importado |
| `tablegs` | 0 | 3 | 0 | 0 | Legado / MDB importado |
| `tablocalmidia` | 0 | 3 | 0 | 0 | Legado / MDB importado |
| `tablogchecklist` | 0 | 7 | 0 | 0 | Legado / MDB importado |
| `tablogcodrs` | 0 | 4 | 0 | 0 | Legado / MDB importado |
| `tablogfichaos` | 0 | 7 | 0 | 0 | Legado / MDB importado |
| `tabmaquinas` | 0 | 2 | 0 | 0 | Legado / MDB importado |
| `tabmaterialentregue` | 0 | 5 | 0 | 0 | Legado / MDB importado |
| `tabmesa` | 0 | 10 | 0 | 0 | Legado / MDB importado |
| `tabmigracaosatregistropt` | 3,961 | 11 | 0 | 2 | Legado / MDB importado |
| `tabmotivoafastamento` | 0 | 2 | 0 | 0 | Legado / MDB importado |
| `taborgaos` | 0 | 11 | 0 | 0 | Legado / MDB importado |
| `tabosarquivostokens` | 0 | 7 | 0 | 2 | Legado / MDB importado |
| `tabpapel` | 37 | 10 | 0 | 0 | Legado / MDB importado |
| `tabpapelariajoblog` | 258 | 6 | 0 | 1 | Legado / MDB importado |
| `tabpapelariajobs` | 61 | 23 | 0 | 3 | Legado / MDB importado |
| `tabpapelariamodelos` | 21 | 16 | 0 | 0 | Legado / MDB importado |
| `tabpapelariasvgmodelos` | 9 | 9 | 0 | 0 | Legado / MDB importado |
| `tabpapelariaworkerheartbeat` | 6 | 3 | 0 | 1 | Legado / MDB importado |
| `tabpermissoes` | 0 | 8 | 0 | 0 | Legado / MDB importado |
| `tabprooftokens` | 10 | 16 | 0 | 2 | Legado / MDB importado |
| `tabprotocolosbloqueados` | 0 | 2 | 0 | 0 | Legado / MDB importado |
| `tabprotocolosmdb` | 0 | 51 | 0 | 4 | Legado / MDB importado |
| `tabrespgraf` | 0 | 2 | 0 | 0 | Legado / MDB importado |
| `tabselecionados` | 0 | 3 | 0 | 0 | Legado / MDB importado |
| `tabsetor` | 0 | 3 | 0 | 0 | Legado / MDB importado |
| `tabsetorpaineldefaults` | 5 | 3 | 0 | 0 | Legado / MDB importado |
| `tabsituacao` | 0 | 4 | 0 | 0 | Legado / MDB importado |
| `tabsituacao-old` | 0 | 3 | 0 | 0 | Legado / MDB importado |
| `tabsolicitacoesacesso` | 0 | 6 | 0 | 0 | Legado / MDB importado |
| `tabsupportmessages` | 19 | 19 | 0 | 3 | Legado / MDB importado |
| `tabsupportthreadmessages` | 40 | 7 | 0 | 2 | Legado / MDB importado |
| `tabtipomidiadigital` | 0 | 2 | 0 | 0 | Legado / MDB importado |
| `tabtipopubmodelos` | 0 | 3 | 0 | 0 | Legado / MDB importado |
| `tabuserfiltersettings` | 0 | 6 | 0 | 1 | Legado / MDB importado |
| `tabuserpreferences` | 6 | 4 | 0 | 1 | Legado / MDB importado |
| `tabusersavedfilters` | 13 | 7 | 0 | 1 | Legado / MDB importado |

#### Operacional / inferido (57 tabelas)

| Tabela | Registros | Colunas | FKs | Índices | Origem inferida |
|---|---:|---:|---:|---:|---|
| `acabamento` | 0 | 4 | 0 | 1 | MySQL / inferido |
| `acabamentos_catalogo` | 0 | 8 | 0 | 1 | MySQL / inferido |
| `andamentos_backup` | 0 | 14 | 0 | 3 | MySQL / inferido |
| `andamentos_mdb_cache` | 0 | 5 | 0 | 2 | MySQL / inferido |
| `apagar-creditos` | 0 | 3 | 0 | 0 | MySQL / inferido |
| `apagar-debitos` | 0 | 3 | 0 | 0 | MySQL / inferido |
| `apagar-tabtipocota` | 0 | 1 | 0 | 0 | MySQL / inferido |
| `apagar-tabtipocota1` | 0 | 1 | 0 | 0 | MySQL / inferido |
| `componente_variacao` | 0 | 6 | 1 | 1 | MySQL / inferido |
| `cor` | 0 | 3 | 0 | 1 | MySQL / inferido |
| `delete_candidates` | 0 | 7 | 0 | 0 | MySQL / inferido |
| `deputadoscache` | 93 | 10 | 0 | 0 | MySQL / inferido |
| `ds_model_training_history` | 0 | 14 | 0 | 0 | MySQL / inferido |
| `ds_production_features` | 0 | 22 | 0 | 3 | MySQL / inferido |
| `erros ao colar` | 0 | 3 | 0 | 0 | MySQL / inferido |
| `normalizacao_state` | 0 | 3 | 0 | 0 | MySQL / inferido |
| `normalizacao_state_v2` | 0 | 4 | 0 | 0 | MySQL / inferido |
| `os_acabamentos` | 0 | 13 | 2 | 2 | MySQL / inferido |
| `os_componente_lotes` | 0 | 14 | 1 | 1 | MySQL / inferido |
| `os_componentes` | 0 | 15 | 0 | 1 | MySQL / inferido |
| `papel` | 0 | 5 | 0 | 1 | MySQL / inferido |
| `produto` | 0 | 9 | 0 | 0 | MySQL / inferido |
| `produto_componente` | 0 | 5 | 1 | 1 | MySQL / inferido |
| `sagra_sync_change_log` | 0 | 9 | 0 | 1 | MySQL / inferido |
| `sagra_sync_meta` | 0 | 2 | 0 | 0 | MySQL / inferido |
| `sagra_sync_row_state` | 0 | 9 | 0 | 2 | MySQL / inferido |
| `sagra_sync_state` | 0 | 4 | 0 | 0 | MySQL / inferido |
| `shadow_tabandamento_mdb` | 0 | 6 | 0 | 0 | MySQL / inferido |
| `shadow_tabdetalhesservico_mdb` | 0 | 7 | 0 | 0 | MySQL / inferido |
| `shadow_tabprotocolos_mdb` | 0 | 7 | 0 | 0 | MySQL / inferido |
| `stg_normalizacao` | 0 | 13 | 0 | 0 | MySQL / inferido |
| `stg_revisao_manual` | 0 | 7 | 0 | 0 | MySQL / inferido |
| `suspected_deletes` | 0 | 8 | 0 | 1 | MySQL / inferido |
| `sync_baseline_detalhes` | 0 | 5 | 0 | 0 | MySQL / inferido |
| `sync_baseline_protocolos` | 0 | 5 | 0 | 0 | MySQL / inferido |
| `sync_changes_log` | 0 | 6 | 0 | 1 | MySQL / inferido |
| `sync_circuit_breaker` | 0 | 5 | 0 | 0 | MySQL / inferido |
| `sync_control` | 0 | 3 | 0 | 0 | MySQL / inferido |
| `sync_hash_detalhes` | 0 | 5 | 0 | 0 | MySQL / inferido |
| `sync_hash_protocolos` | 0 | 5 | 0 | 0 | MySQL / inferido |
| `sync_meta_detalhes` | 0 | 10 | 0 | 0 | MySQL / inferido |
| `sync_meta_protocolos` | 0 | 8 | 0 | 0 | MySQL / inferido |
| `sync_missing_candidates` | 0 | 8 | 0 | 1 | MySQL / inferido |
| `sync_outbox` | 0 | 14 | 0 | 2 | MySQL / inferido |
| `sync_outbox_dedupe` | 0 | 2 | 0 | 1 | MySQL / inferido |
| `sync_state` | 0 | 5 | 0 | 0 | MySQL / inferido |
| `sync_status` | 0 | 4 | 0 | 0 | MySQL / inferido |
| `sync_v2_baseline_detalhes` | 0 | 5 | 0 | 0 | MySQL / inferido |
| `sync_v2_baseline_protocolos` | 0 | 5 | 0 | 0 | MySQL / inferido |
| `sync_v2_meta_detalhes` | 0 | 4 | 0 | 0 | MySQL / inferido |
| `sync_v2_meta_protocolos` | 0 | 4 | 0 | 0 | MySQL / inferido |
| `sync_v2_state` | 0 | 3 | 0 | 0 | MySQL / inferido |
| `variacao_acabamento` | 0 | 2 | 2 | 1 | MySQL / inferido |
| `variacao_cor` | 0 | 2 | 2 | 1 | MySQL / inferido |
| `variacao_papel` | 0 | 2 | 2 | 1 | MySQL / inferido |
| `xpose_paths` | 0 | 8 | 0 | 1 | MySQL / inferido |
| `xpose_tickets` | 0 | 12 | 0 | 1 | MySQL / inferido |

#### Sync / monitor / cache / log (10 tabelas)

| Tabela | Registros | Colunas | FKs | Índices | Origem inferida |
|---|---:|---:|---:|---:|---|
| `backup_andamentos` | 114 | 7 | 0 | 1 | Sync (Web) |
| `cache_andamentos_mdb` | 2,232 | 6 | 0 | 0 | Sync (Web) |
| `deleted_andamentos` | 93 | 7 | 0 | 2 | Sync (Web) |
| `log_sincronizacao` | 0 | 12 | 0 | 3 | MySQL / inferido |
| `log_sync_andamentos` | 83,901 | 11 | 0 | 2 | Sync (Web) |
| `monitor_cache_detalhes` | 360 | 5 | 0 | 0 | Sync (Web) |
| `monitor_detalhes_os` | 0 | 41 | 0 | 0 | Sync (Web) |
| `monitor_detalhes_sp` | 0 | 41 | 0 | 0 | Sync (Web) |
| `monitor_protocol_os` | 0 | 43 | 0 | 0 | Sync (Web) |
| `monitor_protocol_sp` | 0 | 43 | 0 | 0 | Sync (Web) |

#### Web / extensão SAGRA Web (15 tabelas)

| Tabela | Registros | Colunas | FKs | Índices | Origem inferida |
|---|---:|---:|---:|---:|---|
| `ct_gravacao_eventos` | 0 | 8 | 1 | 1 | Web |
| `ip_permissions` | 15 | 31 | 0 | 1 | Web |
| `tab_os_audit_log` | 1,102 | 14 | 0 | 2 | Web |
| `tab_os_componentes` | 12 | 13 | 0 | 2 | Web |
| `tab_os_filter_produtos` | 61 | 6 | 0 | 3 | Web |
| `tab_os_filter_solicitantes` | 1,977 | 6 | 0 | 3 | Web |
| `tab_os_sub_os` | 6 | 9 | 0 | 3 | Web |
| `tab_os_sub_os_andamento` | 0 | 14 | 0 | 4 | Web |
| `tab_os_ultimo_andamento_operacional` | 84,075 | 10 | 0 | 5 | Web |
| `tab_pcp_fila` | 291 | 6 | 0 | 2 | Web |
| `tab_pre_analise_snapshot` | 11 | 9 | 0 | 2 | Web |
| `tab_pre_analise_timing` | 162 | 8 | 0 | 2 | Web |
| `tab_pre_analise_timing_file` | 184 | 8 | 0 | 2 | Web |
| `user_permissions` | 8 | 27 | 0 | 0 | Web |
| `user_registered_ips` | 7 | 5 | 0 | 3 | Web |

### 3.2 Top 25 tabelas por volume

| # | Tabela | Registros | Finalidade aparente |
|---:|---|---:|---|
| 1 | `tabandamento` | 199,180 | Legado / espelho MDB |
| 2 | `tabdetalhesservico` | 85,660 | Legado / espelho MDB |
| 3 | `tabprotocolos` | 84,083 | Legado / espelho MDB |
| 4 | `tab_os_ultimo_andamento_operacional` | 84,075 | Web / extensão SAGRA Web |
| 5 | `log_sync_andamentos` | 83,901 | Sync / monitor / cache / log |
| 6 | `tabanaliseitens` | 4,017 | Legado / espelho MDB |
| 7 | `tabmigracaosatregistropt` | 3,961 | Legado / operacional (provável origem MDB) |
| 8 | `cache_andamentos_mdb` | 2,232 | Sync / monitor / cache / log |
| 9 | `tab_os_filter_solicitantes` | 1,977 | Web / extensão SAGRA Web |
| 10 | `tab_os_audit_log` | 1,102 | Web / extensão SAGRA Web |
| 11 | `tabanalises` | 760 | Legado / espelho MDB |
| 12 | `tabdadosdeputados` | 512 | Legado / espelho MDB |
| 13 | `monitor_cache_detalhes` | 360 | Sync / monitor / cache / log |
| 14 | `tab_pcp_fila` | 291 | Web / extensão SAGRA Web |
| 15 | `tabpapelariajoblog` | 258 | Legado / operacional (provável origem MDB) |
| 16 | `tab_pre_analise_timing_file` | 184 | Web / extensão SAGRA Web |
| 17 | `tabnotificacoes` | 178 | Legado / espelho MDB |
| 18 | `tab_pre_analise_timing` | 162 | Web / extensão SAGRA Web |
| 19 | `backup_andamentos` | 114 | Sync / monitor / cache / log |
| 20 | `deleted_andamentos` | 93 | Sync / monitor / cache / log |
| 21 | `deputadoscache` | 93 | Operacional / inferido |
| 22 | `tabproblemaspadrao` | 84 | Legado / espelho MDB |
| 23 | `tabformatos` | 78 | Legado / operacional (provável origem MDB) |
| 24 | `tab_os_filter_produtos` | 61 | Web / extensão SAGRA Web |
| 25 | `tabpapelariajobs` | 61 | Legado / operacional (provável origem MDB) |

### 3.3 Duplicatas de casing (legado)

| Variante PascalCase (código) | Variante lowercase (MySQL live) | Registros |
|---|---|---:|
| `tabAndamento` | `tabandamento` | 199.180 |
| `tabProtocolos` | `tabprotocolos` | 84.083 |
| `tabDetalhesServico` | `tabdetalhesservico` | 85.660 |

**Observação:** No servidor auditado (`10.1.1.73`), **somente as variantes lowercase existem fisicamente**. O backend (`andamento_table.py`, queries dinâmicas) ainda trata PascalCase para servidores case-sensitive ou migrações antigas. Risco: código ou sync referenciando PascalCase em ambiente onde só existe lowercase (ou vice-versa) pode falhar silenciosamente ou criar tabela vazia.

### 3.4 Detalhamento das tabelas principais


#### `backup_andamentos`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Registros:** 114  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | auto_increment | — |
| `timestamp_backup` | datetime | YES | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |
| `origem` | varchar(50) | YES | — | — | — | — |
| `codstatus` | varchar(50) | YES | — | MUL | — | — |
| `nro` | int | YES | — | — | — | — |
| `ano` | int | YES | — | — | — | — |
| `dados_json` | text | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_codstatus` | Sim | BTREE | codstatus |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "2878"
- `timestamp_backup`: "2026-05-19 21:02:16"
- `origem`: "MySQL"
- `codstatus`: "008642026-07"
- `nro`: "864"
- `ano`: "2026"
- `dados_json`: "{\"CodStatus\": \"008642026-07\", \"NroProtocoloLink\": 864, \"AnoProtocoloLink\": 2026, \"SituacaoLink\": \"Problemas Técnicos\"..."
**Registro 2:**
- `id`: "2879"
- `timestamp_backup`: "2026-05-19 21:02:22"
- `origem`: "MySQL"
- `codstatus`: "008642026-06"
- `nro`: "864"
- `ano`: "2026"
- `dados_json`: "{\"CodStatus\": \"008642026-06\", \"NroProtocoloLink\": 864, \"AnoProtocoloLink\": 2026, \"SituacaoLink\": \"Recebido\", \"SetorLi..."
**Registro 3:**
- `id`: "2880"
- `timestamp_backup`: "2026-05-20 12:52:36"
- `origem`: "MySQL"
- `codstatus`: "058272026-07"
- `nro`: "5827"
- `ano`: "2026"
- `dados_json`: "{\"CodStatus\": \"058272026-07\", \"NroProtocoloLink\": 5827, \"AnoProtocoloLink\": 2026, \"SituacaoLink\": \"Encam. de Docum.\",..."

**Referências no código (amostra):**

- `app\services\sync_andamentos_v2.py`
- `deploy\release\app\services\sync_andamentos_v2.py`
- `sync_andamentos_v2.py`


#### `cache_andamentos_mdb`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Registros:** 2,232  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `codstatus` | varchar(50) | NO | — | PRI | — | — |
| `nro` | int | YES | — | — | — | — |
| `ano` | int | YES | — | — | — | — |
| `origem` | varchar(50) | YES | — | — | — | — |
| `ultima_atualizacao` | datetime | YES | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |
| `content_hash` | varchar(64) | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | codstatus |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `codstatus`: "000052026-09"
- `nro`: "5"
- `ano`: "2026"
- `origem`: "OS_Atual"
- `ultima_atualizacao`: "2026-06-12 19:46:51"
- `content_hash`: NULL
**Registro 2:**
- `codstatus`: "000372026-04"
- `nro`: "37"
- `ano`: "2026"
- `origem`: "OS_Atual"
- `ultima_atualizacao`: "2026-06-12 19:46:51"
- `content_hash`: NULL
**Registro 3:**
- `codstatus`: "000372026-05"
- `nro`: "37"
- `ano`: "2026"
- `origem`: "OS_Atual"
- `ultima_atualizacao`: "2026-06-12 19:46:51"
- `content_hash`: NULL

**Referências no código (amostra):**

- `app\services\sync_andamentos_v2.py`
- `deploy\release\app\services\sync_andamentos_v2.py`
- `sync_andamentos_v2.py`


#### `ct_gravacao_eventos`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 0  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id_evento` | int | NO | — | PRI | auto_increment | — |
| `id_job` | int | YES | — | MUL | — | — |
| `nome_chapa` | varchar(255) | YES | — | — | — | — |
| `tipo_evento` | varchar(50) | YES | — | — | — | — |
| `status_evento` | varchar(50) | YES | — | — | — | — |
| `descricao_evento` | text | YES | — | — | — | — |
| `data_evento` | datetime(6) | YES | — | — | — | — |
| `sequencia` | int | YES | 0 | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id_evento |
| `unique_evento` | Não | BTREE | id_job, nome_chapa, data_evento, status_evento |

**Foreign keys:**

| Constraint | Coluna | Ref. Tabela | Ref. Coluna | ON UPDATE | ON DELETE |
|---|---|---|---|---|---|
| `ct_gravacao_eventos_ibfk_1` | `id_job` | `ct_gravacao_jobs` | `id_job` | NO ACTION | CASCADE |

**Amostra (dados sensíveis mascarados):**

_Sem amostra disponível._

**Referências no código (amostra):**

- `app\backend\routers\gravacao_routes.py`
- `deploy\release\app\backend\routers\gravacao_routes.py`


#### `deleted_andamentos`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Registros:** 93  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `codstatus` | varchar(50) | NO | — | PRI | — | — |
| `nro` | int | YES | — | MUL | — | — |
| `ano` | int | YES | — | — | — | — |
| `origem` | varchar(50) | YES | — | — | — | OS_Atual ou Papelaria - origem da exclusão |
| `deleted_at` | datetime | YES | CURRENT_TIMESTAMP | MUL | DEFAULT_GENERATED | — |
| `motivo` | varchar(255) | YES | Exclusão detectada no MDB | — | — | — |
| `content_hash` | varchar(64) | YES | — | — | — | SHA256 do conteúdo do registro excluído |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | codstatus |
| `idx_deleted_at` | Sim | BTREE | deleted_at |
| `idx_nro_ano` | Sim | BTREE | nro, ano |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `codstatus`: "000282026-13"
- `nro`: "28"
- `ano`: "2026"
- `origem`: "API"
- `deleted_at`: "2026-06-09 14:36:20"
- `motivo`: "Exclusão via Frontend"
- `content_hash`: "***MASCARADO***"
**Registro 2:**
- `codstatus`: "000372026-04"
- `nro`: "37"
- `ano`: "2026"
- `origem`: "API"
- `deleted_at`: "2026-06-12 10:47:06"
- `motivo`: "Exclusão via Frontend"
- `content_hash`: "***MASCARADO***"
**Registro 3:**
- `codstatus`: "000372026-05"
- `nro`: "37"
- `ano`: "2026"
- `origem`: "API"
- `deleted_at`: "2026-06-12 10:46:57"
- `motivo`: "Exclusão via Frontend"
- `content_hash`: "***MASCARADO***"

**Referências no código (amostra):**

- `app\backend\routers\os_routes.py`
- `app\backend\services\os_componentes_service.py`
- `app\services\sync_andamentos_v2.py`
- `deploy\release\app\backend\routers\os_routes.py`
- `deploy\release\app\backend\services\os_componentes_service.py`
- `deploy\release\app\services\sync_andamentos_v2.py`
- `sync_andamentos_v2.py`


#### `ip_permissions`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 15  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | auto_increment | — |
| `ip` | varchar(45) | NO | — | UNI | — | — |
| `descricao` | varchar(255) | YES | — | — | — | — |
| `grupo` | varchar(100) | YES | Sem Grupo | — | — | — |
| `ativo` | tinyint(1) | YES | 1 | — | — | — |
| `ctx_nova_os` | tinyint(1) | YES | 1 | — | — | — |
| `ctx_duplicar_os` | tinyint(1) | YES | 1 | — | — | — |
| `ctx_editar_os` | tinyint(1) | YES | 1 | — | — | — |
| `ctx_vincular_os` | tinyint(1) | YES | 1 | — | — | — |
| `ctx_abrir_pasta` | tinyint(1) | YES | 1 | — | — | — |
| `ctx_imprimir_ficha` | tinyint(1) | YES | 1 | — | — | — |
| `ctx_detalhes_os` | tinyint(1) | YES | 1 | — | — | — |
| `sb_inicio` | tinyint(1) | YES | 1 | — | — | — |
| `sb_gerencia` | tinyint(1) | YES | 1 | — | — | — |
| `sb_email` | tinyint(1) | YES | 1 | — | — | — |
| `sb_analise` | tinyint(1) | YES | 1 | — | — | — |
| `sb_papelaria` | tinyint(1) | YES | 1 | — | — | — |
| `sb_usuario` | tinyint(1) | YES | 1 | — | — | — |
| `sb_configuracoes` | tinyint(1) | YES | 1 | — | — | — |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |
| `updated_at` | timestamp | NO | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED on update CURRENT_TIMESTAMP | — |
| `sb_relatorio` | tinyint(1) | YES | 1 | — | — | — |
| `sb_dashboard_setor` | tinyint(1) | YES | 1 | — | — | — |
| `sb_admin_ips` | tinyint(1) | NO | 0 | — | — | — |
| `sb_pcp` | tinyint(1) | NO | 0 | — | — | — |
| `sb_usuarios` | tinyint(1) | NO | 0 | — | — | — |
| `sb_active_computers` | tinyint(1) | NO | 0 | — | — | — |
| `sb_gravacao` | tinyint(1) | NO | 0 | — | — | — |
| `sb_dashboard_global` | tinyint(1) | NO | 0 | — | — | — |
| `painel_setores` | json | YES | — | — | — | — |
| `ctx_mover_pastas` | tinyint(1) | NO | 1 | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `ip` | Não | BTREE | ip |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "14"
- `ip`: "10.120.1.14"
- `descricao`: "Acesso total — 10.120.1.14"
- `grupo`: "Administradores"
- `ativo`: "1"
- `ctx_nova_os`: "1"
- `ctx_duplicar_os`: "1"
- `ctx_editar_os`: "1"
- `ctx_vincular_os`: "1"
- `ctx_abrir_pasta`: "1"
- `ctx_imprimir_ficha`: "1"
- `ctx_detalhes_os`: "1"
- `sb_inicio`: "1"
- `sb_gerencia`: "1"
- `sb_email`: "***MASCARADO***"
- `sb_analise`: "1"
- `sb_papelaria`: "1"
- `sb_usuario`: "1"
- `sb_configuracoes`: "1"
- `created_at`: "2026-05-26 15:05:19"
- `updated_at`: "2026-05-26 19:06:20"
- `sb_relatorio`: "1"
- `sb_dashboard_setor`: "1"
- `sb_admin_ips`: "1"
- `sb_pcp`: "1"
- `sb_usuarios`: "1"
- `sb_active_computers`: "1"
- `sb_gravacao`: "1"
- `sb_dashboard_global`: "0"
- `painel_setores`: NULL
- `ctx_mover_pastas`: "1"
**Registro 2:**
- `id`: "16"
- `ip`: "127.0.0.1"
- `descricao`: "Acesso total — 127.0.0.1"
- `grupo`: "Administradores"
- `ativo`: "1"
- `ctx_nova_os`: "1"
- `ctx_duplicar_os`: "1"
- `ctx_editar_os`: "1"
- `ctx_vincular_os`: "1"
- `ctx_abrir_pasta`: "1"
- `ctx_imprimir_ficha`: "1"
- `ctx_detalhes_os`: "1"
- `sb_inicio`: "1"
- `sb_gerencia`: "1"
- `sb_email`: "***MASCARADO***"
- `sb_analise`: "1"
- `sb_papelaria`: "1"
- `sb_usuario`: "1"
- `sb_configuracoes`: "1"
- `created_at`: "2026-05-26 19:06:20"
- `updated_at`: "2026-05-26 19:06:20"
- `sb_relatorio`: "1"
- `sb_dashboard_setor`: "1"
- `sb_admin_ips`: "1"
- `sb_pcp`: "1"
- `sb_usuarios`: "1"
- `sb_active_computers`: "1"
- `sb_gravacao`: "1"
- `sb_dashboard_global`: "0"
- `painel_setores`: NULL
- `ctx_mover_pastas`: "1"
**Registro 3:**
- `id`: "19"
- `ip`: "::1"
- `descricao`: "Acesso total — ::1"
- `grupo`: "Administradores"
- `ativo`: "1"
- `ctx_nova_os`: "1"
- `ctx_duplicar_os`: "1"
- `ctx_editar_os`: "1"
- `ctx_vincular_os`: "1"
- `ctx_abrir_pasta`: "1"
- `ctx_imprimir_ficha`: "1"
- `ctx_detalhes_os`: "1"
- `sb_inicio`: "1"
- `sb_gerencia`: "1"
- `sb_email`: "***MASCARADO***"
- `sb_analise`: "1"
- `sb_papelaria`: "1"
- `sb_usuario`: "1"
- `sb_configuracoes`: "1"
- `created_at`: "2026-05-26 19:31:34"
- `updated_at`: "2026-05-26 19:31:34"
- `sb_relatorio`: "1"
- `sb_dashboard_setor`: "1"
- `sb_admin_ips`: "1"
- `sb_pcp`: "1"
- `sb_usuarios`: "1"
- `sb_active_computers`: "1"
- `sb_gravacao`: "1"
- `sb_dashboard_global`: "0"
- `painel_setores`: NULL
- `ctx_mover_pastas`: "1"

**Referências no código (amostra):**

- `app\backend\ip_permissions_schema.py`
- `app\backend\routers\api.py`
- `app\backend\routers\ip_admin_routes.py`
- `app\backend\routers\realtime.py`
- `app\backend\security\api_auth.py`
- `app\backend\security\painel_access.py`
- `app\backend\security\spa_access.py`
- `app\backend\setor_painel_schema.py`
- `deploy\release\app\backend\ip_permissions_schema.py`
- `deploy\release\app\backend\routers\api.py`
- `deploy\release\app\backend\routers\ip_admin_routes.py`
- `deploy\release\app\backend\routers\realtime.py`
- `deploy\release\app\backend\security\api_auth.py`
- `deploy\release\app\backend\security\painel_access.py`
- `deploy\release\app\backend\security\spa_access.py`


#### `log_sync_andamentos`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Registros:** 83,901  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | auto_increment | — |
| `timestamp` | datetime | YES | CURRENT_TIMESTAMP | MUL | DEFAULT_GENERATED | — |
| `tipo` | varchar(20) | YES | — | — | — | — |
| `origem` | varchar(50) | YES | — | — | — | — |
| `destino` | varchar(50) | YES | — | — | — | — |
| `codstatus` | varchar(50) | YES | — | MUL | — | — |
| `nro` | int | YES | — | — | — | — |
| `ano` | int | YES | — | — | — | — |
| `detalhes` | text | YES | — | — | — | — |
| `sucesso` | tinyint(1) | YES | 1 | — | — | — |
| `erro` | text | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_codstatus` | Sim | BTREE | codstatus |
| `idx_timestamp` | Sim | BTREE | timestamp |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "58479"
- `timestamp`: "2026-05-19 20:48:08"
- `tipo`: "INSERT"
- `origem`: "OS_Atual"
- `destino`: "MySQL"
- `codstatus`: "008482026-14"
- `nro`: "848"
- `ano`: "2026"
- `detalhes`: "Novo andamento sincronizado"
- `sucesso`: "1"
- `erro`: NULL
**Registro 2:**
- `id`: "58480"
- `timestamp`: "2026-05-19 20:48:32"
- `tipo`: "INSERT"
- `origem`: "OS_Atual"
- `destino`: "MySQL"
- `codstatus`: "008482026-15"
- `nro`: "848"
- `ano`: "2026"
- `detalhes`: "Novo andamento sincronizado"
- `sucesso`: "1"
- `erro`: NULL
**Registro 3:**
- `id`: "58481"
- `timestamp`: "2026-05-19 20:49:04"
- `tipo`: "INSERT"
- `origem`: "OS_Atual"
- `destino`: "MySQL"
- `codstatus`: "008512026-10"
- `nro`: "851"
- `ano`: "2026"
- `detalhes`: "Novo andamento sincronizado"
- `sucesso`: "1"
- `erro`: NULL

**Referências no código (amostra):**

- `app\services\sync_andamentos_v2.py`
- `deploy\release\app\services\sync_andamentos_v2.py`
- `sync_andamentos_v2.py`


#### `monitor_cache_detalhes`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Registros:** 360  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `NroProtocolo` | int | NO | — | PRI | — | — |
| `AnoProtocolo` | int | NO | — | PRI | — | — |
| `HashConteudo` | varchar(64) | YES | — | — | — | — |
| `ConteudoJson` | text | YES | — | — | — | — |
| `LastCheck` | datetime | YES | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | NroProtocolo, AnoProtocolo |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `NroProtocolo`: "83"
- `AnoProtocolo`: "2026"
- `HashConteudo`: "***MASCARADO***"
- `ConteudoJson`: "{\"NroProtocoloLinkDet\": 83, \"AnoProtocoloLinkDet\": 2026, \"ElemGrafBrasao\": \"0\", \"ElemGrafTimbre\": \"0\", \"ElemGrafArteG..."
- `LastCheck`: "2026-06-10 14:24:34"
**Registro 2:**
- `NroProtocolo`: "84"
- `AnoProtocolo`: "2026"
- `HashConteudo`: "***MASCARADO***"
- `ConteudoJson`: "{\"NroProtocoloLinkDet\": 84, \"AnoProtocoloLinkDet\": 2026, \"ElemGrafBrasao\": \"0\", \"ElemGrafTimbre\": \"0\", \"ElemGrafArteG..."
- `LastCheck`: "2026-06-10 15:24:18"
**Registro 3:**
- `NroProtocolo`: "85"
- `AnoProtocolo`: "2026"
- `HashConteudo`: "***MASCARADO***"
- `ConteudoJson`: "{\"NroProtocoloLinkDet\": 85, \"AnoProtocoloLinkDet\": 2026, \"ElemGrafBrasao\": \"0\", \"ElemGrafTimbre\": \"0\", \"ElemGrafArteG..."
- `LastCheck`: "2026-06-10 14:25:46"

**Referências no código (amostra):**

- `app\services\monitor_os_changes.py`
- `deploy\release\app\services\monitor_os_changes.py`


#### `monitor_detalhes_os`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Registros:** 0  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | bigint | NO | — | PRI | — | — |
| `AnoProtocoloLinkDet` | bigint | NO | — | PRI | — | — |
| `ElemGrafBrasao` | tinyint(1) | YES | — | — | — | — |
| `ElemGrafTimbre` | tinyint(1) | YES | — | — | — | — |
| `ElemGrafArteGab` | tinyint(1) | YES | — | — | — | — |
| `ElemGrafAssinatura` | tinyint(1) | YES | — | — | — | — |
| `ElemGrafCarimbo` | text | YES | — | — | — | — |
| `InsumosFornecidos` | text | YES | — | — | — | — |
| `MaterialFornecido` | tinyint(1) | YES | — | — | — | — |
| `ModeloDobra` | tinyint(1) | YES | — | — | — | — |
| `Fotolito` | tinyint(1) | YES | — | — | — | — |
| `ProvaImpressa` | tinyint(1) | YES | — | — | — | — |
| `TipoPublicacaoLink` | text | YES | — | — | — | — |
| `MaquinaLink` | text | YES | — | — | — | — |
| `Pags` | bigint | YES | — | — | — | — |
| `Mult4` | tinyint(1) | YES | — | — | — | — |
| `Tiragem` | bigint | YES | — | — | — | — |
| `CotaTotal` | bigint | YES | — | — | — | — |
| `Titulo` | text | YES | — | — | — | — |
| `FormatoLink` | text | YES | — | — | — | — |
| `CoeficienteA4` | double | YES | — | — | — | — |
| `PapelLink` | text | YES | — | — | — | — |
| `PapelDescricao` | text | YES | — | — | — | — |
| `FrenteVerso` | tinyint(1) | YES | — | — | — | — |
| `Cores` | text | YES | — | — | — | — |
| `CoresDescricao` | text | YES | — | — | — | — |
| `DescAcabamento` | text | YES | — | — | — | — |
| `Observ` | text | YES | — | — | — | — |
| `CalcPgs1` | bigint | YES | — | — | — | — |
| `CalcQtdCores1` | bigint | YES | — | — | — | — |
| `CalcCor1` | text | YES | — | — | — | — |
| `CalcPgs2` | bigint | YES | — | — | — | — |
| `CalcQtdCores2` | bigint | YES | — | — | — | — |
| `CalcCor2` | text | YES | — | — | — | — |
| `CalcPgs3` | bigint | YES | — | — | — | — |
| `CalcQtdCores3` | bigint | YES | — | — | — | — |
| `CalcCor3` | text | YES | — | — | — | — |
| `TiragemSolicitada` | bigint | YES | — | — | — | — |
| `ModelosArq` | bigint | YES | — | — | — | — |
| `lastupdate` | datetime | YES | — | — | — | — |
| `sync` | tinyint(1) | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | NroProtocoloLinkDet, AnoProtocoloLinkDet |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

_Sem amostra disponível._

**Referências no código (amostra):**

- `app\services\sync_tables\check_types.py`
- `app\services\sync_tables\main_monitor.py`
- `app\services\sync_tables\sync_tabdetalhes_os.py`
- `deploy\release\app\services\sync_tables\check_types.py`
- `deploy\release\app\services\sync_tables\main_monitor.py`
- `deploy\release\app\services\sync_tables\sync_tabdetalhes_os.py`


#### `monitor_detalhes_sp`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Registros:** 0  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | bigint | NO | — | PRI | — | — |
| `AnoProtocoloLinkDet` | bigint | NO | — | PRI | — | — |
| `ElemGrafBrasao` | tinyint(1) | YES | — | — | — | — |
| `ElemGrafTimbre` | tinyint(1) | YES | — | — | — | — |
| `ElemGrafArteGab` | tinyint(1) | YES | — | — | — | — |
| `ElemGrafAssinatura` | tinyint(1) | YES | — | — | — | — |
| `ElemGrafCarimbo` | text | YES | — | — | — | — |
| `InsumosFornecidos` | text | YES | — | — | — | — |
| `MaterialFornecido` | tinyint(1) | YES | — | — | — | — |
| `ModeloDobra` | tinyint(1) | YES | — | — | — | — |
| `Fotolito` | tinyint(1) | YES | — | — | — | — |
| `ProvaImpressa` | tinyint(1) | YES | — | — | — | — |
| `TipoPublicacaoLink` | text | YES | — | — | — | — |
| `MaquinaLink` | text | YES | — | — | — | — |
| `Pags` | bigint | YES | — | — | — | — |
| `Mult4` | tinyint(1) | YES | — | — | — | — |
| `Tiragem` | bigint | YES | — | — | — | — |
| `TiragemSolicitada` | bigint | YES | — | — | — | — |
| `CotaTotal` | bigint | YES | — | — | — | — |
| `Titulo` | text | YES | — | — | — | — |
| `FormatoLink` | text | YES | — | — | — | — |
| `CoeficienteA4` | double | YES | — | — | — | — |
| `PapelLink` | text | YES | — | — | — | — |
| `PapelDescricao` | text | YES | — | — | — | — |
| `FrenteVerso` | tinyint(1) | YES | — | — | — | — |
| `Cores` | text | YES | — | — | — | — |
| `CoresDescricao` | text | YES | — | — | — | — |
| `DescAcabamento` | text | YES | — | — | — | — |
| `Observ` | text | YES | — | — | — | — |
| `CalcPgs1` | bigint | YES | — | — | — | — |
| `CalcQtdCores1` | bigint | YES | — | — | — | — |
| `CalcCor1` | text | YES | — | — | — | — |
| `CalcPgs2` | bigint | YES | — | — | — | — |
| `CalcQtdCores2` | bigint | YES | — | — | — | — |
| `CalcCor2` | text | YES | — | — | — | — |
| `CalcPgs3` | bigint | YES | — | — | — | — |
| `CalcQtdCores3` | bigint | YES | — | — | — | — |
| `CalcCor3` | text | YES | — | — | — | — |
| `ModelosArq` | bigint | YES | — | — | — | — |
| `lastupdate` | datetime | YES | — | — | — | — |
| `sync` | tinyint(1) | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | NroProtocoloLinkDet, AnoProtocoloLinkDet |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

_Sem amostra disponível._

**Referências no código (amostra):**

- `app\services\sync_tables\main_monitor.py`
- `app\services\sync_tables\sync_tabdetalhes_sp.py`
- `deploy\release\app\services\sync_tables\main_monitor.py`
- `deploy\release\app\services\sync_tables\sync_tabdetalhes_sp.py`


#### `monitor_protocol_os`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Registros:** 0  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `NroProtocolo` | bigint | NO | — | PRI | — | — |
| `AnoProtocolo` | bigint | NO | — | PRI | — | — |
| `DataEntrada` | datetime | YES | — | — | — | — |
| `ProcessoSolicit` | text | YES | — | — | — | — |
| `CSnro` | text | YES | — | — | — | — |
| `CategoriaLink` | text | YES | — | — | — | — |
| `CodUsuarioLink` | text | YES | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — |
| `NomeUsuario` | text | YES | — | — | — | — |
| `Solicitante` | text | YES | — | — | — | — |
| `OrgInteressado` | text | YES | — | — | — | — |
| `SiglaOrgao` | text | YES | — | — | — | — |
| `Titular` | text | YES | — | — | — | — |
| `GabSalaUsuario` | text | YES | — | — | — | — |
| `Localizacao` | text | YES | — | — | — | — |
| `Andar` | text | YES | — | — | — | — |
| `RamalUsuario` | bigint | YES | — | — | — | — |
| `ContatoTrab` | text | YES | — | — | — | — |
| `ResponsavelGrafLink` | text | YES | — | — | — | — |
| `EntregaFormaLink` | text | YES | — | — | — | — |
| `EntregPrazoLink` | text | YES | — | — | — | — |
| `EntregData` | datetime | YES | — | — | — | — |
| `EntregPeriodo` | text | YES | — | — | — | — |
| `ReqLançada` | tinyint(1) | YES | — | — | — | — |
| `ReqEntregue` | tinyint(1) | YES | — | — | — | — |
| `DataConclusao` | datetime | YES | — | — | — | — |
| `ArmazenadoEm` | text | YES | — | — | — | — |
| `ContatoRecebim` | text | YES | — | — | — | — |
| `RetiradaNome` | text | YES | — | — | — | — |
| `RetiradaPonto` | text | YES | — | — | — | — |
| `RecebimData` | datetime | YES | — | — | — | — |
| `PontoEntrega` | text | YES | — | — | — | — |
| `SetorEntrega` | text | YES | — | — | — | — |
| `CancelamentoMotivo` | text | YES | — | — | — | — |
| `CancelamentoPonto` | text | YES | — | — | — | — |
| `CancelamentoData` | datetime | YES | — | — | — | — |
| `CancelamentoSetor` | text | YES | — | — | — | — |
| `CotaRepro` | bigint | YES | — | — | — | — |
| `CotaCartao` | text | YES | — | — | — | — |
| `ReimprimirOS` | tinyint(1) | YES | — | — | — | — |
| `DebitarCGRAF` | tinyint(1) | YES | — | — | — | — |
| `lastupdate` | datetime | YES | — | — | — | — |
| `sync` | tinyint(1) | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | NroProtocolo, AnoProtocolo |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

_Sem amostra disponível._

**Referências no código (amostra):**

- `app\services\sync_tables\main_monitor.py`
- `app\services\sync_tables\sync_access_mysql - Copia.py`
- `app\services\sync_tables\sync_access_mysql.py`
- `deploy\release\app\services\sync_tables\main_monitor.py`
- `deploy\release\app\services\sync_tables\sync_access_mysql - Copia.py`
- `deploy\release\app\services\sync_tables\sync_access_mysql.py`


#### `monitor_protocol_sp`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Registros:** 0  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `NroProtocolo` | bigint | NO | — | PRI | — | — |
| `AnoProtocolo` | bigint | NO | — | PRI | — | — |
| `DataEntrada` | datetime | YES | — | — | — | — |
| `ProcessoSolicit` | text | YES | — | — | — | — |
| `CSnro` | text | YES | — | — | — | — |
| `CategoriaLink` | text | YES | — | — | — | — |
| `CodUsuarioLink` | text | YES | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — |
| `NomeUsuario` | text | YES | — | — | — | — |
| `Solicitante` | text | YES | — | — | — | — |
| `OrgInteressado` | text | YES | — | — | — | — |
| `SiglaOrgao` | text | YES | — | — | — | — |
| `Titular` | text | YES | — | — | — | — |
| `GabSalaUsuario` | text | YES | — | — | — | — |
| `Localizacao` | text | YES | — | — | — | — |
| `Andar` | text | YES | — | — | — | — |
| `RamalUsuario` | bigint | YES | — | — | — | — |
| `ContatoTrab` | text | YES | — | — | — | — |
| `ResponsavelGrafLink` | text | YES | — | — | — | — |
| `EntregaFormaLink` | text | YES | — | — | — | — |
| `EntregPrazoLink` | text | YES | — | — | — | — |
| `EntregData` | datetime | YES | — | — | — | — |
| `EntregPeriodo` | text | YES | — | — | — | — |
| `ReqLançada` | tinyint(1) | YES | — | — | — | — |
| `ReqEntregue` | tinyint(1) | YES | — | — | — | — |
| `DataConclusao` | text | YES | — | — | — | — |
| `ArmazenadoEm` | text | YES | — | — | — | — |
| `ContatoRecebim` | text | YES | — | — | — | — |
| `RetiradaNome` | text | YES | — | — | — | — |
| `RetiradaPonto` | text | YES | — | — | — | — |
| `RecebimData` | datetime | YES | — | — | — | — |
| `PontoEntrega` | text | YES | — | — | — | — |
| `SetorEntrega` | text | YES | — | — | — | — |
| `CancelamentoMotivo` | text | YES | — | — | — | — |
| `CancelamentoPonto` | text | YES | — | — | — | — |
| `CancelamentoData` | datetime | YES | — | — | — | — |
| `CancelamentoSetor` | text | YES | — | — | — | — |
| `CotaRepro` | bigint | YES | — | — | — | — |
| `CotaCartao` | text | YES | — | — | — | — |
| `ReimprimirOS` | tinyint(1) | YES | — | — | — | — |
| `DebitarCGRAF` | tinyint(1) | YES | — | — | — | — |
| `lastupdate` | datetime | YES | — | — | — | — |
| `sync` | tinyint(1) | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | NroProtocolo, AnoProtocolo |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

_Sem amostra disponível._

**Referências no código (amostra):**

- `app\services\sync_tables\main_monitor.py`
- `deploy\release\app\services\sync_tables\main_monitor.py`


#### `tab_os_audit_log`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 1,102  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | auto_increment | — |
| `nro_protocolo` | int | NO | — | — | — | — |
| `ano_protocolo` | int | NO | — | MUL | — | — |
| `evento_em` | datetime | NO | — | — | — | — |
| `acao` | varchar(40) | NO | — | — | — | — |
| `entidade` | varchar(40) | NO | — | — | — | — |
| `campo` | varchar(80) | YES | — | — | — | — |
| `valor_anterior` | text | YES | — | — | — | — |
| `valor_novo` | text | YES | — | — | — | — |
| `ponto` | varchar(20) | YES | — | — | — | — |
| `client_ip` | varchar(45) | YES | — | — | — | — |
| `ref_cod` | varchar(64) | YES | — | MUL | — | — |
| `origem` | varchar(40) | NO | API | — | — | — |
| `descricao` | text | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_os_audit_os` | Sim | BTREE | ano_protocolo, nro_protocolo, evento_em |
| `idx_os_audit_ref` | Sim | BTREE | ref_cod |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "1"
- `nro_protocolo`: "659"
- `ano_protocolo`: "2026"
- `evento_em`: "2026-04-28 00:00:00"
- `acao`: "CREATE"
- `entidade`: "os"
- `campo`: NULL
- `valor_anterior`: NULL
- `valor_novo`: NULL
- `ponto`: "7.472"
- `client_ip`: NULL
- `ref_cod`: NULL
- `origem`: "BACKFILL"
- `descricao`: "OS 659/2026 criada (registro legado)"
**Registro 2:**
- `id`: "2"
- `nro_protocolo`: "659"
- `ano_protocolo`: "2026"
- `evento_em`: "2026-04-28 00:00:00"
- `acao`: "ANDAMENTO_ADD"
- `entidade`: "andamento"
- `campo`: NULL
- `valor_anterior`: NULL
- `valor_novo`: "{\"situacao\": \"Entrada Inicial\", \"setor\": \"SECOG\", \"observacao\": \"12h16\"}"
- `ponto`: "7.472"
- `client_ip`: NULL
- `ref_cod`: "backfill:006592026-01"
- `origem`: "BACKFILL"
- `descricao`: "Andamento: Entrada Inicial — Setor SECOG — 12h16"
**Registro 3:**
- `id`: "3"
- `nro_protocolo`: "659"
- `ano_protocolo`: "2026"
- `evento_em`: "2026-04-28 00:00:00"
- `acao`: "ANDAMENTO_ADD"
- `entidade`: "andamento"
- `campo`: NULL
- `valor_anterior`: NULL
- `valor_novo`: "{\"situacao\": \"Pendência Usuário\", \"setor\": \"SECOG\", \"observacao\": \"12h26\\r\\nAutorizado Cotasgraf\\r\\nAguarda arquivo.\"}"
- `ponto`: "7.472"
- `client_ip`: NULL
- `ref_cod`: "backfill:006592026-02"
- `origem`: "BACKFILL"
- `descricao`: "Andamento: Pendência Usuário — Setor SECOG — 12h26\r\nAutorizado Cotasgraf\r\nAguarda arquivo."

**Referências no código (amostra):**

- `app\backend\routers\os_audit_service.py`
- `deploy\release\app\backend\routers\os_audit_service.py`
- `deploy\release\sql\create_os_audit_log.sql`
- `deploy\sql\create_os_audit_log.sql`
- `scripts\purge_os_pre_2024.py`
- `scripts\purge_os_pre_2024_counts.py`
- `tools\audit_previsao_prazo_data.py`


#### `tab_os_componentes`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 12  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | auto_increment | — |
| `nro_protocolo` | int | NO | — | — | — | — |
| `ano_protocolo` | int | NO | — | MUL | — | — |
| `nome` | varchar(120) | NO | — | — | — | — |
| `nome_normalizado` | varchar(120) | NO | — | — | — | — |
| `tipo` | varchar(20) | YES | — | — | — | — |
| `ordem` | int | NO | 0 | — | — | — |
| `ativo` | tinyint(1) | NO | 1 | — | — | — |
| `techspec_json` | json | YES | — | — | — | — |
| `criado_em` | datetime | NO | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |
| `criado_por` | varchar(32) | YES | — | — | — | — |
| `atualizado_em` | datetime | YES | — | — | on update CURRENT_TIMESTAMP | — |
| `atualizado_por` | varchar(32) | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_os_componentes_nome_norm` | Sim | BTREE | ano_protocolo, nro_protocolo, nome_normalizado |
| `idx_os_componentes_os` | Sim | BTREE | ano_protocolo, nro_protocolo, ativo |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "1"
- `nro_protocolo`: "812"
- `ano_protocolo`: "2026"
- `nome`: "Capa"
- `nome_normalizado`: "capa"
- `tipo`: "CAPA"
- `ordem`: "0"
- `ativo`: "1"
- `techspec_json`: "{\"lotes\": [{\"paginas\": 4, \"cores_link\": \"Policromia\"}]}"
- `criado_em`: "2026-06-08 17:02:55"
- `criado_por`: "918713"
- `atualizado_em`: "2026-06-08 17:14:52"
- `atualizado_por`: "918713"
**Registro 2:**
- `id`: "2"
- `nro_protocolo`: "812"
- `ano_protocolo`: "2026"
- `nome`: "Miolo"
- `nome_normalizado`: "miolo"
- `tipo`: "MIOLO"
- `ordem`: "1"
- `ativo`: "1"
- `techspec_json`: "{\"lotes\": [{\"paginas\": 468, \"cores_link\": \"Preto\"}]}"
- `criado_em`: "2026-06-08 17:02:55"
- `criado_por`: "918713"
- `atualizado_em`: "2026-06-08 17:14:52"
- `atualizado_por`: "918713"
**Registro 3:**
- `id`: "3"
- `nro_protocolo`: "1156"
- `ano_protocolo`: "2025"
- `nome`: "Capa"
- `nome_normalizado`: "capa"
- `tipo`: "CAPA"
- `ordem`: "0"
- `ativo`: "1"
- `techspec_json`: "{\"lotes\": [{\"id\": \"lote_1780950562512_3\", \"paginas\": 4, \"cores_desc\": \"\", \"cores_link\": \"Policromia\", \"papel_desc\": \"..."
- `criado_em`: "2026-06-08 17:29:56"
- `criado_por`: "918713"
- `atualizado_em`: NULL
- `atualizado_por`: NULL

**Referências no código (amostra):**

- `app\backend\os_sub_os_schema.py`
- `app\backend\routers\os_routes.py`
- `app\backend\services\os_componentes_service.py`
- `app\backend\services\os_sub_os_queries.py`
- `app\backend\tests\test_componentes_gerencia.py`
- `apps\web\src\features\gerencia\techSpec.ts`
- `deploy\release\app\backend\os_sub_os_schema.py`
- `deploy\release\app\backend\routers\os_routes.py`
- `deploy\release\app\backend\services\os_componentes_service.py`
- `deploy\release\app\backend\services\os_sub_os_queries.py`
- `deploy\release\app\backend\tests\test_componentes_gerencia.py`
- `deploy\release\sql\create_tab_os_sub_os.sql`
- `deploy\sql\create_tab_os_sub_os.sql`
- `tools\audit_previsao_prazo_data.py`


#### `tab_os_filter_produtos`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 61  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | auto_increment | — |
| `produto` | varchar(255) | NO | — | MUL | — | — |
| `produto_normalizado` | varchar(255) | NO | — | UNI | — | — |
| `total_os` | int | NO | 0 | — | — | — |
| `ultima_os_ano` | int | YES | — | — | — | — |
| `atualizado_em` | datetime | NO | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED on update CURRENT_TIMESTAMP | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_filter_produtos_label` | Sim | BTREE | produto |
| `idx_filter_produtos_norm` | Sim | BTREE | produto_normalizado |
| `uk_produto_normalizado` | Não | BTREE | produto_normalizado |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "1"
- `produto`: "Acabamento"
- `produto_normalizado`: "acabamento"
- `total_os`: "1927"
- `ultima_os_ano`: "2025"
- `atualizado_em`: "2026-06-11 11:58:06"
**Registro 2:**
- `id`: "2"
- `produto`: "Aerograma"
- `produto_normalizado`: "aerograma"
- `total_os`: "1757"
- `ultima_os_ano`: "2025"
- `atualizado_em`: "2026-06-11 14:48:13"
**Registro 3:**
- `id`: "3"
- `produto`: "Apostila"
- `produto_normalizado`: "apostila"
- `total_os`: "1980"
- `ultima_os_ano`: "2026"
- `atualizado_em`: "2026-06-12 18:55:48"

**Referências no código (amostra):**

- `app\backend\os_filter_options_schema.py`
- `app\backend\services\os_filter_options_service.py`
- `deploy\release\app\backend\os_filter_options_schema.py`
- `deploy\release\app\backend\services\os_filter_options_service.py`
- `deploy\release\sql\create_os_filter_options_tables.sql`
- `deploy\sql\create_os_filter_options_tables.sql`
- `sync_andamentos_v2.py`


#### `tab_os_filter_solicitantes`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 1,977  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | auto_increment | — |
| `solicitante` | varchar(255) | NO | — | MUL | — | — |
| `solicitante_normalizado` | varchar(255) | NO | — | UNI | — | — |
| `total_os` | int | NO | 0 | — | — | — |
| `ultima_os_ano` | int | YES | — | — | — | — |
| `atualizado_em` | datetime | NO | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED on update CURRENT_TIMESTAMP | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_filter_solicitantes_label` | Sim | BTREE | solicitante |
| `idx_filter_solicitantes_norm` | Sim | BTREE | solicitante_normalizado |
| `uk_solicitante_normalizado` | Não | BTREE | solicitante_normalizado |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "1"
- `solicitante`: "GIACOBO"
- `solicitante_normalizado`: "giacobo"
- `total_os`: "75"
- `ultima_os_ano`: "2026"
- `atualizado_em`: "2026-06-11 11:58:08"
**Registro 2:**
- `id`: "2"
- `solicitante`: "ELCIONE BARBALHO"
- `solicitante_normalizado`: "elcione barbalho"
- `total_os`: "59"
- `ultima_os_ano`: "2025"
- `atualizado_em`: "2026-06-11 11:58:08"
**Registro 3:**
- `id`: "3"
- `solicitante`: "MISSIONARIO JOSE OLIMPIO"
- `solicitante_normalizado`: "missionario jose olimpio"
- `total_os`: "34"
- `ultima_os_ano`: "2026"
- `atualizado_em`: "2026-06-11 11:58:08"

**Referências no código (amostra):**

- `app\backend\os_filter_options_schema.py`
- `app\backend\services\os_filter_options_service.py`
- `deploy\release\app\backend\os_filter_options_schema.py`
- `deploy\release\app\backend\services\os_filter_options_service.py`
- `deploy\release\sql\create_os_filter_options_tables.sql`
- `deploy\sql\create_os_filter_options_tables.sql`
- `sync_andamentos_v2.py`


#### `tab_os_sub_os`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 6  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | auto_increment | — |
| `nro_protocolo` | int | NO | — | MUL | — | — |
| `ano_protocolo` | int | NO | — | MUL | — | — |
| `componente_id` | bigint | NO | — | — | — | — |
| `display_name` | varchar(160) | NO | — | — | — | — |
| `ativo` | tinyint(1) | NO | 1 | — | — | — |
| `congelada` | tinyint(1) | NO | 0 | — | — | — |
| `criado_em` | datetime | NO | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |
| `criado_por` | varchar(32) | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_sub_os_os` | Sim | BTREE | ano_protocolo, nro_protocolo, ativo |
| `idx_sub_os_os_ativo` | Sim | BTREE | nro_protocolo, ano_protocolo, ativo |
| `uk_sub_os_os_componente` | Não | BTREE | ano_protocolo, nro_protocolo, componente_id |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "1"
- `nro_protocolo`: "568"
- `ano_protocolo`: "2026"
- `componente_id`: "5"
- `display_name`: "568 [Capa]"
- `ativo`: "0"
- `congelada`: "0"
- `criado_em`: "2026-06-08 17:35:48"
- `criado_por`: NULL
**Registro 2:**
- `id`: "2"
- `nro_protocolo`: "568"
- `ano_protocolo`: "2026"
- `componente_id`: "6"
- `display_name`: "568 [Miolo]"
- `ativo`: "0"
- `congelada`: "0"
- `criado_em`: "2026-06-08 17:43:49"
- `criado_por`: NULL
**Registro 3:**
- `id`: "3"
- `nro_protocolo`: "2532"
- `ano_protocolo`: "2025"
- `componente_id`: "9"
- `display_name`: "2532 [Capa]"
- `ativo`: "0"
- `congelada`: "0"
- `criado_em`: "2026-06-08 18:13:56"
- `criado_por`: NULL

**Referências no código (amostra):**

- `app\backend\os_search_indexes_schema.py`
- `app\backend\os_sub_os_schema.py`
- `app\backend\services\andamento_operacional.py`
- `app\backend\services\email_pendencias_service.py`
- `app\backend\services\os_componentes_service.py`
- `app\backend\services\os_sub_os_queries.py`
- `app\backend\tests\test_email_pendencias.py`
- `app\backend\tests\test_sub_os_corrections.py`
- `app\backend\tests\test_sub_os_listagem_manual.py`
- `deploy\release\app\backend\os_search_indexes_schema.py`
- `deploy\release\app\backend\os_sub_os_schema.py`
- `deploy\release\app\backend\services\andamento_operacional.py`
- `deploy\release\app\backend\services\email_pendencias_service.py`
- `deploy\release\app\backend\services\os_componentes_service.py`
- `deploy\release\app\backend\services\os_sub_os_queries.py`


#### `tab_os_sub_os_andamento`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 0  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | auto_increment | — |
| `sub_os_id` | bigint | NO | — | MUL | — | — |
| `situacao` | varchar(120) | NO | — | — | — | — |
| `setor` | varchar(80) | NO | — | — | — | — |
| `observacao` | text | YES | — | — | — | — |
| `data` | datetime | NO | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |
| `ultimo_status` | tinyint(1) | NO | 0 | MUL | — | — |
| `ponto` | varchar(32) | YES | — | — | — | — |
| `cod_status_espelho` | varchar(32) | YES | — | MUL | — | — |
| `criado_em` | datetime | NO | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |
| `criado_por` | varchar(32) | YES | — | — | — | — |
| `source_type` | varchar(32) | YES | manual_sub_os | — | — | — |
| `source_cod_status` | varchar(32) | YES | — | — | — | — |
| `herdado_da_os_principal` | tinyint(1) | NO | 0 | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_sub_os_andamento_espelho` | Sim | BTREE | cod_status_espelho |
| `idx_sub_os_andamento_filtro` | Sim | BTREE | ultimo_status, setor, situacao, sub_os_id |
| `idx_sub_os_andamento_sub` | Sim | BTREE | sub_os_id, ultimo_status |
| `uk_sub_os_andamento_inherited` | Não | BTREE | sub_os_id, source_cod_status |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

_Sem amostra disponível._

**Referências no código (amostra):**

- `ajuste_andamentos_os_antigas.py`
- `app\backend\os_search_indexes_schema.py`
- `app\backend\os_sub_os_schema.py`
- `app\backend\services\andamento_operacional.py`
- `app\backend\services\email_pendencias_service.py`
- `app\backend\services\os_componentes_service.py`
- `app\backend\services\os_sub_os_queries.py`
- `app\backend\tests\test_email_pendencias.py`
- `app\backend\tests\test_sub_os_propagacao_exclusao.py`
- `deploy\release\app\backend\os_search_indexes_schema.py`
- `deploy\release\app\backend\os_sub_os_schema.py`
- `deploy\release\app\backend\services\andamento_operacional.py`
- `deploy\release\app\backend\services\email_pendencias_service.py`
- `deploy\release\app\backend\services\os_componentes_service.py`
- `deploy\release\app\backend\services\os_sub_os_queries.py`


#### `tab_os_ultimo_andamento_operacional`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 84,075  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `nro_protocolo` | int | NO | — | PRI | — | — |
| `ano_protocolo` | int | NO | — | PRI | — | — |
| `cod_status` | varchar(32) | YES | — | — | — | — |
| `situacao` | varchar(120) | YES | — | MUL | — | — |
| `setor` | varchar(80) | YES | — | MUL | — | — |
| `data` | datetime | YES | — | MUL | — | — |
| `observacao` | text | YES | — | — | — | — |
| `ponto` | varchar(32) | YES | — | — | — | — |
| `ultimo_status` | tinyint(1) | NO | 0 | — | — | — |
| `atualizado_em` | datetime | NO | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED on update CURRENT_TIMESTAMP | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | nro_protocolo, ano_protocolo |
| `idx_ua_oper_ano_nro` | Sim | BTREE | ano_protocolo, nro_protocolo |
| `idx_ua_oper_data` | Sim | BTREE | data |
| `idx_ua_oper_setor` | Sim | BTREE | setor |
| `idx_ua_oper_setor_situacao` | Sim | BTREE | setor, situacao |
| `idx_ua_oper_situacao` | Sim | BTREE | situacao |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `nro_protocolo`: "1"
- `ano_protocolo`: "2006"
- `cod_status`: "000012006-02"
- `situacao`: "Cancelado"
- `setor`: "SEFOC"
- `data`: "2007-03-01 00:00:00"
- `observacao`: "OS criada p/ CS de Papelaria"
- `ponto`: "6.220"
- `ultimo_status`: "1"
- `atualizado_em`: "2026-06-11 18:48:11"
**Registro 2:**
- `nro_protocolo`: "1"
- `ano_protocolo`: "2007"
- `cod_status`: "000012007-02"
- `situacao`: "Entregue"
- `setor`: "Expedição"
- `data`: "2007-01-25 00:00:00"
- `observacao`: NULL
- `ponto`: "4.839"
- `ultimo_status`: "1"
- `atualizado_em`: "2026-06-11 18:48:11"
**Registro 3:**
- `nro_protocolo`: "1"
- `ano_protocolo`: "2008"
- `cod_status`: "000012008-07"
- `situacao`: "Entregue"
- `setor`: "SEDIR "
- `data`: "2008-04-08 00:00:00"
- `observacao`: "Entregue para: Fatima N\r\nPonto: 1.000\r\nEm: 08/04/2008    11h27\r\nEntregue por: 6.218\r\nSetor: SEDIR \r\nteste"
- `ponto`: "6.218"
- `ultimo_status`: "1"
- `atualizado_em`: "2026-06-11 18:48:11"

**Referências no código (amostra):**

- `app\backend\os_ultimo_andamento_schema.py`
- `app\backend\services\os_home_source_service.py`
- `app\backend\services\os_materialized_reconcile_service.py`
- `app\backend\services\os_operacional_notify_service.py`
- `app\backend\services\os_ultimo_andamento_service.py`
- `app\backend\tests\test_os_search_gap_fallback.py`
- `app\backend\tests\test_os_search_security.py`
- `app\backend\tests\test_os_ultimo_andamento_search.py`
- `deploy\release\app\backend\os_ultimo_andamento_schema.py`
- `deploy\release\app\backend\services\os_home_source_service.py`
- `deploy\release\app\backend\services\os_materialized_reconcile_service.py`
- `deploy\release\app\backend\services\os_operacional_notify_service.py`
- `deploy\release\app\backend\services\os_ultimo_andamento_service.py`
- `deploy\release\app\backend\tests\test_os_search_gap_fallback.py`
- `deploy\release\app\backend\tests\test_os_search_security.py`


#### `tab_pcp_fila`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 291  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | auto_increment | — |
| `setor` | varchar(64) | NO | — | MUL | — | — |
| `nro_os` | int | NO | — | — | — | — |
| `ano` | int | NO | — | — | — | — |
| `ordem` | int | NO | — | — | — | — |
| `ultima_atualizacao` | datetime | YES | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED on update CURRENT_TIMESTAMP | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_setor_ordem` | Sim | BTREE | setor, ordem |
| `uniq_setor_os` | Não | BTREE | setor, nro_os, ano |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "5689"
- `setor`: "SIELT"
- `nro_os`: "791"
- `ano`: "2026"
- `ordem`: "1"
- `ultima_atualizacao`: "2026-05-29 08:06:06"
**Registro 2:**
- `id`: "5690"
- `setor`: "SIELT"
- `nro_os`: "956"
- `ano`: "2026"
- `ordem`: "2"
- `ultima_atualizacao`: "2026-05-29 08:06:06"
**Registro 3:**
- `id`: "5691"
- `setor`: "SIELT"
- `nro_os`: "766"
- `ano`: "2026"
- `ordem`: "3"
- `ultima_atualizacao`: "2026-05-29 08:06:06"

**Referências no código (amostra):**

- `app\backend\pcp_queue_service.py`
- `app\backend\routers\pcp_queue_service.py`
- `app\backend\routers\pcp_routes.py`
- `app\backend\services\os_search_service.py`
- `apps\web\src\features\dashboard-setor\api.ts`
- `deploy\release\app\backend\pcp_queue_service.py`
- `deploy\release\app\backend\routers\pcp_queue_service.py`
- `deploy\release\app\backend\routers\pcp_routes.py`
- `deploy\release\app\backend\services\os_search_service.py`
- `docs\sql\os_search_indexes.sql`
- `scripts\purge_os_pre_2024.py`
- `scripts\purge_os_pre_2024_counts.py`
- `tools\audit_previsao_prazo_data.py`


#### `tab_pre_analise_snapshot`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 11  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | auto_increment | — |
| `AnoProtocolo` | int | NO | — | MUL | — | — |
| `NroProtocolo` | int | NO | — | — | — | — |
| `VersaoLabel` | varchar(255) | NO | — | — | — | — |
| `ResultsJson` | longtext | NO | — | — | — | — |
| `CheckCount` | int | NO | 0 | — | — | — |
| `AlertCount` | int | NO | 0 | — | — | — |
| `ExecutadoEm` | datetime | NO | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |
| `ExecutadoPor` | varchar(32) | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_pre_analise_os` | Sim | BTREE | AnoProtocolo, NroProtocolo |
| `uk_pre_analise_os_versao` | Não | BTREE | AnoProtocolo, NroProtocolo, VersaoLabel |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "1"
- `AnoProtocolo`: "2026"
- `NroProtocolo`: "973"
- `VersaoLabel`: "v1 (Original)"
- `ResultsJson`: "[{\"status\": \"warning\", \"mensagem\": \"\\\"CONVITE GRUPO PARLAMENTAR BRASIL JAPAO 118 ANOS 11 DE JUNHO 2026 PDF.pdf\\\": mar..."
- `CheckCount`: "5"
- `AlertCount`: "5"
- `ExecutadoEm`: "2026-06-01 17:05:53"
- `ExecutadoPor`: "918713"
**Registro 2:**
- `id`: "2"
- `AnoProtocolo`: "2026"
- `NroProtocolo`: "981"
- `VersaoLabel`: "v1 (Original)"
- `ResultsJson`: "[{\"status\": \"warning\", \"mensagem\": \"\\\"Caderno CONLE novos consultores.pdf\\\" pág. 1: marcas sobrepostas (~0.3 mm) (can..."
- `CheckCount`: "5"
- `AlertCount`: "11"
- `ExecutadoEm`: "2026-06-01 17:15:36"
- `ExecutadoPor`: "918713"
**Registro 3:**
- `id`: "3"
- `AnoProtocolo`: "2026"
- `NroProtocolo`: "982"
- `VersaoLabel`: "v1 (Original)"
- `ResultsJson`: "[{\"status\": \"warning\", \"mensagem\": \"\\\"Luciano.pdf\\\": marcas de corte não detectadas; utilizado TrimBox ou formato do ..."
- `CheckCount`: "5"
- `AlertCount`: "6"
- `ExecutadoEm`: "2026-06-01 17:13:18"
- `ExecutadoPor`: "918713"

**Referências no código (amostra):**

- `app\backend\services\pre_analise\snapshot_store.py`
- `deploy\release\app\backend\services\pre_analise\snapshot_store.py`
- `deploy\release\sql\create_tab_pre_analise_snapshot.sql`
- `deploy\sql\create_tab_pre_analise_snapshot.sql`
- `scripts\purge_os_pre_2024.py`


#### `tab_pre_analise_timing`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 162  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | auto_increment | — |
| `check_id` | varchar(64) | NO | — | MUL | — | — |
| `pdf_count` | int | NO | 0 | — | — | — |
| `total_pages` | int | NO | 0 | — | — | — |
| `formato_bucket` | varchar(32) | NO | unknown | — | — | — |
| `duration_ms` | int | NO | — | — | — | — |
| `phase` | varchar(16) | NO | check | MUL | — | — |
| `sampled_at` | datetime | YES | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_timing_lookup` | Sim | BTREE | check_id, formato_bucket, pdf_count, total_pages, sampled_at |
| `idx_timing_setup` | Sim | BTREE | phase, formato_bucket, pdf_count, sampled_at |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "8"
- `check_id`: ""
- `pdf_count`: "2"
- `total_pages`: "105"
- `formato_bucket`: "mixed"
- `duration_ms`: "35"
- `phase`: "setup"
- `sampled_at`: "2026-06-01 15:32:17"
**Registro 2:**
- `id`: "9"
- `check_id`: "formato"
- `pdf_count`: "2"
- `total_pages`: "105"
- `formato_bucket`: "mixed"
- `duration_ms`: "2637"
- `phase`: "check"
- `sampled_at`: "2026-06-01 15:32:19"
**Registro 3:**
- `id`: "10"
- `check_id`: "sangria_bleed"
- `pdf_count`: "2"
- `total_pages`: "105"
- `formato_bucket`: "mixed"
- `duration_ms`: "41740"
- `phase`: "check"
- `sampled_at`: "2026-06-01 15:33:01"

**Referências no código (amostra):**

- `app\backend\services\pre_analise\timing_store.py`
- `deploy\release\app\backend\services\pre_analise\timing_store.py`


#### `tab_pre_analise_timing_file`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 184  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | auto_increment | — |
| `check_id` | varchar(64) | NO | — | MUL | — | — |
| `pdf_name` | varchar(255) | NO | — | — | — | — |
| `page_count` | int | NO | — | — | — | — |
| `formato_bucket` | varchar(32) | NO | unknown | — | — | — |
| `duration_ms` | int | NO | — | — | — | — |
| `ms_per_page` | int | NO | 0 | — | — | — |
| `sampled_at` | datetime | YES | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_file_name` | Sim | BTREE | check_id, pdf_name, page_count |
| `idx_file_timing` | Sim | BTREE | check_id, formato_bucket, page_count, sampled_at |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "5"
- `check_id`: "formato"
- `pdf_name`: "(Final) Capa Aberta_Yvyrupá Territorio_Radilson Gomes.pdf"
- `page_count`: "1"
- `formato_bucket`: "large"
- `duration_ms`: "25"
- `ms_per_page`: "25"
- `sampled_at`: "2026-06-01 15:32:19"
**Registro 2:**
- `id`: "6"
- `check_id`: "formato"
- `pdf_name`: "(Final) Miolo_Catálogo_Yvyurupá Território.pdf"
- `page_count`: "104"
- `formato_bucket`: "A4"
- `duration_ms`: "2612"
- `ms_per_page`: "25"
- `sampled_at`: "2026-06-01 15:32:19"
**Registro 3:**
- `id`: "7"
- `check_id`: "sangria_bleed"
- `pdf_name`: "(Final) Capa Aberta_Yvyrupá Territorio_Radilson Gomes.pdf"
- `page_count`: "1"
- `formato_bucket`: "large"
- `duration_ms`: "398"
- `ms_per_page`: "398"
- `sampled_at`: "2026-06-01 15:33:01"

**Referências no código (amostra):**

- `app\backend\services\pre_analise\timing_store.py`
- `deploy\release\app\backend\services\pre_analise\timing_store.py`


#### `tabandamento`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** MDB + MySQL (duplicata de casing)  
**Registros:** 199,180  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `CodStatus` | varchar(20) | NO | — | PRI | — | — |
| `NroProtocoloLink` | int | YES | — | MUL | — | — |
| `AnoProtocoloLink` | int | YES | — | — | — | — |
| `SituacaoLink` | text | YES | — | MUL | — | — |
| `SetorLink` | text | YES | — | — | — | — |
| `Data` | datetime | YES | — | — | — | — |
| `UltimoStatus` | tinyint | YES | — | MUL | — | — |
| `Observaçao` | text | YES | — | — | — | — |
| `Ponto` | text | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | CodStatus |
| `idx_andamento_filtros` | Sim | BTREE | SituacaoLink, SetorLink, UltimoStatus |
| `idx_andamento_os_operacional` | Sim | BTREE | NroProtocoloLink, AnoProtocoloLink, UltimoStatus, Data, CodStatus |
| `idx_andamento_os_ultimo_data` | Sim | BTREE | NroProtocoloLink, AnoProtocoloLink, UltimoStatus, Data, CodStatus |
| `idx_andamento_protocolo` | Sim | BTREE | NroProtocoloLink, AnoProtocoloLink |
| `idx_panel_opt` | Sim | BTREE | UltimoStatus, SituacaoLink, SetorLink |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `CodStatus`: "000012006-02"
- `NroProtocoloLink`: "1"
- `AnoProtocoloLink`: "2006"
- `SituacaoLink`: "Cancelado"
- `SetorLink`: "SEFOC"
- `Data`: "2007-03-01 00:00:00"
- `UltimoStatus`: "1"
- `Observaçao`: "OS criada p/ CS de Papelaria"
- `Ponto`: "6.220"
**Registro 2:**
- `CodStatus`: "000012007-02"
- `NroProtocoloLink`: "1"
- `AnoProtocoloLink`: "2007"
- `SituacaoLink`: "Entregue"
- `SetorLink`: "Expedição"
- `Data`: "2007-01-25 00:00:00"
- `UltimoStatus`: "1"
- `Observaçao`: NULL
- `Ponto`: "4.839"
**Registro 3:**
- `CodStatus`: "000012008-07"
- `NroProtocoloLink`: "1"
- `AnoProtocoloLink`: "2008"
- `SituacaoLink`: "Entregue"
- `SetorLink`: "SEDIR "
- `Data`: "2008-04-08 00:00:00"
- `UltimoStatus`: "1"
- `Observaçao`: "Entregue para: Fatima N\r\nPonto: 1.000\r\nEm: 08/04/2008    11h27\r\nEntregue por: 6.218\r\nSetor: SEDIR \r\nteste"
- `Ponto`: "6.218"

**Referências no código (amostra):**

- `app\backend\services\andamento_table.py`
- `app\backend\services\os_home_source_service.py`
- `app\backend\services\os_search_service.py`
- `app\backend\tests\test_andamento_table.py`
- `app\services\sync_andamentos_v2.py`
- `app\services\sync_tables\processarantigas.py`
- `deploy\release\app\backend\services\andamento_table.py`
- `deploy\release\app\backend\services\os_home_source_service.py`
- `deploy\release\app\backend\services\os_search_service.py`
- `deploy\release\app\backend\tests\test_andamento_table.py`
- `deploy\release\app\services\sync_andamentos_v2.py`
- `deploy\release\app\services\sync_tables\processarantigas.py`
- `sync_andamentos_v2.py`
- `tools\validate_sync_mdb_mysql.py`


#### `tabdadosdeputados`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Registros:** 512  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `nome_parlamentar` | varchar(255) | YES | — | — | — | — |
| `partido` | varchar(50) | YES | — | — | — | — |
| `uf` | varchar(2) | YES | — | — | — | — |
| `anexo` | varchar(100) | YES | — | — | — | — |
| `gabinete` | varchar(50) | YES | — | — | — | — |
| `telefone_1` | varchar(50) | YES | — | — | — | — |
| `telefone_2` | varchar(50) | YES | — | — | — | — |
| `email_dep` | varchar(255) | YES | — | — | — | — |
| `email_gab` | varchar(255) | YES | — | — | — | — |
| `nome_sem_acento` | varchar(255) | YES | — | — | — | — |

**Índices:**

_Nenhum índice registrado._

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `nome_parlamentar`: "Acácio Favacho"
- `partido`: "MDB"
- `uf`: "AP"
- `anexo`: "4"
- `gabinete`: "414"
- `telefone_1`: "***MASCARADO***"
- `telefone_2`: "***MASCARADO***"
- `email_dep`: "***MASCARADO***"
- `email_gab`: "***MASCARADO***"
- `nome_sem_acento`: "Acacio Favacho"
**Registro 2:**
- `nome_parlamentar`: "Adail Filho"
- `partido`: "MDB"
- `uf`: "AM"
- `anexo`: "4"
- `gabinete`: "531"
- `telefone_1`: "***MASCARADO***"
- `telefone_2`: "***MASCARADO***"
- `email_dep`: "***MASCARADO***"
- `email_gab`: "***MASCARADO***"
- `nome_sem_acento`: "Adail Filho"
**Registro 3:**
- `nome_parlamentar`: "Adilson Barroso"
- `partido`: "PL"
- `uf`: "SP"
- `anexo`: "4"
- `gabinete`: "603"
- `telefone_1`: "***MASCARADO***"
- `telefone_2`: "***MASCARADO***"
- `email_dep`: "***MASCARADO***"
- `email_gab`: "***MASCARADO***"
- `nome_sem_acento`: "Adilson Barroso"

**Referências no código (amostra):**

- `app\backend\services\deputados_local_service.py`
- `deploy\release\app\backend\services\deputados_local_service.py`


#### `tabdetalhesservico`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** MDB + MySQL (duplicata de casing)  
**Registros:** 85,660  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | int | YES | — | MUL | — | — |
| `AnoProtocoloLinkDet` | int | YES | — | MUL | — | — |
| `ElemGrafBrasao` | text | YES | — | — | — | — |
| `ElemGrafTimbre` | text | YES | — | — | — | — |
| `ElemGrafArteGab` | text | YES | — | — | — | — |
| `ElemGrafAssinatura` | text | YES | — | — | — | — |
| `ElemGrafCarimbo` | text | YES | — | — | — | — |
| `InsumosFornecidos` | text | YES | — | — | — | — |
| `MaterialFornecido` | text | YES | — | — | — | — |
| `ModeloDobra` | text | YES | — | — | — | — |
| `Fotolito` | text | YES | — | — | — | — |
| `ProvaImpressa` | text | YES | — | — | — | — |
| `TipoPublicacaoLink` | text | YES | — | MUL | — | — |
| `MaquinaLink` | text | YES | — | — | — | — |
| `Pags` | int | YES | — | — | — | — |
| `Mult4` | text | YES | — | — | — | — |
| `Tiragem` | int | YES | — | — | — | — |
| `CotaTotal` | int | YES | — | — | — | — |
| `Titulo` | text | YES | — | MUL | — | — |
| `FormatoLink` | text | YES | — | — | — | — |
| `CoeficienteA4` | double | YES | — | — | — | — |
| `PapelLink` | text | YES | — | — | — | — |
| `PapelDescricao` | text | YES | — | — | — | — |
| `FrenteVerso` | text | YES | — | — | — | — |
| `Cores` | text | YES | — | — | — | — |
| `CoresDescricao` | text | YES | — | — | — | — |
| `DescAcabamento` | text | YES | — | — | — | — |
| `Observ` | text | YES | — | — | — | — |
| `CalcPgs1` | int | YES | — | — | — | — |
| `CalcQtdCores1` | int | YES | — | — | — | — |
| `CalcCor1` | text | YES | — | — | — | — |
| `CalcPgs2` | int | YES | — | — | — | — |
| `CalcQtdCores2` | int | YES | — | — | — | — |
| `CalcCor2` | text | YES | — | — | — | — |
| `CalcPgs3` | int | YES | — | — | — | — |
| `CalcQtdCores3` | int | YES | — | — | — | — |
| `CalcCor3` | text | YES | — | — | — | — |
| `TiragemSolicitada` | int | YES | — | — | — | — |
| `ModelosArq` | int | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `ft_detalhes_produto` | Sim | FULLTEXT | TipoPublicacaoLink |
| `ft_detalhes_titulo` | Sim | FULLTEXT | Titulo |
| `idx_detalhes_join` | Sim | BTREE | NroProtocoloLinkDet, AnoProtocoloLinkDet |
| `idx_detalhes_os_link` | Sim | BTREE | AnoProtocoloLinkDet, NroProtocoloLinkDet |
| `idx_detalhes_produto_titulo` | Sim | BTREE | TipoPublicacaoLink, Titulo |
| `idx_detalhes_protocolo` | Sim | BTREE | NroProtocoloLinkDet, AnoProtocoloLinkDet |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `NroProtocoloLinkDet`: "5000"
- `AnoProtocoloLinkDet`: "2010"
- `ElemGrafBrasao`: "1"
- `ElemGrafTimbre`: "1"
- `ElemGrafArteGab`: "0"
- `ElemGrafAssinatura`: "0"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "0"
- `ModeloDobra`: "0"
- `Fotolito`: "0"
- `ProvaImpressa`: "0"
- `TipoPublicacaoLink`: "Ct Visita"
- `MaquinaLink`: "Digital Cor"
- `Pags`: "2"
- `Mult4`: "0"
- `Tiragem`: "1"
- `CotaTotal`: "2"
- `Titulo`: "Manuela D'avila"
- `FormatoLink`: "Ct Visita 50 x 90"
- `CoeficienteA4`: "12.0"
- `PapelLink`: "ap 180gr"
- `PapelDescricao`: NULL
- `FrenteVerso`: "1"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Refilar"
- `Observ`: NULL
- `CalcPgs1`: "2"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `TiragemSolicitada`: NULL
- `ModelosArq`: "1"
**Registro 2:**
- `NroProtocoloLinkDet`: "5000"
- `AnoProtocoloLinkDet`: "2009"
- `ElemGrafBrasao`: "1"
- `ElemGrafTimbre`: "1"
- `ElemGrafArteGab`: "0"
- `ElemGrafAssinatura`: "0"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "0"
- `ModeloDobra`: "0"
- `Fotolito`: "0"
- `ProvaImpressa`: "0"
- `TipoPublicacaoLink`: "Ct Visita"
- `MaquinaLink`: "Digital Cor"
- `Pags`: "2"
- `Mult4`: "0"
- `Tiragem`: "1"
- `CotaTotal`: "2"
- `Titulo`: "Manuela D'avila"
- `FormatoLink`: "Ct Visita 50 x 90"
- `CoeficienteA4`: "12.0"
- `PapelLink`: "ap 180gr"
- `PapelDescricao`: NULL
- `FrenteVerso`: "1"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Refilar"
- `Observ`: NULL
- `CalcPgs1`: "2"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `TiragemSolicitada`: NULL
- `ModelosArq`: "1"
**Registro 3:**
- `NroProtocoloLinkDet`: "5000"
- `AnoProtocoloLinkDet`: "2008"
- `ElemGrafBrasao`: "1"
- `ElemGrafTimbre`: "1"
- `ElemGrafArteGab`: "0"
- `ElemGrafAssinatura`: "0"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "0"
- `ModeloDobra`: "0"
- `Fotolito`: "0"
- `ProvaImpressa`: "0"
- `TipoPublicacaoLink`: "Ct Visita"
- `MaquinaLink`: "Digital Cor"
- `Pags`: "2"
- `Mult4`: "0"
- `Tiragem`: "1"
- `CotaTotal`: "2"
- `Titulo`: "Manuela D'avila"
- `FormatoLink`: "Ct Visita 50 x 90"
- `CoeficienteA4`: "12.0"
- `PapelLink`: "ap 180gr"
- `PapelDescricao`: NULL
- `FrenteVerso`: "1"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Refilar"
- `Observ`: NULL
- `CalcPgs1`: "2"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `TiragemSolicitada`: NULL
- `ModelosArq`: "1"

**Referências no código (amostra):**

- `app\services\sync_tables\main_monitor.py`
- `app\services\sync_tables\sagra_sync.py`
- `app\services\sync_tables\sync_os_mysql_mdb.py`
- `deploy\release\app\services\sync_tables\main_monitor.py`
- `deploy\release\app\services\sync_tables\sagra_sync.py`
- `deploy\release\app\services\sync_tables\sync_os_mysql_mdb.py`


#### `tabprotocolos`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** MDB + MySQL (duplicata de casing)  
**Registros:** 84,083  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `NroProtocolo` | int | YES | — | MUL | — | — |
| `AnoProtocolo` | int | YES | — | MUL | — | — |
| `DataEntrada` | date | YES | — | — | — | — |
| `ProcessoSolicit` | text | YES | — | — | — | — |
| `CSnro` | text | YES | — | — | — | — |
| `CategoriaLink` | text | YES | — | — | — | — |
| `CodUsuarioLink` | text | YES | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — |
| `NomeUsuario` | text | YES | — | MUL | — | — |
| `Solicitante` | text | YES | — | — | — | — |
| `OrgInteressado` | text | YES | — | — | — | — |
| `SiglaOrgao` | text | YES | — | — | — | — |
| `Titular` | text | YES | — | — | — | — |
| `GabSalaUsuario` | text | YES | — | — | — | — |
| `Localizacao` | text | YES | — | — | — | — |
| `Andar` | text | YES | — | — | — | — |
| `RamalUsuario` | int | YES | — | — | — | — |
| `ContatoTrab` | text | YES | — | — | — | — |
| `ResponsavelGrafLink` | text | YES | — | — | — | — |
| `EntregaFormaLink` | text | YES | — | — | — | — |
| `EntregPrazoLink` | text | YES | — | — | — | — |
| `EntregData` | date | YES | — | MUL | — | — |
| `EntregPeriodo` | text | YES | — | — | — | — |
| `ReqLançada` | text | YES | — | — | — | — |
| `ReqEntregue` | text | YES | — | — | — | — |
| `DataConclusao` | text | YES | — | — | — | — |
| `ArmazenadoEm` | text | YES | — | — | — | — |
| `ContatoRecebim` | text | YES | — | — | — | — |
| `RetiradaNome` | text | YES | — | — | — | — |
| `RetiradaPonto` | text | YES | — | — | — | — |
| `RecebimData` | text | YES | — | — | — | — |
| `PontoEntrega` | text | YES | — | — | — | — |
| `SetorEntrega` | text | YES | — | — | — | — |
| `CancelamentoMotivo` | text | YES | — | — | — | — |
| `CancelamentoPonto` | text | YES | — | — | — | — |
| `CancelamentoData` | text | YES | — | — | — | — |
| `CancelamentoSetor` | text | YES | — | — | — | — |
| `CotaRepro` | int | YES | — | — | — | — |
| `CotaCartao` | int | YES | — | — | — | — |
| `ReimprimirOS` | text | YES | — | — | — | — |
| `DebitarCGRAF` | text | YES | — | — | — | — |
| `email_pt_html` | text | YES | — | — | — | — |
| `email_pt_versao` | varchar(50) | YES | — | — | — | — |
| `email_pt_data` | timestamp | YES | — | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `ft_protocolos_solicitante` | Sim | FULLTEXT | NomeUsuario |
| `idx_proto_unique` | Não | BTREE | NroProtocolo, AnoProtocolo |
| `idx_protocolos_ano_nro` | Sim | BTREE | AnoProtocolo, NroProtocolo |
| `idx_protocolos_data_prioridade` | Sim | BTREE | EntregData, EntregPrazoLink, AnoProtocolo, NroProtocolo |
| `idx_protocolos_search_sort` | Sim | BTREE | EntregData, AnoProtocolo, NroProtocolo |
| `idx_protocolos_solicitante` | Sim | BTREE | NomeUsuario |
| `idx_protocolos_sort_date` | Sim | BTREE | EntregData, DataEntrada, AnoProtocolo, NroProtocolo |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `NroProtocolo`: "5170"
- `AnoProtocolo`: "2022"
- `DataEntrada`: "2022-03-10"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-00940"
- `CodigoRequisic`: "30045"
- `NomeUsuario`: "BILAC PINTO"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "806"
- `Localizacao`: "Anexo IV"
- `Andar`: "8"
- `RamalUsuario`: "55806"
- `ContatoTrab`: "Silvaninha P_120819"
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "1"
- `ReqEntregue`: "0"
- `DataConclusao`: "2022-03-14 00:00:00"
- `ArmazenadoEm`: "e"
- `ContatoRecebim`: "Silvaninha"
- `RetiradaNome`: "Silvana"
- `RetiradaPonto`: "120.819"
- `RecebimData`: "2022-03-14 00:00:00"
- `PontoEntrega`: "882.215"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "400"
- `CotaCartao`: NULL
- `ReimprimirOS`: "0"
- `DebitarCGRAF`: "1"
- `email_pt_html`: NULL
- `email_pt_versao`: NULL
- `email_pt_data`: NULL
**Registro 2:**
- `NroProtocolo`: "5171"
- `AnoProtocolo`: "2020"
- `DataEntrada`: "2020-02-12"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-01771"
- `CodigoRequisic`: "31158"
- `NomeUsuario`: "CAPITAO DERRITE"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "639"
- `Localizacao`: "Anexo IV"
- `Andar`: "6"
- `RamalUsuario`: "55639"
- `ContatoTrab`: "prova para\r\nluis.araujo@camara.leg.br"
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "1"
- `ReqEntregue`: "0"
- `DataConclusao`: "2020-02-27 00:00:00"
- `ArmazenadoEm`: "e"
- `ContatoRecebim`: "Karine"
- `RetiradaNome`: "Moreira"
- `RetiradaPonto`: "266.079"
- `RecebimData`: "2020-03-02 00:00:00"
- `PontoEntrega`: "6.352"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "500"
- `CotaCartao`: NULL
- `ReimprimirOS`: "0"
- `DebitarCGRAF`: "1"
- `email_pt_html`: NULL
- `email_pt_versao`: NULL
- `email_pt_data`: NULL
**Registro 3:**
- `NroProtocolo`: "5171"
- `AnoProtocolo`: "2021"
- `DataEntrada`: "2021-02-09"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-00295"
- `CodigoRequisic`: "15168"
- `NomeUsuario`: "GASTAO VIEIRA"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "372"
- `Localizacao`: "Anexo III"
- `Andar`: "3"
- `RamalUsuario`: "55372"
- `ContatoTrab`: NULL
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR III"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "1"
- `ReqEntregue`: "0"
- `DataConclusao`: "2021-03-16 00:00:00"
- `ArmazenadoEm`: "E"
- `ContatoRecebim`: NULL
- `RetiradaNome`: "VALDERI"
- `RetiradaPonto`: "204.621"
- `RecebimData`: "2021-07-15 00:00:00"
- `PontoEntrega`: "881.985"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "1500"
- `CotaCartao`: NULL
- `ReimprimirOS`: "0"
- `DebitarCGRAF`: "1"
- `email_pt_html`: NULL
- `email_pt_versao`: NULL
- `email_pt_data`: NULL

**Referências no código (amostra):**

- `app\backend\routers\auxiliar_routes.py`
- `app\services\sync_tables\main_monitor.py`
- `app\services\sync_tables\sagra_sync.py`
- `app\services\sync_tables\sync_access_mysql - Copia.py`
- `app\services\sync_tables\sync_access_mysql.py`
- `app\services\sync_tables\sync_os_mysql_mdb.py`
- `deploy\release\app\backend\routers\auxiliar_routes.py`
- `deploy\release\app\services\sync_tables\main_monitor.py`
- `deploy\release\app\services\sync_tables\sagra_sync.py`
- `deploy\release\app\services\sync_tables\sync_access_mysql - Copia.py`
- `deploy\release\app\services\sync_tables\sync_access_mysql.py`
- `deploy\release\app\services\sync_tables\sync_os_mysql_mdb.py`


#### `user_permissions`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 8  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `Ponto` | int | NO | — | PRI | — | — |
| `ctx_nova_os` | tinyint(1) | YES | 0 | — | — | — |
| `ctx_duplicar_os` | tinyint(1) | YES | 0 | — | — | — |
| `ctx_editar_os` | tinyint(1) | YES | 0 | — | — | — |
| `ctx_vincular_os` | tinyint(1) | YES | 0 | — | — | — |
| `ctx_abrir_pasta` | tinyint(1) | YES | 0 | — | — | — |
| `ctx_imprimir_ficha` | tinyint(1) | YES | 0 | — | — | — |
| `ctx_detalhes_os` | tinyint(1) | YES | 0 | — | — | — |
| `sb_inicio` | tinyint(1) | YES | 0 | — | — | — |
| `sb_gerencia` | tinyint(1) | YES | 0 | — | — | — |
| `sb_email` | tinyint(1) | YES | 0 | — | — | — |
| `sb_analise` | tinyint(1) | YES | 0 | — | — | — |
| `sb_papelaria` | tinyint(1) | YES | 0 | — | — | — |
| `sb_usuario` | tinyint(1) | YES | 0 | — | — | — |
| `sb_configuracoes` | tinyint(1) | YES | 0 | — | — | — |
| `sb_relatorio` | tinyint(1) | YES | 0 | — | — | — |
| `sb_dashboard_setor` | tinyint(1) | YES | 0 | — | — | — |
| `sb_admin_ips` | tinyint(1) | YES | 0 | — | — | — |
| `sb_pcp` | tinyint(1) | YES | 0 | — | — | — |
| `sb_usuarios` | tinyint(1) | YES | 0 | — | — | — |
| `sb_active_computers` | tinyint(1) | YES | 0 | — | — | — |
| `sb_gravacao` | tinyint(1) | YES | 0 | — | — | — |
| `created_at` | timestamp | YES | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |
| `updated_at` | timestamp | YES | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED on update CURRENT_TIMESTAMP | — |
| `sb_dashboard_global` | tinyint(1) | NO | 0 | — | — | — |
| `painel_setores` | json | YES | — | — | — | — |
| `ctx_mover_pastas` | tinyint(1) | YES | 0 | — | — | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | Ponto |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `Ponto`: "6231"
- `ctx_nova_os`: "1"
- `ctx_duplicar_os`: "1"
- `ctx_editar_os`: "1"
- `ctx_vincular_os`: "1"
- `ctx_abrir_pasta`: "1"
- `ctx_imprimir_ficha`: "1"
- `ctx_detalhes_os`: "1"
- `sb_inicio`: "1"
- `sb_gerencia`: "1"
- `sb_email`: "***MASCARADO***"
- `sb_analise`: "1"
- `sb_papelaria`: "0"
- `sb_usuario`: "0"
- `sb_configuracoes`: "1"
- `sb_relatorio`: "1"
- `sb_dashboard_setor`: "0"
- `sb_admin_ips`: "0"
- `sb_pcp`: "0"
- `sb_usuarios`: "0"
- `sb_active_computers`: "0"
- `sb_gravacao`: "0"
- `created_at`: "2026-06-09 16:12:42"
- `updated_at`: "2026-06-12 17:16:01"
- `sb_dashboard_global`: "1"
- `painel_setores`: "[]"
- `ctx_mover_pastas`: "1"
**Registro 2:**
- `Ponto`: "881480"
- `ctx_nova_os`: "0"
- `ctx_duplicar_os`: "0"
- `ctx_editar_os`: "0"
- `ctx_vincular_os`: "0"
- `ctx_abrir_pasta`: "1"
- `ctx_imprimir_ficha`: "1"
- `ctx_detalhes_os`: "1"
- `sb_inicio`: "1"
- `sb_gerencia`: "1"
- `sb_email`: "***MASCARADO***"
- `sb_analise`: "0"
- `sb_papelaria`: "0"
- `sb_usuario`: "1"
- `sb_configuracoes`: "1"
- `sb_relatorio`: "0"
- `sb_dashboard_setor`: "1"
- `sb_admin_ips`: "0"
- `sb_pcp`: "0"
- `sb_usuarios`: "0"
- `sb_active_computers`: "0"
- `sb_gravacao`: "0"
- `created_at`: "2026-06-03 14:40:47"
- `updated_at`: "2026-06-10 10:04:28"
- `sb_dashboard_global`: "0"
- `painel_setores`: "[\"SEFOC\"]"
- `ctx_mover_pastas`: "0"
**Registro 3:**
- `Ponto`: "881481"
- `ctx_nova_os`: "0"
- `ctx_duplicar_os`: "0"
- `ctx_editar_os`: "1"
- `ctx_vincular_os`: "0"
- `ctx_abrir_pasta`: "1"
- `ctx_imprimir_ficha`: "1"
- `ctx_detalhes_os`: "1"
- `sb_inicio`: "1"
- `sb_gerencia`: "1"
- `sb_email`: "***MASCARADO***"
- `sb_analise`: "0"
- `sb_papelaria`: "1"
- `sb_usuario`: "1"
- `sb_configuracoes`: "1"
- `sb_relatorio`: "0"
- `sb_dashboard_setor`: "1"
- `sb_admin_ips`: "0"
- `sb_pcp`: "0"
- `sb_usuarios`: "0"
- `sb_active_computers`: "0"
- `sb_gravacao`: "0"
- `created_at`: "2026-06-12 16:15:19"
- `updated_at`: "2026-06-12 16:15:56"
- `sb_dashboard_global`: "0"
- `painel_setores`: "[\"SEFOC\"]"
- `ctx_mover_pastas`: "1"

**Referências no código (amostra):**

- `app\backend\routers\admin_system_routes.py`
- `app\backend\routers\ip_admin_routes.py`
- `app\backend\routers\papelaria_routes.py`
- `app\backend\routers\user_admin_routes.py`
- `app\backend\security\api_auth.py`
- `app\backend\security\public_access.py`
- `app\backend\security\spa_access.py`
- `app\backend\security\user_permissions.py`
- `app\backend\services\support_settings.py`
- `app\backend\setor_painel_schema.py`
- `app\backend\tests\conftest.py`
- `app\backend\tests\test_api_access_middleware.py`
- `app\backend\user_auth_schema.py`
- `deploy\release\app\backend\routers\admin_system_routes.py`
- `deploy\release\app\backend\routers\ip_admin_routes.py`


#### `user_registered_ips`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Registros:** 7  

**Colunas:**

| Campo | Tipo | Null | Default | Chave | Extra | Comentário |
|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | auto_increment | — |
| `Ponto` | int | NO | — | MUL | — | — |
| `ip` | varchar(45) | NO | — | MUL | — | — |
| `descricao` | varchar(255) | YES | — | — | — | — |
| `created_at` | timestamp | YES | CURRENT_TIMESTAMP | — | DEFAULT_GENERATED | — |

**Índices:**

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | id |
| `idx_user_registered_ips_ip` | Sim | BTREE | ip |
| `idx_user_registered_ips_ponto` | Sim | BTREE | Ponto |
| `uq_user_registered_ips_ponto_ip` | Não | BTREE | Ponto, ip |

**Foreign keys:**

_Nenhuma foreign key declarada._

**Amostra (dados sensíveis mascarados):**

**Registro 1:**
- `id`: "1"
- `Ponto`: "6231"
- `ip`: "10.120.1.8"
- `descricao`: NULL
- `created_at`: "2026-06-12 16:33:00"
**Registro 2:**
- `id`: "2"
- `Ponto`: "922177"
- `ip`: "10.120.1.7"
- `descricao`: NULL
- `created_at`: "2026-06-12 17:13:15"
**Registro 3:**
- `id`: "3"
- `Ponto`: "882280"
- `ip`: "10.120.1.144"
- `descricao`: NULL
- `created_at`: "2026-06-12 17:13:37"

**Referências no código (amostra):**

- `app\backend\routers\api.py`
- `app\backend\services\user_registered_ips_service.py`
- `app\backend\user_registered_ips_schema.py`
- `deploy\release\app\backend\routers\api.py`
- `deploy\release\app\backend\services\user_registered_ips_service.py`
- `deploy\release\app\backend\user_registered_ips_schema.py`


---

## 4. Estrutura MDB/Access


**OS Atual vs Papelaria Atual:** 42 tabelas em comum, 4 só em OS, 3 só em Papelaria.

### 4.0 Tabelas core — comparativo MDB vs MySQL

| Tabela | OS Atual (MDB) | Papelaria Atual (MDB) | MySQL `sagrafulldb` |
|---|---:|---:|---:|
| Protocolos | 5.646 | 4.098 | 84.083 (`tabprotocolos`) |
| Detalhes serviço | 5.646 | 4.065 | 85.660 (`tabdetalhesservico`) |
| Andamentos | 73.963 | 50.697 | 199.180 (`tabandamento`) |

**Nota:** O MySQL contém histórico consolidado (inclui anos anteriores e ambos os MDBs). Os MDBs "Atual" contêm apenas o recorte operacional corrente. O sync filtra `AnoProtocoloLink >= 2024` para andamentos.

**Limitação ODBC:** Metadados de colunas de `tabProtocolos` no MDB retornaram vazio via `cursor.columns()` e falha `UnicodeDecodeError` em leitura direta — provável encoding interno Access. Contagens (`COUNT(*)`) funcionaram. Schema inferido a partir do MySQL espelho e do código `mdb_writer.py` / `sync_andamentos_v2.py`.

**Tabelas exclusivas OS Atual:** `tabDeputados-Old 2013`, `tabDeputados-old 2014`, `tabExportarProtocoloAnoAnterior`, `tabSelecionados`

**Tabelas exclusivas Papelaria Atual:** `_tabDeputados-NovaLista`, `tabDeputados - old`, `tabTemporario`

### 4.1 OS Atual

- **Caminho:** `\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb`
- **Tamanho:** 70.41 MB (73,830,400 bytes)
- **Modificação:** 2026-06-12T18:58:44.955206

| Tabela | Registros | Colunas |
|---|---:|---:|
| `tabAndamento` | 73963 | 7 |
| `tabLogFichaOS` | 38016 | 1 |
| `tabLogChecklist` | 13968 | 1 |
| `tabDetalhesServico` | 5646 | 7 |
| `tabProtocolos` | 5646 | 0 |
| `tabExportarProtocoloAnoAnterior` | 2876 | 41 |
| `tabMidiaDigital` | 1873 | 2 |
| `tabDeputados-old 2014` | 1416 | 2 |
| `tabDeputados-Old 2013` | 1199 | 2 |
| `_Plan1` | 513 | 9 |
| `tabLogCodRS` | 446 | 4 |
| `tabOrgaos` | 215 | 9 |
| `tabTipoPubModelos` | 61 | 3 |
| `tabPapel` | 37 | 10 |
| `tabSituacao` | 34 | 3 |
| `tabMaquinas` | 27 | 2 |
| `tabFormatos` | 26 | 4 |
| `tabSetor` | 20 | 3 |
| `tabRespGraf` | 15 | 2 |
| `tabSituacao-old` | 13 | 3 |
| `tabEntregaForma` | 12 | 2 |
| `tabLegs` | 12 | 3 |
| `tabMesa` | 12 | 0 |
| `Erros ao colar` | 11 | 3 |
| `tabTipoMidiaDigital` | 10 | 0 |
| `tabMotivoAfastamento` | 9 | 1 |
| `tabCores` | 8 | 2 |
| `TabAnd3aItensDescCompleta` | 5 | 2 |
| `tabFormatoImpressao` | 4 | 3 |
| `_tabChecagemInicial` | 3 | 0 |
| `apagar-Debitos` | 3 | 3 |
| `apagar-tabTipoCota` | 3 | 1 |
| `apagar-tabTipoCota1` | 3 | 1 |
| `tabAnd1aTiposDePend` | 3 | 2 |
| `tabCategorias` | 3 | 1 |
| `tabEntregaPrazo` | 3 | 2 |
| `apagar-Creditos` | 2 | 3 |
| `TabAnd3DescricaoCompleta` | 2 | 0 |
| `tabProtocolosBloqueados` | 2 | 0 |
| `tabIndicadores` | 1 | 11 |
| `_tabOpenForm` | 0 | 0 |
| `tabAnd1TipoPend` | 0 | 1 |
| `tabAnd2Contatos` | 0 | 0 |
| `tabLocalMidia` | 0 | 3 |
| `tabMaterialEntregue` | 0 | 5 |
| `tabSelecionados` | 0 | 2 |

#### MDB `tabProtocolos` (OS Atual)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|

**Amostra:**

**Registro 1:**
- `NroProtocolo`: "7"
- `AnoProtocolo`: "2026"
- `DataEntrada`: "2026-01-05 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-02145"
- `CodigoRequisic`: ""
- `NomeUsuario`: "LEO PRATES"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "646"
- `Localizacao`: ""
- `Andar`: ""
- `RamalUsuario`: "55646"
- `ContatoTrab`: "Ana Julia/ Silvana\r\nR: 61-982660198"
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "False"
- `DataConclusao`: NULL
- `ArmazenadoEm`: NULL
- `ContatoRecebim`: NULL
- `RetiradaNome`: "Silvana"
- `RetiradaPonto`: "214.039"
- `RecebimData`: "2026-01-19 00:00:00"
- `PontoEntrega`: "920.105"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "80000"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "False"
**Registro 2:**
- `NroProtocolo`: "8"
- `AnoProtocolo`: "2026"
- `DataEntrada`: "2026-01-05 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Orgao"
- `CodUsuarioLink`: "Org-00117"
- `CodigoRequisic`: "20783"
- `NomeUsuario`: "Depart. de Polícia Legislativa"
- `Solicitante`: NULL
- `OrgInteressado`: "Coord. de Apoio Logístico - DEPOL"
- `SiglaOrgao`: "DEPOL"
- `Titular`: ""
- `GabSalaUsuario`: ""
- `Localizacao`: ""
- `Andar`: ""
- `RamalUsuario`: "62800"
- `ContatoTrab`: "Adriana / Cibele / Fernando / André Luiz\r\nsetid.depol@camara.leg.br\r\n6-2908, 6-2909, 6-2816 ou 6-2912\r\nDandara 6-2909"
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "False"
- `DataConclusao`: NULL
- `ArmazenadoEm`: NULL
- `ContatoRecebim`: NULL
- `RetiradaNome`: "Victor"
- `RetiradaPonto`: "922.264"
- `RecebimData`: "2026-01-06 00:00:00"
- `PontoEntrega`: "9.129.789"
- `SetorEntrega`: "Expedição"
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "4"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "True"
**Registro 3:**
- `NroProtocolo`: "9"
- `AnoProtocolo`: "2026"
- `DataEntrada`: "2026-01-05 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-01016"
- `CodigoRequisic`: "30120"
- `NomeUsuario`: "JILMAR TATTO"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: ""
- `Titular`: ""
- `GabSalaUsuario`: "548"
- `Localizacao`: "Anexo IV"
- `Andar`: "5"
- `RamalUsuario`: "55548"
- `ContatoTrab`: "Rubervon  99608-6838\r\n\r\nrubervon@gmail.com"
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "False"
- `DataConclusao`: NULL
- `ArmazenadoEm`: NULL
- `ContatoRecebim`: NULL
- `RetiradaNome`: "Fátima"
- `RetiradaPonto`: "161.290"
- `RecebimData`: "2026-01-15 00:00:00"
- `PontoEntrega`: "920.105"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "119925"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "False"

#### MDB `tabDetalhesServico` (OS Atual)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|
| `NroProtocoloLinkDet` | INTEGER | 10 | Sim |
| `AnoProtocoloLinkDet` | INTEGER | 10 | Sim |
| `ElemGrafBrasao` | BIT | 1 | Não |
| `ElemGrafTimbre` | BIT | 1 | Não |
| `ElemGrafArteGab` | BIT | 1 | Não |
| `ElemGrafAssinatura` | BIT | 1 | Não |
| `ElemGrafCarimbo` | VARCHAR | 50 | Sim |

**Amostra:**

**Registro 1:**
- `NroProtocoloLinkDet`: "7"
- `AnoProtocoloLinkDet`: "2026"
- `ElemGrafBrasao`: "False"
- `ElemGrafTimbre`: "False"
- `ElemGrafArteGab`: "True"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: "Arquivo na pasta"
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "False"
- `TipoPublicacaoLink`: "Revista c/ Capa"
- `MaquinaLink`: "Komori"
- `Pags`: "20"
- `Mult4`: "True"
- `Tiragem`: "1000"
- `CotaTotal`: "80000"
- `Titulo`: "Prestaçao de Contas"
- `FormatoLink`: "A4"
- `CoeficienteA4`: "1.0"
- `PapelLink`: "Diversos"
- `PapelDescricao`: "Capa: CF 115g\r\nMiolo: AP 90g"
- `FrenteVerso`: "True"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Dobra\r\nGrampo Canoa\r\nRefile"
- `Observ`: "Repetição da OS 2282/25\r\n-------"
- `CalcPgs1`: "20"
- `CalcQtdCores1`: "4"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: NULL
- `CalcQtdCores2`: NULL
- `CalcCor2`: NULL
- `CalcPgs3`: NULL
- `CalcQtdCores3`: NULL
- `CalcCor3`: NULL
- `TiragemSolicitada`: NULL
- `ModelosArq`: "1"
**Registro 2:**
- `NroProtocoloLinkDet`: "8"
- `AnoProtocoloLinkDet`: "2026"
- `ElemGrafBrasao`: "False"
- `ElemGrafTimbre`: "False"
- `ElemGrafArteGab`: "True"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "False"
- `TipoPublicacaoLink`: "Crachá"
- `MaquinaLink`: "Digital Cor/PB"
- `Pags`: "2"
- `Mult4`: "False"
- `Tiragem`: "1"
- `CotaTotal`: "4"
- `Titulo`: "Credencial de Veiculos Varios modelos"
- `FormatoLink`: "Crachá 75 x 110"
- `CoeficienteA4`: "7.570000171661377"
- `PapelLink`: "Couché Fosco 250gr"
- `PapelDescricao`: "Imprimir em A4>"
- `FrenteVerso`: "True"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "- Laminaçao Fosca F/V\r\n- Refile\r\n\r\nObs. Náo será mais feita a plastificação rígida pelo Depol."
- `Observ`: NULL
- `CalcPgs1`: "2"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Cor"
- `CalcPgs2`: NULL
- `CalcQtdCores2`: NULL
- `CalcCor2`: NULL
- `CalcPgs3`: NULL
- `CalcQtdCores3`: NULL
- `CalcCor3`: NULL
- `TiragemSolicitada`: NULL
- `ModelosArq`: "12"
**Registro 3:**
- `NroProtocoloLinkDet`: "9"
- `AnoProtocoloLinkDet`: "2026"
- `ElemGrafBrasao`: "False"
- `ElemGrafTimbre`: "False"
- `ElemGrafArteGab`: "True"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: "Arquivo na pasta"
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "False"
- `TipoPublicacaoLink`: "Livreto c/ Capa"
- `MaquinaLink`: "Komori"
- `Pags`: "24"
- `Mult4`: "True"
- `Tiragem`: "2665"
- `CotaTotal`: "119925"
- `Titulo`: "Tarifa Zero"
- `FormatoLink`: "A5"
- `CoeficienteA4`: "2.0"
- `PapelLink`: "Diversos"
- `PapelDescricao`: "Capa: CF 115g\r\nMiolo: AP 90g"
- `FrenteVerso`: "True"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "- Dobra\r\n- Grampo Canoa\r\n- Refile"
- `Observ`: "Repetição da OS 2194/25\r\n-------"
- `CalcPgs1`: "22"
- `CalcQtdCores1`: "4"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "2"
- `CalcQtdCores2`: "1"
- `CalcCor2`: "PB"
- `CalcPgs3`: NULL
- `CalcQtdCores3`: NULL
- `CalcCor3`: NULL
- `TiragemSolicitada`: NULL
- `ModelosArq`: "1"

#### MDB `tabAndamento` (OS Atual)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|
| `CodStatus` | VARCHAR | 12 | Sim |
| `NroProtocoloLink` | INTEGER | 10 | Sim |
| `AnoProtocoloLink` | INTEGER | 10 | Sim |
| `SituacaoLink` | VARCHAR | 50 | Sim |
| `SetorLink` | VARCHAR | 20 | Sim |
| `Data` | DATETIME | 19 | Sim |
| `UltimoStatus` | BIT | 1 | Não |

**Amostra:**

**Registro 1:**
- `CodStatus`: "000022024-01"
- `NroProtocoloLink`: "2"
- `AnoProtocoloLink`: "2024"
- `SituacaoLink`: "Entrada Inicial"
- `SetorLink`: "SIELT"
- `Data`: "2024-01-04 00:00:00"
- `UltimoStatus`: "False"
- `Observaçao`: "10h29\r\nOS aberta a pedido do diretor da gráfica"
- `Ponto`: "881.477"
**Registro 2:**
- `CodStatus`: "000022024-02"
- `NroProtocoloLink`: "2"
- `AnoProtocoloLink`: "2024"
- `SituacaoLink`: "Saída p/"
- `SetorLink`: "SEFOC"
- `Data`: "2024-01-04 00:00:00"
- `UltimoStatus`: "False"
- `Observaçao`: "10h35"
- `Ponto`: "881.477"
**Registro 3:**
- `CodStatus`: "000022024-03"
- `NroProtocoloLink`: "2"
- `AnoProtocoloLink`: "2024"
- `SituacaoLink`: "Comentário"
- `SetorLink`: "SEFOC"
- `Data`: "2024-01-04 00:00:00"
- `UltimoStatus`: "False"
- `Observaçao`: "10h43\r\nAssim que arquivo estiver na pasta atualizar dados do SAGRA."
- `Ponto`: "888.240"

### 4.2 Papelaria Atual

- **Caminho:** `\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb`
- **Tamanho:** 89.22 MB (93,556,736 bytes)
- **Modificação:** 2026-06-12T18:15:57.529292

| Tabela | Registros | Colunas |
|---|---:|---:|
| `tabAndamento` | 50697 | 7 |
| `tabLogFichaOS` | 19180 | 1 |
| `tabLogChecklist` | 9879 | 1 |
| `tabProtocolos` | 4098 | 0 |
| `tabDetalhesServico` | 4065 | 7 |
| `tabDeputados - old` | 1199 | 2 |
| `_Plan1` | 513 | 9 |
| `tabLogCodRS` | 446 | 4 |
| `tabOrgaos` | 210 | 9 |
| `tabTipoPubModelos` | 61 | 2 |
| `tabPapel` | 37 | 10 |
| `tabSituacao` | 34 | 3 |
| `tabMaquinas` | 25 | 2 |
| `tabFormatos` | 24 | 4 |
| `tabSetor` | 20 | 3 |
| `tabRespGraf` | 15 | 2 |
| `tabMesa` | 13 | 0 |
| `tabSituacao-old` | 13 | 3 |
| `tabEntregaForma` | 12 | 2 |
| `tabLegs` | 12 | 3 |
| `tabTipoMidiaDigital` | 10 | 0 |
| `tabMotivoAfastamento` | 9 | 1 |
| `tabCores` | 7 | 2 |
| `tabTemporario` | 6 | 12 |
| `Erros ao colar` | 5 | 39 |
| `TabAnd3aItensDescCompleta` | 5 | 2 |
| `TabAnd3DescricaoCompleta` | 4 | 0 |
| `tabFormatoImpressao` | 4 | 3 |
| `_tabChecagemInicial` | 3 | 0 |
| `apagar-Debitos` | 3 | 3 |
| `apagar-tabTipoCota` | 3 | 1 |
| `apagar-tabTipoCota1` | 3 | 1 |
| `tabAnd1aTiposDePend` | 3 | 2 |
| `tabCategorias` | 3 | 1 |
| `tabEntregaPrazo` | 3 | 2 |
| `apagar-Creditos` | 2 | 3 |
| `tabProtocolosBloqueados` | 2 | 0 |
| `tabIndicadores` | 1 | 11 |
| `_tabDeputados-NovaLista` | 0 | 2 |
| `_tabOpenForm` | 0 | 0 |
| `tabAnd1TipoPend` | 0 | 1 |
| `tabAnd2Contatos` | 0 | 0 |
| `tabLocalMidia` | 0 | 3 |
| `tabMaterialEntregue` | 0 | 5 |
| `tabMidiaDigital` | 0 | 2 |

#### MDB `tabProtocolos` (Papelaria Atual)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|

**Amostra:**

**Registro 1:**
- `NroProtocolo`: "5481"
- `AnoProtocolo`: "2025"
- `DataEntrada`: "2025-03-31 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-00309"
- `CodigoRequisic`: "17807"
- `NomeUsuario`: "GIACOBO"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "629"
- `Localizacao`: "Anexo IV"
- `Andar`: "7"
- `RamalUsuario`: "55629"
- `ContatoTrab`: NULL
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "False"
- `DataConclusao`: NULL
- `ArmazenadoEm`: NULL
- `ContatoRecebim`: NULL
- `RetiradaNome`: "EDILSON"
- `RetiradaPonto`: "226.937"
- `RecebimData`: "2025-04-02 00:00:00"
- `PontoEntrega`: "920.105"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "20"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "True"
**Registro 2:**
- `NroProtocolo`: "5482"
- `AnoProtocolo`: "2025"
- `DataEntrada`: "2025-03-31 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-00237"
- `CodigoRequisic`: "19129"
- `NomeUsuario`: "ELCIONE BARBALHO"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "216"
- `Localizacao`: "Anexo IV"
- `Andar`: "2"
- `RamalUsuario`: "55216"
- `ContatoTrab`: NULL
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "False"
- `DataConclusao`: NULL
- `ArmazenadoEm`: NULL
- `ContatoRecebim`: NULL
- `RetiradaNome`: "PABLO"
- `RetiradaPonto`: "270.418"
- `RecebimData`: "2025-04-01 00:00:00"
- `PontoEntrega`: "920.195"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "50"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "True"
**Registro 3:**
- `NroProtocolo`: "5483"
- `AnoProtocolo`: "2025"
- `DataEntrada`: "2025-03-31 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-01326"
- `CodigoRequisic`: "30466"
- `NomeUsuario`: "MISSIONARIO JOSE OLIMPIO"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "785"
- `Localizacao`: "Anexo III"
- `Andar`: ""
- `RamalUsuario`: "55785"
- `ContatoTrab`: NULL
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR III"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "False"
- `DataConclusao`: NULL
- `ArmazenadoEm`: NULL
- `ContatoRecebim`: NULL
- `RetiradaNome`: "Lucimar"
- `RetiradaPonto`: "151.383"
- `RecebimData`: "2025-04-02 00:00:00"
- `PontoEntrega`: "888.432"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "100"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "True"

#### MDB `tabDetalhesServico` (Papelaria Atual)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|
| `NroProtocoloLinkDet` | INTEGER | 10 | Sim |
| `AnoProtocoloLinkDet` | INTEGER | 10 | Sim |
| `ElemGrafBrasao` | BIT | 1 | Não |
| `ElemGrafTimbre` | BIT | 1 | Não |
| `ElemGrafArteGab` | BIT | 1 | Não |
| `ElemGrafAssinatura` | BIT | 1 | Não |
| `ElemGrafCarimbo` | VARCHAR | 50 | Sim |

**Amostra:**

**Registro 1:**
- `NroProtocoloLinkDet`: "5121"
- `AnoProtocoloLinkDet`: "2025"
- `ElemGrafBrasao`: "True"
- `ElemGrafTimbre`: "True"
- `ElemGrafArteGab`: "False"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "False"
- `TipoPublicacaoLink`: "Ct Visita"
- `MaquinaLink`: "Digital Cor"
- `Pags`: "2"
- `Mult4`: "False"
- `Tiragem`: "250"
- `TiragemSolicitada`: NULL
- `CotaTotal`: "50"
- `Titulo`: "Pastor Claudio Mariano"
- `FormatoLink`: "Ct Visita2 50 x 85"
- `CoeficienteA4`: "10.0"
- `PapelLink`: "Couché Fosco 300gr"
- `PapelDescricao`: NULL
- `FrenteVerso`: "True"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Refile"
- `Observ`: "Partido: UNIÃO - PA\r\nE-mail: dep.pastorclaudiomariano@camara.leg.br\r\nTelefone: (61) 3215-5236\r\nEndereço: Gabinete 236..."
- `CalcPgs1`: "2"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `ModelosArq`: "1"
**Registro 2:**
- `NroProtocoloLinkDet`: "5122"
- `AnoProtocoloLinkDet`: "2025"
- `ElemGrafBrasao`: "True"
- `ElemGrafTimbre`: "True"
- `ElemGrafArteGab`: "False"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "False"
- `TipoPublicacaoLink`: "Ct Visita"
- `MaquinaLink`: "Digital Cor"
- `Pags`: "2"
- `Mult4`: "False"
- `Tiragem`: "300"
- `TiragemSolicitada`: NULL
- `CotaTotal`: "60"
- `Titulo`: "Rodolfo Nogueira"
- `FormatoLink`: "Ct Visita2 50 x 85"
- `CoeficienteA4`: "10.0"
- `PapelLink`: "Couché Fosco 300gr"
- `PapelDescricao`: NULL
- `FrenteVerso`: "True"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Refile"
- `Observ`: "Partido: PL - MS\r\nE-mail: dep.rodolfonogueira@camara.leg.br\r\nTelefone: (61) 3215-5776\r\nEndereço: Gabinete 776 - Anexo..."
- `CalcPgs1`: "2"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `ModelosArq`: "1"
**Registro 3:**
- `NroProtocoloLinkDet`: "5123"
- `AnoProtocoloLinkDet`: "2025"
- `ElemGrafBrasao`: "True"
- `ElemGrafTimbre`: "True"
- `ElemGrafArteGab`: "False"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "False"
- `TipoPublicacaoLink`: "Pasta Avulso c/ Bolso"
- `MaquinaLink`: "Digital PB"
- `Pags`: "1"
- `Mult4`: "False"
- `Tiragem`: "100"
- `TiragemSolicitada`: NULL
- `CotaTotal`: "400"
- `Titulo`: "Elmar Nascimento"
- `FormatoLink`: "Pasta c/ Bolso 470 x 440"
- `CoeficienteA4`: "0.25"
- `PapelLink`: "Diversos"
- `PapelDescricao`: "Pasta: ap 240g\r\nBolso: ap 180g"
- `FrenteVerso`: "False"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "- Laminação Brilho na Frente \r\n- Refile\r\n- Dobra ao meio\r\n- Colagem do Bolso"
- `Observ`: "Partido: UNIÃO - BA\r\nE-mail: dep.elmarnascimento@camara.leg.br\r\nTelefone: (61) 3215-5332\r\nEndereço: Gabinete 332 - An..."
- `CalcPgs1`: "1"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `ModelosArq`: "1"

#### MDB `tabAndamento` (Papelaria Atual)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|
| `CodStatus` | VARCHAR | 12 | Sim |
| `NroProtocoloLink` | INTEGER | 10 | Sim |
| `AnoProtocoloLink` | INTEGER | 10 | Sim |
| `SituacaoLink` | VARCHAR | 50 | Sim |
| `SetorLink` | VARCHAR | 20 | Sim |
| `Data` | DATETIME | 19 | Sim |
| `UltimoStatus` | BIT | 1 | Não |

**Amostra:**

**Registro 1:**
- `CodStatus`: "050012025-01"
- `NroProtocoloLink`: "5001"
- `AnoProtocoloLink`: "2025"
- `SituacaoLink`: "Entrada Inicial"
- `SetorLink`: "SEFOC"
- `Data`: "2024-01-02 00:00:00"
- `UltimoStatus`: "False"
- `Observaçao`: "8h01"
- `Ponto`: "6.220"
**Registro 2:**
- `CodStatus`: "050012025-02"
- `NroProtocoloLink`: "5001"
- `AnoProtocoloLink`: "2025"
- `SituacaoLink`: "Cancelado"
- `SetorLink`: "SEFOC"
- `Data`: "2024-01-02 00:00:00"
- `UltimoStatus`: "True"
- `Observaçao`: "Modelo SP"
- `Ponto`: "6.220"
**Registro 3:**
- `CodStatus`: "050022025-01"
- `NroProtocoloLink`: "5002"
- `AnoProtocoloLink`: "2025"
- `SituacaoLink`: "Entrada Inicial"
- `SetorLink`: "SEFOC"
- `Data`: "2024-01-02 00:00:00"
- `UltimoStatus`: "False"
- `Observaçao`: "8h02"
- `Ponto`: "6.220"

### 4.3 OS AntigaCore

- **Caminho:** `\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS AntigaCore.mdb`
- **Tamanho:** 150.91 MB (158,240,768 bytes)
- **Modificação:** 2026-06-12T19:40:13.593690

| Tabela | Registros | Colunas |
|---|---:|---:|
| `tabAndamento` | 536322 | 7 |
| `tabProtocolos` | 49175 | 0 |
| `tabDetalhesServico` | 49174 | 7 |
| `tabLogChecklist` | 6234 | 1 |
| `tabMidiaDigital` | 5839 | 2 |
| `tabDeputados` | 2317 | 2 |
| `tabDeputados1aSAGRA-2023` | 2231 | 2 |
| `tabDeputados_` | 2231 | 2 |
| `tabDeputados1bSAGRA-Original` | 2028 | 2 |
| `_tabDeputados-NovaLista` | 1982 | 2 |
| `_tabDeputados-NovaLista - 2019 Mes01 30` | 1736 | 2 |
| `_tabDeputados-NovaLista - 2018 Mes` | 1680 | 2 |
| `tabDeputados-OLD-54LEG` | 1481 | 2 |
| `_tabTabDepsNova_Inativos-Apagar` | 1168 | 18 |
| `_tabDepsFelps` | 514 | 5 |
| `_Plan1` | 513 | 9 |
| `_tabTabDepsNova_Ativos-Apagar` | 513 | 17 |
| `_tabAlteracaoInativos` | 511 | 2 |
| `tabLogCodRS` | 446 | 4 |
| `tabOrgaos` | 232 | 9 |
| `tabDeputados1aSAGRA-2023b` | 203 | 2 |
| `tabLogFichaOS` | 179 | 1 |
| `tabTipoPubModelos` | 62 | 2 |
| `tabPapel` | 38 | 10 |
| `tabSituacao` | 34 | 3 |
| `tabMaquinas` | 27 | 2 |
| `tabFormatos` | 26 | 4 |
| `tabSetor` | 20 | 3 |
| `tabRespGraf` | 15 | 2 |
| `tabSituacao-old` | 13 | 3 |
| `tabEntregaForma` | 12 | 2 |
| `tabLegs` | 12 | 3 |
| `tabMesa` | 11 | 0 |
| `tabTipoMidiaDigital` | 10 | 0 |
| `tabMotivoAfastamento` | 9 | 1 |
| `tabCores` | 8 | 2 |
| `TabAnd3aItensDescCompleta` | 5 | 2 |
| `TabAnd3DescricaoCompleta` | 4 | 0 |
| `tabFormatoImpressao` | 4 | 3 |
| `_tabChecagemInicial` | 3 | 0 |
| `apagar-Debitos` | 3 | 3 |
| `apagar-tabTipoCota` | 3 | 1 |
| `apagar-tabTipoCota1` | 3 | 1 |
| `tabAnd1aTiposDePend` | 3 | 2 |
| `tabCategorias` | 3 | 1 |
| `tabEntregaPrazo` | 3 | 2 |
| `apagar-Creditos` | 2 | 3 |
| `tabProtocolos_ExportErrors1` | 2 | 3 |
| `tabIndicadores` | 1 | 11 |
| `tabProtocolos_ExportErrors` | 1 | 3 |
| `_tabOpenForm` | 0 | 0 |
| `Erros ao colar` | 0 | 1 |
| `tabAnd1TipoPend` | 0 | 1 |
| `tabAnd2Contatos` | 0 | 0 |
| `tabLocalMidia` | 0 | 3 |
| `tabMaterialEntregue` | 0 | 5 |
| `tabProtocolosBloqueados` | 0 | 0 |

#### MDB `tabProtocolos` (OS AntigaCore)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|

**Amostra:**

**Registro 1:**
- `NroProtocolo`: "1"
- `AnoProtocolo`: "2006"
- `DataEntrada`: "2006-01-05 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: "086232011"
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-00123"
- `CodigoRequisic`: "12531"
- `NomeUsuario`: "BONIFACIO DE ANDRADA"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "431"
- `Localizacao`: "Anexo IV"
- `Andar`: "4"
- `RamalUsuario`: "55431"
- `ContatoTrab`: NULL
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "True"
- `DataConclusao`: NULL
- `ArmazenadoEm`: NULL
- `ContatoRecebim`: NULL
- `RetiradaNome`: NULL
- `RetiradaPonto`: ""
- `RecebimData`: "2007-03-22 00:00:00"
- `PontoEntrega`: ""
- `SetorEntrega`: "Sedir - Distrib."
- `CancelamentoMotivo`: "OS criada p/ CS de Papelaria"
- `CancelamentoPonto`: "6.220"
- `CancelamentoData`: "2009-01-08 00:00:00"
- `CancelamentoSetor`: "SEFOC"
- `CotaRepro`: "500"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "True"
- `Campo0`: NULL
**Registro 2:**
- `NroProtocolo`: "1"
- `AnoProtocolo`: "2007"
- `DataEntrada`: "2007-01-05 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-00090"
- `CodigoRequisic`: "19050"
- `NomeUsuario`: "ARNALDO FARIA DE SA"
- `Solicitante`: "d"
- `OrgInteressado`: NULL
- `SiglaOrgao`: ""
- `Titular`: ""
- `GabSalaUsuario`: "929"
- `Localizacao`: "Anexo IV"
- `Andar`: "9"
- `RamalUsuario`: "55929"
- `ContatoTrab`: NULL
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "True"
- `DataConclusao`: "2007-01-24 00:00:00"
- `ArmazenadoEm`: "E"
- `ContatoRecebim`: "Denis"
- `RetiradaNome`: "IVO"
- `RetiradaPonto`: "209.007"
- `RecebimData`: "2007-03-22 00:00:00"
- `PontoEntrega`: "6.350"
- `SetorEntrega`: "Sedir - Distrib."
- `CancelamentoMotivo`: "DEAPA vai fornecer um exemplar da nova versão do Manual do Gabinete para cada gabinete."
- `CancelamentoPonto`: "6.218"
- `CancelamentoData`: "2007-03-06 00:00:00"
- `CancelamentoSetor`: "Sielt"
- `CotaRepro`: "500"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "False"
- `Campo0`: NULL
**Registro 3:**
- `NroProtocolo`: "1"
- `AnoProtocolo`: "2008"
- `DataEntrada`: "2008-01-02 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-01048"
- `CodigoRequisic`: "30012"
- `NomeUsuario`: "MANUELA D'AVILA"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: ""
- `Titular`: ""
- `GabSalaUsuario`: "438"
- `Localizacao`: "Anexo IV"
- `Andar`: "4"
- `RamalUsuario`: "55438"
- `ContatoTrab`: NULL
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "True"
- `DataConclusao`: NULL
- `ArmazenadoEm`: NULL
- `ContatoRecebim`: NULL
- `RetiradaNome`: "Fatima N"
- `RetiradaPonto`: "1.000"
- `RecebimData`: "2008-04-08 00:00:00"
- `PontoEntrega`: "6.218"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: "OS usada como Modelo. OS original teve o nro substituído."
- `CancelamentoPonto`: "6.220"
- `CancelamentoData`: "2008-09-16 00:00:00"
- `CancelamentoSetor`: "SEFOC"
- `CotaRepro`: "100"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "False"
- `Campo0`: NULL

#### MDB `tabDetalhesServico` (OS AntigaCore)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|
| `NroProtocoloLinkDet` | INTEGER | 10 | Sim |
| `AnoProtocoloLinkDet` | INTEGER | 10 | Sim |
| `ElemGrafBrasao` | BIT | 1 | Não |
| `ElemGrafTimbre` | BIT | 1 | Não |
| `ElemGrafArteGab` | BIT | 1 | Não |
| `ElemGrafAssinatura` | BIT | 1 | Não |
| `ElemGrafCarimbo` | VARCHAR | 50 | Sim |

**Amostra:**

**Registro 1:**
- `NroProtocoloLinkDet`: "1"
- `AnoProtocoloLinkDet`: "2006"
- `ElemGrafBrasao`: "True"
- `ElemGrafTimbre`: "True"
- `ElemGrafArteGab`: "False"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "True"
- `TipoPublicacaoLink`: "Bloco A5"
- `MaquinaLink`: "Catu"
- `Pags`: "100"
- `Mult4`: "False"
- `TiragemSolicitada`: "10"
- `Tiragem`: "10"
- `CotaTotal`: "500"
- `Titulo`: "Bonifacio De Andrada"
- `FormatoLink`: "A5"
- `CoeficienteA4`: "2.0"
- `PapelLink`: "Normal"
- `PapelDescricao`: NULL
- `FrenteVerso`: "False"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Refilar\r\nColar Bloco"
- `Observ`: "10blocos 100 folhas\r\n1000folhas A5\r\n500  folhas A4"
- `CalcPgs1`: "100"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `ModelosArq`: "1"
**Registro 2:**
- `NroProtocoloLinkDet`: "1"
- `AnoProtocoloLinkDet`: "2007"
- `ElemGrafBrasao`: "False"
- `ElemGrafTimbre`: "False"
- `ElemGrafArteGab`: "False"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "True"
- `TipoPublicacaoLink`: "Ct Gab Simples (Cor)"
- `MaquinaLink`: "Multilith"
- `Pags`: "1"
- `Mult4`: "False"
- `TiragemSolicitada`: NULL
- `Tiragem`: "500"
- `CotaTotal`: "500"
- `Titulo`: "Aniversario"
- `FormatoLink`: "100 x 148,5 crt"
- `CoeficienteA4`: "1.0"
- `PapelLink`: "180gr"
- `PapelDescricao`: NULL
- `FrenteVerso`: "False"
- `Cores`: "Preto"
- `CoresDescricao`: NULL
- `DescAcabamento`: NULL
- `Observ`: NULL
- `CalcPgs1`: "1"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Preto"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `ModelosArq`: "1"
**Registro 3:**
- `NroProtocoloLinkDet`: "1"
- `AnoProtocoloLinkDet`: "2008"
- `ElemGrafBrasao`: "False"
- `ElemGrafTimbre`: "False"
- `ElemGrafArteGab`: "False"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "False"
- `TipoPublicacaoLink`: "Ct Gab Simples (Cor)"
- `MaquinaLink`: "Catu"
- `Pags`: "1"
- `Mult4`: "False"
- `TiragemSolicitada`: NULL
- `Tiragem`: "100"
- `CotaTotal`: "100"
- `Titulo`: "C-2008"
- `FormatoLink`: "Ct Gab Simp 105 x 148,5"
- `CoeficienteA4`: "1.0"
- `PapelLink`: "ap 180gr"
- `PapelDescricao`: NULL
- `FrenteVerso`: "False"
- `Cores`: "Preto"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Refile"
- `Observ`: NULL
- `CalcPgs1`: "1"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Preto"
- `CalcPgs2`: NULL
- `CalcQtdCores2`: NULL
- `CalcCor2`: NULL
- `CalcPgs3`: NULL
- `CalcQtdCores3`: NULL
- `CalcCor3`: NULL
- `ModelosArq`: "1"

#### MDB `tabAndamento` (OS AntigaCore)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|
| `CodStatus` | VARCHAR | 12 | Sim |
| `NroProtocoloLink` | INTEGER | 10 | Sim |
| `AnoProtocoloLink` | INTEGER | 10 | Sim |
| `SituacaoLink` | VARCHAR | 50 | Sim |
| `SetorLink` | VARCHAR | 20 | Sim |
| `Data` | DATETIME | 19 | Sim |
| `UltimoStatus` | BIT | 1 | Não |

**Amostra:**

**Registro 1:**
- `CodStatus`: "000012006-01"
- `NroProtocoloLink`: "1"
- `AnoProtocoloLink`: "2006"
- `SituacaoLink`: "Entrada Inicial"
- `SetorLink`: "SEFOC"
- `Data`: "2007-03-01 00:00:00"
- `UltimoStatus`: "False"
- `Observaçao`: "10h46"
- `Ponto`: "6.220"
- `Campo1`: NULL
**Registro 2:**
- `CodStatus`: "000012006-02"
- `NroProtocoloLink`: "1"
- `AnoProtocoloLink`: "2006"
- `SituacaoLink`: "Cancelado"
- `SetorLink`: "SEFOC"
- `Data`: "2007-03-01 00:00:00"
- `UltimoStatus`: "True"
- `Observaçao`: "OS criada p/ CS de Papelaria"
- `Ponto`: "6.220"
- `Campo1`: NULL
**Registro 3:**
- `CodStatus`: "000012007-01"
- `NroProtocoloLink`: "1"
- `AnoProtocoloLink`: "2007"
- `SituacaoLink`: "Entrada Inicial"
- `SetorLink`: "SEDIR"
- `Data`: "2007-01-02 00:00:00"
- `UltimoStatus`: "False"
- `Observaçao`: NULL
- `Ponto`: "4.839"
- `Campo1`: NULL

### 4.4 Papelaria Antiga

- **Caminho:** `\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Antiga.mdb`
- **Tamanho:** 90.2 MB (94,576,640 bytes)
- **Modificação:** 2026-03-26T12:47:30.688350

| Tabela | Registros | Colunas |
|---|---:|---:|
| `tabAndamento` | 314207 | 7 |
| `tabProtocolos` | 26931 | 0 |
| `tabDetalhesServico` | 26775 | 7 |
| `tabLogFichaOS` | 4796 | 1 |
| `tabLogChecklist` | 4612 | 1 |
| `tabDeputados1` | 1699 | 2 |
| `tabDeputados - old` | 1199 | 2 |
| `_Plan1` | 513 | 9 |
| `tabLogCodRS` | 446 | 4 |
| `tabOrgaos` | 210 | 9 |
| `Erros ao colar` | 185 | 1 |
| `tabTipoPubModelos` | 61 | 2 |
| `tabPapel` | 37 | 10 |
| `tabSituacao` | 34 | 3 |
| `tabFormatos` | 25 | 4 |
| `tabMaquinas` | 25 | 2 |
| `tabMidiaDigital` | 23 | 2 |
| `tabSetor` | 20 | 3 |
| `tabProtocolosBloqueados` | 15 | 0 |
| `tabRespGraf` | 15 | 2 |
| `tabLegs` | 13 | 3 |
| `tabMesa` | 13 | 0 |
| `tabSituacao-old` | 13 | 3 |
| `tabEntregaForma` | 12 | 2 |
| `tabTipoMidiaDigital` | 10 | 0 |
| `tabMotivoAfastamento` | 9 | 1 |
| `tabCores` | 7 | 2 |
| `TabAnd3aItensDescCompleta` | 5 | 2 |
| `TabAnd3DescricaoCompleta` | 4 | 0 |
| `tabFormatoImpressao` | 4 | 3 |
| `_tabChecagemInicial` | 3 | 0 |
| `apagar-Debitos` | 3 | 3 |
| `apagar-tabTipoCota` | 3 | 1 |
| `apagar-tabTipoCota1` | 3 | 1 |
| `tabAnd1aTiposDePend` | 3 | 2 |
| `tabCategorias` | 3 | 1 |
| `tabEntregaPrazo` | 3 | 2 |
| `apagar-Creditos` | 2 | 3 |
| `tabProtocolos_ExportErrors` | 2 | 3 |
| `tabIndicadores` | 1 | 11 |
| `_tabDeputados-NovaLista` | 0 | 2 |
| `_tabOpenForm` | 0 | 0 |
| `tabAnd1TipoPend` | 0 | 1 |
| `tabAnd2Contatos` | 0 | 0 |
| `tabLocalMidia` | 0 | 3 |
| `tabMaterialEntregue` | 0 | 5 |

#### MDB `tabProtocolos` (Papelaria Antiga)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|

**Amostra:**

**Registro 1:**
- `NroProtocolo`: "5170"
- `AnoProtocolo`: "2022"
- `DataEntrada`: "2022-03-10 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-00940"
- `CodigoRequisic`: "30045"
- `NomeUsuario`: "BILAC PINTO"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "806"
- `Localizacao`: "Anexo IV"
- `Andar`: "8"
- `RamalUsuario`: "55806"
- `ContatoTrab`: "Silvaninha P_120819"
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "False"
- `DataConclusao`: "2022-03-14 00:00:00"
- `ArmazenadoEm`: "e"
- `ContatoRecebim`: "Silvaninha"
- `RetiradaNome`: "Silvana"
- `RetiradaPonto`: "120.819"
- `RecebimData`: "2022-03-14 00:00:00"
- `PontoEntrega`: "882.215"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "400"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "True"
**Registro 2:**
- `NroProtocolo`: "5171"
- `AnoProtocolo`: "2020"
- `DataEntrada`: "2020-02-12 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-01771"
- `CodigoRequisic`: "31158"
- `NomeUsuario`: "CAPITAO DERRITE"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "639"
- `Localizacao`: "Anexo IV"
- `Andar`: "6"
- `RamalUsuario`: "55639"
- `ContatoTrab`: "prova para\r\nluis.araujo@camara.leg.br"
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR IV"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "False"
- `DataConclusao`: "2020-02-27 00:00:00"
- `ArmazenadoEm`: "e"
- `ContatoRecebim`: "Karine"
- `RetiradaNome`: "Moreira"
- `RetiradaPonto`: "266.079"
- `RecebimData`: "2020-03-02 00:00:00"
- `PontoEntrega`: "6.352"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "500"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "True"
**Registro 3:**
- `NroProtocolo`: "5171"
- `AnoProtocolo`: "2021"
- `DataEntrada`: "2021-02-09 00:00:00"
- `ProcessoSolicit`: NULL
- `CSnro`: NULL
- `CategoriaLink`: "Deputado"
- `CodUsuarioLink`: "Dep-00295"
- `CodigoRequisic`: "15168"
- `NomeUsuario`: "GASTAO VIEIRA"
- `Solicitante`: NULL
- `OrgInteressado`: NULL
- `SiglaOrgao`: NULL
- `Titular`: NULL
- `GabSalaUsuario`: "372"
- `Localizacao`: "Anexo III"
- `Andar`: "3"
- `RamalUsuario`: "55372"
- `ContatoTrab`: NULL
- `ResponsavelGrafLink`: NULL
- `EntregaFormaLink`: "Entreg. na SEDIR III"
- `EntregPrazoLink`: "Normal"
- `EntregData`: NULL
- `EntregPeriodo`: NULL
- `ReqLançada`: "True"
- `ReqEntregue`: "False"
- `DataConclusao`: "2021-03-16 00:00:00"
- `ArmazenadoEm`: "E"
- `ContatoRecebim`: NULL
- `RetiradaNome`: "VALDERI"
- `RetiradaPonto`: "204.621"
- `RecebimData`: "2021-07-15 00:00:00"
- `PontoEntrega`: "881.985"
- `SetorEntrega`: "SEDIR "
- `CancelamentoMotivo`: NULL
- `CancelamentoPonto`: NULL
- `CancelamentoData`: NULL
- `CancelamentoSetor`: NULL
- `CotaRepro`: "1500"
- `CotaCartao`: NULL
- `ReimprimirOS`: "False"
- `DebitarCGRAF`: "True"

#### MDB `tabDetalhesServico` (Papelaria Antiga)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|
| `NroProtocoloLinkDet` | INTEGER | 10 | Sim |
| `AnoProtocoloLinkDet` | INTEGER | 10 | Sim |
| `ElemGrafBrasao` | BIT | 1 | Não |
| `ElemGrafTimbre` | BIT | 1 | Não |
| `ElemGrafArteGab` | BIT | 1 | Não |
| `ElemGrafAssinatura` | BIT | 1 | Não |
| `ElemGrafCarimbo` | VARCHAR | 50 | Sim |

**Amostra:**

**Registro 1:**
- `NroProtocoloLinkDet`: "5000"
- `AnoProtocoloLinkDet`: "2010"
- `ElemGrafBrasao`: "True"
- `ElemGrafTimbre`: "True"
- `ElemGrafArteGab`: "False"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "False"
- `TipoPublicacaoLink`: "Ct Visita"
- `MaquinaLink`: "Digital Cor"
- `Pags`: "2"
- `Mult4`: "False"
- `Tiragem`: "1"
- `CotaTotal`: "2"
- `Titulo`: "Manuela D'avila"
- `FormatoLink`: "Ct Visita 50 x 90"
- `CoeficienteA4`: "12.0"
- `PapelLink`: "ap 180gr"
- `PapelDescricao`: NULL
- `FrenteVerso`: "True"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Refilar"
- `Observ`: NULL
- `CalcPgs1`: "2"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `TiragemSolicitada`: NULL
- `ModelosArq`: "1"
**Registro 2:**
- `NroProtocoloLinkDet`: "5000"
- `AnoProtocoloLinkDet`: "2009"
- `ElemGrafBrasao`: "True"
- `ElemGrafTimbre`: "True"
- `ElemGrafArteGab`: "False"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "False"
- `TipoPublicacaoLink`: "Ct Visita"
- `MaquinaLink`: "Digital Cor"
- `Pags`: "2"
- `Mult4`: "False"
- `Tiragem`: "1"
- `CotaTotal`: "2"
- `Titulo`: "Manuela D'avila"
- `FormatoLink`: "Ct Visita 50 x 90"
- `CoeficienteA4`: "12.0"
- `PapelLink`: "ap 180gr"
- `PapelDescricao`: NULL
- `FrenteVerso`: "True"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Refilar"
- `Observ`: NULL
- `CalcPgs1`: "2"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `TiragemSolicitada`: NULL
- `ModelosArq`: "1"
**Registro 3:**
- `NroProtocoloLinkDet`: "5000"
- `AnoProtocoloLinkDet`: "2008"
- `ElemGrafBrasao`: "True"
- `ElemGrafTimbre`: "True"
- `ElemGrafArteGab`: "False"
- `ElemGrafAssinatura`: "False"
- `ElemGrafCarimbo`: NULL
- `InsumosFornecidos`: NULL
- `MaterialFornecido`: "False"
- `ModeloDobra`: "False"
- `Fotolito`: "False"
- `ProvaImpressa`: "False"
- `TipoPublicacaoLink`: "Ct Visita"
- `MaquinaLink`: "Digital Cor"
- `Pags`: "2"
- `Mult4`: "False"
- `Tiragem`: "1"
- `CotaTotal`: "2"
- `Titulo`: "Manuela D'avila"
- `FormatoLink`: "Ct Visita 50 x 90"
- `CoeficienteA4`: "12.0"
- `PapelLink`: "ap 180gr"
- `PapelDescricao`: NULL
- `FrenteVerso`: "True"
- `Cores`: "Policromia"
- `CoresDescricao`: NULL
- `DescAcabamento`: "Refilar"
- `Observ`: NULL
- `CalcPgs1`: "2"
- `CalcQtdCores1`: "1"
- `CalcCor1`: "Policromia"
- `CalcPgs2`: "0"
- `CalcQtdCores2`: "0"
- `CalcCor2`: NULL
- `CalcPgs3`: "0"
- `CalcQtdCores3`: "0"
- `CalcCor3`: NULL
- `TiragemSolicitada`: NULL
- `ModelosArq`: "1"

#### MDB `tabAndamento` (Papelaria Antiga)

| Campo | Tipo Access | Tamanho | Nullable |
|---|---|---|---|
| `CodStatus` | VARCHAR | 12 | Sim |
| `NroProtocoloLink` | INTEGER | 10 | Sim |
| `AnoProtocoloLink` | INTEGER | 10 | Sim |
| `SituacaoLink` | VARCHAR | 50 | Sim |
| `SetorLink` | VARCHAR | 20 | Sim |
| `Data` | DATETIME | 19 | Sim |
| `UltimoStatus` | BIT | 1 | Não |

**Amostra:**

**Registro 1:**
- `CodStatus`: "000012011-01"
- `NroProtocoloLink`: "1"
- `AnoProtocoloLink`: "2011"
- `SituacaoLink`: "Entrada Inicial"
- `SetorLink`: "SEDIR"
- `Data`: "2011-03-10 00:00:00"
- `UltimoStatus`: "False"
- `Observaçao`: NULL
- `Ponto`: NULL
**Registro 2:**
- `CodStatus`: "000012011-02"
- `NroProtocoloLink`: "1"
- `AnoProtocoloLink`: "2011"
- `SituacaoLink`: "Cancelado"
- `SetorLink`: "SEDIR"
- `Data`: "2011-03-18 00:00:00"
- `UltimoStatus`: "True"
- `Observaçao`: "Modelo para CS de papelaria."
- `Ponto`: "6.220"
**Registro 3:**
- `CodStatus`: "000022011-01"
- `NroProtocoloLink`: "2"
- `AnoProtocoloLink`: "2011"
- `SituacaoLink`: "Entrada Inicial"
- `SetorLink`: "SEDIR"
- `Data`: "2011-03-10 00:00:00"
- `UltimoStatus`: "False"
- `Observaçao`: NULL
- `Ponto`: NULL

### 4.5 SAT ACCDB

- **Caminho:** `\\redecamara\dfsdata\cgraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\BaseDeDados - SAT\Base de dados SAT.accdb`
- **Tamanho:** 12.04 MB (12,623,872 bytes)
- **Modificação:** 2026-06-08T10:51:37.460488

| Tabela | Registros | Colunas |
|---|---:|---:|
| `tabRegistroPT` | 3984 | 9 |
| `Historico` | 3683 | 7 |
| `~TMPCLP472961` | 2118 | 9 |
| `tabPT_Old` | 84 | 4 |
| `Abertura` | 83 | 13 |
| `tabPT` | 78 | 3 |
| `Plan1$_ImportErrors` | 76 | 3 |
| `tabUsers` | 11 | 5 |
| `SPs` | 1 | 9 |
| `tabVersao` | 1 | 2 |
| `tabSP` | 0 | 6 |

---

## 5. Scripts de sincronização e integração

### 5.1 Mapa geral

| Script | Direção | Origem | Destino | Operações | Periodicidade |
|---|---|---|---|---|---|
| `sync_andamentos_v2.py` (raiz) | MDB → MySQL | tabandamento (OS+Papelaria MDB) | tabAndamento/tabandamento MySQL | INSERT/UPDATE/DELETE tracking | Loop ~0.2s |
| `app/services/sync_andamentos_v2.py` | MySQL ↔ MDB (legado) | Ambos | Ambos | INSERT/UPDATE | Loop |
| `app/backend/routers/mdb_writer.py` | MySQL → MDB | MySQL (pós-commit) | MDB OS/Papelaria | UPSERT | On-demand (API) |
| `app/services/sync_tables/sync_access_mysql.py` | MDB → MySQL | Access | MySQL | TRUNCATE+INSERT (1ª exec) / poll | Manual/daemon |
| `app/services/sync_tables/sagra_sync.py` | MDB → MySQL | protocolos/detalhes | MySQL | Hash-based sync | Manual |
| `app/services/sync_tables/sync_os_mysql_mdb.py` | MySQL → MDB | MySQL | MDB | UPDATE | Manual |
| `app/backend/lookup_sync.py` | MDB → MySQL | Lookups OS Atual | MySQL | INSERT/UPDATE | On-demand |
| `os_routes._mdb_sync_worker` | MySQL → MDB | MySQL | MDB | Async dual-write | Background thread |
| `sync_tabprotocolos_os.py` / `_sp.py` | MDB → MySQL | tabProtocolos MDB | monitor_protocol_* MySQL | Poll/hash | Manual/GUI |
| `sync_tabdetalhes_os.py` / `_sp.py` | MDB → MySQL | tabDetalhesServico MDB | monitor_detalhes_* MySQL | Poll/hash | Manual/GUI |
| `sync_andamentos_os.py` | MDB ↔ MySQL | tabandamento | MySQL + filas YAML | INSERT/UPDATE/DELETE | Manual |
| `sync_mdb_mysql_protocolos.py` | MDB → MySQL | tabProtocolos | tabprotocolos | UPSERT | Manual |
| `sync_mdb_mysql_detalhes.py` | MDB → MySQL | tabDetalhesServico | tabdetalhesservico | UPSERT | Manual |
| `sync_dbs.py` | MySQL → MySQL | monitor_* OS | monitor_* SP | COPY | Manual threaded |
| `sync_all.py` | MDB → MySQL | Multi (YAML) | Multi | Variado | Manual |
| `main_monitor.py` | — | GUI launcher | Scripts acima | — | Manual |
| `ajuste_andamentos_os_antigas.py` | — | MySQL only | tabandamento | UPDATE bulk | Manual (ano < 2024) |
| `remover_andamentos_os_antigas.py` | — | MySQL only | tabandamento | DELETE | Manual |
| `scripts/reconcile_os_ultimo_andamento.py` | — | tabandamento | tab_os_ultimo_andamento_operacional | Rebuild | Manual |
| `sat_registro_pt_migration.py` | ACCDB → MySQL | tabRegistroPT SAT | tabMigracaoSatRegistroPT | INSERT | Manual |

### 5.2 sync_andamentos_v2.py (raiz) — detalhamento

**Caminho:** `C:\dev\SagraWeb\sync_andamentos_v2.py` (cópia equivalente em `\\cgrafsysvm\...`)

**Lê do MDB (somente leitura por padrão):**
- `tabandamento` de **OS Atual** e **Papelaria Atual**
- Filtro: `AnoProtocoloLink >= 2024` e janela recente (~15 dias configurável)
- Thread background: `tabProtocolos` e `tabDetalhesServico` quando mtime do MDB muda

**Grava no MySQL:**
- Tabela canônica resolvida por `services/andamento_table.py` (`tabAndamento` **ou** `tabandamento`)
- Tabelas auxiliares: `deleted_andamentos`, `log_sync_andamentos`, `cache_andamentos_mdb`, `backup_andamentos`
- Pós-sync: `tab_os_ultimo_andamento_operacional`, caches de filtro, notify WebSocket via API `/realtime/notify`

**Escreve no MDB?** Apenas se `SYNC_ALLOW_MDB_WRITE=true` (default **false**). Fluxo principal é unidirecional.

**Riscos identificados:**
1. Casing de tabela de andamento — no ambiente auditado só existe `tabandamento`, mas sync/código alternam PascalCase; risco em migração ou servidor case-sensitive.
2. Duas versões do script (raiz unidirecional vs `app/services` bidirecional) — deploy pode executar versão errada.
3. Janela temporal (15–30 dias) — andamentos antigos editados no MDB podem não propagar.
4. DELETE/resurrection tracking — risco de reintroduzir registros ou marcar falsos positivos.
5. Background sync de protocolos/detalhes sobrescreve colunas allowlisted — campos Web-only protegidos por `_MYSQL_ONLY_PROTECTED`.
6. Lock de instância única — segunda instância aborta; sem lock, duplicidade/loop possível.
7. MDB bloqueado — pyodbc falha; MySQL fica desatualizado até próximo ciclo.

**Invocação:** Manual, `_iniciar-sync-andamentos.cmd`, ou API `sync_routes.py` (master IP, flag `sync_andamentos_enabled`).

---

## 6. Dicionário de dados

_Todas as 158 tabelas MySQL. Para tabelas principais, ver também seção 3.4._


### Tabela: `_plan1`

**Finalidade aparente:** Auxiliar / importação / suspeita  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Nome Civil` | text | YES | — | — | — | — | — |
| `Partido` | text | YES | — | — | — | — | — |
| `UF` | text | YES | — | — | — | — | — |
| `Gab` | double | YES | — | — | — | — | — |
| `Andar` | text | YES | — | — | — | — | — |
| `Anexo` | text | YES | — | — | — | — | — |
| `Ramal` | text | YES | — | — | — | — | — |
| `LegAtual` | double | YES | — | — | — | — | — |
| `Nome Parlamentar` | text | YES | — | — | — | — | — |

### Tabela: `_tabchecageminicial`

**Finalidade aparente:** Auxiliar / importação / suspeita  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `FormPrincipalDoSistemaCliente` | text | YES | — | — | — | — | — |
| `VersaoAtualDoSistema` | text | YES | — | — | — | — | — |
| `BaseAtual` | text | YES | — | — | — | — | — |
| `BaseDePapelaria` | text | YES | — | — | — | — | — |
| `ManutençaoBase` | text | YES | — | — | — | — | — |
| `TrocarBaseCliente` | text | YES | — | — | — | — | — |
| `Comentario` | text | YES | — | — | — | — | — |
| `ManterPonto` | text | YES | — | — | — | — | — |
| `CriaPastaPapelaria` | text | YES | — | — | — | — | — |

### Tabela: `_tabopenform`

**Finalidade aparente:** Auxiliar / importação / suspeita  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `formPrincipal` | text | YES | — | — | — | — | — |
| `formUsuariosRS2` | text | YES | — | — | — | — | — |
| `formPrincipal2` | text | YES | — | — | — | — | — |

### Tabela: `acabamento`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `nome` | varchar(150) | NO | — | UNI | nome | — | — |
| `categoria` | varchar(100) | YES | — | — | — | — | — |
| `observacoes` | text | YES | — | — | — | — | — |

### Tabela: `acabamentos_catalogo`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `nome` | varchar(100) | NO | — | UNI | nome | — | — |
| `categoria` | varchar(80) | YES | — | — | — | — | — |
| `exige_parametros` | tinyint(1) | YES | 0 | — | — | — | — |
| `escopo_padrao` | enum('GLOBAL','COMPONENTE') | YES | GLOBAL | — | — | — | — |
| `ativo` | tinyint(1) | YES | 1 | — | — | — | — |
| `criado_em` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `atualizado_em` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `andamentos_backup`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `timestamp_backup` | datetime | YES | CURRENT_TIMESTAMP | MUL | idx_timestamp | — | — |
| `origem` | varchar(50) | NO | — | — | — | — | — |
| `tipo_acao` | varchar(50) | NO | — | — | — | — | — |
| `codstatus` | int | YES | — | MUL | idx_codstatus | — | — |
| `nros` | int | YES | — | MUL | idx_nros_ano | — | — |
| `ano` | int | YES | — | — | idx_nros_ano | — | — |
| `andamento` | text | YES | — | — | — | — | — |
| `data` | date | YES | — | — | — | — | — |
| `ponto` | varchar(20) | YES | — | — | — | — | — |
| `hora` | time | YES | — | — | — | — | — |
| `usuariotag` | varchar(100) | YES | — | — | — | — | — |
| `ultimostatus` | tinyint(1) | YES | — | — | — | — | — |
| `dados_completos_json` | text | YES | — | — | — | — | — |

### Tabela: `andamentos_mdb_cache`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `codstatus` | int | NO | — | PRI | — | — | — |
| `nros` | int | NO | — | MUL | idx_nros_ano | — | — |
| `ano` | int | NO | — | — | idx_nros_ano | — | — |
| `origem_mdb` | varchar(50) | NO | — | MUL | idx_origem | — | — |
| `ultima_verificacao` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `apagar-creditos`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodLancCr` | int | YES | — | — | — | — | — |
| `NomeUsuario` | text | YES | — | — | — | — | — |
| `Credito` | int | YES | — | — | — | — | — |

### Tabela: `apagar-debitos`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodLancamento` | int | YES | — | — | — | — | — |
| `NomeUsuario` | text | YES | — | — | — | — | — |
| `Debito` | int | YES | — | — | — | — | — |

### Tabela: `apagar-tabtipocota`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `TipoCota` | text | YES | — | — | — | — | — |

### Tabela: `apagar-tabtipocota1`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `TipoCota` | text | YES | — | — | — | — | — |

### Tabela: `backup_andamentos`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Quantidade aproximada de registros:** 114

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `timestamp_backup` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |
| `origem` | varchar(50) | YES | — | — | — | — | — |
| `codstatus` | varchar(50) | YES | — | MUL | idx_codstatus | — | — |
| `nro` | int | YES | — | — | — | — | — |
| `ano` | int | YES | — | — | — | — | — |
| `dados_json` | text | YES | — | — | — | — | — |

### Tabela: `cache_andamentos_mdb`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Quantidade aproximada de registros:** 2,232

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `codstatus` | varchar(50) | NO | — | PRI | — | — | — |
| `nro` | int | YES | — | — | — | — | — |
| `ano` | int | YES | — | — | — | — | — |
| `origem` | varchar(50) | YES | — | — | — | — | — |
| `ultima_atualizacao` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |
| `content_hash` | varchar(64) | YES | — | — | — | — | — |

### Tabela: `componente_variacao`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `componente_id` | int | NO | — | MUL | componente_id | — | — |
| `descricao` | varchar(255) | YES | — | — | — | — | — |
| `qtd_paginas` | int | YES | — | — | — | — | — |
| `observacoes` | text | YES | — | — | — | — | — |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `cor`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `codigo` | varchar(10) | NO | — | UNI | codigo | — | — |
| `descricao` | varchar(100) | YES | — | — | — | — | — |

### Tabela: `ct_gravacao_eventos`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id_evento` | int | NO | — | PRI | — | — | — |
| `id_job` | int | YES | — | MUL | unique_evento | — | — |
| `nome_chapa` | varchar(255) | YES | — | — | unique_evento | — | — |
| `tipo_evento` | varchar(50) | YES | — | — | — | — | — |
| `status_evento` | varchar(50) | YES | — | — | unique_evento | — | — |
| `descricao_evento` | text | YES | — | — | — | — | — |
| `data_evento` | datetime(6) | YES | — | — | unique_evento | — | — |
| `sequencia` | int | YES | 0 | — | — | — | — |

### Tabela: `delete_candidates`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `codstatus` | varchar(50) | NO | — | PRI | — | — | — |
| `first_seen` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `last_seen` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `seen_count` | int | NO | 1 | — | — | — | — |
| `nro` | int | YES | — | — | — | — | — |
| `ano` | int | YES | — | — | — | — | — |
| `origem` | varchar(20) | YES | — | — | — | — | — |

### Tabela: `deleted_andamentos`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Quantidade aproximada de registros:** 93

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `codstatus` | varchar(50) | NO | — | PRI | — | — | — |
| `nro` | int | YES | — | MUL | idx_nro_ano | — | — |
| `ano` | int | YES | — | — | idx_nro_ano | — | — |
| `origem` | varchar(50) | YES | — | — | — | — | OS_Atual ou Papelaria - origem da exclusão |
| `deleted_at` | datetime | YES | CURRENT_TIMESTAMP | MUL | idx_deleted_at | — | — |
| `motivo` | varchar(255) | YES | Exclusão detectada no MDB | — | — | — | — |
| `content_hash` | varchar(64) | YES | — | — | — | — | SHA256 do conteúdo do registro excluído |

### Tabela: `deputadoscache`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 93

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `Nome` | varchar(255) | NO | — | — | — | — | — |
| `Gabinete` | varchar(50) | YES | — | — | — | — | — |
| `Andar` | varchar(50) | YES | — | — | — | — | — |
| `Local` | varchar(100) | YES | — | — | — | — | — |
| `Ramal` | varchar(50) | YES | — | — | — | — | — |
| `FotoURL` | text | YES | — | — | — | — | — |
| `DataAtualizacao` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |
| `EmailDep` | varchar(255) | NO | — | — | — | — | — |
| `EmailGab` | varchar(255) | NO | — | — | — | — | — |

### Tabela: `ds_model_training_history`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `model_id` | int | NO | — | PRI | — | — | — |
| `model_version` | varchar(20) | YES | — | — | — | — | — |
| `trained_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `training_samples` | int | YES | — | — | — | — | — |
| `validation_samples` | int | YES | — | — | — | — | — |
| `date_range_start` | date | YES | — | — | — | — | — |
| `date_range_end` | date | YES | — | — | — | — | — |
| `metric_mae` | decimal(10,4) | YES | — | — | — | — | — |
| `metric_rmse` | decimal(10,4) | YES | — | — | — | — | — |
| `metric_r2` | decimal(10,4) | YES | — | — | — | — | — |
| `model_path` | varchar(255) | YES | — | — | — | — | — |
| `features_list` | text | YES | — | — | — | — | — |
| `hyperparameters` | text | YES | — | — | — | — | — |
| `status` | enum('Active','Deprecated','Failed') | YES | Active | — | — | — | — |

### Tabela: `ds_production_features`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | — | — | — |
| `os_id` | int | NO | — | MUL | idx_os | — | — |
| `os_ano` | int | NO | — | — | idx_os | — | — |
| `seq_andamento` | int | NO | — | — | — | — | — |
| `duration_minutes` | decimal(10,2) | YES | — | — | — | — | — |
| `machine_id` | varchar(50) | YES | — | MUL | idx_machine | — | — |
| `sector_id` | varchar(50) | YES | — | — | — | — | — |
| `status_id` | varchar(50) | YES | — | — | — | — | — |
| `product_type` | varchar(100) | YES | — | — | — | — | — |
| `paper_type` | varchar(100) | YES | — | — | — | — | — |
| `paper_weight` | int | YES | — | — | — | — | — |
| `format_name` | varchar(50) | YES | — | — | — | — | — |
| `colors` | varchar(20) | YES | — | — | — | — | — |
| `finishing_tags` | text | YES | — | — | — | — | — |
| `qty_pages` | int | YES | — | — | — | — | — |
| `qty_copies` | int | YES | — | — | — | — | — |
| `total_impressions` | bigint | YES | — | — | — | — | — |
| `start_timestamp` | datetime | YES | — | MUL | idx_date | — | — |
| `is_work_hours` | tinyint(1) | YES | — | — | — | — | — |
| `work_shift` | enum('Morning','Afternoon','Night') | YES | — | — | — | — | — |
| `processed_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `is_outlier` | tinyint(1) | YES | 0 | — | — | — | — |

### Tabela: `erros ao colar`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Setor` | text | YES | — | — | — | — | — |
| `SetorSeq` | int | YES | — | — | — | — | — |
| `ProxSetor` | int | YES | — | — | — | — | — |

### Tabela: `ip_permissions`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 15

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `ip` | varchar(45) | NO | — | UNI | ip | — | — |
| `descricao` | varchar(255) | YES | — | — | — | — | — |
| `grupo` | varchar(100) | YES | Sem Grupo | — | — | — | — |
| `ativo` | tinyint(1) | YES | 1 | — | — | — | — |
| `ctx_nova_os` | tinyint(1) | YES | 1 | — | — | — | — |
| `ctx_duplicar_os` | tinyint(1) | YES | 1 | — | — | — | — |
| `ctx_editar_os` | tinyint(1) | YES | 1 | — | — | — | — |
| `ctx_vincular_os` | tinyint(1) | YES | 1 | — | — | — | — |
| `ctx_abrir_pasta` | tinyint(1) | YES | 1 | — | — | — | — |
| `ctx_imprimir_ficha` | tinyint(1) | YES | 1 | — | — | — | — |
| `ctx_detalhes_os` | tinyint(1) | YES | 1 | — | — | — | — |
| `sb_inicio` | tinyint(1) | YES | 1 | — | — | — | — |
| `sb_gerencia` | tinyint(1) | YES | 1 | — | — | — | — |
| `sb_email` | tinyint(1) | YES | 1 | — | — | — | — |
| `sb_analise` | tinyint(1) | YES | 1 | — | — | — | — |
| `sb_papelaria` | tinyint(1) | YES | 1 | — | — | — | — |
| `sb_usuario` | tinyint(1) | YES | 1 | — | — | — | — |
| `sb_configuracoes` | tinyint(1) | YES | 1 | — | — | — | — |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `updated_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `sb_relatorio` | tinyint(1) | YES | 1 | — | — | — | — |
| `sb_dashboard_setor` | tinyint(1) | YES | 1 | — | — | — | — |
| `sb_admin_ips` | tinyint(1) | NO | 0 | — | — | — | — |
| `sb_pcp` | tinyint(1) | NO | 0 | — | — | — | — |
| `sb_usuarios` | tinyint(1) | NO | 0 | — | — | — | — |
| `sb_active_computers` | tinyint(1) | NO | 0 | — | — | — | — |
| `sb_gravacao` | tinyint(1) | NO | 0 | — | — | — | — |
| `sb_dashboard_global` | tinyint(1) | NO | 0 | — | — | — | — |
| `painel_setores` | json | YES | — | — | — | — | — |
| `ctx_mover_pastas` | tinyint(1) | NO | 1 | — | — | — | — |

### Tabela: `log_sincronizacao`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `timestamp` | datetime | YES | CURRENT_TIMESTAMP | MUL | idx_timestamp | — | — |
| `tipo_acao` | varchar(50) | NO | — | — | — | — | — |
| `origem` | varchar(50) | NO | — | — | — | — | — |
| `destino` | varchar(50) | NO | — | — | — | — | — |
| `nros` | int | YES | — | MUL | idx_nros_ano | — | — |
| `ano` | int | YES | — | — | idx_nros_ano | — | — |
| `codstatus` | int | YES | — | MUL | idx_codstatus | — | — |
| `campos_modificados` | text | YES | — | — | — | — | — |
| `sucesso` | tinyint(1) | YES | 1 | — | — | — | — |
| `mensagem_erro` | text | YES | — | — | — | — | — |
| `detalhes_completos` | text | YES | — | — | — | — | — |

### Tabela: `log_sync_andamentos`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Quantidade aproximada de registros:** 83,901

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `timestamp` | datetime | YES | CURRENT_TIMESTAMP | MUL | idx_timestamp | — | — |
| `tipo` | varchar(20) | YES | — | — | — | — | — |
| `origem` | varchar(50) | YES | — | — | — | — | — |
| `destino` | varchar(50) | YES | — | — | — | — | — |
| `codstatus` | varchar(50) | YES | — | MUL | idx_codstatus | — | — |
| `nro` | int | YES | — | — | — | — | — |
| `ano` | int | YES | — | — | — | — | — |
| `detalhes` | text | YES | — | — | — | — | — |
| `sucesso` | tinyint(1) | YES | 1 | — | — | — | — |
| `erro` | text | YES | — | — | — | — | — |

### Tabela: `monitor_cache_detalhes`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Quantidade aproximada de registros:** 360

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | int | NO | — | PRI | — | — | — |
| `AnoProtocolo` | int | NO | — | PRI | — | — | — |
| `HashConteudo` | varchar(64) | YES | — | — | — | — | — |
| `ConteudoJson` | text | YES | — | — | — | — | — |
| `LastCheck` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `monitor_detalhes_os`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | bigint | NO | — | PRI | — | — | — |
| `AnoProtocoloLinkDet` | bigint | NO | — | PRI | — | — | — |
| `ElemGrafBrasao` | tinyint(1) | YES | — | — | — | — | — |
| `ElemGrafTimbre` | tinyint(1) | YES | — | — | — | — | — |
| `ElemGrafArteGab` | tinyint(1) | YES | — | — | — | — | — |
| `ElemGrafAssinatura` | tinyint(1) | YES | — | — | — | — | — |
| `ElemGrafCarimbo` | text | YES | — | — | — | — | — |
| `InsumosFornecidos` | text | YES | — | — | — | — | — |
| `MaterialFornecido` | tinyint(1) | YES | — | — | — | — | — |
| `ModeloDobra` | tinyint(1) | YES | — | — | — | — | — |
| `Fotolito` | tinyint(1) | YES | — | — | — | — | — |
| `ProvaImpressa` | tinyint(1) | YES | — | — | — | — | — |
| `TipoPublicacaoLink` | text | YES | — | — | — | — | — |
| `MaquinaLink` | text | YES | — | — | — | — | — |
| `Pags` | bigint | YES | — | — | — | — | — |
| `Mult4` | tinyint(1) | YES | — | — | — | — | — |
| `Tiragem` | bigint | YES | — | — | — | — | — |
| `CotaTotal` | bigint | YES | — | — | — | — | — |
| `Titulo` | text | YES | — | — | — | — | — |
| `FormatoLink` | text | YES | — | — | — | — | — |
| `CoeficienteA4` | double | YES | — | — | — | — | — |
| `PapelLink` | text | YES | — | — | — | — | — |
| `PapelDescricao` | text | YES | — | — | — | — | — |
| `FrenteVerso` | tinyint(1) | YES | — | — | — | — | — |
| `Cores` | text | YES | — | — | — | — | — |
| `CoresDescricao` | text | YES | — | — | — | — | — |
| `DescAcabamento` | text | YES | — | — | — | — | — |
| `Observ` | text | YES | — | — | — | — | — |
| `CalcPgs1` | bigint | YES | — | — | — | — | — |
| `CalcQtdCores1` | bigint | YES | — | — | — | — | — |
| `CalcCor1` | text | YES | — | — | — | — | — |
| `CalcPgs2` | bigint | YES | — | — | — | — | — |
| `CalcQtdCores2` | bigint | YES | — | — | — | — | — |
| `CalcCor2` | text | YES | — | — | — | — | — |
| `CalcPgs3` | bigint | YES | — | — | — | — | — |
| `CalcQtdCores3` | bigint | YES | — | — | — | — | — |
| `CalcCor3` | text | YES | — | — | — | — | — |
| `TiragemSolicitada` | bigint | YES | — | — | — | — | — |
| `ModelosArq` | bigint | YES | — | — | — | — | — |
| `lastupdate` | datetime | YES | — | — | — | — | — |
| `sync` | tinyint(1) | YES | — | — | — | — | — |

### Tabela: `monitor_detalhes_sp`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | bigint | NO | — | PRI | — | — | — |
| `AnoProtocoloLinkDet` | bigint | NO | — | PRI | — | — | — |
| `ElemGrafBrasao` | tinyint(1) | YES | — | — | — | — | — |
| `ElemGrafTimbre` | tinyint(1) | YES | — | — | — | — | — |
| `ElemGrafArteGab` | tinyint(1) | YES | — | — | — | — | — |
| `ElemGrafAssinatura` | tinyint(1) | YES | — | — | — | — | — |
| `ElemGrafCarimbo` | text | YES | — | — | — | — | — |
| `InsumosFornecidos` | text | YES | — | — | — | — | — |
| `MaterialFornecido` | tinyint(1) | YES | — | — | — | — | — |
| `ModeloDobra` | tinyint(1) | YES | — | — | — | — | — |
| `Fotolito` | tinyint(1) | YES | — | — | — | — | — |
| `ProvaImpressa` | tinyint(1) | YES | — | — | — | — | — |
| `TipoPublicacaoLink` | text | YES | — | — | — | — | — |
| `MaquinaLink` | text | YES | — | — | — | — | — |
| `Pags` | bigint | YES | — | — | — | — | — |
| `Mult4` | tinyint(1) | YES | — | — | — | — | — |
| `Tiragem` | bigint | YES | — | — | — | — | — |
| `TiragemSolicitada` | bigint | YES | — | — | — | — | — |
| `CotaTotal` | bigint | YES | — | — | — | — | — |
| `Titulo` | text | YES | — | — | — | — | — |
| `FormatoLink` | text | YES | — | — | — | — | — |
| `CoeficienteA4` | double | YES | — | — | — | — | — |
| `PapelLink` | text | YES | — | — | — | — | — |
| `PapelDescricao` | text | YES | — | — | — | — | — |
| `FrenteVerso` | tinyint(1) | YES | — | — | — | — | — |
| `Cores` | text | YES | — | — | — | — | — |
| `CoresDescricao` | text | YES | — | — | — | — | — |
| `DescAcabamento` | text | YES | — | — | — | — | — |
| `Observ` | text | YES | — | — | — | — | — |
| `CalcPgs1` | bigint | YES | — | — | — | — | — |
| `CalcQtdCores1` | bigint | YES | — | — | — | — | — |
| `CalcCor1` | text | YES | — | — | — | — | — |
| `CalcPgs2` | bigint | YES | — | — | — | — | — |
| `CalcQtdCores2` | bigint | YES | — | — | — | — | — |
| `CalcCor2` | text | YES | — | — | — | — | — |
| `CalcPgs3` | bigint | YES | — | — | — | — | — |
| `CalcQtdCores3` | bigint | YES | — | — | — | — | — |
| `CalcCor3` | text | YES | — | — | — | — | — |
| `ModelosArq` | bigint | YES | — | — | — | — | — |
| `lastupdate` | datetime | YES | — | — | — | — | — |
| `sync` | tinyint(1) | YES | — | — | — | — | — |

### Tabela: `monitor_protocol_os`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | bigint | NO | — | PRI | — | — | — |
| `AnoProtocolo` | bigint | NO | — | PRI | — | — | — |
| `DataEntrada` | datetime | YES | — | — | — | — | — |
| `ProcessoSolicit` | text | YES | — | — | — | — | — |
| `CSnro` | text | YES | — | — | — | — | — |
| `CategoriaLink` | text | YES | — | — | — | — | — |
| `CodUsuarioLink` | text | YES | — | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — | — |
| `NomeUsuario` | text | YES | — | — | — | — | — |
| `Solicitante` | text | YES | — | — | — | — | — |
| `OrgInteressado` | text | YES | — | — | — | — | — |
| `SiglaOrgao` | text | YES | — | — | — | — | — |
| `Titular` | text | YES | — | — | — | — | — |
| `GabSalaUsuario` | text | YES | — | — | — | — | — |
| `Localizacao` | text | YES | — | — | — | — | — |
| `Andar` | text | YES | — | — | — | — | — |
| `RamalUsuario` | bigint | YES | — | — | — | — | — |
| `ContatoTrab` | text | YES | — | — | — | — | — |
| `ResponsavelGrafLink` | text | YES | — | — | — | — | — |
| `EntregaFormaLink` | text | YES | — | — | — | — | — |
| `EntregPrazoLink` | text | YES | — | — | — | — | — |
| `EntregData` | datetime | YES | — | — | — | — | — |
| `EntregPeriodo` | text | YES | — | — | — | — | — |
| `ReqLançada` | tinyint(1) | YES | — | — | — | — | — |
| `ReqEntregue` | tinyint(1) | YES | — | — | — | — | — |
| `DataConclusao` | datetime | YES | — | — | — | — | — |
| `ArmazenadoEm` | text | YES | — | — | — | — | — |
| `ContatoRecebim` | text | YES | — | — | — | — | — |
| `RetiradaNome` | text | YES | — | — | — | — | — |
| `RetiradaPonto` | text | YES | — | — | — | — | — |
| `RecebimData` | datetime | YES | — | — | — | — | — |
| `PontoEntrega` | text | YES | — | — | — | — | — |
| `SetorEntrega` | text | YES | — | — | — | — | — |
| `CancelamentoMotivo` | text | YES | — | — | — | — | — |
| `CancelamentoPonto` | text | YES | — | — | — | — | — |
| `CancelamentoData` | datetime | YES | — | — | — | — | — |
| `CancelamentoSetor` | text | YES | — | — | — | — | — |
| `CotaRepro` | bigint | YES | — | — | — | — | — |
| `CotaCartao` | text | YES | — | — | — | — | — |
| `ReimprimirOS` | tinyint(1) | YES | — | — | — | — | — |
| `DebitarCGRAF` | tinyint(1) | YES | — | — | — | — | — |
| `lastupdate` | datetime | YES | — | — | — | — | — |
| `sync` | tinyint(1) | YES | — | — | — | — | — |

### Tabela: `monitor_protocol_sp`

**Finalidade aparente:** Sync / monitor / cache / log  
**Origem:** Sync (Web)  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | bigint | NO | — | PRI | — | — | — |
| `AnoProtocolo` | bigint | NO | — | PRI | — | — | — |
| `DataEntrada` | datetime | YES | — | — | — | — | — |
| `ProcessoSolicit` | text | YES | — | — | — | — | — |
| `CSnro` | text | YES | — | — | — | — | — |
| `CategoriaLink` | text | YES | — | — | — | — | — |
| `CodUsuarioLink` | text | YES | — | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — | — |
| `NomeUsuario` | text | YES | — | — | — | — | — |
| `Solicitante` | text | YES | — | — | — | — | — |
| `OrgInteressado` | text | YES | — | — | — | — | — |
| `SiglaOrgao` | text | YES | — | — | — | — | — |
| `Titular` | text | YES | — | — | — | — | — |
| `GabSalaUsuario` | text | YES | — | — | — | — | — |
| `Localizacao` | text | YES | — | — | — | — | — |
| `Andar` | text | YES | — | — | — | — | — |
| `RamalUsuario` | bigint | YES | — | — | — | — | — |
| `ContatoTrab` | text | YES | — | — | — | — | — |
| `ResponsavelGrafLink` | text | YES | — | — | — | — | — |
| `EntregaFormaLink` | text | YES | — | — | — | — | — |
| `EntregPrazoLink` | text | YES | — | — | — | — | — |
| `EntregData` | datetime | YES | — | — | — | — | — |
| `EntregPeriodo` | text | YES | — | — | — | — | — |
| `ReqLançada` | tinyint(1) | YES | — | — | — | — | — |
| `ReqEntregue` | tinyint(1) | YES | — | — | — | — | — |
| `DataConclusao` | text | YES | — | — | — | — | — |
| `ArmazenadoEm` | text | YES | — | — | — | — | — |
| `ContatoRecebim` | text | YES | — | — | — | — | — |
| `RetiradaNome` | text | YES | — | — | — | — | — |
| `RetiradaPonto` | text | YES | — | — | — | — | — |
| `RecebimData` | datetime | YES | — | — | — | — | — |
| `PontoEntrega` | text | YES | — | — | — | — | — |
| `SetorEntrega` | text | YES | — | — | — | — | — |
| `CancelamentoMotivo` | text | YES | — | — | — | — | — |
| `CancelamentoPonto` | text | YES | — | — | — | — | — |
| `CancelamentoData` | datetime | YES | — | — | — | — | — |
| `CancelamentoSetor` | text | YES | — | — | — | — | — |
| `CotaRepro` | bigint | YES | — | — | — | — | — |
| `CotaCartao` | text | YES | — | — | — | — | — |
| `ReimprimirOS` | tinyint(1) | YES | — | — | — | — | — |
| `DebitarCGRAF` | tinyint(1) | YES | — | — | — | — | — |
| `lastupdate` | datetime | YES | — | — | — | — | — |
| `sync` | tinyint(1) | YES | — | — | — | — | — |

### Tabela: `normalizacao_state`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `last_raw_pk` | bigint | NO | 0 | — | — | — | — |
| `updated_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `normalizacao_state_v2`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `protocolo` | varchar(50) | NO | — | PRI | — | — | — |
| `ano` | int | NO | — | PRI | — | — | — |
| `row_hash` | char(40) | NO | — | — | — | — | — |
| `processed_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `os_acabamentos`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `os_ano` | int | NO | — | — | — | — | — |
| `os_numero` | int | NO | — | — | — | — | — |
| `acabamento_id` | int | NO | — | MUL | fk_acabamento_catalogo | — | — |
| `escopo` | enum('GLOBAL','CAPA','MIOLO','UNICO') | YES | GLOBAL | — | — | — | — |
| `componente_id` | int | YES | — | MUL | fk_acabamento_componente | — | — |
| `parametros_json` | longtext | YES | — | — | — | — | — |
| `resumo_textual` | text | YES | — | — | — | — | — |
| `observacoes` | text | YES | — | — | — | — | — |
| `criado_em` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `criado_por` | varchar(50) | YES | — | — | — | — | — |
| `atualizado_em` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `atualizado_por` | varchar(50) | YES | — | — | — | — | — |

### Tabela: `os_componente_lotes`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `componente_id` | int | NO | — | MUL | fk_lote_componente | — | — |
| `ordem` | int | YES | 1 | — | — | — | — |
| `qtd_paginas` | int | YES | 0 | — | — | — | — |
| `maquina_link` | varchar(120) | YES | — | — | — | — | — |
| `papel_link` | varchar(120) | YES | — | — | — | — | — |
| `papel_descricao` | text | YES | — | — | — | — | — |
| `cores_resumo` | varchar(255) | YES | — | — | — | — | — |
| `cores_tipo` | varchar(60) | YES | — | — | — | — | — |
| `frente_verso` | tinyint(1) | YES | — | — | — | — | — |
| `criado_em` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `criado_por` | varchar(50) | YES | — | — | — | — | — |
| `atualizado_em` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `atualizado_por` | varchar(50) | YES | — | — | — | — | — |

### Tabela: `os_componentes`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `os_ano` | int | NO | — | MUL | os_ano | — | — |
| `os_numero` | int | NO | — | — | os_ano | — | — |
| `tipo` | enum('CAPA','MIOLO','UNICO') | NO | — | — | os_ano | — | — |
| `produto_nome` | varchar(120) | YES | — | — | — | — | — |
| `qtd_paginas_total` | int | YES | 0 | — | — | — | — |
| `paginas_fixas` | tinyint(1) | YES | 0 | — | — | — | — |
| `frente_verso` | tinyint(1) | YES | 0 | — | — | — | — |
| `formato` | varchar(120) | YES | — | — | — | — | — |
| `ignorar_validacao_mult4` | tinyint(1) | YES | 0 | — | — | — | — |
| `observacoes_tecnicas` | text | YES | — | — | — | — | — |
| `criado_em` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `criado_por` | varchar(50) | YES | — | — | — | — | — |
| `atualizado_em` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `atualizado_por` | varchar(50) | YES | — | — | — | — | — |

### Tabela: `papel`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `nome` | varchar(100) | NO | — | MUL | nome | — | — |
| `gramatura` | int | YES | — | — | nome | — | — |
| `acabamento` | varchar(100) | YES | — | — | nome | — | — |
| `observacoes` | text | YES | — | — | — | — | — |

### Tabela: `produto`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `protocolo` | varchar(50) | YES | — | — | — | — | — |
| `ano` | int | YES | — | — | — | — | — |
| `titulo` | varchar(255) | YES | — | — | — | — | — |
| `tipo_publicacao` | varchar(100) | YES | — | — | — | — | — |
| `formato` | varchar(50) | YES | — | — | — | — | — |
| `tiragem` | int | YES | — | — | — | — | — |
| `observacoes` | text | YES | — | — | — | — | — |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `produto_componente`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `produto_id` | int | NO | — | MUL | produto_id | — | — |
| `tipo` | enum('CAPA','MIOLO','ENCARTE','OUTRO') | NO | — | — | — | — | — |
| `descricao` | varchar(255) | YES | — | — | — | — | — |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `sagra_sync_change_log`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | idx_log_fetch | — | — |
| `source` | varchar(32) | NO | — | — | idx_log_fetch | — | — |
| `table_name` | varchar(64) | NO | — | — | idx_log_fetch | — | — |
| `op` | varchar(16) | NO | — | — | — | — | — |
| `pk_json` | longtext | NO | — | — | — | — | — |
| `happened_at` | datetime(6) | NO | — | — | — | — | — |
| `row_json` | longtext | YES | — | — | — | — | — |
| `ignored` | tinyint(1) | NO | 0 | MUL | idx_log_fetch | — | — |
| `ignore_reason` | varchar(255) | YES | — | — | — | — | — |

### Tabela: `sagra_sync_meta`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `k` | varchar(64) | NO | — | PRI | — | — | — |
| `v` | text | YES | — | — | — | — | — |

### Tabela: `sagra_sync_row_state`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `table_name` | varchar(64) | NO | — | PRI | idx_state_ignored, idx_state_seen | — | — |
| `source` | varchar(32) | NO | — | PRI | idx_state_ignored, idx_state_seen | — | — |
| `pk_hash` | char(64) | NO | — | PRI | — | — | — |
| `pk_json` | longtext | NO | — | — | — | — | — |
| `row_hash` | char(64) | NO | — | — | — | — | — |
| `last_seen_scan` | bigint | NO | — | — | idx_state_seen | — | — |
| `last_seen_at` | datetime(6) | NO | — | — | — | — | — |
| `ignored_deleted` | tinyint(1) | NO | 0 | — | idx_state_ignored | — | — |
| `ignored_reason` | varchar(255) | YES | — | — | — | — | — |

### Tabela: `sagra_sync_state`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `table_name` | varchar(100) | NO | — | PRI | — | — | — |
| `pk_json` | text | NO | — | PRI | — | — | — |
| `row_hash` | char(64) | NO | — | — | — | — | — |
| `last_seen` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `shadow_tabandamento_mdb`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodStatus` | varchar(20) | NO | — | PRI | — | — | — |
| `row_hash` | char(64) | NO | — | — | — | — | — |
| `last_seen_mdb` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `last_synced_to_mysql` | timestamp | YES | — | — | — | — | — |
| `last_mysql_event_at` | timestamp | YES | — | — | — | — | — |
| `last_mysql_hash` | char(64) | YES | — | — | — | — | — |

### Tabela: `shadow_tabdetalhesservico_mdb`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | int | NO | — | PRI | — | — | — |
| `AnoProtocoloLinkDet` | int | NO | — | PRI | — | — | — |
| `row_hash` | char(64) | NO | — | — | — | — | — |
| `last_seen_mdb` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `last_synced_to_mysql` | timestamp | YES | — | — | — | — | — |
| `last_mysql_event_at` | timestamp | YES | — | — | — | — | — |
| `last_mysql_hash` | char(64) | YES | — | — | — | — | — |

### Tabela: `shadow_tabprotocolos_mdb`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | int | NO | — | PRI | — | — | — |
| `AnoProtocolo` | int | NO | — | PRI | — | — | — |
| `row_hash` | char(64) | NO | — | — | — | — | — |
| `last_seen_mdb` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `last_synced_to_mysql` | timestamp | YES | — | — | — | — | — |
| `last_mysql_event_at` | timestamp | YES | — | — | — | — | — |
| `last_mysql_hash` | char(64) | YES | — | — | — | — | — |

### Tabela: `stg_normalizacao`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `id_origem` | int | YES | — | — | — | — | — |
| `papel_raw` | text | YES | — | — | — | — | — |
| `papel_nome` | varchar(100) | YES | — | — | — | — | — |
| `papel_gramatura` | int | YES | — | — | — | — | — |
| `papel_acabamento` | varchar(100) | YES | — | — | — | — | — |
| `cor_raw` | text | YES | — | — | — | — | — |
| `cor_codigo` | varchar(10) | YES | — | — | — | — | — |
| `cor_descricao` | varchar(100) | YES | — | — | — | — | — |
| `acabamento_raw` | text | YES | — | — | — | — | — |
| `acabamento_normalizado` | text | YES | — | — | — | — | — |
| `status` | enum('OK','PENDENTE','ERRO') | YES | PENDENTE | — | — | — | — |
| `observacoes` | text | YES | — | — | — | — | — |

### Tabela: `stg_revisao_manual`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `id_origem` | int | YES | — | — | — | — | — |
| `campo` | varchar(100) | YES | — | — | — | — | — |
| `valor_original` | text | YES | — | — | — | — | — |
| `sugestao` | text | YES | — | — | — | — | — |
| `resolvido` | tinyint(1) | YES | 0 | — | — | — | — |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `suspected_deletes`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `table_name` | varchar(64) | NO | — | MUL | idx_suspect_table_status | — | — |
| `pk_json` | longtext | NO | — | — | — | — | — |
| `pk_hash` | char(64) | NO | — | PRI | — | — | — |
| `first_missing_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `last_missing_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `missing_count` | int | NO | 1 | — | — | — | — |
| `status` | enum('SUSPECT','CONFIRMED','CANCELLED') | NO | SUSPECT | — | idx_suspect_table_status | — | — |
| `last_action` | text | YES | — | — | — | — | — |

### Tabela: `sync_baseline_detalhes`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | int | NO | — | PRI | — | — | — |
| `AnoProtocoloLinkDet` | int | NO | — | PRI | — | — | — |
| `hash_p` | char(64) | NO | — | — | — | — | — |
| `hash_m` | char(64) | NO | — | — | — | — | — |
| `baseline_at` | datetime | NO | — | — | — | — | — |

### Tabela: `sync_baseline_protocolos`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | int | NO | — | PRI | — | — | — |
| `AnoProtocolo` | int | NO | — | PRI | — | — | — |
| `hash_p` | char(64) | NO | — | — | — | — | — |
| `hash_m` | char(64) | NO | — | — | — | — | — |
| `baseline_at` | datetime | NO | — | — | — | — | — |

### Tabela: `sync_changes_log`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `table_name` | varchar(50) | NO | — | — | — | — | — |
| `pk_json` | longtext | NO | — | — | — | — | — |
| `action` | enum('INSERT','UPDATE','DELETE') | NO | — | — | — | — | — |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `processed` | tinyint(1) | YES | 0 | MUL | idx_processed | — | — |

### Tabela: `sync_circuit_breaker`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `name` | varchar(64) | NO | — | PRI | — | — | — |
| `is_open` | tinyint | NO | 0 | — | — | — | — |
| `reason` | text | YES | — | — | — | — | — |
| `opened_at` | timestamp | YES | — | — | — | — | — |
| `updated_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `sync_control`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `name` | varchar(64) | NO | — | PRI | — | — | — |
| `value` | varchar(255) | YES | — | — | — | — | — |
| `updated_at` | datetime | YES | — | — | — | — | — |

### Tabela: `sync_hash_detalhes`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `nro` | int | NO | — | PRI | — | — | — |
| `ano` | int | NO | — | PRI | — | — | — |
| `hash_mdb` | char(64) | YES | — | — | — | — | — |
| `hash_mysql` | char(64) | YES | — | — | — | — | — |
| `last_sync` | timestamp | YES | — | — | — | — | — |

### Tabela: `sync_hash_protocolos`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `nro` | int | NO | — | PRI | — | — | — |
| `ano` | int | NO | — | PRI | — | — | — |
| `hash_mdb` | char(64) | YES | — | — | — | — | — |
| `hash_mysql` | char(64) | YES | — | — | — | — | — |
| `last_sync` | timestamp | YES | — | — | — | — | — |

### Tabela: `sync_meta_detalhes`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | int | NO | — | PRI | — | — | — |
| `AnoProtocoloLinkDet` | int | NO | — | PRI | — | — | — |
| `last_hash_protocolos` | varchar(64) | YES | — | — | — | — | — |
| `last_seen_change_protocolos` | timestamp | YES | — | — | — | — | — |
| `last_hash_p` | varchar(64) | YES | — | — | — | — | — |
| `last_hash_m` | varchar(64) | YES | — | — | — | — | — |
| `last_seen_hash_p` | varchar(64) | YES | — | — | — | — | — |
| `last_seen_hash_m` | varchar(64) | YES | — | — | — | — | — |
| `last_seen_change_p` | datetime | YES | — | — | — | — | — |
| `last_seen_change_m` | datetime | YES | — | — | — | — | — |

### Tabela: `sync_meta_protocolos`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | int | NO | — | PRI | — | — | — |
| `AnoProtocolo` | int | NO | — | PRI | — | — | — |
| `last_seen_hash_p` | char(64) | YES | — | — | — | — | — |
| `last_seen_change_p` | datetime | YES | — | — | — | — | — |
| `last_hash_p` | varchar(64) | YES | — | — | — | — | — |
| `last_hash_m` | varchar(64) | YES | — | — | — | — | — |
| `last_seen_hash_m` | varchar(64) | YES | — | — | — | — | — |
| `last_seen_change_m` | datetime | YES | — | — | — | — | — |

### Tabela: `sync_missing_candidates`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `table_name` | varchar(64) | NO | — | MUL | idx_tbl_src | — | — |
| `pk_hash` | char(64) | NO | — | PRI | — | — | — |
| `pk_json` | longtext | NO | — | — | — | — | — |
| `mdb_source` | enum('OS','PAP') | NO | — | — | idx_tbl_src | — | — |
| `first_missing_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `last_check_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `miss_count` | int | NO | 1 | — | — | — | — |
| `last_error` | text | YES | — | — | — | — | — |

### Tabela: `sync_outbox`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint unsigned | NO | — | PRI | — | — | — |
| `source` | varchar(20) | NO | mysql | — | — | — | — |
| `table_name` | varchar(64) | NO | — | MUL | idx_outbox_table | — | — |
| `op` | enum('I','U','D') | NO | — | — | — | — | — |
| `pk_json` | longtext | NO | — | — | — | — | — |
| `row_json` | longtext | YES | — | — | — | — | — |
| `row_hash` | char(64) | YES | — | — | — | — | — |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | — | idx_outbox_status_created, idx_outbox_table | — | — |
| `status` | enum('NEW','PROCESSING','DONE','ERROR','SKIPPED') | NO | NEW | MUL | idx_outbox_status_created | — | — |
| `attempts` | int | NO | 0 | — | — | — | — |
| `last_error` | text | YES | — | — | — | — | — |
| `locked_at` | timestamp | YES | — | — | — | — | — |
| `locked_by` | varchar(64) | YES | — | — | — | — | — |
| `processed_at` | timestamp | YES | — | — | — | — | — |

### Tabela: `sync_outbox_dedupe`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `dedupe_key` | char(64) | NO | — | PRI | — | — | — |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | MUL | idx_dedupe_created | — | — |

### Tabela: `sync_state`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `name` | varchar(64) | NO | — | PRI | — | — | — |
| `value` | text | YES | — | — | — | — | — |
| `updated_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `initialized` | tinyint(1) | NO | 0 | — | — | — | — |
| `last_run` | datetime | YES | — | — | — | — | — |

### Tabela: `sync_status`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `table_name` | varchar(64) | NO | — | PRI | — | — | — |
| `pk1` | varchar(32) | NO | — | PRI | — | — | — |
| `pk2` | varchar(32) | NO | — | PRI | — | — | — |
| `last_snapshot` | longtext | YES | — | — | — | — | — |

### Tabela: `sync_v2_baseline_detalhes`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | int | NO | — | PRI | — | — | — |
| `AnoProtocoloLinkDet` | int | NO | — | PRI | — | — | — |
| `hash_new` | varchar(64) | NO | — | — | — | — | — |
| `hash_mir` | varchar(64) | NO | — | — | — | — | — |
| `baseline_at` | datetime | NO | — | — | — | — | — |

### Tabela: `sync_v2_baseline_protocolos`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | int | NO | — | PRI | — | — | — |
| `AnoProtocolo` | int | NO | — | PRI | — | — | — |
| `hash_new` | varchar(64) | NO | — | — | — | — | — |
| `hash_mir` | varchar(64) | NO | — | — | — | — | — |
| `baseline_at` | datetime | NO | — | — | — | — | — |

### Tabela: `sync_v2_meta_detalhes`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | int | NO | — | PRI | — | — | — |
| `AnoProtocoloLinkDet` | int | NO | — | PRI | — | — | — |
| `last_hash_new` | varchar(64) | YES | — | — | — | — | — |
| `last_seen_change_new` | datetime | YES | — | — | — | — | — |

### Tabela: `sync_v2_meta_protocolos`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | int | NO | — | PRI | — | — | — |
| `AnoProtocolo` | int | NO | — | PRI | — | — | — |
| `last_hash_new` | varchar(64) | YES | — | — | — | — | — |
| `last_seen_change_new` | datetime | YES | — | — | — | — | — |

### Tabela: `sync_v2_state`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `state_key` | tinyint | NO | — | PRI | — | — | — |
| `initialized` | tinyint | NO | 0 | — | — | — | — |
| `initialized_at` | datetime | YES | — | — | — | — | — |

### Tabela: `tab_os_audit_log`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 1,102

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | — | — | — |
| `nro_protocolo` | int | NO | — | — | idx_os_audit_os | — | — |
| `ano_protocolo` | int | NO | — | MUL | idx_os_audit_os | — | — |
| `evento_em` | datetime | NO | — | — | idx_os_audit_os | — | — |
| `acao` | varchar(40) | NO | — | — | — | — | — |
| `entidade` | varchar(40) | NO | — | — | — | — | — |
| `campo` | varchar(80) | YES | — | — | — | — | — |
| `valor_anterior` | text | YES | — | — | — | — | — |
| `valor_novo` | text | YES | — | — | — | — | — |
| `ponto` | varchar(20) | YES | — | — | — | — | — |
| `client_ip` | varchar(45) | YES | — | — | — | — | — |
| `ref_cod` | varchar(64) | YES | — | MUL | idx_os_audit_ref | — | — |
| `origem` | varchar(40) | NO | API | — | — | — | — |
| `descricao` | text | YES | — | — | — | — | — |

### Tabela: `tab_os_componentes`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 12

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | — | — | — |
| `nro_protocolo` | int | NO | — | — | idx_os_componentes_nome_norm, idx_os_componentes_os | — | — |
| `ano_protocolo` | int | NO | — | MUL | idx_os_componentes_nome_norm, idx_os_componentes_os | — | — |
| `nome` | varchar(120) | NO | — | — | — | — | — |
| `nome_normalizado` | varchar(120) | NO | — | — | idx_os_componentes_nome_norm | — | — |
| `tipo` | varchar(20) | YES | — | — | — | — | — |
| `ordem` | int | NO | 0 | — | — | — | — |
| `ativo` | tinyint(1) | NO | 1 | — | idx_os_componentes_os | — | — |
| `techspec_json` | json | YES | — | — | — | — | — |
| `criado_em` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `criado_por` | varchar(32) | YES | — | — | — | — | — |
| `atualizado_em` | datetime | YES | — | — | — | — | — |
| `atualizado_por` | varchar(32) | YES | — | — | — | — | — |

### Tabela: `tab_os_filter_produtos`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 61

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | — | — | — |
| `produto` | varchar(255) | NO | — | MUL | idx_filter_produtos_label | — | — |
| `produto_normalizado` | varchar(255) | NO | — | UNI | idx_filter_produtos_norm, uk_produto_normalizado | — | — |
| `total_os` | int | NO | 0 | — | — | — | — |
| `ultima_os_ano` | int | YES | — | — | — | — | — |
| `atualizado_em` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tab_os_filter_solicitantes`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 1,977

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | — | — | — |
| `solicitante` | varchar(255) | NO | — | MUL | idx_filter_solicitantes_label | — | — |
| `solicitante_normalizado` | varchar(255) | NO | — | UNI | idx_filter_solicitantes_norm, uk_solicitante_normalizado | — | — |
| `total_os` | int | NO | 0 | — | — | — | — |
| `ultima_os_ano` | int | YES | — | — | — | — | — |
| `atualizado_em` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tab_os_sub_os`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 6

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | — | — | — |
| `nro_protocolo` | int | NO | — | MUL | idx_sub_os_os, idx_sub_os_os_ativo, uk_sub_os_os_componente | — | — |
| `ano_protocolo` | int | NO | — | MUL | idx_sub_os_os, idx_sub_os_os_ativo, uk_sub_os_os_componente | — | — |
| `componente_id` | bigint | NO | — | — | uk_sub_os_os_componente | — | — |
| `display_name` | varchar(160) | NO | — | — | — | — | — |
| `ativo` | tinyint(1) | NO | 1 | — | idx_sub_os_os, idx_sub_os_os_ativo | — | — |
| `congelada` | tinyint(1) | NO | 0 | — | — | — | — |
| `criado_em` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `criado_por` | varchar(32) | YES | — | — | — | — | — |

### Tabela: `tab_os_sub_os_andamento`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | — | — | — |
| `sub_os_id` | bigint | NO | — | MUL | idx_sub_os_andamento_filtro, idx_sub_os_andamento_sub, uk_sub_os_andamento_inherited | — | — |
| `situacao` | varchar(120) | NO | — | — | idx_sub_os_andamento_filtro | — | — |
| `setor` | varchar(80) | NO | — | — | idx_sub_os_andamento_filtro | — | — |
| `observacao` | text | YES | — | — | — | — | — |
| `data` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `ultimo_status` | tinyint(1) | NO | 0 | MUL | idx_sub_os_andamento_filtro, idx_sub_os_andamento_sub | — | — |
| `ponto` | varchar(32) | YES | — | — | — | — | — |
| `cod_status_espelho` | varchar(32) | YES | — | MUL | idx_sub_os_andamento_espelho | — | — |
| `criado_em` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `criado_por` | varchar(32) | YES | — | — | — | — | — |
| `source_type` | varchar(32) | YES | manual_sub_os | — | — | — | — |
| `source_cod_status` | varchar(32) | YES | — | — | uk_sub_os_andamento_inherited | — | — |
| `herdado_da_os_principal` | tinyint(1) | NO | 0 | — | — | — | — |

### Tabela: `tab_os_ultimo_andamento_operacional`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 84,075

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `nro_protocolo` | int | NO | — | PRI | idx_ua_oper_ano_nro | — | — |
| `ano_protocolo` | int | NO | — | PRI | idx_ua_oper_ano_nro | — | — |
| `cod_status` | varchar(32) | YES | — | — | — | — | — |
| `situacao` | varchar(120) | YES | — | MUL | idx_ua_oper_setor_situacao, idx_ua_oper_situacao | — | — |
| `setor` | varchar(80) | YES | — | MUL | idx_ua_oper_setor, idx_ua_oper_setor_situacao | — | — |
| `data` | datetime | YES | — | MUL | idx_ua_oper_data | — | — |
| `observacao` | text | YES | — | — | — | — | — |
| `ponto` | varchar(32) | YES | — | — | — | — | — |
| `ultimo_status` | tinyint(1) | NO | 0 | — | — | — | — |
| `atualizado_em` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tab_pcp_fila`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 291

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `setor` | varchar(64) | NO | — | MUL | idx_setor_ordem, uniq_setor_os | — | — |
| `nro_os` | int | NO | — | — | uniq_setor_os | — | — |
| `ano` | int | NO | — | — | uniq_setor_os | — | — |
| `ordem` | int | NO | — | — | idx_setor_ordem | — | — |
| `ultima_atualizacao` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tab_pre_analise_snapshot`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 11

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | — | — | — |
| `AnoProtocolo` | int | NO | — | MUL | idx_pre_analise_os, uk_pre_analise_os_versao | — | — |
| `NroProtocolo` | int | NO | — | — | idx_pre_analise_os, uk_pre_analise_os_versao | — | — |
| `VersaoLabel` | varchar(255) | NO | — | — | uk_pre_analise_os_versao | — | — |
| `ResultsJson` | longtext | NO | — | — | — | — | — |
| `CheckCount` | int | NO | 0 | — | — | — | — |
| `AlertCount` | int | NO | 0 | — | — | — | — |
| `ExecutadoEm` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `ExecutadoPor` | varchar(32) | YES | — | — | — | — | — |

### Tabela: `tab_pre_analise_timing`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 162

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | — | — | — |
| `check_id` | varchar(64) | NO | — | MUL | idx_timing_lookup | — | — |
| `pdf_count` | int | NO | 0 | — | idx_timing_lookup, idx_timing_setup | — | — |
| `total_pages` | int | NO | 0 | — | idx_timing_lookup | — | — |
| `formato_bucket` | varchar(32) | NO | unknown | — | idx_timing_lookup, idx_timing_setup | — | — |
| `duration_ms` | int | NO | — | — | — | — | — |
| `phase` | varchar(16) | NO | check | MUL | idx_timing_setup | — | — |
| `sampled_at` | datetime | YES | CURRENT_TIMESTAMP | — | idx_timing_lookup, idx_timing_setup | — | — |

### Tabela: `tab_pre_analise_timing_file`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 184

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | bigint | NO | — | PRI | — | — | — |
| `check_id` | varchar(64) | NO | — | MUL | idx_file_name, idx_file_timing | — | — |
| `pdf_name` | varchar(255) | NO | — | — | idx_file_name | — | — |
| `page_count` | int | NO | — | — | idx_file_name, idx_file_timing | — | — |
| `formato_bucket` | varchar(32) | NO | unknown | — | idx_file_timing | — | — |
| `duration_ms` | int | NO | — | — | — | — | — |
| `ms_per_page` | int | NO | 0 | — | — | — | — |
| `sampled_at` | datetime | YES | CURRENT_TIMESTAMP | — | idx_file_timing | — | — |

### Tabela: `tabanaliseitens`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 4,017

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `ID_Analise` | int | NO | — | MUL | ID_Analise | — | — |
| `ID_ProblemaPadrao` | int | YES | — | — | — | — | — |
| `Obs` | text | YES | — | — | — | — | — |
| `HTML_Snapshot` | longtext | YES | — | — | — | — | — |
| `Componente` | varchar(255) | YES | — | — | — | — | — |
| `Versao` | varchar(50) | YES | — | — | — | — | — |
| `Desconsiderado` | tinyint(1) | YES | 0 | — | — | — | — |
| `ClienteNome` | varchar(150) | YES | — | — | — | — | — |
| `ClientePonto` | varchar(20) | YES | — | — | — | — | — |
| `DataDesconsiderado` | datetime | YES | — | — | — | — | — |
| `Resolver` | tinyint(1) | YES | 0 | — | — | — | — |
| `DataResolver` | datetime | YES | — | — | — | — | — |
| `ResolucaoObrigatoria` | tinyint(1) | NO | 0 | — | — | — | — |
| `CorrigidoSefoc` | tinyint(1) | NO | 0 | — | — | — | — |
| `ObsCorrecaoSefoc` | text | YES | — | — | — | — | — |

### Tabela: `tabanalises`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 760

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `OS` | int | NO | — | MUL | unique_os_analise | — | — |
| `Ano` | int | NO | — | — | unique_os_analise | — | — |
| `Versao` | varchar(50) | YES | — | — | — | — | — |
| `Componente` | varchar(100) | YES | — | — | — | — | — |
| `Usuario` | varchar(100) | YES | — | — | — | — | — |
| `DataCriacao` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `RelatorioHTML` | longtext | YES | — | — | — | — | — |
| `RelatorioEmail` | longtext | YES | — | — | — | — | — |

### Tabela: `taband1atiposdepend`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodTipoDePend` | int | YES | — | — | — | — | — |
| `TipoDePendencia` | text | YES | — | — | — | — | — |

### Tabela: `taband1tipopend`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodAndamTipoPend` | text | YES | — | — | — | — | — |
| `CodStatusLink` | text | YES | — | — | — | — | — |
| `CodTiposDePendLink` | int | YES | — | — | — | — | — |
| `Descricao` | text | YES | — | — | — | — | — |

### Tabela: `taband2contatos`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodAndamContato` | text | YES | — | — | — | — | — |
| `DataContato` | text | YES | — | — | — | — | — |
| `HoraContato` | text | YES | — | — | — | — | — |
| `CodAndamTipoPendLink` | text | YES | — | — | — | — | — |
| `Contato` | text | YES | — | — | — | — | — |
| `PrazoCombinado` | text | YES | — | — | — | — | — |
| `Resolucao` | text | YES | — | — | — | — | — |

### Tabela: `taband3aitensdesccompleta`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodItemDescComp` | int | YES | — | — | — | — | — |
| `DescricaoComp` | text | YES | — | — | — | — | — |

### Tabela: `taband3descricaocompleta`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodAndDescCompleta` | text | YES | — | — | — | — | — |
| `CodAndamTipoPendLink` | text | YES | — | — | — | — | — |
| `CodItemDescCompLink` | text | YES | — | — | — | — | — |

### Tabela: `tabandamento`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** MDB + MySQL (duplicata de casing)  
**Quantidade aproximada de registros:** 199,180

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodStatus` | varchar(20) | NO | — | PRI | idx_andamento_os_operacional, idx_andamento_os_ultimo_data | — | — |
| `NroProtocoloLink` | int | YES | — | MUL | idx_andamento_os_operacional, idx_andamento_os_ultimo_data, idx_andamento_protocolo | — | — |
| `AnoProtocoloLink` | int | YES | — | — | idx_andamento_os_operacional, idx_andamento_os_ultimo_data, idx_andamento_protocolo | — | — |
| `SituacaoLink` | text | YES | — | MUL | idx_andamento_filtros, idx_panel_opt | — | — |
| `SetorLink` | text | YES | — | — | idx_andamento_filtros, idx_panel_opt | — | — |
| `Data` | datetime | YES | — | — | idx_andamento_os_operacional, idx_andamento_os_ultimo_data | — | — |
| `UltimoStatus` | tinyint | YES | — | MUL | idx_andamento_filtros, idx_andamento_os_operacional, idx_andamento_os_ultimo_data, idx_panel_opt | — | — |
| `Observaçao` | text | YES | — | — | — | — | — |
| `Ponto` | text | YES | — | — | — | — | — |

### Tabela: `tabcalculosos`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `os_numero` | int | NO | — | MUL | unique_os | — | — |
| `os_ano` | int | NO | — | — | unique_os | — | — |
| `capa_color` | int | YES | 0 | — | — | — | — |
| `capa_pb` | int | YES | 0 | — | — | — | — |
| `miolo_color` | int | YES | 0 | — | — | — | — |
| `miolo_pb` | int | YES | 0 | — | — | — | — |
| `altura_mm` | decimal(10,2) | YES | 0.00 | — | — | — | — |
| `largura_mm` | decimal(10,2) | YES | 0.00 | — | — | — | — |
| `coef_a4` | decimal(10,3) | YES | 0.000 | — | — | — | — |
| `total_paginas` | int | YES | 0 | — | — | — | — |
| `tiragem` | int | YES | 0 | — | — | — | — |
| `cota_total` | decimal(10,2) | YES | 0.00 | — | — | — | — |
| `usuario_registro` | varchar(50) | YES | — | — | — | — | — |
| `data_registro` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabcategorias`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 3

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Categoria` | text | YES | — | — | — | — | — |

### Tabela: `tabclientegabinete`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 4

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `Gabinete` | varchar(255) | NO | — | MUL | idx_cliente_gabinete | — | — |
| `TipoConta` | varchar(16) | NO | gabinete | — | — | — | — |
| `Email` | varchar(255) | NO | — | UNI | uq_cliente_email | — | — |
| `PasswordHash` | varchar(255) | YES | — | — | — | — | — |
| `Nome` | varchar(255) | NO | — | — | — | — | — |
| `ParentID` | int | YES | — | MUL | fk_cliente_parent | — | — |
| `AuthAtivo` | tinyint(1) | NO | 1 | — | — | — | — |
| `EmailVerified` | tinyint(1) | NO | 0 | — | — | — | — |
| `ActivationToken` | varchar(64) | YES | — | — | — | — | — |
| `ActivationExpires` | datetime | YES | — | — | — | — | — |
| `PasswordResetToken` | varchar(64) | YES | — | — | — | — | — |
| `PasswordResetExpires` | datetime | YES | — | — | — | — | — |
| `CreatedAt` | timestamp | YES | CURRENT_TIMESTAMP | — | — | — | — |
| `UpdatedAt` | timestamp | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabclienttokens`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 22

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `ID_Analise` | int | NO | — | MUL | ID_Analise | — | — |
| `NroProtocolo` | int | NO | — | — | — | — | — |
| `AnoProtocolo` | int | NO | — | — | — | — | — |
| `Token` | varchar(64) | NO | — | UNI | unique_token | — | — |
| `DataCriacao` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `DataExpiracao` | datetime | YES | — | — | — | — | — |

### Tabela: `tabcores`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 8

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Cod` | int | YES | — | — | — | — | — |
| `Cor` | text | YES | — | — | — | — | — |

### Tabela: `tabdadosdeputados`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 512

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `nome_parlamentar` | varchar(255) | YES | — | — | — | — | — |
| `partido` | varchar(50) | YES | — | — | — | — | — |
| `uf` | varchar(2) | YES | — | — | — | — | — |
| `anexo` | varchar(100) | YES | — | — | — | — | — |
| `gabinete` | varchar(50) | YES | — | — | — | — | — |
| `telefone_1` | varchar(50) | YES | — | — | — | — | — |
| `telefone_2` | varchar(50) | YES | — | — | — | — | — |
| `email_dep` | varchar(255) | YES | — | — | — | — | — |
| `email_gab` | varchar(255) | YES | — | — | — | — | — |
| `nome_sem_acento` | varchar(255) | YES | — | — | — | — | — |

### Tabela: `tabdeputados-old 2013`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodDep` | text | YES | — | — | — | — | — |
| `NomeDep` | text | YES | — | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — | — |
| `NroGab` | text | YES | — | — | — | — | — |
| `Andar` | text | YES | — | — | — | — | — |
| `Ramal` | text | YES | — | — | — | — | — |
| `Anexo` | text | YES | — | — | — | — | — |
| `SiglaPartido` | text | YES | — | — | — | — | — |
| `EstadoDep` | text | YES | — | — | — | — | — |
| `CotaInicial` | int | YES | — | — | — | — | — |
| `CotaSaldo` | int | YES | — | — | — | — | — |
| `MotivoAfastamento` | text | YES | — | — | — | — | — |
| `Inativo` | text | YES | — | — | — | — | — |
| `NomeCivil` | text | YES | — | — | — | — | — |
| `LegUlt` | double | YES | — | — | — | — | — |
| `LegAtual` | double | YES | — | — | — | — | — |
| `Foto` | text | YES | — | — | — | — | — |

### Tabela: `tabdeputados-old 2014`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodDep` | text | YES | — | — | — | — | — |
| `NomeDep` | text | YES | — | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — | — |
| `NroGab` | text | YES | — | — | — | — | — |
| `Andar` | text | YES | — | — | — | — | — |
| `Ramal` | text | YES | — | — | — | — | — |
| `Anexo` | text | YES | — | — | — | — | — |
| `SiglaPartido` | text | YES | — | — | — | — | — |
| `EstadoDep` | text | YES | — | — | — | — | — |
| `CotaInicial` | int | YES | — | — | — | — | — |
| `CotaSaldo` | int | YES | — | — | — | — | — |
| `MotivoAfastamento` | text | YES | — | — | — | — | — |
| `Inativo` | text | YES | — | — | — | — | — |
| `NomeCivil` | text | YES | — | — | — | — | — |
| `LegUlt` | double | YES | — | — | — | — | — |
| `LegAtual` | double | YES | — | — | — | — | — |
| `Foto` | text | YES | — | — | — | — | — |

### Tabela: `tabdetalhesservico`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** MDB + MySQL (duplicata de casing)  
**Quantidade aproximada de registros:** 85,660

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkDet` | int | YES | — | MUL | idx_detalhes_join, idx_detalhes_os_link, idx_detalhes_protocolo | — | — |
| `AnoProtocoloLinkDet` | int | YES | — | MUL | idx_detalhes_join, idx_detalhes_os_link, idx_detalhes_protocolo | — | — |
| `ElemGrafBrasao` | text | YES | — | — | — | — | — |
| `ElemGrafTimbre` | text | YES | — | — | — | — | — |
| `ElemGrafArteGab` | text | YES | — | — | — | — | — |
| `ElemGrafAssinatura` | text | YES | — | — | — | — | — |
| `ElemGrafCarimbo` | text | YES | — | — | — | — | — |
| `InsumosFornecidos` | text | YES | — | — | — | — | — |
| `MaterialFornecido` | text | YES | — | — | — | — | — |
| `ModeloDobra` | text | YES | — | — | — | — | — |
| `Fotolito` | text | YES | — | — | — | — | — |
| `ProvaImpressa` | text | YES | — | — | — | — | — |
| `TipoPublicacaoLink` | text | YES | — | MUL | ft_detalhes_produto, idx_detalhes_produto_titulo | — | — |
| `MaquinaLink` | text | YES | — | — | — | — | — |
| `Pags` | int | YES | — | — | — | — | — |
| `Mult4` | text | YES | — | — | — | — | — |
| `Tiragem` | int | YES | — | — | — | — | — |
| `CotaTotal` | int | YES | — | — | — | — | — |
| `Titulo` | text | YES | — | MUL | ft_detalhes_titulo, idx_detalhes_produto_titulo | — | — |
| `FormatoLink` | text | YES | — | — | — | — | — |
| `CoeficienteA4` | double | YES | — | — | — | — | — |
| `PapelLink` | text | YES | — | — | — | — | — |
| `PapelDescricao` | text | YES | — | — | — | — | — |
| `FrenteVerso` | text | YES | — | — | — | — | — |
| `Cores` | text | YES | — | — | — | — | — |
| `CoresDescricao` | text | YES | — | — | — | — | — |
| `DescAcabamento` | text | YES | — | — | — | — | — |
| `Observ` | text | YES | — | — | — | — | — |
| `CalcPgs1` | int | YES | — | — | — | — | — |
| `CalcQtdCores1` | int | YES | — | — | — | — | — |
| `CalcCor1` | text | YES | — | — | — | — | — |
| `CalcPgs2` | int | YES | — | — | — | — | — |
| `CalcQtdCores2` | int | YES | — | — | — | — | — |
| `CalcCor2` | text | YES | — | — | — | — | — |
| `CalcPgs3` | int | YES | — | — | — | — | — |
| `CalcQtdCores3` | int | YES | — | — | — | — | — |
| `CalcCor3` | text | YES | — | — | — | — | — |
| `TiragemSolicitada` | int | YES | — | — | — | — | — |
| `ModelosArq` | int | YES | — | — | — | — | — |

### Tabela: `tabdetalhesservicomdb`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `NroProtocoloLinkDet` | varchar(50) | YES | — | MUL | idx_unique_tabdetalhesservicomdb, uk_detalhes | — | — |
| `AnoProtocoloLinkDet` | varchar(10) | YES | — | — | idx_unique_tabdetalhesservicomdb, uk_detalhes | — | — |
| `TipoServico` | varchar(100) | YES | — | — | — | — | — |
| `DescricaoServico` | text | YES | — | — | — | — | — |
| `Quantidade` | decimal(10,2) | YES | — | — | — | — | — |
| `ValorUnitario` | decimal(10,2) | YES | — | — | — | — | — |
| `ValorTotal` | decimal(10,2) | YES | — | — | — | — | — |
| `DataServico` | date | YES | — | — | — | — | — |
| `StatusServico` | varchar(50) | YES | — | — | — | — | — |
| `ObservacoesDetalhes` | text | YES | — | — | — | — | — |
| `OrigemMDB` | varchar(100) | YES | — | — | idx_unique_tabdetalhesservicomdb, uk_detalhes | — | — |
| `DataSincronizacao` | timestamp | NO | CURRENT_TIMESTAMP | MUL | idx_detalhes_sync | — | — |
| `HashRegistro` | varchar(64) | YES | — | MUL | idx_detalhes_hash | — | — |
| `ElemGrafBrasao` | text | YES | — | — | — | — | — |
| `ElemGrafTimbre` | text | YES | — | — | — | — | — |
| `ElemGrafArteGab` | text | YES | — | — | — | — | — |
| `ElemGrafAssinatura` | text | YES | — | — | — | — | — |
| `ElemGrafCarimbo` | text | YES | — | — | — | — | — |
| `InsumosFornecidos` | text | YES | — | — | — | — | — |
| `MaterialFornecido` | text | YES | — | — | — | — | — |
| `ModeloDobra` | text | YES | — | — | — | — | — |
| `Fotolito` | text | YES | — | — | — | — | — |
| `ProvaImpressa` | text | YES | — | — | — | — | — |
| `TipoPublicacaoLink` | text | YES | — | — | — | — | — |
| `MaquinaLink` | text | YES | — | — | — | — | — |
| `Pags` | text | YES | — | — | — | — | — |
| `Mult4` | text | YES | — | — | — | — | — |
| `Tiragem` | text | YES | — | — | — | — | — |
| `CotaTotal` | text | YES | — | — | — | — | — |
| `Titulo` | text | YES | — | — | — | — | — |
| `FormatoLink` | text | YES | — | — | — | — | — |
| `CoeficienteA4` | text | YES | — | — | — | — | — |
| `PapelLink` | text | YES | — | — | — | — | — |
| `PapelDescricao` | text | YES | — | — | — | — | — |
| `FrenteVerso` | text | YES | — | — | — | — | — |
| `Cores` | text | YES | — | — | — | — | — |
| `CoresDescricao` | text | YES | — | — | — | — | — |
| `DescAcabamento` | text | YES | — | — | — | — | — |
| `Observ` | text | YES | — | — | — | — | — |
| `CalcPgs1` | text | YES | — | — | — | — | — |
| `CalcQtdCores1` | text | YES | — | — | — | — | — |
| `CalcCor1` | text | YES | — | — | — | — | — |
| `CalcPgs2` | text | YES | — | — | — | — | — |
| `CalcQtdCores2` | text | YES | — | — | — | — | — |
| `CalcCor2` | text | YES | — | — | — | — | — |
| `CalcPgs3` | text | YES | — | — | — | — | — |
| `CalcQtdCores3` | text | YES | — | — | — | — | — |
| `CalcCor3` | text | YES | — | — | — | — | — |
| `TiragemSolicitada` | text | YES | — | — | — | — | — |
| `ModelosArq` | text | YES | — | — | — | — | — |

### Tabela: `tabemailexchangeconfig`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 1

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Ponto` | varchar(20) | NO | — | PRI | — | — | — |
| `EwsUsername` | varchar(255) | NO | — | — | — | — | — |
| `EwsPasswordEnc` | text | YES | — | — | — | — | — |
| `EwsUrl` | varchar(512) | NO | — | — | — | — | — |
| `VerifySsl` | tinyint(1) | NO | 0 | — | — | — | — |
| `MaxItemsPerFolder` | int | NO | 20 | — | — | — | — |
| `RefreshIntervalSec` | int | NO | 5 | — | — | — | — |
| `OnlyUnread` | tinyint(1) | NO | 1 | — | — | — | — |
| `MonitoredTargets` | json | YES | — | — | — | — | — |
| `SendMailboxOsLt5000` | varchar(255) | NO | — | — | — | — | — |
| `SendMailboxOsGte5000` | varchar(255) | NO | — | — | — | — | — |
| `UpdatedAt` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabemailtemplateconfig`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 1

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Id` | int | NO | — | PRI | — | — | — |
| `Payload` | longtext | YES | — | — | — | — | — |
| `UpdatedAt` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabemailtemplatemodel`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 6

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Id` | int | NO | — | PRI | — | — | — |
| `Grupo` | varchar(32) | NO | — | MUL | idx_email_tpl_ativo, idx_email_tpl_grupo_variante | — | — |
| `Variante` | varchar(32) | NO | — | — | idx_email_tpl_ativo, idx_email_tpl_grupo_variante | — | — |
| `Nome` | varchar(120) | NO | — | — | — | — | — |
| `Assunto` | varchar(500) | NO | — | — | — | — | — |
| `Html` | longtext | NO | — | — | — | — | — |
| `Ativo` | tinyint(1) | NO | 0 | — | idx_email_tpl_ativo | — | — |
| `AnexarPdf` | tinyint(1) | NO | 0 | — | — | — | — |
| `ContentMode` | varchar(16) | NO | custom | — | — | — | — |
| `PresetId` | varchar(64) | YES | — | — | — | — | — |
| `Ordem` | int | NO | 0 | — | — | — | — |
| `CreatedAt` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `UpdatedAt` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `UpdatedByPonto` | varchar(20) | YES | — | — | — | — | — |
| `LegacyTemplateId` | varchar(64) | YES | — | — | — | — | — |

### Tabela: `tabentregaforma`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `FormaEntrega` | text | YES | — | — | — | — | — |
| `Seq` | int | YES | — | — | — | — | — |

### Tabela: `tabentregaprazo`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `PrazoEntrega` | text | YES | — | — | — | — | — |
| `Seq` | int | YES | — | — | — | — | — |

### Tabela: `tabexportarprotocoloanoanterior`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | int | YES | — | — | — | — | — |
| `AnoProtocolo` | int | YES | — | — | — | — | — |
| `DataEntrada` | date | YES | — | — | — | — | — |
| `ProcessoSolicit` | text | YES | — | — | — | — | — |
| `CSnro` | text | YES | — | — | — | — | — |
| `CategoriaLink` | text | YES | — | — | — | — | — |
| `CodUsuarioLink` | text | YES | — | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — | — |
| `NomeUsuario` | text | YES | — | — | — | — | — |
| `Solicitante` | text | YES | — | — | — | — | — |
| `OrgInteressado` | text | YES | — | — | — | — | — |
| `SiglaOrgao` | text | YES | — | — | — | — | — |
| `Titular` | text | YES | — | — | — | — | — |
| `GabSalaUsuario` | text | YES | — | — | — | — | — |
| `Localizacao` | text | YES | — | — | — | — | — |
| `Andar` | text | YES | — | — | — | — | — |
| `RamalUsuario` | int | YES | — | — | — | — | — |
| `ContatoTrab` | text | YES | — | — | — | — | — |
| `ResponsavelGrafLink` | text | YES | — | — | — | — | — |
| `EntregaFormaLink` | text | YES | — | — | — | — | — |
| `EntregPrazoLink` | text | YES | — | — | — | — | — |
| `EntregData` | date | YES | — | — | — | — | — |
| `EntregPeriodo` | text | YES | — | — | — | — | — |
| `ReqLançada` | text | YES | — | — | — | — | — |
| `ReqEntregue` | text | YES | — | — | — | — | — |
| `DataConclusao` | text | YES | — | — | — | — | — |
| `ArmazenadoEm` | text | YES | — | — | — | — | — |
| `ContatoRecebim` | text | YES | — | — | — | — | — |
| `RetiradaNome` | text | YES | — | — | — | — | — |
| `RetiradaPonto` | text | YES | — | — | — | — | — |
| `RecebimData` | text | YES | — | — | — | — | — |
| `PontoEntrega` | text | YES | — | — | — | — | — |
| `SetorEntrega` | text | YES | — | — | — | — | — |
| `CancelamentoMotivo` | text | YES | — | — | — | — | — |
| `CancelamentoPonto` | text | YES | — | — | — | — | — |
| `CancelamentoData` | text | YES | — | — | — | — | — |
| `CancelamentoSetor` | text | YES | — | — | — | — | — |
| `CotaRepro` | int | YES | — | — | — | — | — |
| `CotaCartao` | int | YES | — | — | — | — | — |
| `ReimprimirOS` | text | YES | — | — | — | — | — |
| `DebitarCGRAF` | text | YES | — | — | — | — | — |

### Tabela: `tabformatoimpressao`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodFormato` | int | YES | — | — | — | — | — |
| `Formato` | text | YES | — | — | — | — | — |
| `CabemNoA4` | double | YES | — | — | — | — | — |

### Tabela: `tabformatonormalize`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `Formato` | varchar(255) | YES | — | UNI | unique_formato | — | — |
| `Largura` | decimal(10,2) | YES | — | MUL | idx_dimensoes | — | — |
| `Altura` | decimal(10,2) | YES | — | — | idx_dimensoes | — | — |
| `created_at` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabformatos`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 78

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodFormato` | int | YES | — | — | — | — | — |
| `Formato` | text | YES | — | — | — | — | — |
| `CabemNoA4` | double | YES | — | — | — | — | — |
| `Seq` | int | YES | — | — | — | — | — |

### Tabela: `tabindicadores`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id_Indicador` | int | YES | — | — | — | — | — |
| `nr_Vizualizar` | int | YES | — | — | — | — | — |
| `nr_Editar` | int | YES | — | — | — | — | — |
| `nr_Salvar` | int | YES | — | — | — | — | — |
| `nr_InserirAnd` | int | YES | — | — | — | — | — |
| `nr_ExcluirOS` | int | YES | — | — | — | — | — |
| `nr_AbrirSS` | int | YES | — | — | — | — | — |
| `nr_Cancelar` | int | YES | — | — | — | — | — |
| `nr_ExcluirAnd` | int | YES | — | — | — | — | — |
| `nr_Filtrar` | int | YES | — | — | — | — | — |
| `nr_LimparFiltro` | int | YES | — | — | — | — | — |

### Tabela: `tabippermitidos`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `ip` | varchar(45) | NO | — | UNI | ip | — | — |
| `descricao` | varchar(255) | YES | — | — | — | — | — |
| `ativo` | tinyint(1) | YES | 1 | — | — | — | — |

### Tabela: `tablegs`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Legislatura` | int | YES | — | — | — | — | — |
| `AnoInicio` | double | YES | — | — | — | — | — |
| `AnoFinal` | double | YES | — | — | — | — | — |

### Tabela: `tablocalmidia`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `MidiaDigitalLink` | text | YES | — | — | — | — | — |
| `Qtd` | int | YES | — | — | — | — | — |
| `MidiaDigitDescricao` | text | YES | — | — | — | — | — |

### Tabela: `tablogchecklist`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Código` | int | YES | — | — | — | — | — |
| `ds_Computador` | text | YES | — | — | — | — | — |
| `ds_Usuario` | text | YES | — | — | — | — | — |
| `nr_Protocolo` | int | YES | — | — | — | — | — |
| `nr_Ano` | int | YES | — | — | — | — | — |
| `dt_Data` | text | YES | — | — | — | — | — |
| `ds_Impresso` | text | YES | — | — | — | — | — |

### Tabela: `tablogcodrs`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Cod` | int | YES | — | — | — | — | — |
| `DataAbertura` | text | YES | — | — | — | — | — |
| `HoraAbertura` | text | YES | — | — | — | — | — |
| `HoraFechamento` | text | YES | — | — | — | — | — |

### Tabela: `tablogfichaos`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id_Log` | int | YES | — | — | — | — | — |
| `ds_Computador` | text | YES | — | — | — | — | — |
| `ds_Usuario` | text | YES | — | — | — | — | — |
| `nr_Protocolo` | int | YES | — | — | — | — | — |
| `nr_Ano` | int | YES | — | — | — | — | — |
| `dt_Data` | text | YES | — | — | — | — | — |
| `ds_Impresso` | text | YES | — | — | — | — | — |

### Tabela: `tabmaquinas`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Maquina` | text | YES | — | — | — | — | — |
| `Seq` | int | YES | — | — | — | — | — |

### Tabela: `tabmaterialentregue`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkMat` | int | YES | — | — | — | — | — |
| `AnoProtocoloLinkMat` | int | YES | — | — | — | — | — |
| `ProvaImpressa` | text | YES | — | — | — | — | — |
| `ModeloDobra` | text | YES | — | — | — | — | — |
| `Fotolito` | text | YES | — | — | — | — | — |

### Tabela: `tabmesa`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodMesa` | text | YES | — | — | — | — | — |
| `NomeMesa` | text | YES | — | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — | — |
| `TitularMesa` | text | YES | — | — | — | — | — |
| `NroSala` | text | YES | — | — | — | — | — |
| `Anexo` | text | YES | — | — | — | — | — |
| `Andar` | text | YES | — | — | — | — | — |
| `Ramal` | text | YES | — | — | — | — | — |
| `NomeCivil` | text | YES | — | — | — | — | — |
| `Foto` | text | YES | — | — | — | — | — |

### Tabela: `tabmidiadigital`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkMidia` | int | YES | — | — | — | — | — |
| `AnoProtocoloLinkMidia` | int | YES | — | — | — | — | — |
| `MidiaDigitalLink` | text | YES | — | — | — | — | — |
| `Qtde` | int | YES | — | — | — | — | — |
| `MidiaDigitDescricao` | text | YES | — | — | — | — | — |

### Tabela: `tabmigracaosatregistropt`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 3,961

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `SatCodigo` | int | NO | — | PRI | — | — | — |
| `ID_AnaliseItem` | int | NO | — | UNI | uq_migracao_item | — | — |
| `OS` | int | NO | — | MUL | idx_migracao_os_ano | — | — |
| `Ano` | int | NO | — | — | idx_migracao_os_ano | — | — |
| `VersaoSat` | int | YES | — | — | — | — | — |
| `ProbTecFileName` | varchar(255) | YES | — | — | — | — | — |
| `Componente` | varchar(100) | YES | — | — | — | — | — |
| `ProbTecTitulo` | varchar(255) | YES | — | — | — | — | — |
| `PdfSourcePath` | varchar(1024) | YES | — | — | — | — | — |
| `PdfStoragePath` | varchar(1024) | YES | — | — | — | — | — |
| `ImportadoEm` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabmotivoafastamento`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Seq` | text | YES | — | — | — | — | — |
| `MotivoAfastamento` | text | YES | — | — | — | — | — |

### Tabela: `tabnotificacoes`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 178

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Id` | int | NO | — | PRI | — | — | — |
| `Ponto` | varchar(20) | NO | — | MUL | idx_ponto_lida | — | — |
| `NroProtocolo` | int | NO | — | — | — | — | — |
| `AnoProtocolo` | int | NO | — | — | — | — | — |
| `Mensagem` | text | NO | — | — | — | — | — |
| `DetalhesJson` | text | YES | — | — | — | — | — |
| `Lida` | tinyint(1) | YES | 0 | — | idx_ponto_lida | — | — |
| `DataCriacao` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `taborgaos`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodOrgao` | text | YES | — | — | — | — | — |
| `NomeOrgao` | text | YES | — | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — | — |
| `SiglaOrgao` | text | YES | — | — | — | — | — |
| `TitularOrgao` | text | YES | — | — | — | — | — |
| `NroSala` | text | YES | — | — | — | — | — |
| `Andar` | text | YES | — | — | — | — | — |
| `Anexo` | text | YES | — | — | — | — | — |
| `Ramal` | text | YES | — | — | — | — | — |
| `Foto` | text | YES | — | — | — | — | — |
| `LogoOrgao` | text | YES | — | — | — | — | — |

### Tabela: `tabosarquivostokens`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `NroProtocolo` | int | NO | — | MUL | idx_os_arquivos_os | — | — |
| `AnoProtocolo` | int | NO | — | — | idx_os_arquivos_os | — | — |
| `Token` | varchar(64) | NO | — | UNI | uq_os_arquivos_token | — | — |
| `EmailCliente` | varchar(255) | YES | — | — | — | — | — |
| `DataCriacao` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `DataExpiracao` | datetime | YES | — | — | — | — | — |

### Tabela: `tabosvinculadas`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 2

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `os_principal_numero` | int | NO | — | MUL | unique_link | — | — |
| `os_principal_ano` | int | NO | — | — | unique_link | — | — |
| `os_vinculada_numero` | int | NO | — | — | unique_link | — | — |
| `os_vinculada_ano` | int | NO | — | — | unique_link | — | — |
| `data_vinculo` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |
| `grupo_id` | int | YES | — | MUL | idx_os_vinculadas_grupo | — | — |

### Tabela: `tabosvinculoexcecoes`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 2

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `NroProtocolo` | int | NO | — | MUL | unique_exc | — | — |
| `AnoProtocolo` | int | NO | — | — | unique_exc | — | — |
| `DataExcecao` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |
| `Observacao` | varchar(255) | YES | — | — | — | — | — |

### Tabela: `tabosvinculogrupos`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 2

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `situacao` | varchar(120) | NO | — | — | — | — | — |
| `setor` | varchar(80) | NO | — | — | — | — | — |
| `criado_por_ponto` | varchar(32) | YES | — | — | — | — | — |
| `criado_em` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `atualizado_em` | datetime | YES | — | — | — | — | — |

### Tabela: `tabpapel`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 37

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `CodPapel` | int | YES | — | — | — | — | — |
| `Papel` | text | YES | — | — | — | — | — |
| `Seq` | double | YES | — | — | — | — | — |
| `Formato` | text | YES | — | — | — | — | — |
| `Espessura` | double | YES | — | — | — | — | — |
| `Disponibilidade` | text | YES | — | — | — | — | — |
| `Obs` | text | YES | — | — | — | — | — |
| `Disponivel` | text | YES | — | — | — | — | — |
| `Mostruario` | text | YES | — | — | — | — | — |
| `DataMedicao` | text | YES | — | — | — | — | — |

### Tabela: `tabpapelariajoblog`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 258

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | bigint | NO | — | PRI | — | — | — |
| `JobID` | bigint | NO | — | MUL | idx_job | — | — |
| `Nivel` | varchar(16) | NO | info | — | — | — | — |
| `Mensagem` | text | NO | — | — | — | — | — |
| `DetalheJson` | json | YES | — | — | — | — | — |
| `CriadoEm` | datetime | NO | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabpapelariajobs`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 61

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | bigint | NO | — | PRI | — | — | — |
| `NroProtocolo` | int | NO | — | — | idx_os | — | — |
| `AnoProtocolo` | int | NO | — | MUL | idx_os | — | — |
| `TipoJob` | varchar(32) | NO | create | — | — | — | — |
| `Produto` | varchar(120) | NO | — | — | — | — | — |
| `ModeloID` | int | YES | — | — | — | — | — |
| `ArquivoModelo` | varchar(255) | NO | — | — | — | — | — |
| `DadosJson` | json | NO | — | — | — | — | — |
| `Status` | varchar(20) | NO | pending | MUL | idx_status_ordem | — | — |
| `Prioridade` | int | NO | 0 | — | — | — | — |
| `OrdemFila` | bigint | NO | — | — | idx_status_ordem | — | — |
| `SolicitadoPor` | varchar(32) | NO | — | — | — | — | — |
| `SolicitadoEm` | datetime | NO | CURRENT_TIMESTAMP | MUL | idx_solicitado | — | — |
| `IniciadoEm` | datetime | YES | — | — | — | — | — |
| `ConcluidoEm` | datetime | YES | — | — | — | — | — |
| `WorkerID` | varchar(64) | YES | — | — | — | — | — |
| `ArquivoCdrGerado` | varchar(512) | YES | — | — | — | — | — |
| `ArquivoPdfGerado` | varchar(512) | YES | — | — | — | — | — |
| `ProvaRevisao` | varchar(20) | YES | — | — | — | — | — |
| `Erro` | text | YES | — | — | — | — | — |
| `Tentativas` | int | NO | 0 | — | — | — | — |
| `Versao` | int | NO | 1 | — | — | — | — |
| `JobPaiID` | bigint | YES | — | — | — | — | — |

### Tabela: `tabpapelariamodelos`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 21

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `NomeProduto` | varchar(100) | NO | — | — | — | — | — |
| `NomeArquivo` | varchar(255) | NO | — | — | — | — | — |
| `Categoria` | varchar(50) | YES | — | — | — | — | — |
| `Ativo` | tinyint(1) | YES | 1 | — | — | — | — |
| `ConfigCampos` | longtext | YES | — | — | — | — | — |
| `Produto` | varchar(120) | YES | — | — | — | — | — |
| `FrenteVerso` | varchar(32) | YES | — | — | — | — | — |
| `Cores` | varchar(64) | YES | — | — | — | — | — |
| `ArquivoModelo` | varchar(255) | YES | — | — | — | — | — |
| `CamposJson` | json | YES | — | — | — | — | — |
| `VariaveisJson` | json | YES | — | — | — | — | — |
| `Ordem` | int | NO | 0 | — | — | — | — |
| `AtualizadoEm` | timestamp | YES | CURRENT_TIMESTAMP | — | — | — | — |
| `MockupConfigJson` | json | YES | — | — | — | — | — |
| `PreviewConfigJson` | json | YES | — | — | — | — | — |

### Tabela: `tabpapelariasvgmodelos`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 9

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Codigo` | varchar(120) | NO | — | PRI | — | — | — |
| `NomeExibicao` | varchar(255) | NO | — | — | — | — | — |
| `ArquivoSvg` | varchar(255) | NO | — | — | — | — | — |
| `Categoria` | varchar(64) | NO | cartao_visita | — | — | — | — |
| `Face` | varchar(16) | NO | frente | — | — | — | — |
| `ConfigCampos` | json | YES | — | — | — | — | — |
| `Ativo` | tinyint(1) | NO | 1 | — | — | — | — |
| `Ordem` | int | NO | 0 | — | — | — | — |
| `AtualizadoEm` | timestamp | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabpapelariaworkerheartbeat`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 6

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `WorkerID` | varchar(64) | NO | — | PRI | — | — | — |
| `HeartbeatEm` | datetime | NO | — | MUL | idx_heartbeat_em | — | — |
| `MetaJson` | json | YES | — | — | — | — | — |

### Tabela: `tabpermissoes`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Nivel` | int | NO | — | PRI | — | — | — |
| `Nome` | varchar(50) | NO | — | — | — | — | — |
| `PermCriarOS` | tinyint(1) | YES | 0 | — | — | — | — |
| `PermEditarOS` | tinyint(1) | YES | 0 | — | — | — | — |
| `PermPapelaria` | tinyint(1) | YES | 0 | — | — | — | — |
| `PermAnalise` | tinyint(1) | YES | 0 | — | — | — | — |
| `PermEmail` | tinyint(1) | YES | 0 | — | — | — | — |
| `PermAdmin` | tinyint(1) | YES | 0 | — | — | — | — |

### Tabela: `tabproblemaspadrao`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 84

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `TituloPT` | varchar(255) | NO | — | — | — | — | — |
| `ProbTecHTML` | longtext | YES | — | — | — | — | — |
| `Categoria` | varchar(100) | YES | Geral | — | — | — | — |

### Tabela: `tabprooftokens`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 10

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `NroProtocolo` | int | NO | — | MUL | idx_proof_os | — | — |
| `AnoProtocolo` | int | NO | — | — | idx_proof_os | — | — |
| `Versao` | varchar(32) | YES | — | — | — | — | — |
| `ArquivoProva` | varchar(512) | YES | — | — | — | — | — |
| `Token` | varchar(128) | NO | — | UNI | uq_proof_token | — | — |
| `DataExpiracao` | datetime | YES | — | — | — | — | — |
| `Aprovado` | tinyint(1) | YES | — | — | — | — | — |
| `Observacao` | text | YES | — | — | — | — | — |
| `AlteracoesJson` | json | YES | — | — | — | — | — |
| `JobIdPapelaria` | int | YES | — | — | — | — | — |
| `DataResposta` | datetime | YES | — | — | — | — | — |
| `ClienteNome` | varchar(255) | YES | — | — | — | — | — |
| `PontoEnvio` | varchar(32) | YES | — | — | — | — | — |
| `CreatedAt` | timestamp | YES | CURRENT_TIMESTAMP | — | — | — | — |
| `DataEnvio` | datetime | YES | — | — | — | — | — |

### Tabela: `tabprotocolos`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** MDB + MySQL (duplicata de casing)  
**Quantidade aproximada de registros:** 84,083

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | int | YES | — | MUL | idx_proto_unique, idx_protocolos_ano_nro, idx_protocolos_data_prioridade, idx_protocolos_search_sort, idx_protocolos_sort_date | — | — |
| `AnoProtocolo` | int | YES | — | MUL | idx_proto_unique, idx_protocolos_ano_nro, idx_protocolos_data_prioridade, idx_protocolos_search_sort, idx_protocolos_sort_date | — | — |
| `DataEntrada` | date | YES | — | — | idx_protocolos_sort_date | — | — |
| `ProcessoSolicit` | text | YES | — | — | — | — | — |
| `CSnro` | text | YES | — | — | — | — | — |
| `CategoriaLink` | text | YES | — | — | — | — | — |
| `CodUsuarioLink` | text | YES | — | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — | — |
| `NomeUsuario` | text | YES | — | MUL | ft_protocolos_solicitante, idx_protocolos_solicitante | — | — |
| `Solicitante` | text | YES | — | — | — | — | — |
| `OrgInteressado` | text | YES | — | — | — | — | — |
| `SiglaOrgao` | text | YES | — | — | — | — | — |
| `Titular` | text | YES | — | — | — | — | — |
| `GabSalaUsuario` | text | YES | — | — | — | — | — |
| `Localizacao` | text | YES | — | — | — | — | — |
| `Andar` | text | YES | — | — | — | — | — |
| `RamalUsuario` | int | YES | — | — | — | — | — |
| `ContatoTrab` | text | YES | — | — | — | — | — |
| `ResponsavelGrafLink` | text | YES | — | — | — | — | — |
| `EntregaFormaLink` | text | YES | — | — | — | — | — |
| `EntregPrazoLink` | text | YES | — | — | idx_protocolos_data_prioridade | — | — |
| `EntregData` | date | YES | — | MUL | idx_protocolos_data_prioridade, idx_protocolos_search_sort, idx_protocolos_sort_date | — | — |
| `EntregPeriodo` | text | YES | — | — | — | — | — |
| `ReqLançada` | text | YES | — | — | — | — | — |
| `ReqEntregue` | text | YES | — | — | — | — | — |
| `DataConclusao` | text | YES | — | — | — | — | — |
| `ArmazenadoEm` | text | YES | — | — | — | — | — |
| `ContatoRecebim` | text | YES | — | — | — | — | — |
| `RetiradaNome` | text | YES | — | — | — | — | — |
| `RetiradaPonto` | text | YES | — | — | — | — | — |
| `RecebimData` | text | YES | — | — | — | — | — |
| `PontoEntrega` | text | YES | — | — | — | — | — |
| `SetorEntrega` | text | YES | — | — | — | — | — |
| `CancelamentoMotivo` | text | YES | — | — | — | — | — |
| `CancelamentoPonto` | text | YES | — | — | — | — | — |
| `CancelamentoData` | text | YES | — | — | — | — | — |
| `CancelamentoSetor` | text | YES | — | — | — | — | — |
| `CotaRepro` | int | YES | — | — | — | — | — |
| `CotaCartao` | int | YES | — | — | — | — | — |
| `ReimprimirOS` | text | YES | — | — | — | — | — |
| `DebitarCGRAF` | text | YES | — | — | — | — | — |
| `email_pt_html` | text | YES | — | — | — | — | — |
| `email_pt_versao` | varchar(50) | YES | — | — | — | — | — |
| `email_pt_data` | timestamp | YES | — | — | — | — | — |

### Tabela: `tabprotocolosbloqueados`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocolo` | int | YES | — | — | — | — | — |
| `AnoProtocolo` | int | YES | — | — | — | — | — |

### Tabela: `tabprotocolosmdb`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `NroProtocolo` | varchar(50) | YES | — | MUL | idx_unique_tabprotocolosmdb, uk_protocolo | — | — |
| `AnoProtocolo` | varchar(10) | YES | — | — | idx_unique_tabprotocolosmdb, uk_protocolo | — | — |
| `DataProtocolo` | date | YES | — | — | — | — | — |
| `TipoProtocolo` | varchar(50) | YES | — | — | — | — | — |
| `Solicitante` | varchar(255) | YES | — | — | — | — | — |
| `Assunto` | text | YES | — | — | — | — | — |
| `Situacao` | varchar(50) | YES | — | — | — | — | — |
| `DataConclusao` | date | YES | — | — | — | — | — |
| `Responsavel` | varchar(100) | YES | — | — | — | — | — |
| `Observacoes` | text | YES | — | — | — | — | — |
| `OrigemMDB` | varchar(100) | YES | — | — | idx_unique_tabprotocolosmdb, uk_protocolo | — | — |
| `DataSincronizacao` | timestamp | NO | CURRENT_TIMESTAMP | MUL | idx_protocolo_sync | — | — |
| `HashRegistro` | varchar(64) | YES | — | MUL | idx_protocolo_hash | — | — |
| `DataEntrada` | text | YES | — | — | — | — | — |
| `ProcessoSolicit` | text | YES | — | — | — | — | — |
| `CSnro` | text | YES | — | — | — | — | — |
| `CategoriaLink` | text | YES | — | — | — | — | — |
| `CodUsuarioLink` | text | YES | — | — | — | — | — |
| `CodigoRequisic` | text | YES | — | — | — | — | — |
| `NomeUsuario` | text | YES | — | — | — | — | — |
| `OrgInteressado` | text | YES | — | — | — | — | — |
| `SiglaOrgao` | text | YES | — | — | — | — | — |
| `Titular` | text | YES | — | — | — | — | — |
| `GabSalaUsuario` | text | YES | — | — | — | — | — |
| `Localizacao` | text | YES | — | — | — | — | — |
| `Andar` | text | YES | — | — | — | — | — |
| `RamalUsuario` | text | YES | — | — | — | — | — |
| `ContatoTrab` | text | YES | — | — | — | — | — |
| `ResponsavelGrafLink` | text | YES | — | — | — | — | — |
| `EntregaFormaLink` | text | YES | — | — | — | — | — |
| `EntregPrazoLink` | text | YES | — | — | — | — | — |
| `EntregData` | text | YES | — | — | — | — | — |
| `EntregPeriodo` | text | YES | — | — | — | — | — |
| `ReqLançada` | text | YES | — | — | — | — | — |
| `ReqEntregue` | text | YES | — | — | — | — | — |
| `ArmazenadoEm` | text | YES | — | — | — | — | — |
| `ContatoRecebim` | text | YES | — | — | — | — | — |
| `RetiradaNome` | text | YES | — | — | — | — | — |
| `RetiradaPonto` | text | YES | — | — | — | — | — |
| `RecebimData` | text | YES | — | — | — | — | — |
| `PontoEntrega` | text | YES | — | — | — | — | — |
| `SetorEntrega` | text | YES | — | — | — | — | — |
| `CancelamentoMotivo` | text | YES | — | — | — | — | — |
| `CancelamentoPonto` | text | YES | — | — | — | — | — |
| `CancelamentoData` | text | YES | — | — | — | — | — |
| `CancelamentoSetor` | text | YES | — | — | — | — | — |
| `CotaRepro` | text | YES | — | — | — | — | — |
| `CotaCartao` | text | YES | — | — | — | — | — |
| `ReimprimirOS` | text | YES | — | — | — | — | — |
| `DebitarCGRAF` | text | YES | — | — | — | — | — |

### Tabela: `tabrespgraf`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ResponsGraf` | text | YES | — | — | — | — | — |
| `Inativo` | text | YES | — | — | — | — | — |

### Tabela: `tabselecionados`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `NroProtocoloLinkSel` | int | YES | — | — | — | — | — |
| `AnoProtocoloLinkSel` | int | YES | — | — | — | — | — |
| `Selecionado` | text | YES | — | — | — | — | — |

### Tabela: `tabsetor`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Setor` | text | YES | — | — | — | — | — |
| `SetorSeq` | int | YES | — | — | — | — | — |
| `ProxSetor` | int | YES | — | — | — | — | — |

### Tabela: `tabsetorpaineldefaults`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 5

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Setor` | varchar(32) | NO | — | PRI | — | — | — |
| `Payload` | json | NO | — | — | — | — | — |
| `DataAtualizacao` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabsituacao`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Situacao` | text | YES | — | — | — | — | — |
| `Seq` | int | YES | — | — | — | — | — |
| `ProxSit` | int | YES | — | — | — | — | — |
| `Ocultar` | text | YES | — | — | — | — | — |

### Tabela: `tabsituacao-old`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Situacao` | text | YES | — | — | — | — | — |
| `Seq` | int | YES | — | — | — | — | — |
| `ProxSit` | int | YES | — | — | — | — | — |

### Tabela: `tabsolicitacoesacesso`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `ip` | varchar(45) | NO | — | — | — | — | — |
| `nome` | varchar(255) | NO | — | — | — | — | — |
| `ponto` | int | NO | — | — | — | — | — |
| `secao` | varchar(255) | NO | — | — | — | — | — |
| `data_solicitacao` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabsupportmessages`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 19

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Id` | int | NO | — | PRI | — | — | — |
| `Ponto` | varchar(32) | NO | — | MUL | idx_support_ponto | — | — |
| `NomeUsuario` | varchar(128) | YES | — | — | — | — | — |
| `Tipo` | varchar(16) | NO | problema | — | — | — | — |
| `Assunto` | varchar(255) | NO | — | — | — | — | — |
| `Mensagem` | text | NO | — | — | — | — | — |
| `Status` | varchar(16) | NO | pendente | MUL | idx_support_status | — | — |
| `Resposta` | text | YES | — | — | — | — | — |
| `RespondidoPor` | varchar(64) | YES | — | — | — | — | — |
| `DataCriacao` | datetime | NO | CURRENT_TIMESTAMP | MUL | idx_support_data | — | — |
| `DataResposta` | datetime | YES | — | — | — | — | — |
| `DataResolucao` | datetime | YES | — | — | — | — | — |
| `ResolvidoPor` | varchar(64) | YES | — | — | — | — | — |
| `AssignedPonto` | varchar(32) | YES | — | — | — | — | — |
| `OsAno` | int | YES | — | — | — | — | — |
| `OsNro` | int | YES | — | — | — | — | — |
| `ClienteId` | int | YES | — | — | — | — | — |
| `VersaoPt` | varchar(64) | YES | — | — | — | — | — |
| `Source` | varchar(16) | NO | interno | — | — | — | — |

### Tabela: `tabsupportthreadmessages`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 40

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Id` | int | NO | — | PRI | — | — | — |
| `TicketId` | int | NO | — | MUL | idx_support_thread_ticket | — | — |
| `AutorTipo` | varchar(16) | NO | — | — | — | — | — |
| `AutorPonto` | varchar(32) | YES | — | — | — | — | — |
| `AutorNome` | varchar(128) | YES | — | — | — | — | — |
| `Mensagem` | text | NO | — | — | — | — | — |
| `DataCriacao` | datetime | NO | CURRENT_TIMESTAMP | MUL | idx_support_thread_data | — | — |

### Tabela: `tabtipomidiadigital`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `MidiaDigital` | text | YES | — | — | — | — | — |
| `Ocultar` | text | YES | — | — | — | — | — |

### Tabela: `tabtipopubmodelos`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `TipoPublicacaoLink` | text | YES | — | — | — | — | — |
| `Seq` | int | YES | — | — | — | — | — |
| `Inativo` | text | YES | — | — | — | — | — |

### Tabela: `tabuserfiltersettings`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `Usuario` | varchar(150) | NO | — | — | — | — | — |
| `Ponto` | varchar(20) | NO | — | UNI | unique_ponto | — | — |
| `Situacoes` | text | YES | — | — | — | — | — |
| `Setores` | text | YES | — | — | — | — | — |
| `DataAtualizacao` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabuserpreferences`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 6

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Ponto` | varchar(32) | NO | — | PRI | — | — | — |
| `PreferenceKey` | varchar(64) | NO | — | PRI | — | — | — |
| `Payload` | json | NO | — | — | — | — | — |
| `DataAtualizacao` | datetime | NO | CURRENT_TIMESTAMP | MUL | idx_user_pref_updated | — | — |

### Tabela: `tabusersavedfilters`

**Finalidade aparente:** Legado / operacional (provável origem MDB)  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 13

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `ID` | int | NO | — | PRI | — | — | — |
| `Ponto` | varchar(20) | NO | — | MUL | idx_ponto | — | — |
| `Nome` | varchar(100) | NO | — | — | — | — | — |
| `Situacoes` | longtext | YES | — | — | — | — | — |
| `Setores` | longtext | YES | — | — | — | — | — |
| `IsDefault` | tinyint(1) | YES | 0 | — | — | — | — |
| `DataCriacao` | datetime | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `tabusuarios`

**Finalidade aparente:** Legado / espelho MDB  
**Origem:** Legado / MDB importado  
**Quantidade aproximada de registros:** 13

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Ponto` | int | NO | — | PRI | — | — | — |
| `Nome` | varchar(255) | YES | — | — | — | — | — |
| `UltimoAcesso` | datetime | YES | — | — | — | — | — |
| `IPUltimoAcesso` | varchar(45) | YES | — | — | — | — | — |
| `Email` | varchar(255) | YES | — | UNI | uq_tabUsuarios_email | — | — |
| `PasswordHash` | varchar(255) | YES | — | — | — | — | — |
| `EmailVerified` | tinyint(1) | NO | 0 | — | — | — | — |
| `ActivationToken` | varchar(64) | YES | — | — | — | — | — |
| `ActivationExpires` | datetime | YES | — | — | — | — | — |
| `AuthAtivo` | tinyint(1) | NO | 1 | — | — | — | — |
| `Setor` | varchar(32) | YES | — | — | — | — | — |
| `PasswordResetToken` | varchar(64) | YES | — | — | — | — | — |
| `PasswordResetExpires` | datetime | YES | — | — | — | — | — |

### Tabela: `user_permissions`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 8

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `Ponto` | int | NO | — | PRI | — | — | — |
| `ctx_nova_os` | tinyint(1) | YES | 0 | — | — | — | — |
| `ctx_duplicar_os` | tinyint(1) | YES | 0 | — | — | — | — |
| `ctx_editar_os` | tinyint(1) | YES | 0 | — | — | — | — |
| `ctx_vincular_os` | tinyint(1) | YES | 0 | — | — | — | — |
| `ctx_abrir_pasta` | tinyint(1) | YES | 0 | — | — | — | — |
| `ctx_imprimir_ficha` | tinyint(1) | YES | 0 | — | — | — | — |
| `ctx_detalhes_os` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_inicio` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_gerencia` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_email` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_analise` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_papelaria` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_usuario` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_configuracoes` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_relatorio` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_dashboard_setor` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_admin_ips` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_pcp` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_usuarios` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_active_computers` | tinyint(1) | YES | 0 | — | — | — | — |
| `sb_gravacao` | tinyint(1) | YES | 0 | — | — | — | — |
| `created_at` | timestamp | YES | CURRENT_TIMESTAMP | — | — | — | — |
| `updated_at` | timestamp | YES | CURRENT_TIMESTAMP | — | — | — | — |
| `sb_dashboard_global` | tinyint(1) | NO | 0 | — | — | — | — |
| `painel_setores` | json | YES | — | — | — | — | — |
| `ctx_mover_pastas` | tinyint(1) | YES | 0 | — | — | — | — |

### Tabela: `user_registered_ips`

**Finalidade aparente:** Web / extensão SAGRA Web  
**Origem:** Web  
**Quantidade aproximada de registros:** 7

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `Ponto` | int | NO | — | MUL | idx_user_registered_ips_ponto, uq_user_registered_ips_ponto_ip | — | — |
| `ip` | varchar(45) | NO | — | MUL | idx_user_registered_ips_ip, uq_user_registered_ips_ponto_ip | — | — |
| `descricao` | varchar(255) | YES | — | — | — | — | — |
| `created_at` | timestamp | YES | CURRENT_TIMESTAMP | — | — | — | — |

### Tabela: `variacao_acabamento`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `variacao_id` | int | NO | — | PRI | — | — | — |
| `acabamento_id` | int | NO | — | PRI | acabamento_id | — | — |

### Tabela: `variacao_cor`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `variacao_id` | int | NO | — | PRI | — | — | — |
| `cor_id` | int | NO | — | PRI | cor_id | — | — |

### Tabela: `variacao_papel`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `variacao_id` | int | NO | — | PRI | — | — | — |
| `papel_id` | int | NO | — | PRI | papel_id | — | — |

### Tabela: `xpose_paths`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `ticket_name` | varchar(255) | YES | — | MUL | unique_path | — | — |
| `path_name` | varchar(255) | YES | — | — | unique_path | — | — |
| `status` | varchar(50) | YES | — | — | — | — | — |
| `colour` | varchar(20) | YES | — | — | — | — | — |
| `last_updated` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `inicio` | datetime | YES | — | — | — | — | — |
| `fim` | datetime | YES | — | — | — | — | — |

### Tabela: `xpose_tickets`

**Finalidade aparente:** Operacional / inferido  
**Origem:** MySQL / inferido  
**Quantidade aproximada de registros:** 0

| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |
|---|---|---|---|---|---|---|---|
| `id` | int | NO | — | PRI | — | — | — |
| `name` | varchar(255) | YES | — | MUL | unique_ticket_os | — | — |
| `status` | varchar(50) | YES | — | — | — | — | — |
| `created` | datetime | YES | — | — | — | — | — |
| `priority` | varchar(50) | YES | — | — | — | — | — |
| `last_updated` | timestamp | NO | CURRENT_TIMESTAMP | — | — | — | — |
| `nros` | varchar(20) | YES | — | — | unique_ticket_os | — | — |
| `anoos` | int | YES | 2025 | — | — | — | — |
| `machine` | varchar(255) | YES | — | — | — | — | — |
| `source_file` | varchar(255) | YES | — | — | — | — | — |
| `inicio` | datetime | YES | — | — | — | — | — |
| `fim` | datetime | YES | — | — | — | — | — |

---

## 7. Relacionamentos reais e inferidos

### 7.1 Foreign keys declaradas no MySQL
| Origem | Campo | Destino | Campo | Tipo | Constraint |
|---|---|---|---|---|---|
| `componente_variacao` | `componente_id` | `produto_componente` | `id` | inferido N:1 | `componente_variacao_ibfk_1` |
| `ct_gravacao_eventos` | `id_job` | `ct_gravacao_jobs` | `id_job` | inferido N:1 | `ct_gravacao_eventos_ibfk_1` |
| `os_acabamentos` | `acabamento_id` | `acabamentos_catalogo` | `id` | inferido N:1 | `fk_acabamento_catalogo` |
| `os_acabamentos` | `componente_id` | `os_componentes` | `id` | inferido N:1 | `fk_acabamento_componente` |
| `os_componente_lotes` | `componente_id` | `os_componentes` | `id` | inferido N:1 | `fk_lote_componente` |
| `produto_componente` | `produto_id` | `produto` | `id` | inferido N:1 | `produto_componente_ibfk_1` |
| `tabanaliseitens` | `ID_Analise` | `tabanalises` | `ID` | inferido N:1 | `tabanaliseitens_ibfk_1` |
| `tabclientegabinete` | `ParentID` | `tabclientegabinete` | `ID` | inferido N:1 | `fk_cliente_parent` |
| `tabclienttokens` | `ID_Analise` | `tabanalises` | `ID` | inferido N:1 | `tabclienttokens_ibfk_1` |
| `variacao_acabamento` | `variacao_id` | `componente_variacao` | `id` | inferido N:1 | `variacao_acabamento_ibfk_1` |
| `variacao_acabamento` | `acabamento_id` | `acabamento` | `id` | inferido N:1 | `variacao_acabamento_ibfk_2` |
| `variacao_cor` | `variacao_id` | `componente_variacao` | `id` | inferido N:1 | `variacao_cor_ibfk_1` |
| `variacao_cor` | `cor_id` | `cor` | `id` | inferido N:1 | `variacao_cor_ibfk_2` |
| `variacao_papel` | `variacao_id` | `componente_variacao` | `id` | inferido N:1 | `variacao_papel_ibfk_1` |
| `variacao_papel` | `papel_id` | `papel` | `id` | inferido N:1 | `variacao_papel_ibfk_2` |
### 7.2 Relacionamentos implícitos (sem FK)

| Origem | Campo | Destino | Campo | Tipo | Obrigatório | Constraint | Código depende | Risco |
|---|---|---|---|---|---|---|---|---|
| tabProtocolos | NroProtocolo, AnoProtocolo | tabDetalhesServico | NroProtocoloLinkDet, AnoProtocoloLinkDet | 1:N | Sim (negócio) | Não | Sim | Alto — joins por protocolo sem FK |
| tabProtocolos | NroProtocolo, AnoProtocolo | tabAndamento/tabandamento | NroProtocoloLink, AnoProtocoloLink | 1:N | Sim | Não | Sim | Alto — duplicata de tabela andamento |
| tabAndamento | CodStatus | tab_os_sub_os_andamento | cod_status_espelho | 1:1 espelho | Opcional | Não | Sim | Médio — exclusão de espelhos na materialized |
| tabPapelariaJobs | NroProtocolo, AnoProtocolo | tabProtocolos | NroProtocolo, AnoProtocolo | N:1 | Sim | Não | Sim | Médio |
| tabPapelariaJobs | modelo_id | tabPapelariaModelos | id | N:1 | Opcional | Parcial | Sim | Baixo |
| tabProofTokens | token | tabAnalises / OS | NroProtocolo | N:1 | Sim | Não | Sim | Alto — token exposto em URL |
| tabClientTokens | token | tabProtocolos | NroProtocolo | N:1 | Sim | Não | Sim | Alto |
| tabUsuarios | Setor | tabSetorPainelDefaults | setor | N:1 | Opcional | Não | Sim | Baixo |
| user_permissions | usuario_id | tabUsuarios | id | N:1 | Sim | Possível | Sim | Médio |
| tabOSVinculadas | grupo_id | tabOSVinculoGrupos | id | N:1 | Opcional | Parcial | Sim | Médio |
| MDB tabProtocolos | PK composta | MySQL tabProtocolos | PK composta | 1:1 espelho | — | Não | Sync | Alto — conflito dual-write |

---

## 8. Entidades de negócio

| Entidade | Tabelas | Campos essenciais | Armazenamento | Telas/endpoints |
|---|---|---|---|---|
| OS (Ordem de Serviço) | tabProtocolos/tabprotocolos + tabDetalhesServico | NroProtocolo, AnoProtocolo, CodigoRequisic, Titular | MDB+MySQL | Home, painel setor, cliente |
| Andamento | tabAndamento/tabandamento | CodStatus, NroProtocoloLink, SetorLink, Data, UltimoStatus | MDB→MySQL sync; Web grava MySQL→MDB | Timeline, painel, websocket |
| Protocolo | Sinônimo de OS — tabProtocolos | NroProtocolo, AnoProtocolo | Legado | Toda a aplicação |
| Detalhe de serviço | tabDetalhesServico | Titulo, Tiragem, PapelLink, Observ | MDB+MySQL | Requisição, papelaria, busca |
| Setor | tabUsuarios.Setor, andamento.SetorLink, tabSetorPainelDefaults | SetorLink, Setor | MySQL | Painel setor, filtros |
| Usuário | tabUsuarios + user_permissions + ip_permissions | NomeUsuario, Senha(hash), Setor | MySQL (MDB tabUsuarios legado) | Login, RBAC |
| Cliente / Gabinete | tabClienteGabinete, tabdadosdeputados, Titular em protocolos | Gabinete, deputado | MySQL + DFS | Portal cliente |
| Prova / Aprovação | tabAnalises, tabAnaliseItens, tabProofTokens | token, status prova | MySQL Web | Portal prova, e-mail PT |
| Papelaria job | tabPapelariaJobs, tabPapelariaJobLog | status, worker, paths CDR/PDF | MySQL Web-only | Fila Corel, worker Windows |
| Modelo papelaria | tabPapelariaModelos, tabPapelariaSvgModelos | SVG, parâmetros mockup | MySQL Web-only | Mockup 3D, geração |
| Token cliente | tabClientTokens, tabOsArquivosTokens | token, expiração | MySQL Web | Links públicos |
| Permissão | user_permissions, ip_permissions | escopos RBAC | MySQL Web | Admin IP, features |
| Problema técnico | tabProblemasPadrao, tabAnaliseItens | descrição, tipo | MySQL | Análise pré-impressão |
| Sub-OS / vínculos | tab_os_sub_os, tabOSVinculadas, tabOSVinculoGrupos | grupo_id, componentes | MySQL Web | OS compostas |
| Status operacional (materialized) | tab_os_ultimo_andamento_operacional | último setor/status denormalizado | MySQL cache | Home search performance |

---

## 9. Fluxos críticos do sistema

| Fluxo | Services | Endpoints | Lê | Grava | Fonte da verdade |
|---|---|---|---|---|---|
| Listagem OS (home) | os_home_source_service, os_search_service | GET /api/os/* | tabProtocolos, tab_os_ultimo_andamento_operacional, tabDetalhesServico | tab_os_filter_* (cache) | Materialized + fallback tabAndamento |
| Painel do setor | andamento_operacional, os_routes | GET/POST andamentos | tabAndamento, tabProtocolos | tabAndamento, MDB via mdb_writer | MySQL commit then MDB |
| WebSocket tempo real | realtime.py | WS /realtime | — | — | Notify pós-sync/post-change |
| Histórico andamentos | os_protocolo_andamento_service | timeline endpoints | tabAndamento | tabAndamento (+ MDB async) | MySQL primary |
| Portal cliente | cliente_gabinete_routes, cliente_os_timeline_service | /api/cliente/* | tabClienteGabinete, tabProtocolos, tabAndamento | tokens | MySQL |
| Portal prova | proof_portal_routes, proof_papelaria_service | /api/proof/* | tabProofTokens, tabAnalises | tabAnaliseItens | MySQL Web |
| Papelaria / jobs Corel | papelaria_jobs_service | /api/papelaria/jobs | tabPapelariaJobs | tabPapelariaJobLog | MySQL only; worker via API |
| Mockup 3D | papelaria_svg_service, frontend PapelariaProofMockup3D | API modelos SVG | tabPapelariaSvgModelos | — | MySQL |
| Login / permissões | user_auth, ip_permissions | /api/auth/* | tabUsuarios, user_permissions, ip_permissions | sessão | MySQL |
| Sync MDB→MySQL | sync_andamentos_v2.py | daemon/manual | MDB tabandamento | MySQL tabandamento + materialized | MDB fonte para andamentos legados |

---

## 10. Fonte da verdade atual por domínio

| Domínio | Fonte oficial aparente | Web grava | Legado grava | Duplicação | Risco conflito | Tabelas migração |
|---|---|---|---|---|---|---|
| OS | MDB (legado Access) + MySQL espelho | MySQL then MDB dual-write | Access/SAGRA desktop | Sim — sync background | Médio — campos Web-only só MySQL | tabProtocolos |
| Andamentos | MDB para entradas legado; Web grava MySQL first | MySQL → MDB | Access | Sim — duas tabelas casing | Alto se sync desligado | tabAndamento (unificar) |
| Detalhes serviço | MDB + MySQL | MySQL → MDB | Access | Sim | Médio | tabDetalhesServico |
| Status atual (home) | MySQL materialized | tab_os_ultimo_andamento_operacional | Derivado de andamentos | Cache | Baixo se reconcile ok | Materialized + andamentos |
| Arquivos | DFS/redes + tokens MySQL | tabOsArquivosTokens | Filesystem | Não no MDB | Baixo | Tokens + paths config |
| Provas | MySQL Web | tabAnalises, tabProofTokens | N/A legado | Não | Baixo | Web tables |
| Problemas técnicos | MySQL | tabAnaliseItens, tabProblemasPadrao | Parcial legado | Parcial | Baixo | Web |
| Papelaria | MySQL Web-only | tabPapelaria* | N/A | Não | Nenhum | Web tables |
| Clientes | MySQL + tabdadosdeputados | tabClienteGabinete | MDB deputados lookup | Parcial | Baixo | Web + lookup |
| Usuários | MySQL (tabUsuarios) | tabUsuarios | MDB tabUsuarios histórico | Possível divergência | Médio | tabUsuarios |
| Permissões | MySQL Web-only | user_permissions, ip_permissions | N/A | Não | Nenhum | Web tables |

---

## 11. Índices e performance

### 11.1 Índices declarados (amostra tabelas críticas)


**`tabandamento`** (199,180 rows)

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | CodStatus |
| `idx_andamento_filtros` | Sim | BTREE | SituacaoLink, SetorLink, UltimoStatus |
| `idx_andamento_os_operacional` | Sim | BTREE | NroProtocoloLink, AnoProtocoloLink, UltimoStatus, Data, CodStatus |
| `idx_andamento_os_ultimo_data` | Sim | BTREE | NroProtocoloLink, AnoProtocoloLink, UltimoStatus, Data, CodStatus |
| `idx_andamento_protocolo` | Sim | BTREE | NroProtocoloLink, AnoProtocoloLink |
| `idx_panel_opt` | Sim | BTREE | UltimoStatus, SituacaoLink, SetorLink |

**`tab_os_ultimo_andamento_operacional`** (84,075 rows)

| Índice | Único | Tipo | Colunas |
|---|---|---|---|
| `PRIMARY` | Não | BTREE | nro_protocolo, ano_protocolo |
| `idx_ua_oper_ano_nro` | Sim | BTREE | ano_protocolo, nro_protocolo |
| `idx_ua_oper_data` | Sim | BTREE | data |
| `idx_ua_oper_setor` | Sim | BTREE | setor |
| `idx_ua_oper_setor_situacao` | Sim | BTREE | setor, situacao |
| `idx_ua_oper_situacao` | Sim | BTREE | situacao |

### 11.2 Problemas preliminares

- **Duas tabelas de andamento** — consultas podem usar índices de uma tabela enquanto sync popula outra.
- **FKs ausentes** — joins por protocolo sem garantia referencial; órfãos possíveis.
- **Tabelas >1M registros** (ver top 25) — exigem índices compostos (Ano+Nro, Setor+Data); scripts em `deploy/sql/create_os_search_indexes.sql` tentam mitigar.
- **FULLTEXT** — `create_os_text_search_indexes.sql`; custo de manutenção em tabelas grandes.
- **Materialized `tab_os_ultimo_andamento_operacional`** — risco de stale data se reconcile falhar.
- **Poll sync 0.2s no MDB** — carga contínua no Access; lock contention com dual-write.
- **Consultas com COLLATE explícito** — indica mismatch de collation entre tabelas/joins.

---

## 12. Problemas estruturais encontrados

1. **Duplicata tabAndamento / tabandamento** — confirmado no MySQL live.
2. **Casing inconsistente** tabProtocolos vs tabprotocolos, tabDetalhesServico vs tabdetalhesservico.
3. **Denormalização legado** — campos calculados em protocolos/detalhes (ver `os_calc_fields.py`, `mdb_helpers.CALC_DETALHES_FIELDS`).
4. **Status textuais** — UltimoStatus, SituacaoLink sem tabela de domínio.
5. **Datas/textos misturados** — colunas legado com tipos TEXT para dados numéricos.
6. **Tabelas auxiliares importação** — prefixo `_`, `tmp`, `monitor_*` misturadas com transacionais.
7. **Ausência massiva de FKs** — integridade só no código.
8. **Dois sync_andamentos_v2** — risco operacional.
9. **Dados sensíveis** — tokens, senhas em tabUsuarios; sem vault separado.
10. **Regras de negócio em scripts** — roteamento Nro<5000, filtros Ano>=2024, espelhos sub-OS.

---

## 13. Dependências no código


### `tabAndamento`

**Usada em (arquivos):**

- `ajuste_andamentos_os_antigas.py`
- `app\backend\os_search_indexes_schema.py`
- `app\backend\pcp_queue_service.py`
- `app\backend\routers\analise_routes.py`
- `app\backend\routers\auxiliar_routes.py`
- `app\backend\routers\cliente_gabinete_routes.py`
- `app\backend\routers\email_routes.py`
- `app\backend\routers\mdb_writer.py`
- `app\backend\routers\notifications_routes.py`
- `app\backend\routers\os_audit_service.py`
- `app\backend\routers\os_routes.py`
- `app\backend\routers\pcp_queue_service.py`
- `app\backend\routers\pcp_routes.py`
- `app\backend\routers\proof_portal_routes.py`
- `app\backend\routers\realtime.py`
- `app\backend\routers\report_custom_routes.py`
- `app\backend\scripts\diag_timeline_destinos.py`
- `app\backend\scripts\diag_timeline_patterns.py`
- `app\backend\scripts\diag_timeline_setores.py`
- `app\backend\services\andamento_operacional.py`
- `app\backend\services\andamento_table.py`
- `app\backend\services\cliente_os_timeline_service.py`
- `app\backend\services\email_dispatch_type_service.py`
- `app\backend\services\email_pendencias_service.py`
- `app\backend\services\os_andamento_post_change_service.py`
- `app\backend\services\os_componentes_service.py`
- `app\backend\services\os_home_source_service.py`
- `app\backend\services\os_materialized_reconcile_service.py`
- `app\backend\services\os_search_service.py`
- `app\backend\services\os_sub_os_queries.py`
- `app\backend\services\os_ultimo_andamento_service.py`
- `app\backend\services\support_message_service.py`
- `app\backend\tests\test_andamento_table.py`
- `app\backend\tests\test_os_search_gap_fallback.py`
- `app\backend\tests\test_os_ultimo_andamento_search.py`
- `app\backend\tests\test_public_tokens.py`
- `app\backend\tests\test_sub_os_corrections.py`
- `app\backend\tests\test_sub_os_propagacao_exclusao.py`
- `app\services\monitor_os_changes.py`
- `deploy\release\app\backend\os_search_indexes_schema.py`
- _... e mais 55 arquivos_

### `tabandamento`

**Usada em (arquivos):**

- `app\backend\services\andamento_table.py`
- `app\backend\services\os_home_source_service.py`
- `app\backend\services\os_search_service.py`
- `app\backend\tests\test_andamento_table.py`
- `app\services\sync_andamentos_v2.py`
- `app\services\sync_tables\processarantigas.py`
- `deploy\release\app\backend\services\andamento_table.py`
- `deploy\release\app\backend\services\os_home_source_service.py`
- `deploy\release\app\backend\services\os_search_service.py`
- `deploy\release\app\backend\tests\test_andamento_table.py`
- `deploy\release\app\services\sync_andamentos_v2.py`
- `deploy\release\app\services\sync_tables\processarantigas.py`
- `sync_andamentos_v2.py`
- `tools\validate_sync_mdb_mysql.py`

### `tabProtocolos`

**Usada em (arquivos):**

- `ajuste_andamentos_os_antigas.py`
- `app\backend\mdb_helpers.py`
- `app\backend\os_search_indexes_schema.py`
- `app\backend\os_text_search_indexes_schema.py`
- `app\backend\pcp_queue_service.py`
- `app\backend\routers\analise_routes.py`
- `app\backend\routers\auxiliar_routes.py`
- `app\backend\routers\cliente_gabinete_routes.py`
- `app\backend\routers\email_routes.py`
- `app\backend\routers\mdb_writer.py`
- `app\backend\routers\os_audit_service.py`
- `app\backend\routers\os_routes.py`
- `app\backend\routers\pcp_queue_service.py`
- `app\backend\routers\pcp_routes.py`
- `app\backend\routers\proof_portal_routes.py`
- `app\backend\routers\report_custom_routes.py`
- `app\backend\routers\requisicao_routes.py`
- `app\backend\scripts\diag_timeline_destinos.py`
- `app\backend\scripts\diag_timeline_patterns.py`
- `app\backend\services\email_pendencias_service.py`
- `app\backend\services\email_template_service.py`
- `app\backend\services\os_arquivos_service.py`
- `app\backend\services\os_filter_options_service.py`
- `app\backend\services\os_protocolo_andamento_service.py`
- `app\backend\services\os_search_service.py`
- `app\backend\services\os_sub_os_queries.py`
- `app\backend\services\os_ultimo_andamento_service.py`
- `app\backend\services\papelaria_jobs_service.py`
- `app\backend\services\papelaria_models_service.py`
- `app\backend\services\papelaria_svg_service.py`
- `app\backend\services\pre_analise\os_loader.py`
- `app\backend\services\proof_papelaria_service.py`
- `app\backend\tests\test_email_template_models.py`
- `app\backend\tests\test_os_protocolo_andamento_service.py`
- `app\backend\tests\test_os_search_gap_fallback.py`
- `app\backend\tests\test_os_ultimo_andamento_search.py`
- `app\backend\tests\test_papelaria_jobs_service.py`
- `app\backend\tests\test_proof_email_portal_corrections.py`
- `app\services\sync_andamentos_v2.py`
- `apps\web\src\features\os\components\OsEntregaModal.tsx`
- _... e mais 58 arquivos_

### `tabDetalhesServico`

**Usada em (arquivos):**

- `app\backend\mdb_helpers.py`
- `app\backend\os_calc_fields.py`
- `app\backend\os_search_indexes_schema.py`
- `app\backend\os_text_search_indexes_schema.py`
- `app\backend\routers\analise_routes.py`
- `app\backend\routers\auxiliar_routes.py`
- `app\backend\routers\cliente_gabinete_routes.py`
- `app\backend\routers\email_routes.py`
- `app\backend\routers\mdb_writer.py`
- `app\backend\routers\os_audit_service.py`
- `app\backend\routers\os_routes.py`
- `app\backend\routers\pcp_routes.py`
- `app\backend\routers\proof_portal_routes.py`
- `app\backend\routers\report_custom_routes.py`
- `app\backend\routers\requisicao_routes.py`
- `app\backend\scripts\diag_timeline_destinos.py`
- `app\backend\scripts\diag_timeline_patterns.py`
- `app\backend\services\cliente_os_timeline_service.py`
- `app\backend\services\email_pendencias_service.py`
- `app\backend\services\os_arquivos_service.py`
- `app\backend\services\os_filter_options_service.py`
- `app\backend\services\os_search_service.py`
- `app\backend\services\os_sub_os_queries.py`
- `app\backend\services\papelaria_jobs_service.py`
- `app\backend\services\papelaria_models_service.py`
- `app\backend\services\papelaria_svg_service.py`
- `app\backend\services\pre_analise\os_loader.py`
- `app\backend\services\proof_papelaria_service.py`
- `app\backend\tests\test_os_ultimo_andamento_search.py`
- `app\services\monitor_os_changes.py`
- `app\services\sync_andamentos_v2.py`
- `apps\web\src\features\papelaria\types.ts`
- `deploy\release\app\backend\mdb_helpers.py`
- `deploy\release\app\backend\os_calc_fields.py`
- `deploy\release\app\backend\os_search_indexes_schema.py`
- `deploy\release\app\backend\os_text_search_indexes_schema.py`
- `deploy\release\app\backend\routers\analise_routes.py`
- `deploy\release\app\backend\routers\auxiliar_routes.py`
- `deploy\release\app\backend\routers\cliente_gabinete_routes.py`
- `deploy\release\app\backend\routers\email_routes.py`
- _... e mais 34 arquivos_

### `tabPapelariaJobs`

**Usada em (arquivos):**

- `app\backend\services\papelaria_jobs_service.py`
- `app\backend\tests\test_papelaria_jobs_service.py`
- `deploy\release\app\backend\services\papelaria_jobs_service.py`
- `deploy\release\app\backend\tests\test_papelaria_jobs_service.py`
- `deploy\release\sql\alter_papelaria_jobs_prova_revisao.sql`
- `deploy\release\sql\create_papelaria_jobs.sql`
- `deploy\sql\alter_papelaria_jobs_prova_revisao.sql`
- `deploy\sql\create_papelaria_jobs.sql`
- `tools\audit_previsao_prazo_data.py`

### `tabUsuarios`

**Usada em (arquivos):**

- `app\backend\routers\api.py`
- `app\backend\routers\auth_routes.py`
- `app\backend\routers\ip_admin_routes.py`
- `app\backend\routers\realtime.py`
- `app\backend\routers\setor_painel_routes.py`
- `app\backend\routers\user_admin_routes.py`
- `app\backend\routers\user_routes.py`
- `app\backend\security\user_permissions.py`
- `app\backend\services\os_vinculo_grupo_service.py`
- `app\backend\services\user_registered_ips_service.py`
- `app\backend\setor_painel_schema.py`
- `app\backend\user_auth_schema.py`
- `app\backend\user_registered_ips_schema.py`
- `deploy\release\app\backend\routers\api.py`
- `deploy\release\app\backend\routers\auth_routes.py`
- `deploy\release\app\backend\routers\ip_admin_routes.py`
- `deploy\release\app\backend\routers\realtime.py`
- `deploy\release\app\backend\routers\setor_painel_routes.py`
- `deploy\release\app\backend\routers\user_admin_routes.py`
- `deploy\release\app\backend\routers\user_routes.py`
- `deploy\release\app\backend\security\user_permissions.py`
- `deploy\release\app\backend\services\os_vinculo_grupo_service.py`
- `deploy\release\app\backend\services\user_registered_ips_service.py`
- `deploy\release\app\backend\setor_painel_schema.py`
- `deploy\release\app\backend\user_auth_schema.py`
- `deploy\release\app\backend\user_registered_ips_schema.py`
- `deploy\scripts\grant_user_full_access.py`

### `tabAnalises`

**Usada em (arquivos):**

- `app\backend\report_service.py`
- `app\backend\routers\analise_routes.py`
- `app\backend\routers\email_routes.py`
- `app\backend\services\email_dispatch_type_service.py`
- `app\backend\services\email_template_model_service.py`
- `app\backend\services\sat_registro_pt_migration.py`
- `app\backend\tests\test_email_template_models.py`
- `deploy\release\app\backend\report_service.py`
- `deploy\release\app\backend\routers\analise_routes.py`
- `deploy\release\app\backend\routers\email_routes.py`
- `deploy\release\app\backend\services\email_dispatch_type_service.py`
- `deploy\release\app\backend\services\email_template_model_service.py`
- `deploy\release\app\backend\services\sat_registro_pt_migration.py`
- `deploy\release\app\backend\tests\test_email_template_models.py`
- `deploy\scripts\check_db_analise_counts.py`
- `deploy\scripts\migrate_sat_registro_pt.py`
- `deploy\scripts\recover_analise_from_ibd.py`
- `deploy\scripts\recover_analise_manual_insert.py`
- `deploy\scripts\scan_backup_substrings.py`
- `deploy\scripts\scan_backup_tables.py`

### `tabProofTokens`

**Usada em (arquivos):**

- `app\backend\cliente_gabinete_schema.py`
- `app\backend\routers\cliente_gabinete_routes.py`
- `app\backend\routers\proof_portal_routes.py`
- `app\backend\services\cliente_os_timeline_service.py`
- `app\backend\services\papelaria_jobs_service.py`
- `app\backend\services\proof_papelaria_service.py`
- `app\backend\tests\test_papelaria_jobs_service.py`
- `app\backend\tests\test_proof_email_files.py`
- `deploy\release\app\backend\cliente_gabinete_schema.py`
- `deploy\release\app\backend\routers\cliente_gabinete_routes.py`
- `deploy\release\app\backend\routers\proof_portal_routes.py`
- `deploy\release\app\backend\services\cliente_os_timeline_service.py`
- `deploy\release\app\backend\services\papelaria_jobs_service.py`
- `deploy\release\app\backend\services\proof_papelaria_service.py`
- `deploy\release\app\backend\tests\test_papelaria_jobs_service.py`
- `deploy\release\app\backend\tests\test_proof_email_files.py`
- `scripts\purge_os_pre_2024.py`
- `tools\audit_previsao_prazo_data.py`

### `tab_os_ultimo_andamento_operacional`

**Usada em (arquivos):**

- `app\backend\os_ultimo_andamento_schema.py`
- `app\backend\services\os_home_source_service.py`
- `app\backend\services\os_materialized_reconcile_service.py`
- `app\backend\services\os_operacional_notify_service.py`
- `app\backend\services\os_ultimo_andamento_service.py`
- `app\backend\tests\test_os_search_gap_fallback.py`
- `app\backend\tests\test_os_search_security.py`
- `app\backend\tests\test_os_ultimo_andamento_search.py`
- `deploy\release\app\backend\os_ultimo_andamento_schema.py`
- `deploy\release\app\backend\services\os_home_source_service.py`
- `deploy\release\app\backend\services\os_materialized_reconcile_service.py`
- `deploy\release\app\backend\services\os_operacional_notify_service.py`
- `deploy\release\app\backend\services\os_ultimo_andamento_service.py`
- `deploy\release\app\backend\tests\test_os_search_gap_fallback.py`
- `deploy\release\app\backend\tests\test_os_search_security.py`
- `deploy\release\app\backend\tests\test_os_ultimo_andamento_search.py`
- `deploy\release\scripts\ops\rebuild_os_ultimo_andamento.py`
- `deploy\release\scripts\ops\validate_os_ultimo_andamento.py`
- `deploy\release\sql\create_tab_os_ultimo_andamento_operacional.sql`
- `deploy\sql\create_tab_os_ultimo_andamento_operacional.sql`
- `scripts\diag_lista_os_2026.py`
- `scripts\diag_os_search_solicitante.py`
- `scripts\diag_sefoc_home_vs_panel.py`
- `scripts\purge_os_pre_2024.py`
- `scripts\purge_os_pre_2024_counts.py`
- `scripts\rebuild_os_ultimo_andamento.py`
- `scripts\reconcile_home_os_sources.py`
- `scripts\reconcile_os_ultimo_andamento.py`
- `scripts\validate_os_ultimo_andamento.py`
- `sync_andamentos_v2.py`
- `tools\audit_previsao_prazo_data.py`
- `tools\validate_sync_mdb_mysql.py`

### `tabClienteGabinete`

**Usada em (arquivos):**

- `app\backend\cliente_gabinete_schema.py`
- `app\backend\routers\auth_routes.py`
- `app\backend\routers\cliente_gabinete_routes.py`
- `deploy\release\app\backend\cliente_gabinete_schema.py`
- `deploy\release\app\backend\routers\auth_routes.py`
- `deploy\release\app\backend\routers\cliente_gabinete_routes.py`
- `tools\audit_previsao_prazo_data.py`

---

## 14. Considerações para futura modelagem ideal

### Entidades propostas → tabelas atuais

| Entidade ideal | Tabelas atuais | Ação sugerida |
|---|---|---|
| work_order | tabProtocolos + tabDetalhesServico | Unificar casing; PK surrogate + unique (ano,nro) |
| work_order_progress | tabAndamento (única) | Eliminar duplicata; FK para work_order |
| sector | tabSetorPainelDefaults + domínio | Normalizar SetorLink |
| user_account | tabUsuarios | Separar credenciais; RBAC user_permissions |
| print_shop_job | tabPapelariaJobs | Manter domínio Web |
| proof_session | tabAnalises + tabProofTokens | Unificar tokens |
| client_portal | tabClienteGabinete + tabClientTokens | — |
| sync_audit | log_sync_*, deleted_andamentos | Schema audit separado |
| search_cache | tab_os_ultimo_andamento_operacional, tab_os_filter_* | Cache schema ou views |

### Campos obrigatórios compatibilidade legado
- Protocolo: NroProtocolo, AnoProtocolo, CodigoRequisic
- Andamento: CodStatus (único global), NroProtocoloLink, AnoProtocoloLink, SetorLink, Data
- Detalhes: NroProtocoloLinkDet, AnoProtocoloLinkDet, Titulo

### Candidatas a eliminar/fusão futura
- tabandamento (duplicata lowercase)
- monitor_* (substituir por CDC ou event log)
- Tabelas `_Plan*`, `tmp*` se confirmado obsolescência

### Decisões humanas necessárias
1. Fonte da verdade definitiva: MySQL-only ou dual-write transitório?
2. Unificação imediata tabAndamento/tabandamento — qual preservar?
3. Manter CodStatus global ou migrar para ID surrogate?
4. Quais campos Web-only exportar ao MDB no contingência?
5. Retenção de OS AntigaCore / Papelaria Antiga no escopo Web?

---

## 15. Considerações para exportador MySQL → MDB

### Tabelas MDB que precisariam receber dados
- `tabProtocolos` (PK: NroProtocolo + AnoProtocolo)
- `tabDetalhesServico` (PK: NroProtocoloLinkDet + AnoProtocoloLinkDet)
- `tabAndamento` (PK: CodStatus)
- Possivelmente `tabUsuarios` (se usuários Web precisarem existir no desktop)

### Campos obrigatórios / formatos Access
- Booleanos via `to_mdb_bool` (0/-1)
- Datas via `to_mdb_datetime`
- Memos longos via `to_mdb_memo`
- Campos calculados em detalhes — **não gravar** (CALC_DETALHES_FIELDS)

### Dados modernos sem equivalente MDB
- tabPapelariaJobs, modelos SVG, tokens, permissões IP, audit log, sub-OS espelhos
- email_pt_* campos em protocolos
- tab_os_ultimo_andamento_operacional (derivado)

### Riscos ao escrever MDB
- Lock exclusivo Access — produção parada
- Corrupção se interrompido mid-write
- Roteamento errado OS vs Papelaria (Nro>=5000)
- Sobrescrever edições desktop não replicadas no MySQL

### Tabelas MDB que provavelmente **não** devem ser alteradas
- Tabelas de lookup estáticas, `_Plan*`, relatórios Access, queries vinculadas

---

## 16. Lacunas e dúvidas que precisam de validação humana

1. Qual cópia de `sync_andamentos_v2.py` está em produção no cgrafsysvm — raiz ou `app/services`?
2. Existe `schema_sagrafulldb.sql` completo fora do repo? Necessário para histórico de tabelas sem CREATE no código.
3. tabprotocolos/tabdetalhesservico lowercase são views, aliases ou tabelas físicas duplicadas?
4. Frequência real de execução dos scripts em `sync_tables/` — ainda usados ou legado?
5. tabUsuarios: senhas ainda sincronizadas com MDB ou só MySQL?
6. Quais tabelas `monitor_*` estão ativamente populadas?
7. SAT.accdb — escopo de integração além de migrate_sat_registro_pt?
8. Política de retenção para backup_andamentos, deleted_andamentos, logs.

---

## 17. Anexos técnicos

### 17.1 Arquivos de auditoria gerados

- `tools/_audit_mysql_output.json` — dump completo schema MySQL
- `tools/_audit_mdb_output.json` — dump completo schema MDB
- `tools/_audit_code_refs.json` — referências de tabelas no código

### 17.2 Lista completa de tabelas MySQL

`_plan1`, `_tabchecageminicial`, `_tabopenform`, `acabamento`, `acabamentos_catalogo`, `andamentos_backup`, `andamentos_mdb_cache`, `apagar-creditos`, `apagar-debitos`, `apagar-tabtipocota`, `apagar-tabtipocota1`, `backup_andamentos`, `cache_andamentos_mdb`, `componente_variacao`, `cor`, `ct_gravacao_eventos`, `delete_candidates`, `deleted_andamentos`, `deputadoscache`, `ds_model_training_history`, `ds_production_features`, `erros ao colar`, `ip_permissions`, `log_sincronizacao`, `log_sync_andamentos`, `monitor_cache_detalhes`, `monitor_detalhes_os`, `monitor_detalhes_sp`, `monitor_protocol_os`, `monitor_protocol_sp`, `normalizacao_state`, `normalizacao_state_v2`, `os_acabamentos`, `os_componente_lotes`, `os_componentes`, `papel`, `produto`, `produto_componente`, `sagra_sync_change_log`, `sagra_sync_meta`, `sagra_sync_row_state`, `sagra_sync_state`, `shadow_tabandamento_mdb`, `shadow_tabdetalhesservico_mdb`, `shadow_tabprotocolos_mdb`, `stg_normalizacao`, `stg_revisao_manual`, `suspected_deletes`, `sync_baseline_detalhes`, `sync_baseline_protocolos`, `sync_changes_log`, `sync_circuit_breaker`, `sync_control`, `sync_hash_detalhes`, `sync_hash_protocolos`, `sync_meta_detalhes`, `sync_meta_protocolos`, `sync_missing_candidates`, `sync_outbox`, `sync_outbox_dedupe`, `sync_state`, `sync_status`, `sync_v2_baseline_detalhes`, `sync_v2_baseline_protocolos`, `sync_v2_meta_detalhes`, `sync_v2_meta_protocolos`, `sync_v2_state`, `tab_os_audit_log`, `tab_os_componentes`, `tab_os_filter_produtos`, `tab_os_filter_solicitantes`, `tab_os_sub_os`, `tab_os_sub_os_andamento`, `tab_os_ultimo_andamento_operacional`, `tab_pcp_fila`, `tab_pre_analise_snapshot`, `tab_pre_analise_timing`, `tab_pre_analise_timing_file`, `tabanaliseitens`, `tabanalises`, `taband1atiposdepend`, `taband1tipopend`, `taband2contatos`, `taband3aitensdesccompleta`, `taband3descricaocompleta`, `tabandamento`, `tabcalculosos`, `tabcategorias`, `tabclientegabinete`, `tabclienttokens`, `tabcores`, `tabdadosdeputados`, `tabdeputados-old 2013`, `tabdeputados-old 2014`, `tabdetalhesservico`, `tabdetalhesservicomdb`, `tabemailexchangeconfig`, `tabemailtemplateconfig`, `tabemailtemplatemodel`, `tabentregaforma`, `tabentregaprazo`, `tabexportarprotocoloanoanterior`, `tabformatoimpressao`, `tabformatonormalize`, `tabformatos`, `tabindicadores`, `tabippermitidos`, `tablegs`, `tablocalmidia`, `tablogchecklist`, `tablogcodrs`, `tablogfichaos`, `tabmaquinas`, `tabmaterialentregue`, `tabmesa`, `tabmidiadigital`, `tabmigracaosatregistropt`, `tabmotivoafastamento`, `tabnotificacoes`, `taborgaos`, `tabosarquivostokens`, `tabosvinculadas`, `tabosvinculoexcecoes`, `tabosvinculogrupos`, `tabpapel`, `tabpapelariajoblog`, `tabpapelariajobs`, `tabpapelariamodelos`, `tabpapelariasvgmodelos`, `tabpapelariaworkerheartbeat`, `tabpermissoes`, `tabproblemaspadrao`, `tabprooftokens`, `tabprotocolos`, `tabprotocolosbloqueados`, `tabprotocolosmdb`, `tabrespgraf`, `tabselecionados`, `tabsetor`, `tabsetorpaineldefaults`, `tabsituacao`, `tabsituacao-old`, `tabsolicitacoesacesso`, `tabsupportmessages`, `tabsupportthreadmessages`, `tabtipomidiadigital`, `tabtipopubmodelos`, `tabuserfiltersettings`, `tabuserpreferences`, `tabusersavedfilters`, `tabusuarios`, `user_permissions`, `user_registered_ips`, `variacao_acabamento`, `variacao_cor`, `variacao_papel`, `xpose_paths`, `xpose_tickets`