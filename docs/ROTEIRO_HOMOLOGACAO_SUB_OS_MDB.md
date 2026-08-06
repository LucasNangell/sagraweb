# Roteiro de Homologação — Sub OS por Componente com MDB

**Versão:** 1.0  
**Data:** 2026-06-08  
**Escopo:** validação manual antes de publicar Sub OS por Componente em produção  
**Restrições:** não alterar código; não publicar; não reiniciar produção; não executar testes destrutivos em MDB/MySQL de produção real.

---

## 1. Objetivo

Validar em ambiente controlado que a feature **Sub OS por Componente** funciona corretamente com **dual-write MySQL + MDB** (`MYSQL_ONLY=false`), com foco nos riscos corrigidos na auditoria:

1. Espelho de andamento grava em `tabAndamento` e no Access com **`UltimoStatus=0`**.
2. Após exclusão de andamento operacional principal, o espelho **não** é promovido a status atual (MySQL e MDB).
3. Componentes, Sub OS, congelamento, lista, portal e painéis se comportam conforme especificação.

Este roteiro substitui os testes automatizados (57 passed) para o cenário real do driver ODBC/Access — os testes unitários usam mocks e **não** validam gravação física no `.mdb`.

---

## 2. Pré-requisitos

### 2.1 Equipe e acesso

| Item | Requisito |
|------|-----------|
| Operador | Usuário com permissão `ctx_detalhes_os` e acesso à Gerência |
| Segundo operador | Outro navegador/sessão (ou outro PC) para teste de persistência |
| Banco | Acesso **somente leitura** ao MySQL (`SELECT`) — preferencialmente DBeaver/Workbench |
| Access | Acesso **somente leitura** ao `.mdb` de homologação (ou consulta ODBC) |
| Servidor dev | API local via `iniciar-servidor.bat` |

### 2.2 URLs corretas (obrigatório)

| Ambiente | URL | Usar para homologação? |
|----------|-----|------------------------|
| Dev local | `http://127.0.0.1:5173/` (Vite → proxy `127.0.0.1:8001`) | **Sim** |
| API direta | `http://127.0.0.1:8001/health` | Diagnóstico |
| Produção | `http://cgrafsysvm/sagra/` ou `http://10.1.1.73/sagra` | **Não** |

> **Alerta:** testes feitos via URL de produção usam a config do **servidor cgrafsysvm**, não a do PC de dev. Gravações irão para MDB real de produção.

### 2.3 Configuração mínima no dev

Arquivo `config/.env`:

```env
ENV=development
MYSQL_ONLY=false
SYNC_ANDAMENTOS_ENABLED=false
PORT=8001
```

Arquivo `config/config.json`: caminhos MDB apontando para **cópia** (não produção). JSON **válido** — sem comentários `//`.

### 2.4 Verificação rápida antes de iniciar (somente leitura)

No PowerShell, a partir de `C:\dev\SagraWeb\app\backend`:

```powershell
python -c "from config_manager import config_manager; print('ENV:', config_manager.get('env')); print('MYSQL_ONLY:', config_manager.is_mysql_only()); print('MDB os_atual:', config_manager.get('mdb_os_atual_path')); print('MDB write:', config_manager.is_mdb_write_enabled())"
```

**Resultado esperado no dev atual:**

- `ENV: development`
- `MYSQL_ONLY: False`
- `MDB os_atual: I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\BackupMySQL\Sagra Base - OS Atual.mdb`
- `MDB write: True`

No log de startup da API, **não** deve aparecer `Error loading config`.

### 2.5 Checklist de pré-voo

- [ ] Servidor dev reiniciado após última alteração de config
- [ ] `config.json` parseia sem erro (sem comentários JSON)
- [ ] Frontend acessado em `127.0.0.1:5173`, não em cgrafsysvm
- [ ] OS de teste criada e anotada (número/ano)
- [ ] OS de teste **não** é OS real em uso operacional
- [ ] MDB de homologação acessível e **desbloqueado** (Access fechado ou em modo leitura)
- [ ] Planilha de evidências aberta (prints + CodStatus anotados)

---

