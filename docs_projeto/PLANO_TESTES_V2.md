# 🧪 PLANO DE TESTES - DASHBOARD SETOR V2.0

**Versão Testada:** 2.0 - Colunas Dinâmicas  
**Data do Deploy:** 16/12/2025  
**Ambiente:** PROD (dashboard_setor_prod.*)

---

## 🎯 OBJETIVO DOS TESTES

Validar que a versão 2.0 em produção funciona corretamente em todos os aspectos:
- ✅ Funcionalidades novas (colunas dinâmicas)
- ✅ Funcionalidades existentes (animações, prioridades, WebSocket)
- ✅ Responsividade em diferentes dispositivos
- ✅ Performance e estabilidade

---

## 📋 CHECKLIST DE TESTES

### 🔹 FASE 1: Testes Básicos (5 minutos)

#### Teste 1.1: Carregamento Inicial
**Passos:**
1. Abrir: `http://localhost:8000/dashboard_setor_prod.html`
2. Aguardar carregamento completo

**Resultado Esperado:**
- [ ] Dashboard carrega sem erros
- [ ] 4 colunas padrão aparecem
- [ ] OSs são exibidas nas colunas corretas
- [ ] Console (F12) sem erros críticos

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 1.2: Abrir Modal de Configurações
**Passos:**
1. Clicar no ícone ⚙️ (engrenagem) no header
2. Aguardar modal abrir

**Resultado Esperado:**
- [ ] Modal abre suavemente
- [ ] Campo "Setor Monitorado" mostra valor atual
- [ ] Campo "Quantidade de Colunas" mostra "4"
- [ ] 4 blocos de configuração de colunas aparecem
- [ ] Botões "+ Adicionar Coluna" e "🗑️ Remover" visíveis

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 1.3: Fechar Modal sem Salvar
**Passos:**
1. Clicar "X" ou "Cancelar"
2. Observar dashboard

**Resultado Esperado:**
- [ ] Modal fecha
- [ ] Dashboard permanece inalterado
- [ ] Nenhuma alteração foi aplicada

**Critério de Sucesso:** ✅ Todos os itens marcados

---

### 🔹 FASE 2: Funcionalidades Novas (10 minutos)

#### Teste 2.1: Adicionar Coluna via Botão
**Passos:**
1. Abrir Settings
2. Clicar "+ Adicionar Coluna"
3. Verificar nova coluna criada

**Resultado Esperado:**
- [ ] Nova coluna aparece no final
- [ ] Título padrão: "Coluna 5"
- [ ] Lista de andamentos vazia
- [ ] Campo "Quantidade de Colunas" atualiza para "5"

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 2.2: Remover Coluna via Botão
**Passos:**
1. Na coluna recém-criada, clicar "🗑️ Remover"
2. Verificar remoção

**Resultado Esperado:**
- [ ] Coluna desaparece
- [ ] Campo "Quantidade de Colunas" volta para "4"
- [ ] Outras colunas permanecem intactas

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 2.3: Ajustar Quantidade via Input
**Passos:**
1. No campo "Quantidade de Colunas", digitar "2"
2. Observar mudanças

**Resultado Esperado:**
- [ ] Colunas são removidas automaticamente
- [ ] Apenas 2 blocos de configuração permanecem
- [ ] Sem erros no console

**Passos Adicionais:**
3. Digitar "6"

**Resultado Esperado:**
- [ ] Colunas são adicionadas automaticamente
- [ ] 6 blocos de configuração aparecem
- [ ] Botão "+ Adicionar" fica desabilitado

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 2.4: Editar Título de Coluna
**Passos:**
1. Selecionar texto do campo "Título da Coluna 1"
2. Digitar "Minha Coluna Teste 🚀"
3. Clicar "Salvar e Recarregar"
4. Observar dashboard

**Resultado Esperado:**
- [ ] Modal fecha
- [ ] Dashboard recarrega
- [ ] Header da coluna mostra "Minha Coluna Teste 🚀"
- [ ] Emoji é exibido corretamente

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 2.5: Configurar Andamentos
**Passos:**
1. Abrir Settings
2. Na coluna 1, desmarcar todos os andamentos
3. Marcar apenas "Em Execução"
4. Salvar

**Resultado Esperado:**
- [ ] Coluna 1 mostra apenas OSs com status "Em Execução"
- [ ] Outras colunas não foram afetadas

**Critério de Sucesso:** ✅ Todos os itens marcados

---

### 🔹 FASE 3: Persistência (5 minutos)

#### Teste 3.1: Recarregar Página
**Passos:**
1. Configurar 3 colunas com títulos personalizados
2. Salvar
3. Pressionar F5 (recarregar)

