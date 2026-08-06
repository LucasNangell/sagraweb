# Relatório — Inspeção de .cdr via worker CorelDRAW

**Data:** 18/06/2026  
**Escopo:** Corrigir detecção de campos ao fazer upload de novo modelo `.cdr` na aba Papelaria (Admin → Configurações).

---

## Problema

Ao selecionar um arquivo `.cdr`, o frontend tentava extrair variáveis **lendo o binário inteiro do arquivo como texto** e buscando padrões `{...}`. Arquivos Corel modernos são ZIP compactados — isso gerava centenas de falsos positivos e exibia **lixo binário** na interface (como na captura de tela reportada).

O correto é consultar os **objetos nomeados** no documento via **CorelDRAW COM**, operação que só o **worker Windows** pode executar.

---

## Solução

1. **Removida** a extração binária local no browser.
2. **Nova fila de inspeção** (`tabPapelariaCdrInspect`): upload enfileira análise; worker processa quando ocioso.
3. **Worker** abre o `.cdr`, indexa shapes por `shape.Name`, lê o texto de cada objeto e devolve `campos` + `variaveis`.
4. **Frontend** faz upload → polling até `completed`/`failed` → exibe lista legível de campos e variáveis.
5. **Criação do modelo** envia `inspect_id` para reutilizar os campos detectados no `CamposJson`.

---

## Fluxo

```
Admin seleciona .cdr
    → POST /papelaria/admin/modelos/inspecionar-cdr
    → Worker claim POST /papelaria/worker/inspect/claim
    → Corel abre CDR, lista objetos nomeados
    → POST /papelaria/worker/inspect/{id}/complete
    → Frontend polling GET /papelaria/admin/modelos/inspecionar-cdr/{id}
    → Usuário clica "Criar modelo" (com inspect_id)
```

**Requisito:** worker Papelaria em execução na máquina com CorelDRAW (mesmo ambiente DEV).

---

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `deploy/sql/create_papelaria_cdr_inspect.sql` | **Novo** — tabela de inspeções |
| `app/backend/services/papelaria_cdr_inspect_service.py` | **Novo** — fila e persistência |
| `app/backend/services/papelaria_modelo_admin_service.py` | Usa campos da inspeção concluída |
| `app/backend/routers/papelaria_routes.py` | Rotas admin inspecionar/consultar |
| `app/backend/routers/papelaria_worker_routes.py` | Rotas worker claim/complete/fail |
| `app/backend/security/papelaria_worker_auth.py` | Autorização das novas rotas |
| `app/backend/tests/test_papelaria_worker.py` | Teste de auth da rota inspect |
| `worker/papelaria_worker/corel_generator.py` | `ler_texto_shape()`, `inspecionar_cdr()` |
| `worker/papelaria_worker/worker.py` | Processamento de inspeções no loop |
| `worker/papelaria_worker/api_client.py` | Métodos HTTP de inspeção |
| `apps/web/src/api/adminSystem.ts` | API `inspectPapelariaCdr`, `fetchPapelariaCdrInspect` |
| `apps/web/src/features/configuracoes/components/PapelariaNovoModeloSection.tsx` | Upload + polling + UI de campos |

---

## Retrocompatibilidade

- Se a inspeção falhar ou o worker estiver offline, a criação do modelo ainda funciona com **campos padrão** (fallback anterior no backend).
- Jobs de geração, mockup, prévia e demais fluxos **não foram alterados**.

---

## Testes

```bash
cd app/backend
python -m pytest tests/test_papelaria_worker.py tests/test_papelaria_models_service.py -q
```
