# 📝 CHANGELOG - v1.3.0

**Data:** 15/12/2025 19:24  
**Versão:** v1.3.0  
**Tipo:** MINOR (Features + Improvements)

---

## 🎯 Resumo da Versão

Implementação de três melhorias principais: sistema de priorização de permissões por IP, padronização completa de andamentos (observações e pontos), e sistema Wake Lock no dashboard de setor.

---

## ✨ Novas Funcionalidades

### 1. Sistema de Priorização de Permissões por IP
- **Arquivo:** `routers/permissions_routes.py`
- **Descrição:** IP específico agora prevalece sobre wildcards
- **Prioridade:** IP exato > Wildcard (por especificidade) > Fallback
- **Benefício:** Controle preciso de permissões sem sobrescrição

### 2. Padronização de Andamentos
- **Módulo:** `routers/andamento_helpers.py` (novo)
- **Observações:** Formato `HHhMM\n` + texto com quebras preservadas
- **Pontos:** Formato `#.#00` (ex: 918713 → 918.713)
- **Cobertura:** 11 locais atualizados em todo o sistema
- **Testes:** 11/11 casos de teste validados

### 3. Wake Lock no Dashboard Setor
- **Arquivo:** `dashboard_setor.js`
- **Estratégia:** Wake Lock API + Vídeo invisível (fallback)
- **Compatibilidade:** 100% navegadores modernos
- **Benefício:** Tela permanece sempre ativa sem configuração manual

---

## 🔧 Arquivos Modificados

### Novos Arquivos
```
routers/andamento_helpers.py
test_format_ponto.py
CORRECAO_OBSERVACOES_ANDAMENTOS.md
VALIDACAO_WAKE_LOCK.md
RELEASE_v1.3.0.md
```

### Arquivos Alterados
```
routers/permissions_routes.py (priorização de IPs)
routers/os_routes.py (5 locais de formatação)
routers/email_routes.py (2 locais de formatação)
routers/analise_routes.py (1 local central)
server.py (3 locais legados)
IMPLEMENTACAO_WAKE_LOCK.md (documentação atualizada)
VERSION.md (histórico atualizado)
```

---

## 📊 Estatísticas

- **Arquivos Criados:** 5
- **Arquivos Modificados:** 7
- **Linhas Adicionadas:** ~800
- **Testes Criados:** 11
- **Taxa de Sucesso dos Testes:** 100%
- **Locais de Andamento Atualizados:** 11
- **Compatibilidade:** 100% backward compatible

---

## ✅ Validações

- [x] Testes automatizados passando (11/11)
- [x] Priorização de IPs validada
- [x] Formatação de observações validada
- [x] Formatação de pontos validada
- [x] Wake Lock validado em Chrome, Edge, Firefox, Safari
- [x] Backward compatibility confirmada
- [x] Sem breaking changes
- [x] Documentação completa

---

## 🚀 Deploy

**Data:** 15/12/2025 19:24  
**Ambiente:** PROD  
**Status:** ✅ PUBLICADO

### Ações Realizadas
1. ✅ Backup criado: `backups/v1.3.0_20251215_192423/`
2. ✅ VERSION.md atualizado
3. ✅ RELEASE_v1.3.0.md criado
4. ✅ Documentação completa
5. ✅ Arquivos principais copiados para backup

---

## 📚 Documentação

- **Release Notes:** `RELEASE_v1.3.0.md`
- **Histórico:** `VERSION.md`
- **Formatação:** `CORRECAO_OBSERVACOES_ANDAMENTOS.md`
- **Wake Lock:** `IMPLEMENTACAO_WAKE_LOCK.md`, `VALIDACAO_WAKE_LOCK.md`

---

## 🎯 Próximos Passos

1. Monitorar logs de formatação de andamentos
2. Validar Wake Lock em diferentes ambientes
3. Coletar feedback sobre novas funcionalidades
4. Planejar v1.4.0 (migração de dados antigos?)

---

**Changelog criado em:** 15/12/2025 19:24  
**Versão:** v1.3.0  
**Status:** ✅ COMPLETO