**Resultado Esperado:**
- [ ] 3 colunas são exibidas
- [ ] Títulos personalizados mantidos
- [ ] Andamentos configurados preservados

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 3.2: Fechar e Reabrir Navegador
**Passos:**
1. Fechar completamente o navegador
2. Reabrir e acessar dashboard

**Resultado Esperado:**
- [ ] Configuração é restaurada automaticamente
- [ ] Mesmo número de colunas
- [ ] Mesmos títulos
- [ ] Mesmos andamentos

**Critério de Sucesso:** ✅ Todos os itens marcados

---

### 🔹 FASE 4: Responsividade (10 minutos)

#### Teste 4.1: TV 4K / Monitor Grande (≥1920px)
**Passos:**
1. Configurar 6 colunas
2. Maximizar navegador em tela ≥1920px

**Resultado Esperado:**
- [ ] 6 colunas lado a lado
- [ ] Fontes grandes e legíveis
- [ ] Cards proporcionais
- [ ] Sem scroll horizontal
- [ ] Espaçamento generoso

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 4.2: Monitor Padrão (1366-1920px)
**Passos:**
1. Redimensionar para ~1600px
2. Observar layout

**Resultado Esperado:**
- [ ] Layout mantém qualidade
- [ ] Fontes em tamanho padrão
- [ ] Cards bem distribuídos

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 4.3: Notebook (≤1366px)
**Passos:**
1. Redimensionar para 1366px ou menos
2. Observar ajustes

**Resultado Esperado:**
- [ ] Layout responsivo ativado
- [ ] Fontes ligeiramente menores mas legíveis
- [ ] Cards compactos mas usáveis
- [ ] 6 colunas → reduz para 4 automaticamente

**Critério de Sucesso:** ✅ Todos os itens marcados

---

### 🔹 FASE 5: Funcionalidades Existentes (10 minutos)

#### Teste 5.1: WebSocket / Atualizações em Tempo Real
**Passos:**
1. Abrir dashboard
2. Aguardar ~10 segundos
3. Observar barra de progresso e atualizações

**Resultado Esperado:**
- [ ] Barra de progresso enche e reseta
- [ ] Timestamp "Atualizado:" muda
- [ ] Novas OSs aparecem (se houver)
- [ ] Console mostra "WebSocket connected"

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 5.2: Animações de Entrada
**Passos:**
1. Configurar para recarregar
2. Observar OSs aparecendo

**Resultado Esperado:**
- [ ] Cards aparecem com animação suave
- [ ] Novos itens têm flash verde
- [ ] Transições fluidas
- [ ] Sem "pulos" ou glitches

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 5.3: Sistema de Prioridades
**Passos:**
1. Identificar OS com "Prometido p/" na descrição
2. Identificar OS com "Solicitado p/"

**Resultado Esperado:**
- [ ] Card "Prometido p/" tem fundo vermelho gradiente
- [ ] Card "Solicitado p/" tem fundo amarelo gradiente
- [ ] Texto está legível em ambos
- [ ] Badge de prioridade aparece

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 5.4: Wake Lock API
**Passos:**
1. Deixar dashboard aberto por 5+ minutos
2. Não interagir com o computador

**Resultado Esperado:**
- [ ] Monitor permanece ligado
- [ ] Console mostra "[Wake Lock] Ativado com sucesso"
- [ ] Tela não escurece automaticamente

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 5.5: Ordenação de OSs
**Passos:**
1. Observar ordem dos cards em cada coluna

**Resultado Esperado:**
- [ ] "Prometido p/" aparecem primeiro
- [ ] "Solicitado p/" aparecem em segundo
- [ ] OSs < 5000 aparecem antes de OSs >= 5000
- [ ] Dentro de cada grupo, mais antigas primeiro

**Critério de Sucesso:** ✅ Todos os itens marcados

---

### 🔹 FASE 6: Validações e Edge Cases (5 minutos)

#### Teste 6.1: Tentar Adicionar 7ª Coluna
**Passos:**
1. Configurar 6 colunas
2. Tentar clicar "+ Adicionar Coluna"

**Resultado Esperado:**
- [ ] Botão está desabilitado
- [ ] Nada acontece ao clicar

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 6.2: Tentar Remover Última Coluna
**Passos:**
1. Configurar apenas 1 coluna
2. Tentar clicar "🗑️ Remover"

**Resultado Esperado:**
- [ ] Botão está desabilitado
- [ ] Coluna permanece

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 6.3: Input Fora dos Limites
**Passos:**
1. Campo "Quantidade", digitar "0"
2. Observar comportamento

**Resultado Esperado:**
- [ ] Valor volta para "1" automaticamente
- [ ] 1 coluna é mantida

