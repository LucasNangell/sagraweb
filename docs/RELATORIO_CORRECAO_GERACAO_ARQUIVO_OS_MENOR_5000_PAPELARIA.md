# Relatório — Correção geração de arquivo Papelaria para OS < 5000

**Data:** 18/06/2026

---

## 1. Problema reportado

Após permitir acesso à página Papelaria para OS com número **menor que 5000** (desde que o produto esteja contemplado nos modelos CDR), ao clicar em **Gerar arquivo** o sistema exibia o aviso em vermelho:

> OS de papelaria deve ter número >= 5000.

O job não era enfileirado e o arquivo não era gerado.

---

## 2. Causa encontrada

A alteração anterior havia sido aplicada de forma **parcial**:

| Camada | Comportamento antes da correção |
|--------|----------------------------------|
| Frontend (`papelariaSession.ts`) | Abre aba Corel quando `targetProduct` é produto de papelaria |
| Backend — contexto (`papelaria_models_service.build_os_context`) | Aceita OS < 5000 se `is_papelaria_os_by_product()` |
| Backend — rotas (`papelaria_routes.py`) | Endpoints de histórico, CDR e Corel validam produto antes de bloquear |
| Backend — fila de jobs (`papelaria_jobs_service._validate_os_exists`) | **Bloqueava incondicionalmente** qualquer OS < 5000 |

O fluxo **Gerar arquivo** chama `POST /api/papelaria/jobs` → `create_job()` → `_validate_os_exists()`, que ainda exigia `nro >= 5000` sem verificar o produto.

Função auxiliar `list_jobs_for_os()` também retornava lista vazia para OS < 5000, impedindo o histórico de jobs mesmo quando a rota já liberava o acesso.

---

## 3. Solução implementada

Alinhar a validação do serviço de jobs com a regra já existente em `papelaria_models_service`:

- **OS >= 5000:** permitido (faixa tradicional de Papelaria/SP).
- **OS < 5000:** permitido **somente** se o produto da OS estiver cadastrado em algum modelo CDR ativo (`is_papelaria_os_by_product`).
- **OS < 5000 sem produto de papelaria:** continua bloqueado com mensagem clara.

---

## 4. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/services/papelaria_jobs_service.py` | `_validate_os_exists`: usa `is_papelaria_os_by_product` para OS < 5000; `list_jobs_for_os`: remove retorno antecipado vazio |
| `app/backend/tests/test_papelaria_jobs_service.py` | 3 testes: criação de job OS < 5000 com produto válido, bloqueio sem produto, listagem de jobs OS < 5000 |
| `docs/RELATORIO_CORRECAO_GERACAO_ARQUIVO_OS_MENOR_5000_PAPELARIA.md` | Este relatório |

**Não alterados:** frontend, rotas, worker Corel, regras de numeração de OS, e-mail, MDB sync, provas ou demais validações >= 5000 em outros módulos.

---

## 5. Impacto e regressões evitadas

| Área | Impacto |
|------|---------|
| OS >= 5000 | Nenhum — validação permanece igual |
| OS < 5000 sem produto CDR | Continua bloqueado (mesma mensagem unificada) |
| Numeração / faixas OS vs SP | Inalterado (`os_routes`, `config_manager`, etc.) |
| Prova portal / e-mail por faixa | Inalterado — regras próprias em `proof_papelaria_service` e `email_routes` |
| Worker Corel | Inalterado — processa jobs já enfileirados sem checar faixa numérica |

---

## 6. Testes executados

```text
python -m pytest app/backend/tests/test_papelaria_jobs_service.py app/backend/tests/test_papelaria_models_service.py -q
46 passed
```

---

## 7. Verificação manual sugerida

1. Abrir uma OS < 5000 cujo produto tenha modelo CDR (ex.: Ct Visita).
2. Navegar para Papelaria → aba Corel deve abrir com contexto da OS.
3. Preencher campos e clicar **Gerar arquivo** — job deve entrar na fila sem erro vermelho.
4. Confirmar que OS < 5000 **sem** produto de papelaria ainda exibe erro ao tentar gerar.
