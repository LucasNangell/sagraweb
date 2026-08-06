# Relatório — Campos Corel comuns em novos modelos (Papelaria)

**Data:** 2026-06-18  
**Objetivo:** Evitar campos duplicados no formulário da página Papelaria quando novos modelos (criados via inspeção `.cdr`) reutilizam objetos Corel já padronizados (`NomeDep`, `Contato`, `Endereco`, etc.).

---

## Problema

Na inspeção do worker, o CorelDRAW devolve o **texto renderizado** dos objetos (ex.: telefone já preenchido), muitas vezes **sem** placeholders `{variavel}`. A normalização anterior tratava cada objeto sem `{...}` como campo de formulário independente, gerando entradas como **"Contato"** mesmo quando esse objeto só combina `gabinete` e `email` — variáveis que já existem em modelos legados.

**Exemplo real (log do worker):** 6 campos detectados, 0 variáveis extraídas do texto.

---

## Solução

Foi adicionado um **mapeamento canônico** de nomes de objetos Corel para templates com `{variavel}`, alinhado à planilha e aos JSONs de referência em `Modelos/papelaria/pdfs/json/`.

### Regra de segurança (retrocompatibilidade)

O template canônico **só substitui** o texto quando **não há** `{variavel}` no conteúdo inspecionado. Modelos importados da planilha (que já trazem templates explícitos) **não são alterados**.

### Objetos Corel reconhecidos

| Objeto Corel (normalizado) | Template canônico | Variáveis do formulário |
|----------------------------|-------------------|-------------------------|
| `NomeDep` | `{nome_deputado}` | nome_deputado |
| `Genero` | `{genero}` | genero |
| `PartidoDep` | `{partido}/{uf}` | partido, uf |
| `Endereco` | Endereço Câmara + `{anexo}`, `{gabinete}` | anexo, gabinete |
| `Contato` | Fones 3215-5/3 + `{gabinete}`, `{email}` | gabinete, email |
| `NomeAssessor` | `{nome_assessor}` | nome_assessor |
| `ContatoAssessor` | `{contato_assessor}` | contato_assessor |
| `Funcao` | `{funcao_assessor}` | funcao_assessor |
| `Cabecalho` | Cabeçalho timbrado | nome_deputado, partido, uf |
| `Rodape` | Rodapé timbrado | anexo, gabinete, email |

Variantes **PT/EN** para `Endereco` e `Contato` são escolhidas quando o texto inspecionado contém termos em inglês (`Chamber`, `Phones`, etc.).

Objetos **desconhecidos** (ex.: `Instagram`) continuam gerando slug editável — comportamento anterior preservado.

---

## Comportamento na página Papelaria

- O formulário continua baseado em **`variaveis` únicas** (`build_campos_formulario`).
- `Contato` deixa de virar campo próprio; o usuário preenche **Gabinete** e **E-mail**, como nos modelos existentes.
- Jobs Corel recebem `CamposJson` normalizado (via API `get_modelo_by_id` com `include_campos=True`).

---

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/services/papelaria_models_service.py` | Templates canônicos, `resolve_canonical_campo_template`, `normalize_campos_from_inspect` atualizado, `_row_to_modelo` normaliza campos na leitura detalhada, `_infer_campo_labels` ignora objetos canônicos |
| `apps/web/src/features/papelaria/preview/dynamicFields.ts` | Mesma lógica canônica em `normalizeInspectCampos` (criação de modelo no admin) |
| `app/backend/tests/test_papelaria_live_preview.py` | Testes de cartão visita e campos customizados |
| `app/backend/tests/test_papelaria_models_service.py` | Teste de não duplicação de `Contato` e preservação de template da planilha |

**Não alterados:** worker, rotas, UI da Papelaria, geração COM, planilha, modelos já corretos no banco.

---

## Testes

```text
test_normalize_campos_corel_canonicos_sem_duplicar_contato
test_normalize_campos_sem_variaveis (cartão visita)
test_normalize_campos_custom_desconhecidos
```

---

## Modelos já criados com configuração incorreta

Modelos salvos **antes** desta correção podem ter `CamposJson`/`VariaveisJson` desatualizados no banco. Ao **selecionar o modelo** na Papelaria, a API normaliza campos em memória (`include_campos=True`), corrigindo formulário e payload do job. Para persistir a correção no banco, recrie o modelo ou edite/salve a configuração admin.

---

## Referências

- `docs/AUDITORIA_FUNCIONALIDADE_PAPELARIA_CORELDRAW.md` — seção 4.1 (mapeamento variável → campo Corel)
- `Modelos/papelaria/pdfs/json/CtVisita.json` — templates de referência
