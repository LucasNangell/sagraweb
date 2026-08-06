# Relatório de Correção — Componentes da Gerência

**Data:** 2026-06-08  
**Veredito:** **Corrigido com ressalvas**

---

## 1. Veredito

A persistência e o carregamento dos componentes técnicos da Gerência foram corrigidos. A fonte confiável passa a ser **`tab_os_componentes.techspec_json` no MySQL**. OSs antigas do Access/MDB não recebem mais componentes fictícios. A homologação MDB da Sub OS pode ser retomada após validação manual dos cenários listados na seção 9.

**Ressalva:** `pnpm typecheck` continua falhando por `TS6310` pré-existente (project references).

---

## 2. Problemas encontrados

### Por que os dados se perdiam

1. **`TechSpecLotePayload` incompleto no backend** — o modelo Pydantic aceitava apenas `paginas` e `cores_link`. Campos `maquina_link`, `papel_link`, `papel_desc`, `cores_desc` e `id` eram **descartados** no `POST /api/os/save` antes de gravar `techspec_json`.
2. **Salvamento condicional** — `sync_componentes_from_techspec` só rodava quando `componentes` não era vazio; lista vazia não sincronizava remoções.
3. **localStorage como fallback de carga** — quando MySQL retornava vazio, o front chamava `inferTechSpecFromForm()` e podia usar localStorage, mascarando falha de persistência.

### Por que páginas vinham zeradas

1. **`inferTechSpecFromForm()`** criava componentes a partir de `PapelDescricao`/`CoresDescricao` legados com **`paginas: 0`**.
2. **`applyTechSpecToForm()`** sobrescrevia `val_pgs` com a soma dos componentes — quando a soma era 0, **zerava** o campo mesmo com `Pags` correto em `tabDetalhesServico`.

### Por que componentes apareciam sem terem sido criados

1. **`inferTechSpecFromForm()`** convertia automaticamente dados legados (Capa/Miolo via campos antigos ou regex em `PapelDescricao`) em componentes fictícios na UI.
2. Isso ocorria em **toda OS antiga** do Access/MDB que tinha descrição de papel no formato `Capa: ... | Miolo: ...`.

---

## 3. Solução aplicada

### Persistência MySQL

- `TechSpecLotePayload` expandido com todos os campos técnicos do lote.
- `_lote_to_dict()` serializa lotes completos em `techspec_json`.
- `sync_componentes_from_techspec` processa **lista vazia** (remove/inativa componentes ausentes do payload).
- `POST /api/os/save` chama sync sempre que `TechSpec is not None`.

### Carregamento

- Gerência carrega componentes **somente** de `GET /api/os/{ano}/{id}/componentes` (MySQL).
- Sem componentes MySQL → **lista vazia** na UI (sem Capa/Miolo/Encarte automáticos).
- localStorage usado **apenas** se a requisição MySQL falhar (erro de rede), nunca quando MySQL retorna vazio.
- Duplicar OS copia estrutura de componentes **sem** `componente_id` (novos IDs na gravação).

### Proteção MDB

- `applyTechSpecToForm()` **não** agrega mais `PapelDescricao`/`CoresDescricao`/`MaquinaLink`/`PapelLink`/`Cores` a partir dos componentes.
- Dual-write MDB continua apenas com campos legados da OS principal (`tabProtocolos` / `tabDetalhesServico`).
- `techspec_json` e `tab_os_componentes` **não** são consultados pelo `mdb_writer`.

### Páginas

- `val_pgs` só é atualizado a partir de componentes quando `totalPages > 0`.
- OS sem componentes mantém `Pags` legado de `tabDetalhesServico`.

---

## 4. Banco de dados

### Tabelas

| Tabela | Uso |
|--------|-----|
| `tab_os_componentes` | Componentes criados explicitamente pelo usuário |
| `tab_os_sub_os` | Sub OS lógica (inalterada) |
| `tab_os_sub_os_andamento` | Andamentos Sub OS (inalterado) |

### Campos técnicos em `techspec_json`

```json
{
  "lotes": [
    {
      "id": "lote_...",
      "paginas": 8,
      "maquina_link": "Offset",
      "papel_link": "Couché 150g",
      "cores_link": "4x4",
      "papel_desc": "",
      "cores_desc": ""
    }
  ]
}
```

### Garantia de não replicação MDB