## 3. Ambiente seguro

> Inspeção realizada em **2026-06-08** no workspace `C:\dev\SagraWeb`. Nenhuma ação destrutiva foi executada.

### 3.1 Arquivo `.env` em uso

| Variável | Valor atual | Observação |
|----------|-------------|------------|
| Arquivo | `C:\dev\SagraWeb\config\.env` | Carregado no startup via `config_manager` |
| `ENV` | `development` | Perfil dev local (`127.0.0.1:8001`) |
| `MYSQL_ONLY` | `false` | Dual-write MySQL + MDB **habilitado** |
| `SYNC_ANDAMENTOS_ENABLED` | `false` | Motor sync legado desligado |
| `DB_HOST` | `10.1.1.73` | MySQL compartilhado |
| `DB_NAME` | `sagrafulldb` | **Mesmo banco usado em produção** |
| `PORT` | `8001` | API local |

### 3.2 Caminhos MDB configurados (dev)

| Chave | Caminho atual |
|-------|---------------|
| `mdb_os_atual_path` | `I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\BackupMySQL\Sagra Base - OS Atual.mdb` |
| `mdb_papelaria_path` | `I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\BackupMySQL\Sagra Base - Papelaria Atual.mdb` |
| `mdb_os_antiga_path` | `I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\BackupMySQL\Sagra Base - OS AntigaCore.mdb` |
| `mdb_papelaria_antiga_path` | `I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\BackupMySQL\Sagra Base - Papelaria Antiga.mdb` |

### 3.3 Comparação com produção (referência)

Template de produção (`deploy/templates/config/config.json`):

| Aspecto | Produção | Dev atual |
|---------|----------|-----------|
| `env` | `production` | `development` |
| `mysql_only` | `true` (MDB desligado no servidor) | `false` via `.env` |
| MDB OS Atual | `...\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb` | `...\BackupMySQL\Sagra Base - OS Atual.mdb` |
| MySQL | `10.1.1.73` / `sagrafulldb` | **Idêntico** |

### 3.4 Análise de risco

| Camada | Aponta para produção? | Seguro para teste destrutivo? |
|--------|----------------------|-------------------------------|
| **MDB (Access)** | **Não** — pasta `BackupMySQL` (cópia) | **Sim**, desde que confirme que o arquivo é cópia e não o `.mdb` operacional |
| **MySQL** | **Sim** — `sagrafulldb` em `10.1.1.73` | **Não totalmente** — gravações em `tabAndamento`, `tab_os_*` afetam o banco compartilhado |
| **API de produção** | Se usar URL cgrafsysvm | **Não** — bloqueado para homologação |

### 3.5 Veredito do ambiente

**Parcialmente seguro — homologação permitida com restrições obrigatórias:**

1. **Usar exclusivamente OS de teste recém-criada** — nunca OS real em operação.
2. **Identificar a OS claramente** (ex.: cliente/descrição `HOMOLOG SUB-OS 2026-06-08`).
3. **Não homologar via servidor de produção** — apenas dev local.
4. **MDB:** confirmar que os arquivos em `BackupMySQL\` são cópias atualizadas o suficiente para conter a OS de teste em `tabProtocolos` (senão o sync MDB falhará com log de erro, sem corromper produção MDB).
5. **MySQL:** aceitar que dados de teste ficarão em `sagrafulldb` até limpeza manual posterior (fora do escopo deste roteiro).
6. Se for necessário isolamento total, **parar** e provisionar: cópia MySQL dedicada + cópia MDB + `.env` apontando para ambos.

> **Se os MDBs voltarem a apontar para `BaseDeDados - SAGRA2\` (sem `BackupMySQL`), interromper imediatamente — há risco de gravar no Access de produção.**

---

## 4. Massa de teste

### 4.1 Critérios da OS

| Critério | Valor |
|----------|-------|
| Tipo | OS **nova**, criada para homologação |
| Número | Anotar `{NRO}` e `{ANO}` — ex.: `886` / `2026` (usar número real criado) |
| Cliente/descrição | Prefixo `HOMOLOG SUB-OS` visível |
| Status inicial | Ativa (ex.: `Em Execução` ou `Recebido`) |
| Protocolo | `< 5000` (usa MDB OS Atual, não Papelaria) |

### 4.2 Componentes obrigatórios (Gerência / TechSpec)

| # | Tipo | Nome | Finalidade |
|---|------|------|------------|
| 1 | Preset | **Capa** | Sub OS nomeada `886 [Capa]` |
| 2 | Preset | **Miolo** | Segunda Sub OS |
| 3 | Livre | **Encarte Especial** (ou outro nome livre) | Teste de componente livre + renomeação |

### 4.3 Dados de controle a anotar durante os testes

Preencher conforme avança:

```
OS de teste: NRO _____ / ANO _____
Operador: _________________  Data: ___/___/2026

