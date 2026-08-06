---
name: Chapas esperadas UI
overview: "Manter a validação de conjuntos (páginas × grupos TIF), mas passar a estimar e exibir o total de chapas (arquivos TIF) esperado via análise assíncrona de tintas por página no PDF, e bloquear conjuntos incompletos (ex.: 1 TIF por página)."
todos:
  - id: ink-estimate-backend
    content: "Backend: estimar tintas por página nos espelhos PDF e devolver expected_plate_count (async-friendly)"
    status: completed
  - id: ink-estimate-frontend
    content: "UI: chapas esperadas vs selecionadas; bloqueio de conjuntos incompletos; loading sem travar modal"
    status: completed
isProject: false
---

# Exibir e validar total de chapas esperado

## Problema confirmado

A regra **páginas = conjuntos** está correta e já alerta quando faltam conjuntos. O que falha na UX/integridade:

- A frase “19 conjuntos esperados” não deixa claro o **total de chapas (TIFs)**
- Com **1 TIF por conjunto** (faltando C/M/Y/K/spots), `groupCount === pageCount` e o modal aceita — conjunto incompleto

Amostras do usuário (`01134-PM…`, `01134-SM…`): 2 + 17 = 19 páginas. Análise preliminar com PyMuPDF nos Form XObjects encontra uso de canais CMYK (C/M/Y/K) nas páginas; spots nomeados (ex. `Direitos humanos`) existem no SM. A estimativa de tintas será **assíncrona** e tratada como estimativa com confiança — se falhar, não trava o UI e não bloqueia por chapas totais.

## Nova regra

| Checagem | Fonte | Bloqueia? |
|----------|--------|-----------|
| Órfãos sem `(C|M|Y|K|spot)` | nomes TIF | Sim |
| `tifGroupCount !== pdfPageCount` | páginas PDF × `groupKey` | Sim |
| `tifFileCount !== expectedPlateCount` | soma de tintas por página do PDF (async) | Sim, **só se** a análise concluiu com sucesso |
| Análise de tintas falhou / em andamento | — | Não bloqueia por chapas; mostra status |

`expectedPlateCount` = soma, por página de todos os espelhos, do nº de tintas detectadas naquela página (processo CMYK com cobertura > limiar + Separation/DeviceN resolvidos, ignorando `All`/`None`).

## Backend (async-friendly)

Novo helper em serviço (ex. [`app/backend/services/gravacao_pendente_service.py`](app/backend/services/gravacao_pendente_service.py) ou módulo dedicado `espelho_ink_estimate.py`):

- Abrir PDFs com `fitz`
- Por página: reunir content + streams de Form XObjects (1 nível aninhado)
- Contar canais:
  - Não-zero em ops `c m y k` / `K`
  - ColorSpaces `/Separation` e `/DeviceN […]` referenciados nos resources das forms (resolver xref), excluindo `All`/`None`
- Retornar `{ pdf_page_count, expected_plate_count, pages: [{page, inks[], count}], confidence }`

Expor em `POST /gravacao-pendente/chapas/estimate` **ou** endpoint dedicado `…/espelhos/ink-estimate` (preferir **estender** a estimate de PDF-only com campos novos para um único round-trip):

- `pdf_page_count`
- `expected_plate_count` (null se não calculável)
- `ink_analysis_status`: `ok` | `partial` | `unavailable`

Processamento no request HTTP já é background do ponto de vista do browser (React Query). Manter o handler rápido o suficiente (timeout razoável); não bloquear a thread do Vite — o usuário continua usando o modal enquanto a query carrega.

## Frontend

Em [`GravacaoPendenteLaunchModal.tsx`](apps/web/src/features/gravacao-externa/components/GravacaoPendenteLaunchModal.tsx):

Reescrever o painel informativo, por exemplo:

- `Espelhos: 19 páginas → 19 conjuntos`
- `Chapas esperadas (estimativa): 76 TIFs` (quando `expected_plate_count` disponível)
- `Selecionado: 19 conjuntos · 19 TIFs` (ou 76 quando completo)
- Âmbar se conjuntos ok mas `tifFileCount !== expected_plate_count`
- Spinner “Analisando tintas dos espelhos…” sem desabilitar o restante do modal

`handleConfirm`:

1. órfãos → alert + block  
2. grupos ≠ páginas → alert + block  
3. se `expected_plate_count != null` e `tifFileCount !== expected_plate_count` → alert explicando esperado vs selecionado + block  

## O que não fazer

- Não voltar a `page_count === tifFileCount`
- Não adicionar Ghostscript neste ciclo
- Não travar a UI (botões/seleção) durante a análise

## Verificação

- 19 páginas + 19 grupos com 1 TIF cada → conjuntos ok, chapas divergem → alerta
- 19 grupos com canais completos batendo a estimativa → confirma
- Análise lenta: modal usável; texto de loading; confirm só bloqueia chapas após resultado ok
