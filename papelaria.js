// papelaria.js - Lógica Dinâmica e Preview PDF (Iframe)

document.addEventListener('DOMContentLoaded', () => {
    console.log('Módulo Papelaria Dinâmico (PDF) Carregado');

    const API_BASE_URL = `http://${window.location.hostname}:8001/api`;
    let currentAno = null;
    let currentId = null;
    let initialSnapshot = null;

    // Elementos do DOM
    const selectTipo = document.getElementById('papelaria-tipo');
    const btnPreview = document.getElementById('btn-preview');
    const artContainer = document.getElementById('art-container');
    const formContainer = document.getElementById('dynamic-form-container');

    // 1. Carrega lista de modelos
    // 1. Inicializa Variáveis e Carrega lista de modelos
    const urlParams = new URLSearchParams(window.location.search);
    // Tenta pegar da URL ou de SessionStorage (como definido no script.js que salva 'sagra_target_product' mas não o ID explicitamente, mas script.js navega para papelaria.html?id=... geralmente não, ele vai direto. Vamos checar se o link do papelaria no index.html passa parâmetros. O clique no link-papelaria faz window.location.href='papelaria.html'. Então não tem query params!)
    // Precisamos pegar do sessionStorage que o script.js populou ou algo assim. 
    // script.js salva 'currentProduct'. E o ID? script.js tem currentId. 
    // Vamos assumir que, se não tem na URL, tentamos pegar de sessionStorage se salvamos lá.
    // Mas script.js só salvou produto? Vamos verificar script.js anterior.
    // Ele salvou 'sagra_target_product'.
    // Faltou salvar o ID da OS selecionada para a navegação funcionar plenamente?
    // Na verdade, a arquitetura da Papelaria parece meio solta. 
    // Vamos adicionar suporte a pegar ID/Ano se passados na URL, e se não, tentar sessionStorage.
    // Como não alteramos script.js para passar na URL, vamos depender de sessionStorage 'sagra_current_os_id' e 'sagra_current_os_ano' se existirem, ou o usuário deve ter navegado com parametros.
    // Vamos assumir que o usuário vai navegar via URL no futuro ou que implementamos isso.
    // Para garantir, no script.js eu deveria ter salvo o ID.
    // Mas OK, vamos implementar a lógica aqui.

    // Correção rápida: script.js checa ID > 5000 mas não passa na URL. 
    // A melhor prática seria que papelaria.js lesse de sessionStorage.
    currentAno = sessionStorage.getItem('sagra_current_os_ano');
    currentId = sessionStorage.getItem('sagra_current_os_id');

    loadModels();
    setupButtons(); // Hook buttons

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

            // Auto-seleção vinda da Dashboard
            const targetProduct = sessionStorage.getItem('sagra_target_product');
            if (targetProduct) {
                console.log("Tentando auto-selecionar produto:", targetProduct);
                const options = Array.from(selectTipo.options);

                // Função de Normalização
                const normalize = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const targetNorm = normalize(targetProduct);

                let matchId = null;

                // 1. Busca Exata
                const exact = options.find(o => o.text === targetProduct || o.value === targetProduct);
                if (exact) matchId = exact.value;

                // 2. Busca Normalizada
                if (!matchId) {
                    const normMatch = options.find(o => normalize(o.text) === targetNorm);
                    if (normMatch) matchId = normMatch.value;
                }

                // 3. Busca por Palavras-Chave (Robusta para Abreviações)
                if (!matchId) {
                    // Mapeamento manual de casos difíceis (Opcional, mas útil)
                    const mapManual = {
                        'cartao': 'ct', // Cartão -> Ct
                        'envelope': 'env',
                        'timbrado': 'timbrado'
                    };

                    // Divide o target em palavras (ex: 'cartao', 'de', 'visita')
                    const keywords = targetNorm.split(/\s+/).filter(k => k.length > 2); // ignora 'de', 'e'

                    matchId = options.find(o => {
                        const optNorm = normalize(o.text);
                        // Verifica se ALGUMA palavra-chave importante está contida no nome do modelo
                        return keywords.some(k => {
                            if (optNorm.includes(k)) return true;
                            // Check mapeamento (ex: se keyword é 'cartao', check se modelo tem 'ct')
                            if (mapManual[k] && optNorm.includes(mapManual[k])) return true;
                            return false;
                        });
                    })?.value;
                }

                if (matchId) {
                    $(selectTipo).val(matchId).trigger('change');
                    console.log(`Auto-selecionado (Algoritmo): ${targetProduct} -> ID ${matchId}`);
                } else {
                    console.warn(`Não foi possível encontrar correspondência para: ${targetProduct}`);
                }

                sessionStorage.removeItem('sagra_target_product');
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
    function setupButtons() {
        const btnCancel = document.getElementById('btn-cancel-os');
        if (btnCancel) {
            btnCancel.onclick = (e) => {
                e.preventDefault();
                if (confirm("Cancelar e voltar ao menu principal?")) {
                    window.location.href = 'index.html';
                }
            };
        }

        const btnSave = document.getElementById('btn-save-os');
        if (btnSave) {
            btnSave.onclick = (e) => {
                e.preventDefault();
                saveOSPapelaria();
            };
        }
    }

    async function saveOSPapelaria() {
        if (!currentId || !currentAno) {
            alert("Nenhuma OS selecionada para salvar. (ID ausente no SessionStorage)");
            return;
        }

        const tipo = $(selectTipo).val();
        if (!tipo) return alert("Selecione um Produto/Modelo.");

        // Coleta Dynamic Fields
        const inputs = document.querySelectorAll('.dynamic-input');
        const dados = {};
        inputs.forEach(inp => {
            const key = inp.dataset.key;
            if (key) dados[key] = inp.value;
        });

        // Formata para salvar no campo Observação (já que não temos colunas específicas no DB principal)
        // Ou salvamos como JSON string se couber. Vamos formatar texto legível.
        let obsTexto = "--- DADOS PAPELARIA ---\n";
        for (const [k, v] of Object.entries(dados)) {
            obsTexto += `${k}: ${v}\n`;
        }

        const payload = {
            NroProtocolo: parseInt(currentId),
            AnoProtocolo: parseInt(currentAno),
            TipoPublicacaoLink: tipo, // Salva o produto
            Observ: obsTexto, // Salva os dados preenchidos no campo OBS para registro
            // Campos obrigatórios mínimos para 'Update'
            NomeUsuario: "Manter", // Mock, backend deve ignorar se for update parcial? 
            // O backend 'save_os' faz UPDATE total. Se mandarmos campos null, ele pode zerar?
            // O backend verifica: if data.NomeUsuario ... 
            // O backend atual faz UPDATE setando TODOS os campos.
            // PERIGO: Se usarmos o endpoint /save comum, vamos sobrescrever tudo com NULL se não enviarmos.
            // Precisamos carregar os dados atuais primeiro?
            // Sim, loadOSData logic seria ideal. 
            // Como papelaria.js não tem loadOSData completo, vamos fazer um FETCH details primeiro, MERGEAR e depois SALVAR.
        };

        try {
            // 1. Fetch dados atuais para não perder info
            const resDet = await fetch(`${API_BASE_URL}/os/${currentAno}/${currentId}/details`);
            if (resDet.ok) {
                const currentData = await resDet.json();

                // Merge
                payload.CodigoRequisicao = currentData.CodigoRequisicao;
                payload.CategoriaLink = currentData.CategoriaLink;
                payload.NomeUsuario = currentData.NomeUsuario;
                payload.Titular = currentData.Titular;
                payload.SiglaOrgao = currentData.SiglaOrgao;
                payload.GabSalaUsuario = currentData.GabSalaUsuario;
                payload.Andar = currentData.Andar;
                payload.Localizacao = currentData.Localizacao;
                payload.RamalUsuario = currentData.RamalUsuario;
                payload.DataEntrada = formatDateForInput(currentData.DataEntrada);
                payload.ProcessoSolicit = currentData.ProcessoSolicit;
                payload.CSnro = currentData.CSnro;

                payload.Titulo = currentData.Titulo; // Mantém título original

                // Atualiza o que interessa
                payload.TipoPublicacaoLink = tipo;

                // Append na Obs existente em vez de substituir bruta
                const oldObs = currentData.Observ || "";
                if (!oldObs.includes("--- DADOS PAPELARIA ---")) {
                    payload.Observ = oldObs + "\n\n" + obsTexto;
                } else {
                    // Tenta substituir o bloco anterior? Complexo. Vamos apenas append se não tiver, ou substituir tudo é arriscado.
                    // Para simplificar: Substitui OBS pela nova gerada (Papelaria costuma ser controlada por aqui).
                    // Ou melhor: concatenar sempre.
                    payload.Observ = oldObs + "\n" + obsTexto;
                }

                // Envia Save
                const resSave = await fetch(`${API_BASE_URL}/os/save`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const dataSave = await resSave.json();
                if (dataSave.status === 'ok') {
                    alert('Papelaria salva com sucesso!');
                    window.location.href = 'index.html';
                } else {
                    alert('Erro ao salvar: ' + dataSave.message);
                }

            } else {
                alert("Erro ao buscar dados originais da OS para merge.");
            }
        } catch (e) {
            console.error(e);
            alert("Erro de comunicação.");
        }
    }

    function formatDateForInput(d) {
        if (!d) return null;
        const date = new Date(d);
        if (isNaN(date)) return null;
        return date.toISOString().split('T')[0];
    }

});