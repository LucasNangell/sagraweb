# Campos exibidos em gravacao.html

Origem base de dados: chamada `GET /api/gravacao/status` (polling a cada 5s com WebSocket quando disponível). O payload é armazenado em `state` e normalizado em `gravacao.js` via `normalizeJob` (jobs) e `normalizePath` (chapas).

## Bloco "Trabalho sendo gravado"
- OS (titulo / pill): `osLabel(job)` -> `job.inferred_os.nr_os` e `inferred_os.ano` (derivados de `job.name` via `inferOs`).
- Produto: `job.produto` (raw: `row.get("produto")`).
- Template: `job.template` (raw: `Template` no XML ou coluna homônima).
- Máquina: `job.machine` (raw: `MediaName` ou `job.machine_serial_number`).
- Entrada: `job.created_at` (raw: `Created` ou `created_at` no DB/XML).
- Progresso: `progressPct(job)` calculado em `gravacao.js` a partir de `metrics.plates_printed`/`metrics.plates_total`.
- Chapas gravadas/total: `plateStats(job).printed` / `plateStats(job).total` (totais dos paths).
- Tempo médio por chapa: `plateStats(job).avgSeconds` calculado pelas diferenças entre timestamps `printed_at` das chapas (ou start→printed da primeira chapa).
- Previsão de conclusão: `plateStats(job).etaSeconds` = chapas faltantes × tempo médio.
- Barra de progresso: mesma fonte de `progressPct(job)`.

### Lista vertical de chapas
- Fonte: `getPlateRows(job)` que ordena `job.paths` por status e tempo.
- Coluna "Chapa": `pathLabel(path)` -> "Chapa: Cad X Cor: K".
  - Caderno `X`: extraído de `descricao_evento`/`nome_chapa`/`tiff` via regex `(Cad ...)` em `extractCadColour`.
  - Cor `K`: `guessColour` + `extractCadColour` a partir de `descricao_evento`/`tiff`/(cor direta) procurando `(C|M|Y|K)`.
- Início: `path.start_at` (raw: `start_at` no DB ou XML path).
- Fim: `path.printed_at` (raw: `printed_at` ou `data_gravacao`).
- Status: `path.status` normalizado em `normalizePlateStatus` (`printing`, `ready`, `printed`).

## Fila de gravação (lista lateral)
- Mostra somente jobs com status "ready" ou "part printed" (`queueNonPrinting`).
- Campos por card:
  - Nome: `shortName(job)` -> "NrOS/AA - Produto" usando `job.inferred_os` + `job.produto`.
  - OS (linha secundária): `osLabel(job)`.
  - Pill status: `job.status`.
  - Template/Prioridade/Máquina: `job.template`, `job.priority`, `job.machine`.
  - Progresso: `progressPct(job)`.
  - Criado: `job.created_at`.
  - Tempo decorrido: calculado em `elapsedFor(job)` (usa `metrics.elapsed_seconds` ou diferença até `nowTick`).
  - Chapas: `metrics.plates_printed` / `metrics.plates_total`.
  - Chips de chapas (linha horizontal): `orderedPaths(job)` -> ordenadas por cor; cada chip mostra `pathLabel(path)` e `path.status_label`.

## Jobs gravados (coluna direita)
- Fonte: `printedJobs` (queue status printed + lista printed do payload).
- Campos por card: `shortName(job)`, `osLabel(job)`, `job.status` (Printed), `printed_at`, `durationFor(job)` (created_at→printed_at ou `metrics.duration_seconds`), total de chapas (`metrics.plates_total`).
- Chips de chapas: `orderedPaths(job)` mostrando cor e `printed_at`.

## Métodos-chave e normalização
- `normalizeJob`: padroniza status/template/priority/machine/created_at/printed_at/paths/metrics; infere OS com `inferOs(job.name)`.
- `normalizePath`: padroniza status/colour/caderno/status_label/printed_at/start_at.
- `mergeJobsByOs`: agrupa jobs pelo mesmo número de OS (combina pastas/anos distintos) somando caminhos e priorizando status mais urgente.
- `statusRank` e `pathStatusRank`: ordenação de jobs (Printing > Part Printed > Ready) e chapas (Printing > Ready > Printed > Other).

## Entradas usadas para extrair caderno/cor das chapas
- `descricao_evento` (preferencial).
- `nome_chapa`.
- `tiff`/`File`/`TiffName`/`TIFFName`.

## Fontes externas
- Payload HTTP/WS: `API_BASE_URL/gravacao/status` e opcional `ws://.../gravacao/status/ws`.
- Ícones: lucide via `window.lucide.createIcons()`.

## Componentes Vue expostos para o template
Listados no `return` de `setup` em `gravacao.js`: `state, loading, errorMsg, lastUpdated, pollMs, sortedQueue, printingJobs, currentPrintingJob, getCurrentPrintingJob, queueNonPrinting, printedJobs, totalPlates, formatDateTime, formatDuration, elapsedFor, durationFor, progressPct, plateStats, statusClass, pathClass, orderedPaths, getOrderedPlates, getPlateGroups, getPlateRows, pathLabel, shortName, osLabel, timeline, loadingHistory, historyFor, openHistory, fetchData`.
