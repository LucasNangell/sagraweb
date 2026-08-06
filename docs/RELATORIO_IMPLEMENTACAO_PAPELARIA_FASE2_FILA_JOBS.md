# Relatório — Implementação Papelaria Fase 2 (Fila de Jobs e UI de Solicitação)

**Data:** 10/06/2026  
**Referência:** `docs/AUDITORIA_FUNCIONALIDADE_PAPELARIA_CORELDRAW.md`, Fase 1 em `docs/RELATORIO_IMPLEMENTACAO_PAPELARIA_FASE1_MODELOS_CONTEXTO.md`

---

## 1. Objetivo da fase

Implementar a **fila de geração Corel/PDF** no servidor e a **UI de solicitação** na página `/papelaria`, **sem** CorelDRAW, COM ou geração real de arquivos:

- Tabela `tabPapelariaJobs` (+ log opcional)
- Serviço de criação, consulta, listagem e cancelamento de jobs
- APIs REST com permissão `sb_papelaria`
- Evento WebSocket `papelaria_job_update` (com polling leve na UI)
- Botão **Gerar arquivo**, painel de status e histórico por OS

**Não implementado nesta fase:** worker Windows, processamento `processing` → `completed`, download real de PDF/CDR.

---

## 2. Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `deploy/sql/create_papelaria_jobs.sql` | DDL `tabPapelariaJobs` e `tabPapelariaJobLog` |
| `deploy/release/sql/create_papelaria_jobs.sql` | Cópia para release |
| `app/backend/services/papelaria_jobs_service.py` | Serviço da fila de jobs |
| `app/backend/tests/test_papelaria_jobs_service.py` | 10 testes unitários |
| `docs/RELATORIO_IMPLEMENTACAO_PAPELARIA_FASE2_FILA_JOBS.md` | Este relatório |

---

## 3. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/routers/papelaria_routes.py` | Endpoints de jobs (criar, consultar, listar OS, cancelar, download preparado) |
| `apps/web/src/api/papelaria.ts` | Funções `createPapelariaJob`, `fetchPapelariaJob`, `fetchPapelariaJobsForOs`, `cancelPapelariaJob`, `papelariaJobFileUrl` |
| `apps/web/src/api/query-keys.ts` | Chaves `jobsOs` e `job` |
| `apps/web/src/features/papelaria/types.ts` | Tipos `PapelariaJob`, `PapelariaJobStatus`, payloads |
| `apps/web/src/features/papelaria/components/PapelariaCorelPanel.tsx` | Botão Gerar arquivo, status ativo, histórico, cancelamento, polling |

**Intactos:** aba SVG (`PapelariaPage.tsx`), Fase 1 (modelos/contexto), `.env`, servidor em produção.

---

## 4. Tabelas criadas

### `tabPapelariaJobs`

| Campo | Tipo | Uso |
|-------|------|-----|
| `ID` | BIGINT PK | Identificador do job |
| `NroProtocolo` / `AnoProtocolo` | INT | OS vinculada |
| `TipoJob` | VARCHAR(32) | Padrão `create` |
| `Produto` | VARCHAR(120) | Produto do modelo |
| `ModeloID` | INT | FK lógica para `tabPapelariaModelos` |
| `ArquivoModelo` | VARCHAR(255) | **Somente nome** do `.cdr` |
| `DadosJson` | JSON | Campos preenchidos pelo usuário |
| `Status` | VARCHAR(20) | `pending`, `processing`, `completed`, `failed`, `cancelled` |
| `Prioridade` | INT | Reservado para worker |
| `OrdemFila` | BIGINT | Ordem de chegada (monotônica) |
| `SolicitadoPor` | VARCHAR(32) | Ponto da sessão |
| `SolicitadoEm` | DATETIME | Timestamp de criação |
| `IniciadoEm` / `ConcluidoEm` | DATETIME | Preenchidos pelo worker |
| `WorkerID` | VARCHAR(64) | ID do worker futuro |
| `ArquivoCdrGerado` / `ArquivoPdfGerado` | VARCHAR(512) | Caminho relativo à pasta OS (backend only) |
| `Erro` | TEXT | Mensagem de falha |
| `Tentativas` | INT | Retentativas do worker |
| `Versao` | INT | Versionamento |
| `JobPaiID` | BIGINT | Jobs derivados (futuro) |

