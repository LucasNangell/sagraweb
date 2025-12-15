const API_BASE_URL = `http://${window.location.hostname}:8001/api`;
let currentUser = null;
let initialSnapshot = null; // Snapshot para o botão Cancelar

document.addEventListener('DOMContentLoaded', () => {
    initGerencia();
});

function updateHeaderUser() {
    const el = document.getElementById('header-user-id');
    // Mock user for display since authentication is removed
    if (el) el.textContent = `ID: WebUser`;
}

function formatPonto(val) {
    if (!val) return '';
    let v = val.toString().replace(/\D/g, '');
    return v.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function initGerencia() {
    const urlParams = new URLSearchParams(window.location.search);
    const ano = urlParams.get('ano');
    const id = urlParams.get('id');
    const modo = urlParams.get('modo'); // Detectar modo 'detalhes'

    setupButtons(); // Inicializa botões imediatamente

    // Carregamento de todas as listas auxiliares
    await Promise.all([loadMaquinas(), loadProdutos(), loadPapeis(), loadCores(), loadCategorias()]);

    if (ano && id) {
        // MODO EDIÇÃO ou DETALHES
        if (modo === 'detalhes') {
            document.getElementById('gerencia-title').textContent = `Detalhes da OS ${id}/${ano} (Somente Leitura)`;
        } else {
            document.getElementById('gerencia-title').textContent = `Gerenciamento da OS ${id}/${ano}`;
        }
        await loadOSData(ano, id);
        
        // Se modo detalhes, aplicar bloqueio
        if (modo === 'detalhes') {
            applyReadOnlyMode();
        }
    } else {
        // MODO NOVA OS
        document.getElementById('gerencia-title').textContent = `Nova Ordem de Serviço`;
        clearForm();

        // Data de hoje como padrão para entrada
        const today = new Date().toISOString().split('T')[0];
        setValue('op_data_entrada', today);
    }

    setupButtons();

    // Salva snapshot inicial após carregar tudo (pequeno delay para garantir inputs preenchidos)
    setTimeout(() => {
        setupButtons();
        setupCalculators(); // Inicializa listeners de cálculo

        // Salva snapshot inicial após carregar tudo (pequeno delay para garantir inputs preenchidos)
        console.log("Snapshot inicial salvo.", initialSnapshot);
    }, 600);
}

// Coleta estado atual de todos os inputs (para Snapshot apenas, não confundir com Payload de Save)
function collectSnapshot() {
    const state = {};
    document.querySelectorAll('input, select, textarea').forEach(el => {
        if (el.id) {
            state[el.id] = (el.type === 'checkbox') ? el.checked : el.value;
        }
    });
    return state;
}

function restoreSnapshot() {
    if (!initialSnapshot) return;
    for (const [id, val] of Object.entries(initialSnapshot)) {
        const el = document.getElementById(id);
        if (el) {
            if (el.type === 'checkbox') el.checked = val;
            else el.value = val;
        }
    }
}

function clearForm() {
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        if (input.type === 'checkbox') input.checked = false;
        else input.value = '';
    });
}

// --- Funções de Carregamento de Listas (Mantidas) ---

async function loadMaquinas() {
    try {
        const response = await fetch(`${API_BASE_URL}/aux/maquinas`);
        const data = await response.json();
        const select = document.getElementById('val_maquina');
        select.innerHTML = '<option value="">Selecione...</option>';
        data.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.MaquinaLink;
            opt.textContent = item.MaquinaLink;
            select.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}

async function loadProdutos() {
    try {
        const response = await fetch(`${API_BASE_URL}/aux/produtos`);
        const data = await response.json();
        const select = document.getElementById('val_produto');
        if (select) {
            select.innerHTML = '<option value="">Selecione...</option>';
            data.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.Produto;
                opt.textContent = item.Produto;
                select.appendChild(opt);
            });
        }
    } catch (e) { console.error(e); }
}

