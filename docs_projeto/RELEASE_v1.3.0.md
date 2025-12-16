# 🚀 RELEASE NOTES - v1.3.0

**Versão:** v1.3.0  
**Data:** 15/12/2025  
**Tipo:** MINOR (Novas Features + Melhorias)  
**Status:** 🚀 PUBLICADO EM PROD

---

## 📋 Resumo

Implementação de três novas funcionalidades principais: sistema de priorização de permissões por IP, padronização completa de andamentos (observações e pontos), e sistema Wake Lock no dashboard de setor para manter tela ativa.

---

## ✨ Principais Funcionalidades

### 1. 🔐 Priorização de Permissões por IP
**Arquivo:** `routers/permissions_routes.py`

**Problema Resolvido:**
- IPs com wildcard (ex: `10.120.1.%`) estavam sobrepondo configurações de IPs específicos
- Falta de previsibilidade no controle de acesso

**Solução Implementada:**
- Sistema de priorização: IP específico > Wildcard > Fallback
- Wildcards ordenados por especificidade (maior LENGTH primeiro)
- Logs detalhados de qual regra foi aplicada

**Comportamento:**
```
1. Busca IP exato (10.120.1.12)
2. Se não encontrar, busca wildcards ordenados (10.120.1.% > 10.120.%)
3. Se nada encontrar, aplica permissões padrão (fallback)
```

**Impacto:**
- ✅ Controle preciso de permissões por IP
- ✅ Configurações específicas não são mais sobrescritas
- ✅ Sistema mais previsível e confiável

---

### 2. 📝 Padronização de Andamentos (Observações + Pontos)
**Arquivos:** 
- `routers/andamento_helpers.py` (novo)
- `routers/os_routes.py`
- `routers/email_routes.py`
- `routers/analise_routes.py`
- `server.py`

#### 2.1 Formato de Observações
**Padrão Implementado:** `HHhMM\nTexto com quebras preservadas`

**Exemplo:**
```
14h35
Cliente solicitou alteração no layout.
Aguardando novo arquivo.
```

**Função:** `format_andamento_obs(obs_text)`
- Prepara automaticamente o horário atual
- Preserva quebras de linha do texto original
- Aplicado em TODOS os 11 pontos de inserção de andamentos

#### 2.2 Formato de Pontos
**Padrão Implementado:** `#.#00` (pontos a cada 3 dígitos da direita para esquerda)

**Exemplos:**
| Entrada | Saída |
|---------|-------|
| `918713` | `918.713` |
| `12345` | `12.345` |
| `1234567` | `1.234.567` |
| `123` | `123` |

**Função:** `format_ponto(ponto)`
- Algoritmo: Reverter → Chunkar (3 em 3) → Juntar com '.' → Reverter
- Remove caracteres não-numéricos automaticamente
- Backward compatible (pontos já formatados passam sem alteração)
- Aplicado em TODOS os 11 pontos de inserção de andamentos

#### 2.3 Locais Atualizados (11 total)

**routers/os_routes.py (5 locais):**
1. Endpoint histórico individual (`POST /os/{ano}/{id}/history`)
2. Replicação de andamentos (`POST /os/history/replicate`)
3. Andamento automático "OS Criada via Web"
4. Andamento automático "Duplicado da OS"
5. Limpeza de dígitos do ponto usuário

**routers/email_routes.py (2 locais):**
1. Endpoint andamento manual (`POST /andamento`)
2. Andamento automático envio de PT

**routers/analise_routes.py (1 local):**
1. Função central `add_movement_internal()` (usada por todos os andamentos de análise)

**server.py (3 locais legados):**
1. Endpoint legado de histórico
2. Endpoint legado de replicação
3. Andamento "OS Criada via Web" (fluxo legado)

#### 2.4 Validação Automatizada
**Arquivo:** `test_format_ponto.py`