**Índices:** `(Status, OrdemFila)`, `(AnoProtocolo, NroProtocolo)`, `(SolicitadoEm)`.

Criação via `CREATE TABLE IF NOT EXISTS` — não recria nem apaga dados existentes.

### `tabPapelariaJobLog`

| Campo | Tipo | Uso |
|-------|------|-----|
| `ID` | BIGINT PK | |
| `JobID` | BIGINT | Job relacionado |
| `Nivel` | VARCHAR(16) | `info`, `warning`, `error` |
| `Mensagem` | TEXT | Texto do log |
| `DetalheJson` | JSON | Metadados opcionais |
| `CriadoEm` | DATETIME | Timestamp |

---

## 5. Endpoints criados

Todos exigem sessão interna e permissão `sb_papelaria` (ou MASTER).

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/papelaria/jobs` | Cria job `pending` |
| `GET` | `/api/papelaria/jobs/{job_id}` | Status e metadados (+ logs) |
| `GET` | `/api/papelaria/os/{ano}/{nro}/jobs` | Histórico da OS (até 50) |
| `POST` | `/api/papelaria/jobs/{job_id}/cancel` | Cancela se `pending` |
| `GET` | `/api/papelaria/jobs/{job_id}/arquivo/{tipo}` | Download `pdf` ou `cdr` (404 amigável sem worker) |

### Exemplo — criar job

```http
POST /api/papelaria/jobs
Content-Type: application/json

