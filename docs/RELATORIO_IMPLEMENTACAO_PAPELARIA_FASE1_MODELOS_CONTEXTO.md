# Relatório — Implementação Papelaria Fase 1 (Modelos e Contexto OS)

**Data:** 10/06/2026  
**Referência:** `docs/AUDITORIA_FUNCIONALIDADE_PAPELARIA_CORELDRAW.md`

---

## 1. Objetivo da fase

Implementar a base backend da funcionalidade Papelaria **sem CorelDRAW no servidor**:

- Tabela e importação de modelos Corel a partir da planilha
- APIs de listagem, detalhe e contexto da OS
- Prefill de variáveis e matching OS → modelo
- UI `/papelaria` preparada para consumir contexto e modelos (aba Corel)
- Manter aba SVG intacta

**Não implementado nesta fase:** worker Windows, fila de jobs, geração CDR/PDF, download de arquivos.

---

## 2. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/routers/papelaria_routes.py` | Removido COM/win32com; novos endpoints; preview retorna 503 |
| `apps/web/src/features/papelaria/components/PapelariaPage.tsx` | Simplificada; delega aba Corel ao novo painel |
| `apps/web/src/api/papelaria.ts` | Novas funções API Corel; preview desabilitado no cliente |
| `apps/web/src/api/query-keys.ts` | Chaves `contexto` e `corelModelo` |
| `apps/web/src/features/papelaria/types.ts` | Tipos Corel e contexto OS |

---

## 3. Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `app/backend/services/papelaria_models_service.py` | Serviço principal: planilha, importação, matching, prefill |
| `deploy/sql/create_papelaria_modelos.sql` | DDL `tabPapelariaModelos` |
| `deploy/release/sql/create_papelaria_modelos.sql` | Cópia para release |
| `app/backend/tests/test_papelaria_models_service.py` | 10 testes unitários |
| `apps/web/src/features/papelaria/components/PapelariaCorelPanel.tsx` | UI modelos + formulário + prévia textual |
| `docs/RELATORIO_IMPLEMENTACAO_PAPELARIA_FASE1_MODELOS_CONTEXTO.md` | Este relatório |

---

## 4. Tabela criada/ajustada

**`tabPapelariaModelos`**

| Campo | Tipo | Uso |
|-------|------|-----|
| `ID` | INT PK | Identificador do modelo |
| `Produto` | VARCHAR(120) | Nome do produto (planilha col. 1) |
| `FrenteVerso` | VARCHAR(32) | Somente Frente / Frente e Verso |
| `Cores` | VARCHAR(64) | Policromia, Relev Seco, etc. |
| `ArquivoModelo` | VARCHAR(255) | Apenas nome do `.cdr` (sem UNC) |
| `CamposJson` | JSON | Mapa campo Corel → texto modelo |
| `VariaveisJson` | JSON | Lista de variáveis `{...}` |
| `Ativo` | TINYINT | 1 = ativo |
| `Ordem` | INT | Ordem de exibição |
| `AtualizadoEm` | TIMESTAMP | Última atualização |

**Compatibilidade legado:** se colunas antigas existirem (`NomeProduto`, `NomeArquivo`, `ConfigCampos`), a migração adiciona colunas novas sem apagar dados e a importação sincroniza ambos os formatos.

---

## 5. Como a planilha é importada

1. Fonte: `Modelos/papelaria/papelaria_variacoes_unicas.xlsx`, aba `Variacoes`.
2. Linha 2 = nomes dos campos Corel; linhas 3+ = modelos.
3. Linhas sem campos válidos são **ignoradas** (ex.: linha 21 `PastaCBolsoSemNome`).
4. Importação automática na primeira listagem se a tabela estiver vazia.
5. Importação manual: `POST /api/papelaria/modelos/importar-planilha` (requer `sb_configuracoes` ou `sb_admin_ips` ou MASTER).

Retorno da importação:

```json
{ "criados": 21, "atualizados": 0, "ignorados": 0 }
```

---

## 6. Como modelos são listados

**`GET /api/papelaria/modelos`**

Query opcional: `produto`, `cores`, `frente_verso`.

Resposta (exemplo):

```json
[
  {
    "id": 14,
    "produto": "Ct Visita",
    "frente_versao": "Frente e Verso",
    "cores": "Policromia",
    "arquivo_modelo": "CtVisitaFV.cdr",
    "variaveis": ["anexo", "email", "gabinete", "genero", "nome_deputado", "partido", "uf"],
    "nome_exibicao": "Ct Visita — Frente e Verso — Policromia",
    "ordem": 140
  }
]
```

**`GET /api/papelaria/modelos/{id}`** — inclui `campos`, `campos_formulario`.

---

## 7. Como contexto da OS é montado

**`GET /api/papelaria/os/{ano}/{nro}/contexto`**