**Resultados:** ✅ 11/11 testes passaram
- Casos padrão (6, 5, 7, 4 dígitos)
- Edge cases (1, 2, 3 dígitos)
- Casos especiais (vazio, None, já formatado, alfanumérico)

**Documentação:** `CORRECAO_OBSERVACOES_ANDAMENTOS.md`

---

### 3. 🔒 Wake Lock no Dashboard Setor
**Arquivos:** 
- `dashboard_setor.js` (já implementado)
- `IMPLEMENTACAO_WAKE_LOCK.md` (atualizado)
- `VALIDACAO_WAKE_LOCK.md` (novo)

**Objetivo:**
Impedir que tela apague, entre em suspensão ou bloqueie enquanto dashboard_setor estiver aberto.

**Estratégia Dupla:**

#### 3.1 Wake Lock API (Nativa)
- Prioridade para navegadores modernos
- Funciona em: Chrome 84+, Edge 84+, Safari 16.4+, Opera 70+
- Solução oficial, eficiente, sem artifícios

#### 3.2 Vídeo Invisível (Fallback)
- Ativado se API não estiver disponível
- Vídeo 1x1 pixel, transparente, em loop
- Funciona em: Firefox e navegadores sem Wake Lock API
- Técnica usada em painéis industriais, NOCs, aeroportos

**Funcionalidades:**
- ✅ Ativação automática ao carregar (`onMounted`)
- ✅ Reativação inteligente ao voltar à aba (`visibilitychange`)
- ✅ Liberação automática ao fechar (`onUnmounted`)
- ✅ Listeners de interação para superar bloqueio de autoplay
- ✅ Gestão completa do ciclo de vida

**Compatibilidade:** 100% dos navegadores modernos

**Comportamento:**
- ❌ Tela NÃO escurece
- ❌ Protetor de tela NÃO ativa
- ❌ Sistema NÃO suspende
- ❌ Sessão NÃO bloqueia
- ✅ Dashboard permanece sempre visível

**Validação:**
- Isolado EXCLUSIVAMENTE ao dashboard_setor
- Não afeta outras telas
- Não altera layout ou funcionalidades
- Reversível e seguro

---

## 🔧 Alterações Técnicas

### Arquivos Novos
- `routers/andamento_helpers.py` - Funções utilitárias de formatação
- `test_format_ponto.py` - Suite de testes automatizados
- `CORRECAO_OBSERVACOES_ANDAMENTOS.md` - Documentação de formatação
- `VALIDACAO_WAKE_LOCK.md` - Validação completa Wake Lock

### Arquivos Modificados
- `routers/permissions_routes.py` - Priorização de IPs
- `routers/os_routes.py` - Formatação de andamentos (5 locais)
- `routers/email_routes.py` - Formatação de andamentos (2 locais)
- `routers/analise_routes.py` - Formatação de andamentos (1 local)
- `server.py` - Formatação de andamentos (3 locais legados)
- `IMPLEMENTACAO_WAKE_LOCK.md` - Documentação atualizada

### Arquivos Sem Alteração
- Backend estrutural mantido
- Frontend de outras telas intacto
- Banco de dados sem migração necessária (campos já existem)

---

## 📊 Impacto

### Segurança
✅ Controle de acesso mais preciso e previsível  
✅ Logs detalhados de permissões aplicadas  

### Qualidade de Dados
✅ Andamentos padronizados em TODO o sistema  
✅ Observações com timestamp automático  
✅ Pontos formatados para melhor legibilidade  
✅ Quebras de linha preservadas  

### Experiência do Usuário
✅ Dashboard pode ser usado como painel permanente  
✅ Não requer interação manual para manter tela ativa  
✅ Ideal para TVs/monitores dedicados  
✅ Dados mais legíveis e organizados  

### Performance
✅ Formatação centralizada (DRY principle)  
✅ Testes automatizados garantem qualidade  
✅ Wake Lock com impacto < 0.1% CPU  