Componente Capa ID: _______
Componente Miolo ID: _______
Componente livre ID: _______

Sub OS Capa ID: _______
Sub OS Miolo ID: _______

Andamento operacional A — CodStatus: _______  (UltimoStatus=1)
Andamento operacional B — CodStatus: _______  (opcional, mais antigo)
Espelho Sub OS Capa — CodStatus: _______  (UltimoStatus=0)
cod_status_espelho (MySQL sub_os_andamento): _______
```

### 4.4 Pré-condição MDB

Antes do teste 2 (andamento normal), confirmar que a OS existe no MDB de homologação:

```sql
-- Access / ODBC (substituir NRO e ANO)
SELECT NroProtocolo, AnoProtocolo, Descricao
FROM tabProtocolos
WHERE NroProtocolo = {NRO} AND AnoProtocolo = {ANO};
```

Se retornar vazio: sincronizar OS para o MDB de cópia primeiro (salvar OS na Gerência com `MYSQL_ONLY=false`) ou usar OS já presente na cópia.

---

## 5. Testes passo a passo

### Legenda de evidências

Cada teste deve registrar: **Passou / Falhou / N/A** + print + CodStatus quando aplicável.

---

### TESTE 1 — Componente livre

**Objetivo:** persistência MySQL de componentes com nome livre.

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 1.1 | Abrir OS de teste na **Gerência** | TechSpec carrega |
| 1.2 | Adicionar componente livre **Encarte Especial** | Aparece na lista |
| 1.3 | Manter Capa e Miolo | Três componentes visíveis |
| 1.4 | **Salvar** OS | Toast/sucesso |
| 1.5 | Abrir **outro navegador** (ou aba anônima), mesma OS | Componentes idênticos |
| 1.6 | Renomear **Encarte Especial** → **Encarte Revista** | Salvar |
| 1.7 | Conferir `tab_os_componentes` (query §6.1) | Mesmo `id`, nome atualizado, `ativo=1` |
| 1.8 | Se já existir Sub OS no componente renomeado | `display_name` da Sub OS atualizado para `{NRO} [Encarte Revista]` |

**Critério de falha:** componente some após salvar; ID muda após renomear; segundo navegador não vê alteração.

---

### TESTE 2 — Andamento normal da OS principal

**Objetivo:** baseline operacional + gravação MDB com `UltimoStatus=1`.

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 2.1 | Selecionar OS na lista inicial | Painel de histórico aberto |
| 2.2 | **Desmarcar** "Andamento por componente" | Modo OS principal |
| 2.3 | Lançar andamento: ex. `Em Execução` / setor válido / obs `HOMOLOG-A operacional` | Sucesso |
| 2.4 | Anotar `CodStatus` retornado (histórico ou query §6.4) | = **Andamento A** |
| 2.5 | Query MySQL §6.4 | Andamento A com `UltimoStatus=1` |
| 2.6 | Query MDB §6.7 | Registro A no Access com `UltimoStatus=1` (ou `-1`/`True` no Access) |
| 2.7 | Lista inicial | Status da OS = situação do andamento A |
| 2.8 | Log da API | Sem `Error loading config`; sem erro fatal de sync MDB |

**Critério de falha:** andamento não aparece no MDB; status da lista diverge; sync falha silenciosamente.

---

### TESTE 3 — Andamento por componente (Capa)

**Objetivo:** Sub OS + espelho + MDB com `UltimoStatus=0`.

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 3.1 | Marcar **"Andamento por componente"** | Seletor de componente habilitado |
| 3.2 | Selecionar **Capa** | Label `886 [Capa]` (ou `{NRO} [Capa]`) |
| 3.3 | Lançar: ex. `Recebido` / setor / obs `HOMOLOG-Capa-1` | Sucesso |
| 3.4 | Resposta API (Network tab) | `sub_history_id`, `mirror_cod_status`, `display_name` |
| 3.5 | Query §6.2 | Sub OS criada ou reutilizada para `componente_id` da Capa |
| 3.6 | Query §6.3 | Registro em `tab_os_sub_os_andamento` com `ultimo_status=1` |
| 3.7 | Query §6.3 | `cod_status_espelho` preenchido = `mirror_cod_status` |
| 3.8 | Query §6.4 | Espelho em `tabAndamento` com `UltimoStatus=0` |
| 3.9 | Query §6.4 | `Observaçao` inicia com `{HH}h{MM} - OS {NRO} [Capa]` |
| 3.10 | Query MDB §6.7 | Espelho presente com `UltimoStatus=0` |
| 3.11 | Query §6.4 | Andamento A **permanece** `UltimoStatus=1` |
| 3.12 | Lista inicial | Status da OS **inalterado** (ainda andamento A) |

**Critério de falha:** espelho com `UltimoStatus=1`; OS principal muda status; MDB sem espelho; formato de obs incorreto.

---

### TESTE 4 — Histórico (principal vs Sub OS)

**Objetivo:** separação correta de históricos.

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 4.1 | OS principal selecionada (não Sub OS) | Histórico lista andamento A + espelho Capa |
| 4.2 | Ordenação | Mais recente primeiro (`Data DESC`) |
| 4.3 | Expandir OS na lista (`+`) → clicar **886 [Capa]** | Badge **Componente: Capa** |
| 4.4 | Painel histórico da Sub OS | **Somente** andamento `HOMOLOG-Capa-1` |
| 4.5 | Status exibido na Sub OS | Reflete andamento da Sub OS, não confundir com OS principal |
| 4.6 | (Opcional) Lançar andamento Miolo | Nova Sub OS; históricos independentes |

**Critério de falha:** histórico Sub OS mostra espelho; histórico principal omite espelho; ordem incorreta.

---

### TESTE 5 — CRÍTICO: Exclusão e recálculo de UltimoStatus

**Objetivo:** validar correção da auditoria — espelho **nunca** promovido após delete.

#### Setup

Garantir esta ordem cronológica (mais recente = espelho):

1. Andamento operacional **A** — `UltimoStatus=1` (teste 2).
2. Andamento espelho **Capa** — `UltimoStatus=0` (teste 3) — **mais recente por Data**.

Opcionalmente, criar andamento operacional **B** mais antigo que A para testar promoção correta.

#### Execução

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 5.1 | Anotar CodStatus de A e do espelho | Controle |
| 5.2 | No histórico **principal**, excluir andamento **A** (operacional) | Confirmação + sucesso |
| 5.3 | Query §6.5 imediata | Espelho: `UltimoStatus=0` |
| 5.4 | Query §6.5 | Nenhum espelho com `UltimoStatus=1` |
| 5.5 | Query §6.5 | Se existir B operacional: B promovido a `UltimoStatus=1` |
| 5.6 | Query §6.5 | Se **não** existir outro operacional: **nenhum** registro com `UltimoStatus=1` |
| 5.7 | Query MDB §6.7 | Espelho permanece `UltimoStatus=0` no Access |
| 5.8 | Query MDB §6.8 | Status atual no MDB **não** é o CodStatus do espelho |
| 5.9 | Lista / status OS | Reflete operacional restante ou vazio — **nunca** situação só do espelho |

#### Comportamento esperado quando só restam espelhos

`recalc_ultimo_status_operacional()` retorna `None` — todos ficam com `UltimoStatus=0`. Documentar como **aceitável** se a OS de teste ficar sem status operacional até novo andamento manual.

**Critério de reprovação imediata:** espelho vira `UltimoStatus=1` em MySQL **ou** MDB.

---

### TESTE 6 — Congelamento

**Objetivo:** Sub OS bloqueada em OS Entregue/Cancelada; descongelamento automático.

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 6.1 | Restaurar OS ativa se necessário (andamento `Em Execução`) | OS não congelada |
| 6.2 | Query §6.2 | `congelada=0` nas Sub OS |
| 6.3 | Lançar andamento principal **Entregue** (ou **Cancelada**) | Sucesso |
| 6.4 | Query §6.2 | `congelada=1` |
| 6.5 | Tentar andamento por componente (Capa) | **Bloqueado** — HTTP 403 ou mensagem de OS congelada |
| 6.6 | Tentar `POST /api/os/{ano}/{id}/sub-os` | **Bloqueado** se OS congelada |
| 6.7 | Alterar/excluir andamento principal para voltar a status ativo | Ex.: `Em Execução` |
| 6.8 | Query §6.2 | `congelada=0` automaticamente |
| 6.9 | Andamento por componente | **Permitido** novamente |

**Critério de falha:** Sub OS aceita andamento com OS Entregue/Cancelada; `congelada` não sincroniza após update/delete/replicate.

---

### TESTE 7 — Remoção de componente

**Objetivo:** componente com Sub OS não é deletado fisicamente.

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 7.1 | Garantir Sub OS existente para **Miolo** (criar andamento se necessário) | Sub OS ID anotado |
| 7.2 | Criar Sub OS para componente **sem andamento** (Miolo ou livre) via API ou UI | Sub OS existe, zero andamentos |
| 7.3 | Na Gerência, **remover** componente Miolo da lista | Salvar OS |
| 7.4 | Query §6.1 com `ativo` | Registro existe com `ativo=0` — **não** DELETE |
| 7.5 | Query §6.2 | Sub OS ainda vinculada ao `componente_id` |
| 7.6 | UI Gerência | Componente removido da lista ativa |
| 7.7 | Expandir `+` na lista | Sub OS ainda listável (pode aparecer com componente inativo — documentar comportamento observado) |

**Critério de falha:** row deletada de `tab_os_componentes`; Sub OS órfã; erro 500 ao salvar.

---

### TESTE 8 — Lista inicial

**Objetivo:** indicador `+`, expansão lazy, detalhes Sub OS.

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 8.1 | Buscar OS de teste na lista | Linha visível |
| 8.2 | Verificar indicador | `{NRO} +` quando `has_sub_os=true` |
| 8.3 | Clicar `+` | Expande; lazy load `GET /api/os/{ano}/{id}/sub-os` |
| 8.4 | Sub-linha | `886 [Capa]` indentada |
| 8.5 | Clicar Sub OS | Detalhes herdados da OS principal + badge componente |
| 8.6 | Paginação | Sub OS **não** conta como linha extra na paginação |
| 8.7 | Filtros/ordenação | OS principal comporta-se normalmente; Sub OS só após expandir |

**Critério de falha:** prefetch N× summary regressivo; duplicação na paginação; `+` ausente com Sub OS existente.

---

### TESTE 9 — Portal cliente

**Objetivo:** portal não expõe Sub OS.

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 9.1 | Acessar portal cliente com credenciais de teste | Portal carrega |
| 9.2 | Localizar OS de homologação | **Uma** entrada — OS principal |
| 9.3 | Verificar listagem/detalhe | **Sem** linhas `886 [Capa]` / Sub OS |
| 9.4 | Status exibido | Status operacional da OS principal |

**Critério de falha:** Sub OS visível no portal.

---

### TESTE 10 — Painéis / PCP / relatórios

**Objetivo:** sem duplicação ou alteração indevida de status geral.

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 10.1 | Painel operacional (ex.: fila/setor) | OS aparece **uma vez** |
| 10.2 | PCP / fila de trabalho | Sem duplicata por Sub OS |
| 10.3 | Status nos painéis | Reflete OS principal, não andamento de componente |
| 10.4 | Relatório/busca existente | Sem regressão (Sub OS não é OS independente) |

**Critério de falha:** OS duplicada; status geral alterado por andamento de componente.

---

## 6. Queries SQL de conferência

> **Somente SELECT.** Substituir `{NRO}`, `{ANO}`, `{COD}`, `{SUB_OS_ID}`, `{COMPONENTE_ID}` pelos valores anotados.  
> MySQL: banco `sagrafulldb`. Access: adaptar sintaxe se necessário (`TOP` em vez de `LIMIT`).

### 6.1 Componentes da OS

```sql
SELECT
    id,
    nro_protocolo,
    ano_protocolo,
    nome,
    nome_normalizado,
    tipo,
    ordem,
    ativo,
    criado_em,
    atualizado_em
