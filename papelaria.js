// papelaria.js - Lógica Dinâmica e Preview PDF (Iframe)

document.addEventListener('DOMContentLoaded', () => {
    console.log('Módulo Papelaria Dinâmico (PDF) Carregado');

    const API_BASE_URL = `http://${window.location.hostname}:8001/api`;

    // Elementos do DOM
    const selectTipo = document.getElementById('papelaria-tipo');
    const btnPreview = document.getElementById('btn-preview');
    const artContainer = document.getElementById('art-container');
    const formContainer = document.getElementById('dynamic-form-container');

    // 1. Carrega lista de modelos
    loadModels();

    // 2. Listener troca de modelo
    $(selectTipo).on('change', function () {
        const modelName = this.value;
        if (modelName) {
            loadModelFields(modelName);
            updateCanvasSize(modelName);
            resetPreviewArea();
        } else {
            formContainer.innerHTML = '';
        }
    });

    async function loadModels() {
        try {
            const res = await fetch(`${API_BASE_URL}/papelaria/modelos`);
            const models = await res.json();

            selectTipo.innerHTML = '<option value="">Selecione...</option>';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.nome;
                selectTipo.appendChild(opt);
            });

            if ($.fn.select2) {
                $(selectTipo).select2({ minimumResultsForSearch: 5, width: '100%' });
            }
        } catch (e) {
            console.error("Erro carregando modelos:", e);
            selectTipo.innerHTML = '<option value="">Erro ao carregar</option>';
        }
    }

    async function loadModelFields(modelName) {
        formContainer.innerHTML = '<div style="text-align:center; padding:10px;"><i class="fas fa-spinner fa-spin"></i> Carregando campos...</div>';

        try {
            const encodedName = encodeURIComponent(modelName);
            const res = await fetch(`${API_BASE_URL}/papelaria/modelos/${encodedName}`);
            if (!res.ok) throw new Error("Falha ao buscar campos");
            const fields = await res.json();
            renderDynamicFields(fields);
        } catch (e) {
            console.error(e);
            formContainer.innerHTML = '<div style="color:red; text-align:center; padding:10px;">Erro ao carregar configuração.</div>';
        }
    }

    function renderDynamicFields(fields) {
        formContainer.innerHTML = '';
        if (!fields || fields.length === 0) {
            formContainer.innerHTML = '<div style="text-align:center; padding:10px; color:#777;">Este modelo não requer preenchimento.</div>';
            return;
        }

        fields.forEach(field => {
            const formGroup = document.createElement('div');
            formGroup.className = 'form-group';

            const label = document.createElement('label');
            label.textContent = field.label;
            formGroup.appendChild(label);

            let input;
            if (field.type === 'textarea') {
                input = document.createElement('textarea');
                input.rows = field.rows || 3;
            } else {
                input = document.createElement('input');
                input.type = field.type === 'email' ? 'email' : 'text';
            }

            input.className = 'form-control dynamic-input';
            input.dataset.key = field.key;
            input.placeholder = field.placeholder || '';

            formGroup.appendChild(input);
            formContainer.appendChild(formGroup);
        });
    }

    // --- AÇÃO BOTÃO PREVIEW ---
    if (btnPreview) {
        btnPreview.addEventListener('click', async () => {
            const tipo = $(selectTipo).val();
            if (!tipo) return alert("Por favor, selecione um modelo.");

            const inputs = document.querySelectorAll('.dynamic-input');
            const dados = {};
            inputs.forEach(inp => {
                const key = inp.dataset.key;
                if (key) dados[key] = inp.value;
            });

            // Interface de Carregamento
            artContainer.innerHTML = `
                <div style="text-align:center; padding-top: 40px;">
                    <i class="fas fa-spinner fa-spin" style="font-size:30px; color:#0095D4"></i>
                    <br><br>
                    <span style="font-size:14px; color:#555; font-weight:bold;">Gerando PDF...</span>
                </div>
            `;
            btnPreview.disabled = true;

            try {
                const response = await fetch(`${API_BASE_URL}/papelaria/preview`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_produto: tipo, dados: dados })
                });

                if (!response.ok) {
                    const txt = await response.text();
                    throw new Error(txt);
                }

                const blob = await response.blob();
                const fileUrl = window.URL.createObjectURL(blob);

                artContainer.innerHTML = '';

                const iframe = document.createElement('iframe');
                // A MUDANÇA ESTÁ AQUI: Adiciona parâmetros para esconder a interface do PDF
                iframe.src = fileUrl + "#toolbar=0&navpanes=0&scrollbar=0&view=Fit";
                iframe.type = "application/pdf";
                iframe.style.width = '100%';
                iframe.style.height = '100%';
                iframe.style.border = 'none';

                artContainer.appendChild(iframe);

            } catch (error) {
                console.error("Erro:", error);
                artContainer.innerHTML = `
                    <div style="color:#dc3545; text-align:center; padding: 20px;">
                        <strong>Erro ao gerar PDF</strong><br>
                        <small>${error.message}</small>
                    </div>
                `;
            } finally {
                btnPreview.disabled = false;
            }
        });
    }

    // Auxiliares visuais
    function updateCanvasSize(tipo) {
        if (!artContainer) return;
        let w = '500px', h = '280px';
        const t = tipo.toLowerCase();

        if (t.includes('a4') || t.includes('timbrado')) { w = '420px'; h = '594px'; }
        else if (t.includes('bloco a5')) { w = '350px'; h = '495px'; }
        else if (t.includes('pasta')) { w = '440px'; h = '310px'; }
        else if (t.includes('retrato') || t.includes('gabinete')) { w = '300px'; h = '500px'; }
        else if (t.includes('paisagem') || t.includes('duplo')) { w = '600px'; h = '350px'; }

        artContainer.style.width = w;
        artContainer.style.height = h;
    }

    function resetPreviewArea() {
        if (artContainer) {
            artContainer.innerHTML = `
                <div style="text-align: center;">
                    <i class="fas fa-drafting-compass" style="font-size: 40px; color: #ddd; margin-bottom: 10px;"></i>
                    <p>Modelo alterado.<br>Preencha os campos e gere o preview.</p>
                </div>
            `;
        }
    }
});