async function loadCategorias() {
    try {
        const response = await fetch(`${API_BASE_URL}/aux/categorias`);
        const data = await response.json();
        const select = document.getElementById('req_categoria');
        select.innerHTML = '<option value="">Selecione...</option>';
        data.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.Categoria;
            opt.textContent = item.Categoria;
            select.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}

async function loadPapeis() {
    try {
        const response = await fetch(`${API_BASE_URL}/aux/papeis`);
        const data = await response.json();
        const select = document.getElementById('val_papel');
        select.innerHTML = '<option value="">Selecione...</option>';
        data.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.Papel;
            opt.textContent = item.Papel;
            select.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}

async function loadCores() {
    try {
        const response = await fetch(`${API_BASE_URL}/aux/cores`);
        const data = await response.json();
        const select = document.getElementById('val_cores');
        select.innerHTML = '<option value="">Selecione...</option>';
        data.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.Cor;
            opt.textContent = item.Cor;
            select.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}

async function loadOSData(ano, id) {
    try {
        const response = await fetch(`${API_BASE_URL}/os/${ano}/${id}/details`);
        if (!response.ok) throw new Error("Erro ao buscar dados");
        const data = await response.json();

        // --- SEÇÃO: SOLICITANTE ---
        setValue('req_codigo', data.CodigoRequisicao);
        setValue('req_categoria', data.CategoriaLink);
        setValue('req_solicitante', data.NomeUsuario);
        setValue('req_titular', data.Titular);
        setValue('req_sigla', data.SiglaOrgao);
        setValue('req_gabinete', data.GabSalaUsuario);
        setValue('req_andar', data.Andar);
        setValue('req_local', data.Localizacao);
        setValue('req_ramal', data.RamalUsuario);

        // --- SEÇÃO: ORDEM DE PRODUÇÃO ---
        setValue('op_os', data.NroProtocolo);
        setValue('op_ano', data.AnoProtocolo);
        setValue('op_data_entrada', formatDateForInput(data.DataEntrada));
        setValue('op_processo', data.ProcessoSolicit);
        setValue('op_cs', data.CSnro);
        setValue('op_tiragem_pret', data.TiragemSolicitada);
        setValue('op_tiragem_final', data.TiragemFinal);

        // Novos campos adicionados ao layout
        setValue('val_titulo', data.Titulo);

        // --- SEÇÃO: DETALHES TÉCNICOS ---
        setValue('val_produto', data.TipoPublicacaoLink);
        setValue('val_maquina', data.MaquinaLink);
        setValue('val_tiragem', data.Tiragem);
        setValue('val_pgs', data.Pags);
        setCheck('chk_fv', data.FrenteVerso);
        setValue('val_modelos', data.ModelosArq);

        setValue('val_prioridade', data.EntregPrazoLink);
        setValue('val_data', formatDateForInput(data.EntregData));

        setValue('val_papel', data.PapelLink);
        setValue('txt_papel_desc', data.PapelDescricao);
        setValue('val_cores', data.Cores);
        setValue('txt_cores_desc', data.CoresDescricao);

        setValue('txt_acabamento', data.DescAcabamento);
        setValue('txt_obs', data.Observ);
        setValue('txt_contato', data.ContatoTrab);

        // --- SEÇÃO: MATERIAL ENTREGUE ---
        setCheck('mat_amostra', data.MaterialFornecido);
        setCheck('mat_fotolito', data.Fotolito);
        setCheck('mat_dobra', data.ModeloDobra);
        setCheck('mat_original', data.ProvaImpressa);
        setValue('mat_insumos', data.InsumosFornecidos);

        // --- SEÇÃO: ELEMENTOS GRÁFICOS ---
        setCheck('el_brasao', data.ElemGrafBrasao);
        setCheck('el_timbre', data.ElemGrafTimbre);
        setCheck('el_arte', data.ElemGrafArteGab);
        setCheck('el_assinatura', data.ElemGrafAssinatura);

        // --- CÁLCULOS ---
        if (data.Calculos) {
            setValue('calc_capa_color', data.Calculos.capa_color);
            setValue('calc_capa_pb', data.Calculos.capa_pb);
            setValue('calc_miolo_color', data.Calculos.miolo_color);
            setValue('calc_miolo_pb', data.Calculos.miolo_pb);
            setValue('calc_altura', data.Calculos.altura_mm);
            setValue('calc_largura', data.Calculos.largura_mm);
            setValue('calc_tiragem', data.Calculos.tiragem);
            // Recalcula visualmente baseado nos valores carregados
            recalculateAll();
        } else {
            // Se não houver cálculos salvos, força sincronização inicial
            const tiragemVal = document.getElementById('val_tiragem').value;
            if (tiragemVal) setValue('calc_tiragem', tiragemVal);
            recalculateAll();
        }

    } catch (e) {
        alert("Erro ao carregar dados da OS.");
        console.error(e);
    }

    // --- AUTO-BUSCA DEPUTADO AO CARREGAR ---
    setTimeout(() => {
        // Garante sync final
        const tTec = document.getElementById('val_tiragem');
        const tCalc = document.getElementById('calc_tiragem');
        if (tTec && tCalc && tTec.value && (!tCalc.value || tCalc.value == '0')) {
            tCalc.value = tTec.value;
            recalculateAll();
        }

        const cat = document.getElementById('req_categoria').value;
        const sol = document.getElementById('req_solicitante').value;

        // Se for Deputado e tiver nome, busca SEMPRE (para garantir a foto)
        if (cat === 'Deputado' && sol && sol.length >= 3) {
            console.log("Acionando busca automática de deputado (Prioridade Foto)...");
            fetchDeputado(sol);
        }
    }, 500);
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = (val !== null && val !== undefined) ? val : '';
}

function setCheck(id, val) {
    const el = document.getElementById(id);
    if (el) {
        if (typeof val === 'string') {
            val = val.toLowerCase().trim();
            el.checked = (val === '1' || val === 'true' || val === 'sim' || val === 's');
        } else {
            el.checked = (val == 1 || val === true);
        }
    }
}

function formatDateForInput(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date)) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function setupButtons() {
    // Botão Cancelar
    const btnCancel = document.getElementById('btn-cancel-os');
    if (btnCancel) {
        // Usa onclick para evitar múltiplos listeners em caso de re-execução
        btnCancel.onclick = (e) => {
            e.preventDefault();
            if (confirm("Tem certeza? Isso desfará todas as alterações.")) {
                restoreSnapshot();
                window.location.href = 'index.html';
            }
        };
    }

    // Botão Salvar
    const btnSave = document.getElementById('btn-save-os');
    if (btnSave) {
        btnSave.onclick = (e) => {
            e.preventDefault();
            saveOS();
        };
    }
}

// --- LÓGICA DE SALVAR ---
function collectAllFields() {
    // Mapeia IDs do HTML para os campos esperados pelo Backend (SaveOSRequest)
    // IDs devem corresponder ao que é carregado em loadOSData

    // Helper
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
    const chk = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

    // Recupera dados básicos da URL se for Edição
    const urlParams = new URLSearchParams(window.location.search);
    const anoURL = urlParams.get('ano');
    const idURL = urlParams.get('id');
    const isEdit = (anoURL && idURL && !urlParams.get('action')); // Se tiver action=duplicate, não é edit 'puro' de ID

    // Helper for numeric fields
    const num = (id) => { const v = val(id); return (v === '' || v === null) ? 0 : v; };

    return {
        // Identificação
        NroProtocolo: isEdit ? parseInt(idURL) : null,
        AnoProtocolo: isEdit ? parseInt(anoURL) : null,

        // Dados Principais
        CodigoRequisicao: val('req_codigo'),
        CategoriaLink: val('req_categoria'),
        NomeUsuario: val('req_solicitante'),
        Titular: val('req_titular'),
        SiglaOrgao: val('req_sigla'),
        GabSalaUsuario: val('req_gabinete'),
        Andar: val('req_andar'),
        Localizacao: val('req_local'),
        RamalUsuario: val('req_ramal'),

        DataEntrada: val('op_data_entrada'),
        ProcessoSolicit: val('op_processo'),
        CSnro: val('op_cs'),
        TiragemSolicitada: val('op_tiragem_pret'),
        TiragemFinal: val('op_tiragem_final'),

        // Detalhes
        Titulo: val('val_titulo'),
        TipoPublicacaoLink: val('val_produto'),
        MaquinaLink: val('val_maquina'),
        Tiragem: val('val_tiragem'),
        Pags: val('val_pgs'),
        FrenteVerso: chk('chk_fv'),
        ModelosArq: val('val_modelos'),

        EntregPrazoLink: val('val_prioridade'),
        EntregData: val('val_data'), // input date YYYY-MM-DD

        PapelLink: val('val_papel'),
        PapelDescricao: val('txt_papel_desc'),
        Cores: val('val_cores'),
        CoresDescricao: val('txt_cores_desc'),

        DescAcabamento: val('txt_acabamento'),
        Observ: val('txt_obs'),
        ContatoTrab: val('txt_contato'),

        // Material
        MaterialFornecido: chk('mat_amostra'),
        Fotolito: chk('mat_fotolito'),
        ModeloDobra: chk('mat_dobra'),
        ProvaImpressa: chk('mat_original'),
        InsumosFornecidos: val('mat_insumos'),

        // Elementos
        ElemGrafBrasao: chk('el_brasao'),
        ElemGrafTimbre: chk('el_timbre'),
        ElemGrafArteGab: chk('el_arte'),
        ElemGrafAssinatura: chk('el_assinatura'),

        // CÁLCULOS
        Calculos: {
            capa_color: num('calc_capa_color'),
            capa_pb: num('calc_capa_pb'),
            miolo_color: num('calc_miolo_color'),
            miolo_pb: num('calc_miolo_pb'),
            altura_mm: num('calc_altura'),
            largura_mm: num('calc_largura'),
            tiragem: num('calc_tiragem'),
            coef_a4: num('calc_coef_a4'),
            total_paginas: num('calc_total_paginas'),
            cota_total: num('calc_cota_total')
        },

        // Usuário Atual
        PontoUsuario: currentUser
    };
}

async function saveOS() {
    const payload = collectAllFields();

    // Validação básica
    if (!payload.TipoPublicacaoLink) return alert("Selecione um Produto.");
    if (!payload.Titulo) return alert("Informe o Título.");
    if (!payload.NomeUsuario) return alert("Informe o Solicitante.");

    document.body.style.cursor = 'wait';

    try {
        const result = await fetch(`${API_BASE_URL}/os/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const text = await result.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (err) {
            console.error("JSON Parse Error:", text);
            throw new Error("Resposta inválida do servidor: " + text.substring(0, 100));
        }

        if (result.ok && data.status === "ok") {
            alert(`OS salva com sucesso! (OS: ${data.id}/${data.ano})`);
            window.location.href = "index.html";
        } else {
            const msg = (typeof data.detail === 'object') ? JSON.stringify(data.detail) : (data.detail || data.message || "Erro desconhecido");
            alert("Erro ao salvar OS: " + msg);
            console.error("Save Error:", data);
        }
    } catch (e) {
        console.error(e);
        alert("Erro de comunicação: " + e.message);
    } finally {
        document.body.style.cursor = 'default';
    }
}

// --- INTEGRAÇÃO DEPUTADOS ---
let lastDepSearch = "";

async function fetchDeputado(nome) {
    // Feedback visual discreto (cursor loading)
    document.body.style.cursor = 'wait';

    try {
        const encodedName = encodeURIComponent(nome);
        const res = await fetch(`${API_BASE_URL}/aux/deputado/buscar?nome=${encodedName}`);

        if (!res.ok) throw new Error("Erro API");

        const data = await res.json();

        if (data && data.nome) {
            // Preenche campos APENAS SE ESTIVEREM VAZIOS (preserva edição manual)
            const gabInput = document.getElementById('req_gabinete');
            const andInput = document.getElementById('req_andar');
            const ramInput = document.getElementById('req_ramal');
            const locInput = document.getElementById('req_local');

            if (data.gabinete && !gabInput.value) gabInput.value = data.gabinete;
            if (data.andar && !andInput.value) andInput.value = data.andar;
            if (data.ramal && !ramInput.value) ramInput.value = data.ramal;
            // Local geralmente é fixo "Câmara dos Deputados", mas se vier diferente...
            if (data.local && !locInput.value) locInput.value = data.local;

            // Foto - SEMPRE atualiza se disponível
            if (data.foto) {
                const avatarDiv = document.getElementById('avatar-initials');
                if (avatarDiv) {
                    // Limpa iniciais
                    avatarDiv.innerHTML = '';
                    avatarDiv.style.background = 'none';

                    // Cria Imagem
                    const img = document.createElement('img');
                    img.src = data.foto;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = '50%';
                    avatarDiv.appendChild(img);
                }
            }
        } else {
            console.log("Deputado não encontrado"); // Console apenas
        }

    } catch (e) {
        console.error("Erro buscando deputado:", e);
    } finally {
        document.body.style.cursor = 'default';
    }
}

function checkAndSearch() {
    const catSelect = document.getElementById('req_categoria');
    const solInput = document.getElementById('req_solicitante');
    if (!catSelect || !solInput) return;

    const cat = catSelect.value;
    const nome = solInput.value.trim();

    if (cat === "Deputado" && nome.length >= 3) {
        if (nome.toLowerCase() === lastDepSearch.toLowerCase()) return;
        lastDepSearch = nome;
        console.log("Busca auto deputado:", nome);
        fetchDeputado(nome);
    }
}

// --- LÓGICA DE CÁLCULOS ---
function setupCalculators() {
    const inputs = document.querySelectorAll('.calc-input');
    inputs.forEach(input => {
        ['input', 'change', 'keyup', 'paste', 'blur'].forEach(evt => {
            input.addEventListener(evt, recalculateAll);
        });
    });

    // Sincroniza Tiragem Técnica -> Tiragem Cálculo
    const tiragemTecnica = document.getElementById('val_tiragem');
    if (tiragemTecnica) {
        tiragemTecnica.addEventListener('input', () => {
            setValue('calc_tiragem', tiragemTecnica.value);
            recalculateAll();
        });
    }

    // Recalcular se a categoria mudar (pois afeta a Cota)
    const catSelect = document.getElementById('req_categoria');
    if (catSelect) {
        catSelect.addEventListener('change', recalculateAll);
    }
}

function recalculateAll() {
    // 1. Coleta valores (com defaults 0)
    const getVal = (id) => parseFloat(document.getElementById(id).value) || 0;

    const capaColor = getVal('calc_capa_color');
    const capaPb = getVal('calc_capa_pb');
    const mioloColor = getVal('calc_miolo_color');
    const mioloPb = getVal('calc_miolo_pb');

    const altura = getVal('calc_altura');
    const largura = getVal('calc_largura');
    const tiragem = getVal('calc_tiragem');

    // 2. Total Páginas
    const totalPaginas = capaColor + capaPb + mioloColor + mioloPb;
    const elTotal = document.getElementById('calc_total_paginas');
    if (elTotal) elTotal.value = totalPaginas;

    // 3. Coeficiente A4 (Area Ratio)
    // Nova regra: Exibir 3 casas decimais. Sem floor.

    let coefA4 = 0;
    if (altura > 0 && largura > 0) {
        // Cálculo da razão de área
        // (Altura * Largura) / (297 * 210)
        coefA4 = (altura * largura) / (297 * 210);
    }
    const elCoef = document.getElementById('calc_coef_a4');
    if (elCoef) elCoef.value = coefA4.toFixed(3);

    // 4. Cota Estimada
    // Se Categoria == 'Deputado' -> (PagsColor * 4) + (PagsPB * 1)
    // Se Outros -> (PagsColor * 1) + (PagsPB * 1)
    // Multiplicado pela Tiragem

    const catSelect = document.getElementById('req_categoria');
    const categoria = catSelect ? catSelect.value : '';
    const isDeputado = (categoria === 'Deputado');

    const totalColor = capaColor + mioloColor;
    const totalPb = capaPb + mioloPb;

    let cotaPorExemplar = 0;
    if (isDeputado) {
        cotaPorExemplar = (totalColor * 4) + (totalPb * 1);
    } else {
        cotaPorExemplar = (totalColor * 1) + (totalPb * 1);
    }

    const cotaTotal = cotaPorExemplar * tiragem * coefA4;

    const elCota = document.getElementById('calc_cota_total');
    if (elCota) elCota.value = cotaTotal.toFixed(2);
}

/**
 * Aplica modo somente leitura em toda a página
 * Desabilita todos os campos e oculta botões de ação
 */
function applyReadOnlyMode() {
    console.log('[Gerencia] Aplicando modo somente leitura...');
    
    // 1. Desabilitar todos os inputs de texto
    const inputs = document.querySelectorAll('input[type="text"], input[type="date"], input[type="number"], textarea');
    inputs.forEach(input => {
        input.setAttribute('readonly', 'readonly');
        input.style.backgroundColor = '#f5f5f5';
        input.style.cursor = 'not-allowed';
    });
    
    // 2. Desabilitar todos os selects
    const selects = document.querySelectorAll('select');
    selects.forEach(select => {
        select.setAttribute('disabled', 'disabled');
        select.style.backgroundColor = '#f5f5f5';
        select.style.cursor = 'not-allowed';
    });
    
    // 3. Ocultar botões de ação (Salvar e Cancelar)
    const btnSave = document.getElementById('btn-save-os');
    const btnCancel = document.getElementById('btn-cancel-os');
    
    if (btnSave) btnSave.style.display = 'none';
    if (btnCancel) {
        // Transformar botão cancelar em "Voltar"
        btnCancel.innerHTML = '<i class="fas fa-arrow-left"></i> Voltar';
        btnCancel.className = 'btn-action btn-secondary';
        btnCancel.onclick = () => window.location.href = 'index.html';
    }
    
    // 4. Desabilitar Select2 (se existir)
    if (typeof $ !== 'undefined' && $.fn.select2) {
        $('.select2-hidden-accessible').each(function() {
            $(this).select2('destroy');
            $(this).prop('disabled', true);
        });
    }
    
    console.log('[Gerencia] Modo somente leitura aplicado com sucesso');
}


document.addEventListener('DOMContentLoaded', () => {
    const catSelect = document.getElementById('req_categoria');
    const solInput = document.getElementById('req_solicitante');

    if (catSelect && solInput) {
        catSelect.addEventListener('change', checkAndSearch);
        solInput.addEventListener('blur', checkAndSearch);
    }
});