FROM tab_os_componentes
WHERE nro_protocolo = {NRO}
  AND ano_protocolo = {ANO}
ORDER BY ordem, id;
```

### 6.2 Sub OS da OS

```sql
SELECT
    s.id,
    s.display_name,
    s.componente_id,
    c.nome AS componente_nome,
    c.ativo AS componente_ativo,
    s.ativo,
    s.congelada,
    s.criado_em
FROM tab_os_sub_os s
JOIN tab_os_componentes c ON c.id = s.componente_id
WHERE s.nro_protocolo = {NRO}
  AND s.ano_protocolo = {ANO}
ORDER BY s.id;
```

### 6.3 Andamentos da Sub OS + vínculo espelho

```sql
SELECT
    a.id,
    a.sub_os_id,
    s.display_name,
    a.situacao,
    a.setor,
    a.observacao,
    a.data,
    a.ultimo_status,
    a.cod_status_espelho,
    a.ponto,
    a.criado_em
FROM tab_os_sub_os_andamento a
JOIN tab_os_sub_os s ON s.id = a.sub_os_id
WHERE s.nro_protocolo = {NRO}
  AND s.ano_protocolo = {ANO}
ORDER BY a.data DESC, a.id DESC;
```

### 6.4 Andamentos em tabAndamento (principal + espelhos)

```sql
SELECT
    CodStatus,
    NroProtocoloLink,
    AnoProtocoloLink,
    SituacaoLink,
    SetorLink,
    `Data`,
    UltimoStatus,
    LEFT(`Observaçao`, 120) AS obs_inicio,
    Ponto
