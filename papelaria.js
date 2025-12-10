// papelaria.js - Lógica de Campos Dinâmicos e Preview via CorelDRAW

document.addEventListener('DOMContentLoaded', () => {
    console.log('Módulo Papelaria (Corel Backend) Carregado');

    // Configuração da API
    const port = window.location.port ? `:${window.location.port}` : '';
    const API_BASE_URL = `http://${window.location.hostname}:8001/api`;

    // Elementos do DOM
    const selectTipo = document.getElementById('papelaria-tipo');
    const btnPreview = document.getElementById('btn-preview');
    const artContainer = document.getElementById('art-container');

    // Inicializar Select2 se disponível
    if ($.fn.select2 && $('#papelaria-tipo').length) {
        $('#papelaria-tipo').select2({ minimumResultsForSearch: Infinity });
    }

    // --- REGRAS DE VISIBILIDADE DOS CAMPOS ---
    const fieldRules = {
        "Bloco A5": ["var-nome", "var-cargo"],
        "Cartão Duplo Paisagem Lateral": ["var-nome", "var-cargo", "var-tel", "var-email", "var-endereco"],
        "Cartão Duplo Paisagem Topo": ["var-nome", "var-cargo", "var-tel", "var-email", "var-endereco"],
        "Cartão Duplo Retrato Lateral": ["var-nome", "var-cargo", "var-tel", "var-email", "var-endereco"],
        "Cartão de Gabinete Simples": ["var-nome", "var-cargo"],
        "Cartão de Cumprimento": ["var-nome", "var-cargo"],
        "Cartão de Visita": ["var-nome", "var-cargo", "var-tel", "var-cel", "var-email", "var-endereco"],
        "Pasta Avulso c/ Bolso": ["var-endereco", "var-tel", "var-email"],
        "Pasta Avulso s/ Bolso": ["var-endereco", "var-tel", "var-email"],
        "Timbrado A4": ["var-nome", "var-cargo", "var-tel", "var-email", "var-endereco"]
    };

    function updateFormFields(produto) {
        const visibleFields = fieldRules[produto] || [];
        const allFieldIds = ["var-nome", "var-cargo", "var-tel", "var-cel", "var-email", "var-endereco"];

        allFieldIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            // Busca o container pai (.form-group ou coluna do .form-row)
            const container = el.closest('.form-group') || el.closest('.form-row > div');

            if (container) {
                if (visibleFields.includes(id)) {
                    container.style.display = 'block';
                } else {
                    container.style.display = 'none';
                    el.value = ''; // Limpa valor ao esconder
                }
            }
        });

        // Tratamento especial para ocultar a linha (row) se ambos (Tel/Cel) estiverem ocultos
        const telContainer = document.getElementById('var-tel')?.closest('.form-row > div');
        const celContainer = document.getElementById('var-cel')?.closest('.form-row > div');

        if (telContainer && celContainer) {
            const row = telContainer.parentElement;
            if (telContainer.style.display === 'none' && celContainer.style.display === 'none') {
                row.style.display = 'none';
            } else {
                row.style.display = 'flex';
            }
        }
    }

    // Ajusta o tamanho do container cinza de preview apenas para referência visual
    function updateCanvasSize(tipo) {
        if (!artContainer) return;
        let w = '500px', h = '280px';

        if (tipo.includes('A4') || tipo.includes('Timbrado')) {
            w = '420px'; h = '594px';
        } else if (tipo.includes('Bloco A5')) {
            w = '350px'; h = '495px';
        } else if (tipo.includes('Pasta')) {
            w = '440px'; h = '310px';
        } else if (tipo.includes('Retrato') || tipo.includes('Gabinete')) {
            w = '300px'; h = '500px';
        } else if (tipo.includes('Paisagem') || tipo.includes('Duplo')) {
            w = '600px'; h = '350px';
        }
        artContainer.style.width = w;
        artContainer.style.height = h;
    }

    // --- EVENT LISTENERS ---

    $('#papelaria-tipo').on('change', function () {
        const val = this.value;
        updateFormFields(val);
        updateCanvasSize(val);

        // Resetar visualização ao trocar modelo
        if (artContainer) {
            artContainer.innerHTML = `
                <div style="text-align: center;">
                    <i class="fas fa-drafting-compass" style="font-size: 40px; color: #ddd; margin-bottom: 10px;"></i>
                    <p>Modelo alterado.<br>Clique em 'Gerar Pré-visualização' para atualizar.</p>
                </div>
            `;
        }
    });

    // Inicialização
    if (selectTipo) {
        updateFormFields(selectTipo.value);
        updateCanvasSize(selectTipo.value);
    }

    // --- AÇÃO DO BOTÃO PREVIEW ---
    if (btnPreview) {
        btnPreview.addEventListener('click', async () => {
            const tipo = selectTipo.value;
            if (!tipo) return alert("Por favor, selecione um modelo.");

            // Coleta os dados do formulário
            const dados = {
                nome: document.getElementById('var-nome')?.value || '',
                cargo: document.getElementById('var-cargo')?.value || '',
                tel: document.getElementById('var-tel')?.value || '',
                cel: document.getElementById('var-cel')?.value || '',
                email: document.getElementById('var-email')?.value || '',
                endereco: document.getElementById('var-endereco')?.value || ''
            };

            // Interface de Carregamento
            artContainer.innerHTML = `
                <div style="text-align:center; padding-top: 40px;">
                    <i class="fas fa-spinner fa-spin" style="font-size:30px; color:#0095D4"></i>
                    <br><br>
                    <span style="font-size:14px; color:#555; font-weight:bold;">Processando no CorelDRAW...</span>
                    <br>
                    <span style="font-size:11px; color:#888;">Isso pode levar alguns segundos.</span>
                </div>
            `;
            btnPreview.disabled = true;

            try {
                // Envia requisição POST para o backend
                const response = await fetch(`${API_BASE_URL}/papelaria/preview`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id_produto: tipo,
                        dados: dados
                    })
                });

                if (!response.ok) {
                    const errText = await response.text();
                    let errMsg = "Erro desconhecido no servidor.";
                    try {
                        // Tenta extrair mensagem JSON se houver
                        const errJson = JSON.parse(errText);
                        if (errJson.detail) errMsg = errJson.detail;
                    } catch (e) {
                        errMsg = errText;
                    }
                    throw new Error(errMsg);
                }

                // Recebe o arquivo PDF como BLOB
                const blob = await response.blob();
                const fileUrl = window.URL.createObjectURL(blob);

                // Renderiza no Iframe
                artContainer.innerHTML = '';
                const iframe = document.createElement('iframe');
                iframe.src = fileUrl;
                iframe.type = "application/pdf";
                iframe.style.width = '100%';
                iframe.style.height = '100%';
                iframe.style.border = 'none';
                artContainer.appendChild(iframe);

            } catch (error) {
                console.error("Erro Papelaria:", error);
                artContainer.innerHTML = `
                    <div style="color:#dc3545; text-align:center; padding: 20px;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 30px; margin-bottom:10px;"></i><br>
                        <strong>Falha ao gerar preview</strong><br>
                        <small>${error.message}</small>
                    </div>
                `;
            } finally {
                btnPreview.disabled = false;
            }
        });
    }
});