- Valida `nro >= 5000`
- Busca `tabProtocolos` + `tabDetalhesServico`
- Monta `prefill` para variáveis Corel
- Executa matching de modelos
- Retorna `autoSelectedModelId` quando há um único modelo compatível
- Não expõe caminhos UNC

---

## 8. Como prefill é feito

| Variável | Fonte |
|----------|-------|
| `nome_deputado` | `Titular` ou `NomeUsuario` |
| `genero` | Padrão `Deputado Federal` |
| `partido` / `uf` | `SiglaOrgao` ou API Câmara |
| `gabinete` | `GabSalaUsuario` normalizado (3 dígitos) |
| `anexo` | Padrão `IV` |
| `email` | API Câmara / inferido `dep.{slug}@camara.leg.br` |
| Assessores | Vazios (preenchimento manual) |

Reutiliza `deputados_camara_service.buscar_deputado_por_nome` quando disponível.

---

## 9. Como matching OS → modelo funciona

1. Normalização de texto do produto (sem acentos, minúsculas).
2. Correspondência **exata** de produto.
3. Se falhar, correspondência **parcial** segura (uma sugestão ou múltiplas com aviso).
4. Desempate por `Cores` e `FrenteVerso` da OS **somente se** os dados existirem na OS.
5. Se ambíguo, `autoSelectedModelId = null` e warnings orientam seleção manual.

---

## 10. Como a página `/papelaria` foi preparada

- Aba **Cartão SVG**: inalterada (`PapelariaCartaoSvgPanel`).
- Aba **Corel (modelos)**: novo `PapelariaCorelPanel`:
  - Carrega contexto da OS via API
  - Exibe cabeçalho OS (produto, título, solicitante, cores, F/V)
  - Cards de modelos compatíveis
  - Auto-seleção quando `autoSelectedModelId` presente
  - Formulário dinâmico com prefill
  - Prévia textual dos campos (substituição `{variavel}` no cliente)
  - Sem botão de gerar PDF/Corel (fase posterior)

---

## 11. O que ainda não foi implementado

- Worker Windows com CorelDRAW
- Tabela/fila `tabPapelariaJobs`
- Geração e cópia de CDR/PDF para `Sefoc/Papelaria/`
- WebSocket de status de job
- Download de arquivos gerados
- Remoção completa do endpoint legado `/preview` (mantido retornando 503)
- Painel admin para editar modelos sem planilha

---

## 12. Testes executados

| Comando | Resultado |
|---------|-----------|
| `python -m pytest app/backend/tests/test_papelaria_models_service.py -q` | **10 passed** |
| `python -m pytest app/backend/tests -q` | **238 passed** |
| `pnpm test:frontend` | **124 passed** (29 arquivos) |
| `pnpm build` | **Sucesso** |
| `pnpm lint` | **Sucesso** (placeholders Fase 0) |
| `pnpm typecheck` | **Falhou** — erro pré-existente TS6310 em `tsconfig.app.json` (referências de projeto); não introduzido por esta fase |

Verificação manual da planilha:

```
modelos 21
Bloco A5 ['anexo', 'email', 'gabinete', ...]
```

---

## 13. Caminhos de arquivos (configuração interna)

| Recurso | Caminho |
|---------|---------|
| Planilha | `Modelos/papelaria/papelaria_variacoes_unicas.xlsx` |
| CDR produção | `\\redecamara\DfsData\CGraf\Sefoc\Laboratorio\Modelos\Modelos Corel\Papelaria\CSP\WEB\` |
| CDR dev opcional | `Modelos/papelaria/cdr/` |

Constantes em `papelaria_models_service.py` — não expostas ao frontend.

---

## 14. Próximas fases

| Fase | Entrega |
|------|---------|
| **2** | Refinar matching + validação de campos |
| **3** | UI final jobs (se necessário além do painel atual) |
| **4** | `tabPapelariaJobs` + APIs de fila |
| **5** | Worker Windows + claim/complete |
| **6** | Integração pasta OS `Sefoc/Papelaria/` |
| **7** | WebSocket status |
| **8** | Hardening e remoção definitiva do preview COM |

---

## 15. Endpoints novos/alterados

| Método | Endpoint | Auth |
|--------|----------|------|
| GET | `/api/papelaria/modelos` | `sb_papelaria` |
| GET | `/api/papelaria/modelos/{id}` | `sb_papelaria` |
| GET | `/api/papelaria/os/{ano}/{nro}/contexto` | `sb_papelaria` |
| POST | `/api/papelaria/modelos/importar-planilha` | `sb_configuracoes` / admin |
| POST | `/api/papelaria/preview` | **503** — Corel desativado no servidor |

Endpoints SVG (`/api/papelaria/svg/*`) **inalterados**.