FROM tabAndamento
WHERE NroProtocoloLink = {NRO}
  AND AnoProtocoloLink = {ANO}
ORDER BY `Data` DESC, CodStatus DESC;
```

### 6.5 UltimoStatus — operacionais vs espelhos (teste crítico)

```sql
-- Status atual operacional (deve excluir espelhos)
SELECT CodStatus, SituacaoLink, SetorLink, `Data`, UltimoStatus
FROM tabAndamento
WHERE NroProtocoloLink = {NRO}
  AND AnoProtocoloLink = {ANO}
  AND UltimoStatus = 1;

-- Espelhos conhecidos (via vínculo Sub OS)
SELECT
    a.cod_status_espelho AS CodStatus,
    t.SituacaoLink,
    t.UltimoStatus,
    LEFT(t.`Observaçao`, 80) AS obs_inicio
FROM tab_os_sub_os_andamento a
JOIN tab_os_sub_os s ON s.id = a.sub_os_id
LEFT JOIN tabAndamento t ON t.CodStatus = a.cod_status_espelho
WHERE s.nro_protocolo = {NRO}
  AND s.ano_protocolo = {ANO}
  AND a.cod_status_espelho IS NOT NULL
  AND a.cod_status_espelho != '';

-- Espelho NÃO pode estar UltimoStatus=1 após delete do operacional
SELECT COUNT(*) AS espelhos_promovidos_indevidamente
FROM tabAndamento t
INNER JOIN tab_os_sub_os_andamento a ON a.cod_status_espelho = t.CodStatus
INNER JOIN tab_os_sub_os s ON s.id = a.sub_os_id
WHERE s.nro_protocolo = {NRO}
  AND s.ano_protocolo = {ANO}
  AND t.UltimoStatus = 1;
