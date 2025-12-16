# 🎯 GUIA RÁPIDO: COLUNAS DINÂMICAS NO DASHBOARD

## Como Configurar Suas Colunas

### 📍 Passo 1: Abrir Configurações
1. Localize o ícone ⚙️ (engrenagem) no canto superior direito do dashboard
2. Clique no ícone para abrir o modal de configurações

### 📊 Passo 2: Definir Quantidade de Colunas

**Opção A - Usar o Input Numérico:**
```
┌─────────────────────────────┐
│ Quantidade de Colunas       │
│ ┌───┐  Min: 1 | Max: 6     │
│ │ 4 │                       │
│ └───┘                       │
└─────────────────────────────┘
```
- Digite o número desejado (1 a 6)
- Colunas são ajustadas automaticamente

**Opção B - Usar Botões:**
- **+ Adicionar Coluna**: Cria nova coluna no final
- **🗑️ Remover**: Remove coluna específica

### ✏️ Passo 3: Personalizar Cada Coluna

Para cada coluna, você pode:

**A) Editar o Título:**
```
┌─────────────────────────────────┐
│ Título da Coluna 1             │
│ ┌─────────────────────────────┐│
│ │ p/ Triagem                  ││ ← Clique e edite
│ └─────────────────────────────┘│
└─────────────────────────────────┘
```

**B) Selecionar Andamentos:**
```
Andamentos desta coluna:
☑ Saída p/              ☑ Entrada Inicial
☑ Saída parcial p/      ☐ Em Execução
☑ Tramit. de Prova p/   ☐ Recebido
```
- Marque os andamentos que devem aparecer nesta coluna
- Você pode selecionar quantos quiser

### 💾 Passo 4: Salvar
1. Clique no botão **"Salvar e Recarregar"**
2. Dashboard será atualizado automaticamente
3. Suas configurações ficam salvas no navegador

---

## 💡 Exemplos Práticos

### Exemplo 1: Dashboard Simples (2 Colunas)

**Configuração:**
- Quantidade: 2
- Coluna 1: "Aguardando" → Marcar: `Entrada Inicial`, `Saída p/`
- Coluna 2: "Trabalhando" → Marcar: `Em Execução`, `Recebido`

**Resultado:**
```
┌─────────────────┬─────────────────┐
│   Aguardando    │   Trabalhando   │
│                 │                 │
│  [OS 1234/25]   │  [OS 5678/25]   │
│  [OS 2345/25]   │  [OS 6789/25]   │
│                 │                 │
└─────────────────┴─────────────────┘
```

### Exemplo 2: Dashboard Detalhado (4 Colunas)

**Configuração:**
- Quantidade: 4
- Coluna 1: "Entrada" → `Entrada Inicial`, `Saída p/`
- Coluna 2: "Produção" → `Em Execução`, `Recebido`
- Coluna 3: "Problemas" → `Problemas Técnicos`
- Coluna 4: "Finalização" → `Encam. de Docum.`

**Resultado:**
```
┌────────┬────────┬────────┬────────┐
│Entrada │Produção│Problem.│Final.  │
│        │        │        │        │
│ [OS 1] │ [OS 5] │ [OS 9] │ [OS 12]│
│ [OS 2] │ [OS 6] │        │ [OS 13]│
│ [OS 3] │ [OS 7] │        │        │
│ [OS 4] │ [OS 8] │        │        │
└────────┴────────┴────────┴────────┘
```

### Exemplo 3: Dashboard Completo (6 Colunas)

**Ideal para:** Monitores grandes, TVs, painéis de NOC

**Configuração:**
- Quantidade: 6
- Coluna 1: "Triagem"
- Coluna 2: "Aguardando"
- Coluna 3: "Em Execução"
- Coluna 4: "Revisão"
- Coluna 5: "Problemas"
- Coluna 6: "Finalização"

---

## ⚙️ Dicas e Truques

### ✅ Boas Práticas

1. **Mantenha Títulos Curtos**
   - ✅ "Em Execução"
   - ❌ "Ordens de Serviço que Estão em Execução Neste Momento"

2. **Agrupe Andamentos Relacionados**
   - Coluna "Entrada": Todos os tipos de entrada
   - Coluna "Problemas": Todos os tipos de problema

3. **Use Emojis nos Títulos (Opcional)**
   - "🔍 Triagem"
   - "⚙️ Produção"
   - "❌ Problemas"
   - "✅ Concluído"

### 📏 Quantidade Ideal de Colunas por Tela

| Tipo de Tela | Resolução | Colunas Recomendadas |
|--------------|-----------|---------------------|
| TV 4K        | 3840x2160 | 5-6 colunas         |
| Monitor Grande| 1920x1080| 4-5 colunas         |
| Monitor Padrão| 1680x1050| 3-4 colunas         |
| Notebook     | 1366x768  | 2-3 colunas         |

### 🎨 Personalização Avançada

**Você pode criar layouts como:**

**Layout "Funil de Vendas":**
1. Prospecção (mais OSs)
2. Negociação (menos OSs)
3. Fechamento (poucas OSs)

**Layout "Prioridades":**
1. 🔴 Urgente
2. 🟡 Importante
3. 🟢 Normal
4. ⚪ Baixa

**Layout "Por Responsável":**
1. João
2. Maria
3. Pedro
4. Ana

---

## ❓ Perguntas Frequentes

**Q: Posso ter mais de 6 colunas?**
A: Não no momento. O limite é 6 para manter a legibilidade.

**Q: As configurações são salvas por usuário?**
A: Sim, cada navegador/computador mantém suas próprias configurações.

**Q: O que acontece se eu fechar sem salvar?**
A: Suas alterações são descartadas. Sempre clique "Salvar e Recarregar".

**Q: Posso ter uma coluna sem andamentos?**
A: Sim, mas ela ficará sempre vazia.

**Q: Como voltar à configuração padrão?**
A: Configure 4 colunas com os títulos e andamentos originais (veja documentação completa).

**Q: As animações funcionam com qualquer quantidade de colunas?**
A: Sim! Todas as animações são mantidas.

**Q: O que acontece com OSs que não se encaixam em nenhuma coluna?**
A: Elas simplesmente não aparecem. Configure suas colunas para cobrir todos os andamentos relevantes.

---

## 🚨 Solução de Problemas

### Problema: Não consigo adicionar mais colunas
**Solução:** Você atingiu o limite de 6 colunas. Remova uma existente primeiro.

### Problema: Botão "Remover" está desabilitado
**Solução:** É necessário ter pelo menos 1 coluna. Não é possível remover a última.

### Problema: Dashboard está muito apertado
**Solução:** Reduza o número de colunas para 3-4 ou use um monitor maior.

### Problema: Fontes muito pequenas
**Solução:** Com 5-6 colunas, fontes reduzem automaticamente. Use menos colunas ou monitor maior.

### Problema: Configuração não foi salva
**Solução:** Certifique-se de clicar "Salvar e Recarregar" antes de fechar o modal.

### Problema: Dashboard voltou ao padrão após atualizar
**Solução:** Verifique se o localStorage não foi limpo. Reconfigure se necessário.

---

## 📞 Suporte

Para mais informações, consulte:
- 📄 [IMPLEMENTACAO_COLUNAS_DINAMICAS.md](IMPLEMENTACAO_COLUNAS_DINAMICAS.md) - Documentação completa
- 🎯 [DASHBOARD_SETOR_README.md](DASHBOARD_SETOR_README.md) - Documentação geral do dashboard

---

**Última Atualização:** 16/12/2025  
**Versão:** 2.0 - Colunas Dinâmicas
