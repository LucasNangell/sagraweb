const API_BASE_URL = `http://${window.location.hostname}:8001/api`;
let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
    checkLogin();
});

function checkLogin() {
    const savedPonto = localStorage.getItem('sagra_user_ponto');
    if (savedPonto) {
        currentUser = savedPonto;
        document.getElementById('login-overlay').style.display = 'none';
        updateHeaderUser();
        initGerencia();
    } else {
        window.location.href = 'index.html';
    }
}

function updateHeaderUser() {
    const el = document.getElementById('header-user-id');
    if (el) el.textContent = `ID: ${formatPonto(currentUser)}`;
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

    // Carregamento de todas as listas auxiliares
    await Promise.all([loadMaquinas(), loadProdutos(), loadPapeis(), loadCores(), loadCategorias()]);

    if (ano && id) {
        // MODO EDIÇÃO (OU PÓS-DUPLICAÇÃO)
        document.getElementById('gerencia-title').textContent = `Gerência de OS ${id}/${ano}`;
        await loadOSData(ano, id);
    } else {
        // MODO NOVA OS (Campos em branco)
        document.getElementById('gerencia-title').textContent = `Nova Ordem de Serviço`;
        clearForm(); // Garante que campos estejam limpos

        // Sugere o usuário atual como solicitante (opcional, melhora UX)
        // setValue('req_codigo', currentUser); 
    }

    setupButtons();
}

function clearForm() {
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        if (input.type === 'checkbox') input.checked = false;
        else input.value = '';
    });
}

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
        select.innerHTML = '<option value="">Selecione...</option>';
        data.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.Produto;
            opt.textContent = item.Produto;
            select.appendChild(opt);
        });
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

// NOVA FUNÇÃO: Busca papéis do backend
async function loadPapeis() {
    try {
        const response = await fetch(`${API_BASE_URL}/aux/papeis`);
        const data = await response.json();
        const select = document.getElementById('val_papel');
        select.innerHTML = '<option value="">Selecione...</option>';
        data.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.Papel; // Campo retornado pela API
            opt.textContent = item.Papel;
            select.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}

// NOVA FUNÇÃO: Busca cores do backend
async function loadCores() {
    try {
        const response = await fetch(`${API_BASE_URL}/aux/cores`);
        const data = await response.json();
        const select = document.getElementById('val_cores');
        select.innerHTML = '<option value="">Selecione...</option>';
        data.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.Cor; // Campo retornado pela API
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

        // --- SEÇÃO: DETALHES TÉCNICOS ---
        setValue('val_titulo', data.Titulo);
        setValue('val_produto', data.TipoPublicacaoLink);
        setValue('val_maquina', data.MaquinaLink);
        setValue('val_tiragem', data.Tiragem);
        setValue('val_pgs', data.Pags);
        setCheck('chk_fv', data.FrenteVerso);
        setValue('val_modelos', data.ModelosArq);

        // Prioridade carregada corretamente do EntregPrazoLink
        setValue('val_prioridade', data.EntregPrazoLink);
        setValue('val_data', formatDateForInput(data.EntregData));

        // Papel e Cores carregados dos novos mapeamentos
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

    } catch (e) {
        alert("Erro ao carregar dados da OS.");
        console.error(e);
    }
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
    // Implementações futuras
}