-- Resultado esperado: 0
```

### 6.6 Resumo Sub OS na busca (campo exposto pela API)

```sql
SELECT COUNT(*) AS sub_os_count
FROM tab_os_sub_os
WHERE nro_protocolo = {NRO}
  AND ano_protocolo = {ANO}
  AND ativo = 1;
-- Comparar com has_sub_os / sub_os_count em GET /api/os/search
```

### 6.7 Consulta MDB (Access / ODBC) — andamentos

```sql
SELECT
    CodStatus,
    NroProtocoloLink,
    AnoProtocoloLink,
    SituacaoLink,
    SetorLink,
    Data,
    UltimoStatus,
    Observaçao,
    Ponto
FROM tabAndamento
WHERE NroProtocoloLink = {NRO}
  AND AnoProtocoloLink = {ANO}
ORDER BY Data DESC;
```

Abrir o arquivo:

`I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\BackupMySQL\Sagra Base - OS Atual.mdb`

> No Access, `UltimoStatus` pode aparecer como checkbox (-1 = True, 0 = False).

### 6.8 MDB — status atual (CodStatus com UltimoStatus ativo)

```sql
SELECT TOP 5
    CodStatus,
    SituacaoLink,
    UltimoStatus,
    Data,
    LEFT(Observaçao, 80) AS obs_inicio