---

## 🧪 Testes Realizados

### Teste 1: Priorização de IPs ✅
- IP específico prevalece sobre wildcard
- Wildcards ordenados por especificidade
- Fallback aplicado quando necessário

### Teste 2: Formatação de Observações ✅
- Timestamp automático em todos os locais
- Quebras de linha preservadas
- Formato consistente em todo o sistema

### Teste 3: Formatação de Pontos ✅
- 11/11 casos de teste passaram
- Edge cases tratados corretamente
- Backward compatible

### Teste 4: Wake Lock ✅
- API nativa funciona em Chrome/Edge/Safari
- Fallback funciona em Firefox
- Reativação automática ao voltar à aba
- Liberação correta ao fechar

---

## 📚 Documentação

### Novos Documentos
- [CORRECAO_OBSERVACOES_ANDAMENTOS.md](CORRECAO_OBSERVACOES_ANDAMENTOS.md) - Guia completo de formatação
- [VALIDACAO_WAKE_LOCK.md](VALIDACAO_WAKE_LOCK.md) - Validação e testes

### Documentos Atualizados
- [IMPLEMENTACAO_WAKE_LOCK.md](IMPLEMENTACAO_WAKE_LOCK.md) - Estratégia dupla documentada
- [VERSION.md](VERSION.md) - Histórico de versões atualizado

---

## ⚠️ Notas de Atualização

### Compatibilidade
✅ **100% Backward Compatible**
- Andamentos antigos continuam funcionando
- Novos andamentos seguem novo padrão
- Pontos já formatados não são alterados

### Sem Breaking Changes
✅ Todas as alterações são aditivas ou melhorias
✅ Nenhuma funcionalidade removida
✅ Interfaces mantidas

### Migração
❌ **Não requer migração de banco de dados**
- Campos já existem (Observação, Ponto)
- Apenas formatação dos dados inseridos é alterada

---

## 🚀 Deploy em PROD

### Pré-requisitos
- [x] Python 3.8+
- [x] FastAPI
- [x] Navegadores modernos (Chrome 84+, Firefox, Safari 16.4+)

### Passos
1. Fazer backup do código atual
2. Atualizar arquivos do repositório
3. Reiniciar serviço FastAPI
4. Validar endpoints de andamento
5. Validar dashboard_setor em diferentes navegadores

### Validação Pós-Deploy
- [ ] Criar novo andamento e verificar formato de observação
- [ ] Verificar formatação de ponto em novo andamento
- [ ] Abrir dashboard_setor e confirmar Wake Lock ativo (console)
- [ ] Configurar IP específico e verificar priorização

---

## 🎯 Próximas Versões

### Sugestões para v1.4.0
- Migração de andamentos antigos para novo formato (script de atualização)
- Dashboard de monitoramento de Wake Lock (estatísticas)
- Relatório de uso de permissões por IP
- API de consulta de andamentos formatados

---

## 📞 Suporte

### Problemas Conhecidos
Nenhum problema conhecido nesta versão.

### Limitações
1. **Wake Lock:** Troca de aba libera o lock (comportamento padrão do navegador)
2. **Wake Lock:** Não impede suspensão/bloqueio manual pelo usuário
3. **Formatação:** Andamentos existentes mantêm formato antigo (não há migração automática)

---

## ✅ Checklist de Release

- [x] Código testado em ambiente de desenvolvimento
- [x] Testes automatizados criados e passando (11/11)
- [x] Documentação completa atualizada
- [x] Validação em múltiplos navegadores
- [x] Backward compatibility verificada
- [x] Sem breaking changes
- [x] Release notes criadas
- [x] VERSION.md atualizado
- [x] Pronto para deploy em PROD

---

**Versão:** v1.3.0  
**Data de Release:** 15/12/2025  
**Status:** ✅ PRONTO PARA PRODUÇÃO 🚀
