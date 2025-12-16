# Dashboard de Setor - Configuração e Uso

## Funcionalidades

O **Dashboard de Setor** (`dashboard_setor.html`) é um painel visual em tempo real que:

- **Exibe OSs ativas por setor** em um layout tipo Kanban com 4 colunas:
  - **p/ Triagem**: OSs em fase inicial ou trâmite de prova/prévia
  - **Em Execução**: OSs em execução ou recebidas
  - **Problemas Técnicos**: OSs com problemas técnicos
  - **Enviar Email**: OSs aguardando documentação

- **Atualização automática**: A cada 5 segundos, os dados são recarregados do banco de dados
- **Indicadores visuais**:
  - Cards **destacados em amarelo** para itens novos (recém-adicionados)
  - Cards **com aviso ⚠️** para OSs com prioridade (Solicitado/Prometido)

- **Configuração dinâmica**: Você pode selecionar qual setor monitorar via modal de configurações:
  - SEFOC, CGRAF, EXPEDIÇÃO, ACABAMENTO, IMPRESSÃO, PRÉ-IMPRESSÃO
  - Configurações são salvas no navegador (localStorage)

## Como Acessar

1. **Abra no navegador**:
   - DEV: `http://localhost:8001/dashboard_setor.html`
   - PROD: `http://localhost:8000/dashboard_setor.html`

2. **Selecione o setor** via botão de engrenagem (⚙️) no canto superior direito

3. **O painel carrega e atualiza automaticamente** a cada 5 segundos

## Estrutura Técnica

### Frontend (Vue 3 + CSS)
- **dashboard_setor.html**: Estrutura do painel com Vue 3
- **dashboard_setor.js**: Lógica de requisição de dados, processamento e reatividade
- **dashboard_setor.css**: Estilos dark-mode, layout Kanban, animações

### Backend (API)
O dashboard usa o endpoint:
```
GET /api/os/search?setor={SETOR}&include_finished=false&limit=200
```

**Respostas esperadas**:
```json
{
  "data": [
    {
      "nr_os": 1404,
      "ano": 2025,
      "titulo": "Educação Verde - Estrategias Pedagogicas",
      "produto": "Livro",
      "situacao": "Saída p/ SEFOC",
      "prioridade": "Solicitado p/",
      "setor": "SEFOC"
    },
    ...
  ],
  "meta": {...}
}
```

## Configuração de Colunas

Para adicionar/modificar as colunas e seus filtros, edite o objeto `config` em `dashboard_setor.js`:

```javascript
const config = ref({
    sector: "SEFOC",
    columns: [
        {
            id: 'entrada',
            title: 'Entrada / Trâmite',
            statuses: ['Saída p/', 'Saída parcial p/', 'Entrada Inicial', ...]
        },
        // Adicione mais colunas aqui...
    ]
});
```

## Dicas

- **Modo Full-Screen**: Ideal para TVs de monitoramento (F11 no navegador)
- **Cache de dados**: O localStorage mantém a configuração do setor entre sessões
- **Animações**: Vue transition-group destaca items novos com animação suave
- **Responsive**: O layout se adapta automaticamente ao tamanho da tela

## Troubleshooting

**Dados não carregam?**
- Verifique se o servidor está rodando na porta correta (8001 DEV, 8000 PROD)
- Abra o Console (F12) e veja se há erros de fetch
- Confirme que há OSs ativas para o setor selecionado

**Setor não tem dados?**
- Verifique se existe dados de OSs com esse setor no banco de dados
- Teste manualmente a API: `curl http://localhost:8001/api/os/search?setor=SEFOC`