FROM tabAndamento
WHERE NroProtocoloLink = {NRO}
  AND AnoProtocoloLink = {ANO}
  AND UltimoStatus <> 0
ORDER BY Data DESC;
-- Nenhum CodStatus listado aqui deve ser cod_status_espelho da Sub OS
```

### 6.9 Conferência cruzada MySQL ↔ MDB (espelho específico)

```sql
-- MySQL
SELECT CodStatus, UltimoStatus, LEFT(`Observaçao`, 80) AS obs
FROM tabAndamento
WHERE CodStatus = '{COD_ESPELHO}';
```

Comparar manualmente com mesmo `CodStatus` no Access (§6.7).

---

## 7. Critérios de aprovação/reprovação

### 7.1 Aprovado

Todos os itens verdadeiros:

- [ ] Testes 1–10 executados na OS de homologação
- [ ] Teste 5 (crítico) passou — espelho permanece `UltimoStatus=0` após delete
- [ ] MDB de **cópia** recebe espelho com `UltimoStatus=0`
- [ ] MDB **não** promove espelho a status atual
- [ ] OS principal mantém status operacional correto
- [ ] Portal cliente sem Sub OS
- [ ] Painéis/PCP sem duplicação
- [ ] Componente com Sub OS não deletado fisicamente
- [ ] Congelamento bloqueia andamento de Sub OS
- [ ] Evidências coletadas (§9)

### 7.2 Aprovado com ressalva

Aprovado com pendências não bloqueantes, por exemplo:

- MDB de cópia desatualizado — sync falhou por OS ausente em `tabProtocolos`, mas lógica MySQL validada
- Comportamento cosmeticamente diferente no Access (formato memo) com dados corretos
- MySQL compartilhado — dados de teste permanecem até limpeza
- Painéis não exibem Sub OS (fase futura documentada — aceitável)

Documentar cada ressalva com plano de ação antes do go-live.

### 7.3 Reprovado — bloqueia produção

Reprovar imediatamente se **qualquer** condição ocorrer:

| # | Condição |
|---|----------|
| R1 | Espelho vira `UltimoStatus=1` no MySQL |
| R2 | Espelho vira `UltimoStatus=1` no MDB |
| R3 | MDB não recebe espelho (dual-write falha sistematicamente) |
| R4 | OS principal muda status indevidamente após andamento de componente |
| R5 | Portal cliente mostra Sub OS |
| R6 | Painéis duplicam OS |
| R7 | Componente com Sub OS deletado fisicamente ou Sub OS órfã |
| R8 | Sub OS permite andamento com OS Entregue/Cancelada |
| R9 | Homologação executada contra MDB de produção (`BaseDeDados - SAGRA2\` sem `BackupMySQL`) |
| R10 | Homologação executada via URL de produção (cgrafsysvm) |

---

## 8. Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| MySQL compartilhado (`sagrafulldb`) | Dados de teste misturados com produção | OS dedicada; prefixo HOMOLOG; limpeza pós-teste |
| MDB cópia desatualizada | Sync falha ou OS ausente no Access | Confirmar OS em `tabProtocolos` na cópia antes dos testes |
| Access bloqueado | Timeout/retry no sync | Fechar Access no `.mdb` de homologação durante testes |
| Config JSON inválida | Fallback silencioso para paths de produção | Validar parse JSON; ver §2.4 |
| Teste via produção | Gravação no MDB real | Usar apenas `127.0.0.1:5173` |
| Edição/exclusão de histórico Sub OS | Não implementada (405) | Não testar edição de espelho via UI — escopo futuro |
| Testes automatizados | Não cobrem ODBC real | Este roteiro é obrigatório |
| `pnpm typecheck` | TS6310 pré-existente | Não bloqueia homologação funcional MDB |

---

## 9. Evidências que devem ser coletadas

| # | Evidência | Formato |
|---|-----------|---------|
| E1 | Screenshot config runtime (§2.4) | Print terminal |
| E2 | OS de teste criada (número/ano + descrição) | Print Gerência |
| E3 | Componentes após save + segundo navegador | 2 prints |
| E4 | Andamento operacional A — CodStatus + UltimoStatus=1 | Print histórico + query §6.4 |
| E5 | Andamento Sub OS Capa — resposta API com `mirror_cod_status` | Print Network tab |
| E6 | Query §6.5 — `espelhos_promovidos_indevidamente = 0` | Print SQL |
| E7 | Access — espelho com UltimoStatus=0 | Print tabela `tabAndamento` |
| E8 | Access — após delete, espelho ainda UltimoStatus=0 | Print comparativo |
| E9 | Bloqueio congelamento (mensagem 403) | Print UI |
| E10 | Lista com `+` expandido | Print |
| E11 | Portal — só OS principal | Print |
| E12 | Log API — sync MDB sem erro crítico | Trecho log |

Arquivar em pasta compartilhada: `docs/evidencias/homolog-sub-os-{ANO}-{NRO}/`

---

## 10. Decisão final antes da produção

### Matriz de decisão

| Veredito | Condição | Ação |
|----------|----------|------|
| **Go** | §7.1 completo + evidências E1–E12 | Liberar deploy com `mysql_only=true` em produção até segunda fase; plano separado para habilitar MDB em prod |
| **Go com ressalva** | §7.2 + nenhum item R1–R10 | Go apenas após registrar ressalvas e prazo de correção |
| **No-Go** | Qualquer R1–R10 | Corrigir código; repetir homologação completa |

### Checklist executivo (preencher ao final)

```
Data homologação: ___/___/2026
Responsável: _______________________
OS de teste: _____ / _____