- Nenhuma alteração em schema Access.
- `sync_os_from_mysql_to_mdb` lê apenas `tabProtocolos` e `tabDetalhesServico`.
- Teste automatizado confirma ausência de query a `tab_os_componentes` no fluxo MDB.

---

## 5. Gerência

### Comportamento novo

| Situação | Comportamento |
|----------|---------------|
| OS antiga sem componentes MySQL | Seção de componentes **vazia**; campos legados (Pags, Papel, etc.) normais |
| OS com componentes MySQL | Carrega lotes completos do `techspec_json` |
| Salvar sem componentes | Não cria registros em `tab_os_componentes` |
| Salvar com componentes | Upsert MySQL; IDs estáveis preservados |

### Adicionar componente

Botões existentes em `TrabalhoComponentes.tsx`:

- Preset **Capa** / **Miolo** / **Encarte**
- **Componente livre** (prompt de nome)

### Renomear

- Alterar nome inline → mesmo `componente_id` → Sub OS atualiza `display_name`.

### Remover / inativar

- Sem Sub OS/histórico → DELETE físico.
- Com Sub OS → `ativo=0` (componente some da Gerência ativa; Sub OS preservada).

---

## 6. Compatibilidade com Sub OS

| Aspecto | Impacto |
|---------|---------|
| Andamento por componente | Lista só componentes **ativos** do MySQL |
| Componente inativado | Não aparece no seletor de novo andamento; Sub OS existente permanece na lista |
| Renomeação | Sub OS vinculada via `componente_id` |
| Espelho `tabAndamento` | Inalterado (`UltimoStatus=0`) |
| MDB | Recebe apenas espelho de andamento, não dados técnicos de componente |

---

## 7. Arquivos alterados

| Arquivo | Alteração | Motivo |
|---------|-----------|--------|
| `app/backend/routers/os_routes.py` | `TechSpecLotePayload` completo; sync sempre com `TechSpec` | Parar perda de campos no save |
| `app/backend/services/os_componentes_service.py` | `_lote_to_dict`, sync com lista vazia, payload Pydantic | Persistência completa |
| `apps/web/src/features/gerencia/components/GerenciaPage.tsx` | Bootstrap só MySQL; sem `inferTechSpecFromForm` | Não presumir componentes |
| `apps/web/src/features/gerencia/techSpec.ts` | `applyTechSpecToForm` seguro; `stripIds` na duplicação | Não zerar Pags; não agregar ao MDB |
| `apps/web/src/features/gerencia/mappers.ts` | `TechSpec` sempre enviado (mesmo vazio) | Sync de remoções |
| `app/backend/tests/test_componentes_gerencia.py` | **Novo** — 9 testes | Regressão |

---

## 8. Testes executados

| Comando | Resultado | Observação |
|---------|-----------|------------|
| `python -m pytest app/backend/tests -q` | ✅ 66 passed | +9 testes componentes |
| `pnpm build` | ✅ Sucesso | Vite build OK |
| `pnpm lint` | ✅ Sucesso | Placeholder Fase 0 |
| `pnpm typecheck` | ❌ TS6310 | Pré-existente (project references) |

---

## 9. Testes manuais recomendados

- [ ] Criar OS nova → editar → **sem componentes** na seção Trabalho
- [ ] Adicionar Capa manualmente → preencher páginas, papel, cores, máquina → salvar
- [ ] Atualizar página → dados permanecem
- [ ] Outro navegador → dados permanecem
- [ ] Adicionar componente livre → salvar → reabrir → dados OK
- [ ] Renomear componente com Sub OS → histórico preservado
- [ ] Abrir OS antiga Access/MDB → **sem** Capa/Miolo/Encarte fictícios
- [ ] OS antiga → `Pags` correto (não zerado)
- [ ] Andamento por componente continua funcionando
- [ ] Salvar OS sem componentes → `GET /componentes` retorna `[]`

---

## 10. Pendências

1. **Validação manual** dos itens da seção 9 antes da homologação MDB Sub OS.
2. **Migração explícita** (futura): converter dados legados Capa/Miolo em componentes MySQL — **não** automática nesta correção.
3. **`pnpm typecheck` TS6310** — correção de project references (escopo separado).
4. **localStorage** — pode ser removido completamente em fase futura; hoje só fallback em erro de rede.

---

## Referências

- `docs/ROTEIRO_HOMOLOGACAO_SUB_OS_MDB.md` — homologação MDB (retomar após validação manual acima)
- `docs/RELATORIO_SUB_OS_COMPONENTE.md` — feature Sub OS original