**Passos Adicionais:**
3. Digitar "10"

**Resultado Esperado:**
- [ ] Valor volta para "6" automaticamente
- [ ] 6 colunas no máximo

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 6.4: Coluna sem Andamentos
**Passos:**
1. Criar nova coluna
2. Não marcar nenhum andamento
3. Salvar

**Resultado Esperado:**
- [ ] Coluna aparece vazia no dashboard
- [ ] Título aparece
- [ ] Contador mostra "0"
- [ ] Sem erros

**Critério de Sucesso:** ✅ Todos os itens marcados

---

### 🔹 FASE 7: Performance e Console (5 minutos)

#### Teste 7.1: Console do Navegador
**Passos:**
1. Pressionar F12 (abrir DevTools)
2. Ir para aba "Console"
3. Observar mensagens

**Resultado Esperado:**
- [ ] Sem erros críticos (vermelhos)
- [ ] Warnings (amarelos) aceitáveis
- [ ] Mensagens de "[Wake Lock]" presentes
- [ ] Mensagens de "WebSocket" presentes

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 7.2: Performance de Renderização
**Passos:**
1. Configurar 6 colunas
2. Aguardar múltiplas atualizações (30s)
3. Observar fluidez

**Resultado Esperado:**
- [ ] Transições suaves
- [ ] Sem lag perceptível
- [ ] Barra de progresso flui normalmente
- [ ] Sem travamentos

**Critério de Sucesso:** ✅ Todos os itens marcados

---

#### Teste 7.3: Uso de Memória
**Passos:**
1. DevTools → Performance → Memory
2. Deixar dashboard aberto por 5 minutos
3. Observar gráfico

**Resultado Esperado:**
- [ ] Memória estável (sem crescimento infinito)
- [ ] Sem memory leaks aparentes

**Critério de Sucesso:** ✅ Todos os itens marcados

---

## 📊 CRITÉRIOS DE ACEITAÇÃO

### ✅ Aprovado se:
- Todas as fases tiveram ≥90% dos itens marcados
- Zero erros críticos no console
- Performance aceitável
- Funcionalidades core funcionando

### ⚠️ Aprovado com Ressalvas se:
- Fases tiveram 70-89% dos itens marcados
- Warnings no console mas funcionando
- Performance levemente comprometida
- Bugs não-críticos encontrados

### ❌ Reprovado se:
- Qualquer fase teve <70% dos itens marcados
- Erros críticos que impedem uso
- Funcionalidades core quebradas
- Performance inaceitável

---

## 🐛 REGISTRO DE BUGS (Se Encontrados)

### Bug #1
**Descrição:**  
**Severidade:** [ ] Crítica [ ] Alta [ ] Média [ ] Baixa  
**Passos para Reproduzir:**  
**Comportamento Esperado:**  
**Comportamento Atual:**  
**Screenshot/Console:**  

### Bug #2
**Descrição:**  
**Severidade:** [ ] Crítica [ ] Alta [ ] Média [ ] Baixa  
**Passos para Reproduzir:**  
**Comportamento Esperado:**  
**Comportamento Atual:**  
**Screenshot/Console:**  

---

## ✅ ASSINATURA DE APROVAÇÃO

**Testado por:** ___________________________  
**Data do Teste:** ___/___/_____  
**Ambiente:** [ ] PROD [ ] DEV  
**Resultado:** [ ] ✅ Aprovado [ ] ⚠️ Aprovado com Ressalvas [ ] ❌ Reprovado

**Observações:**
```
_______________________________________________________
_______________________________________________________
_______________________________________________________
```

**Autorização para Deploy Final:** [ ] Sim [ ] Não

---

## 🔄 PLANO DE ROLLBACK (Se Necessário)

**Quando Executar Rollback:**
- Bugs críticos que impedem uso
- Performance inaceitável
- Dados corrompidos
- Decisão de gestão

**Comando de Rollback:**
```powershell
cd C:\Users\P_918713\Desktop\Antigravity\SagraWeb

# Restaurar V1.0 em PROD
Copy-Item "dashboard_setor_v1_backup_20251216_145237.html" "dashboard_setor_prod.html" -Force
Copy-Item "dashboard_setor_v1_backup_20251216_145237.js" "dashboard_setor_prod.js" -Force
Copy-Item "dashboard_setor_v1_backup_20251216_145237.css" "dashboard_setor_prod.css" -Force

Write-Host "Rollback PROD para V1.0 concluído!" -ForegroundColor Green
```

**Tempo Estimado de Rollback:** < 2 minutos

---

**Documento Criado:** 16/12/2025  
**Versão do Documento:** 1.0  
**Válido para:** Dashboard Setor V2.0