[ ] Ambiente MDB = cópia (BackupMySQL) confirmado
[ ] Ambiente API = dev local (127.0.0.1) confirmado
[ ] Teste 5 crítico PASS
[ ] Testes 1-4, 6-10 PASS
[ ] Evidências E1-E12 arquivadas

Decisão:  ( ) Aprovado  ( ) Aprovado c/ ressalva  ( ) Reprovado

Observações:
_________________________________________________________________
_________________________________________________________________

Assinatura: _______________________
```

### Nota sobre produção

No servidor de produção, o template atual mantém **`mysql_only: true`** — o dual-write MDB **não** estará ativo após deploy até alteração explícita de config no servidor. A homologação deste roteiro valida o comportamento **quando** `MYSQL_ONLY=false`; o go-live inicial da feature Sub OS pode ocorrer em modo MySQL-only enquanto a validação MDB em cópia não for replicada em ambiente dedicado.

---

## Referências internas

- `docs/RELATORIO_SUB_OS_COMPONENTE.md` — implementação original
- `docs/RELATORIO_CORRECOES_SUB_OS.md` — correções da auditoria
- `app/backend/services/andamento_operacional.py` — recálculo UltimoStatus
- `app/backend/services/os_componentes_service.py` — espelho e congelamento
- `deploy/templates/config/config.json` — referência produção