{
  "ano": 2026,
  "nro": 5954,
  "modelo_id": 1,
  "dados": {
    "nome_deputado": "Samuel Viana",
    "genero": "Deputado Federal",
    "partido": "PL",
    "uf": "DF",
    "gabinete": "123",
    "email": "exemplo@camara.leg.br"
  }
}
```

Resposta (resumo):

```json
{
  "id": 42,
  "status": "pending",
  "ordem_fila": 3,
  "arquivo_modelo": "CtVisitaFV.cdr",
  "solicitado_por": "918713",
  "tem_arquivo_pdf": false,
  "tem_arquivo_cdr": false
}
```

---

## 6. Como criar job

1. Usuário abre `/papelaria` com OS ≥ 5000 (via Início).
2. Seleciona modelo e preenche formulário dinâmico (Fase 1).
3. Clica **Gerar arquivo**.
4. Frontend valida campos obrigatórios localmente e chama `POST /api/papelaria/jobs`.
5. Backend:
   - Valida OS existente e modelo ativo (`ModeloID`, não caminho do frontend).
   - Sanitiza `dados` (sem UNC, limite 32 KB).
   - Valida campos obrigatórios do modelo.
   - Insere job `pending` com `OrdemFila` sequencial.
   - Registra log e emite `papelaria_job_update`.

---

## 7. Como o status é acompanhado

### Backend / WebSocket

- Ao criar ou cancelar job: `schedule_broadcast({ type: "papelaria_job_update", job_id, ano, nro, status })`.
- Compatível com infraestrutura existente (`routers/realtime.py`).

### Frontend (polling leve)

| Escopo | Intervalo | Condição |
|--------|-----------|----------|
| Job ativo | 5 s | Enquanto status não for terminal |
| Histórico da OS | 12 s | Sempre que OS selecionada |

Status exibidos em português: Aguardando na fila, Processando, Concluído, Erro, Cancelado.

Jobs `pending` exibem: *"Aguardando processamento pelo computador CorelDRAW."*

---

## 8. Histórico da OS

- `GET /api/papelaria/os/{ano}/{nro}/jobs` retorna jobs ordenados por `SolicitadoEm DESC`.
- UI lista histórico na seção inferior; clique seleciona job no painel ativo.
- Apenas OS ≥ 5000.

---

## 9. Alterações na UI

Na aba **Corel/PDF** de `PapelariaCorelPanel`:

1. Formulário dinâmico e prévia textual (Fase 1) mantidos.
2. Botão **Gerar arquivo** abaixo dos campos.
3. Seção **Fila de geração Corel/PDF**:
   - Painel da solicitação ativa (status, posição na fila, cancelar se `pending`).
   - Histórico clicável da OS.
4. Quando `completed`: botões **Abrir PDF** e **Baixar CDR** (links para API; 404 até worker gerar arquivos).
5. Aba SVG em `PapelariaPage.tsx` **não alterada**.

---

## 10. Segurança

| Regra | Implementação |
|-------|----------------|
| OS válida | Consulta `tabProtocolos`; rejeita OS &lt; 5000 |
| Modelo pelo ID | `ArquivoModelo` vem do cadastro, não do body |
| Sem UNC no frontend | Resposta só com nome de arquivo; paths só no backend |
| Sanitização de dados | Rejeita padrões de caminho em valores e chaves |
| Cancelamento | Apenas `pending` |
| Download | `resolve_job_file_path` valida pasta OS + path traversal |
| Auditoria | `SolicitadoPor` = ponto da sessão; logs em `tabPapelariaJobLog` |
| Permissão | `_require_papelaria_access` em todos os endpoints |

---

## 11. O que ainda depende do worker

| Item | Responsabilidade futura do worker |
|------|-----------------------------------|
| Transição `pending` → `processing` | Worker claim do job |
| Geração CDR/PDF via CorelDRAW | COM no Windows |
| Preenchimento `ArquivoCdrGerado` / `ArquivoPdfGerado` | Caminho relativo em `{OS}/Sefoc/Papelaria/` |
| Status `completed` / `failed` | Após processamento |
| Download real | Endpoint já preparado |
| Polling da fila | Worker HTTP (fase 3+) |

Nesta fase, jobs permanecem em `pending` até o worker existir.

---

## 12. Testes executados

### Cenários cobertos (backend)

| Cenário | Resultado |
|---------|-----------|
| Criar job com modelo válido | OK |
| Bloquear sem campos obrigatórios | OK |
| Bloquear modelo inexistente | OK |
| Listar jobs da OS | OK |
| Cancelar `pending` | OK |
| Impedir cancelar `processing` / `completed` | OK |
| Rejeitar caminho UNC em dados | OK |
| Rejeitar payload &gt; 32 KB | OK |

### Comandos

| Comando | Resultado |
|---------|-----------|
| `python -m pytest app/backend/tests/test_papelaria_jobs_service.py -v` | **10 passed** |
| `pnpm test:backend` | **248 passed** |
| `pnpm test:frontend` | **124 passed** |
| `pnpm build` | **OK** |
| `pnpm lint` | **OK** (pendente Fase 0 nos pacotes) |
| `pnpm typecheck` | **Falha pré-existente** TS6310 em `tsconfig.app.json` (referências `api-types` / `ui`) |

---

## 13. Próxima fase

1. **Worker Windows** — polling da fila, claim atômico, CorelDRAW COM local.
2. **API worker** — endpoints internos para claim/complete/fail (autenticação dedicada).
3. **Atualização de status** — `processing` → `completed`/`failed` com arquivos na pasta OS.
4. **WebSocket na UI** — substituir ou complementar polling com `papelaria_job_update`.
5. **Regeneração / versão** — uso de `JobPaiID` e `Versao` para reprocessamento.

---

## Resultado esperado (atingido)

O usuário consegue abrir `/papelaria`, selecionar modelo, preencher campos e criar um job na fila. A página mostra o job como **Aguardando na fila** / **Aguardando processamento pelo computador CorelDRAW**, com histórico e cancelamento, sem geração Corel no servidor.
