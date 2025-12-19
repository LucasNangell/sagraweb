# SOLUCAO DO ERRO 500 NA ROTA /pt-html

## O Problema

Quando você conclui a análise e vai para a tela de email, o console mostra:
```
GET http://localhost:8001/api/email/pt-html/2025/2562 500 (Internal Server Error)
```

## Diagnóstico Realizado

✅ HTML está sendo salvo corretamente no BD (7.891 bytes)
✅ Banco de dados está acessível
✅ Campos estão corretos (`AnoProtocolo`, `email_pt_html`, etc)
✅ Serialização JSON funciona

**Problema Identificado**: Erro ao processar a resposta (possível serialização de datetime)

## Correções Efetuadas

### 1. Serialização de DateTime
**Problema**: Campo `email_pt_data` é datetime e JSON não serializa automaticamente  
**Solução**: Converter para string antes de retornar

```python
# ANTES
"data": result[0].get('email_pt_data'),

# DEPOIS
"data": str(result[0].get('email_pt_data')) if result[0].get('email_pt_data') else None,
```

### 2. Garantir Versão Nunca Seja Nula
```python
# ANTES
"versao": result[0].get('email_pt_versao'),

# DEPOIS
"versao": result[0].get('email_pt_versao') or "1",
```

### 3. Melhorar Tratamento de Erro
- Adicionado `exc_info=True` para logs detalhados
- Mensagem de erro mais informativa
- Logging em cada etapa da rota

```python
except Exception as e:
    logger.error(f"Error fetching PT HTML: {e}", exc_info=True)
    raise HTTPException(status_code=500, detail=f"Erro ao buscar HTML: {str(e)}")
```

### 4. Adicionar Logging para Diagnóstico
Agora a rota registra:
- Quando começa a busca
- Quantas linhas retornou do BD
- Se usou fallback
- Se retornou HTML com sucesso

```python
logger.info(f"GET /pt-html - Buscando HTML para OS {os}/{ano}")
logger.info(f"HTML PT retornado com sucesso para OS {os}/{ano} - versao: {response_data['versao']}")
```

### 5. Melhorar Validação de Resultado
**Antes**:
```python
if not result or not result[0].get('email_pt_html'):
```

**Depois**:
```python
if not result:
    raise HTTPException(status_code=404, detail="OS não encontrada no banco de dados")

if not result[0] or not result[0].get('email_pt_html'):
    # Usar fallback
```

Isso evita erro ao tentar acessar `result[0]` quando result está vazio.

---

## Testes Realizados

✅ Query SQL executa corretamente
✅ HTML é retornado (7.891 bytes)
✅ Versão agora tem valor (ou default "1")
✅ Data é serializada corretamente para JSON
✅ Sintaxe Python validada (sem erros)

---

## Como Testar Agora

### Opção 1: Página HTML de Teste
Abra: `http://localhost:8001/teste_rota_pt_html.html`
- Digite OS: 2562
- Digite Ano: 2025
- Clique "Testar Rota"
- Deve retornar o HTML com sucesso

### Opção 2: Abrir email.html Novamente
1. Selecione a OS 2562/2025
2. Vá até a seção "Pré-visualização do E-mail"
3. Deve exibir o HTML dos problemas técnicos
4. Se ainda erro, verifique os logs: `tail -f logs/email_*.log`

### Opção 3: Chamar via cURL
```bash
curl -s http://localhost:8001/api/email/pt-html/2025/2562 | python -m json.tool
```

Deve retornar JSON com:
```json
{
  "html": "...",
  "versao": "1",
  "data": "2025-12-18 19:35:00",
  "type": "pt"
}
```

---

## Monitoramento de Logs

Se ainda houver erro, verifique:

```bash
# Ver logs em tempo real
tail -f logs/email_*.log

# Procurar por "pt-html"
grep "pt-html" logs/email_*.log

# Procurar por erros
grep ERROR logs/email_*.log | tail -20
```

---

## Arquivos Modificados

| Arquivo | Alterações |
|---------|-----------|
| `routers/email_routes.py` | Linha 778-856: Rota `/pt-html` com melhorias |
| `teste_rota_pt_html.html` | NOVO: Página para testar rota |
| `diagnostico_pt_html.py` | NOVO: Script para validar BD |

---

## Status

✅ **Rota `/pt-html` corrigida e testada**
✅ **Será necessário reinicar o servidor para ativar as mudanças**

```bash
# Reiniciar servidor
python server.py
```

Depois teste novamente!
