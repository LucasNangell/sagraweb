// analise.js - Versão Real-time Persistence & UI Standard (Safe Mode)
const API_BASE_URL = `http://${window.location.hostname || 'localhost'}:8001/api`;
let currentOs = null;
let currentAno = null;
let currentAnalysisId = null;
let libraryData = [];
let selectedItems = [];
let currentUser = localStorage.getItem('sagra_user_ponto') || 'Desconhecido';
let versionPaths = {};

console.log("analise.js: Carregando script...");

document.addEventListener('DOMContentLoaded', () => {
    checkLogin();

    const urlParams = new URLSearchParams(window.location.search);
    currentOs = urlParams.get('id');
    currentAno = urlParams.get('ano');

    if (currentOs && currentAno) {
        console.log(`Carregando Análise para OS: ${currentOs}/${currentAno}`);
        document.getElementById('anl-os-full').value = `${currentOs}/${currentAno}`;
        fetchOsTitle(currentAno, currentOs);
        fetchVersions(currentAno, currentOs);
        initAnalysis();
    } else {
        alert("Nenhuma OS identificada.");
    }

    loadLibrary();
    document.getElementById('search-library').addEventListener('input', filterLibrary);

    const btnSave = document.getElementById('btn-save-analise');
    if (btnSave) {
        btnSave.textContent = "Concluir";
        btnSave.onclick = () => {
            alert("Análise salva automaticamente.");
            window.location.href = 'index.html';
        };
    }

    document.getElementById('anl-versao').addEventListener('change', (e) => {
        if (e.target.value) updateAnalysisHeader();
    });

    updateHeaderUser();
});

// --- GLOBAL FUNCTIONS (Assigned immediately to window) ---

window.searchLibrary = filterLibrary; // Helper

window.startAnnotation = function (uniqueId, event) {
    alert("TRACE 1: Start. ID=" + uniqueId);
    if (event) {
        event.preventDefault(); // Prevent submit
        event.stopPropagation();
    }

    try {
        currentAnnotationItem = selectedItems.find(x => x.uniqueId == uniqueId);
        if (!currentAnnotationItem) {
            alert("TRACE 2: Item FAIL");
            return;
        }
        alert("TRACE 2: Item OK");

        const versaoSelect = document.getElementById('anl-versao');
        const versaoKey = versaoSelect ? versaoSelect.value : null;
        let path = versionPaths[versaoKey];

        alert("TRACE 3: Key=" + versaoKey + " Path=" + path);

        if (!path) {
            alert("TRACE 4: Path FAIL");
            return;
        }

        alert("TRACE 5: Calling openFileSelectionModal");
        openFileSelectionModal(path);
    } catch (e) {
        alert("TRACE ERROR: " + e.message);
        console.error(e);
    }
};

window.removeItem = async function (uniqueId, event) {
    if (event) event.stopPropagation();
    if (!confirm("Remover item?")) return;
    try {
        const res = await fetch(`${API_BASE_URL}/analise/item/${uniqueId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error("Erro delete");
        selectedItems = selectedItems.filter(x => x.uniqueId !== uniqueId);
        renderSelectedList();
        document.getElementById('preview-container').innerHTML = '';
    } catch (e) { alert("Erro ao remover: " + e.message); }
};

window.updateObs = function (uniqueId, value) {
    const item = selectedItems.find(x => x.uniqueId === uniqueId);
    if (item) {
        item.obs = value;
        renderPreview(item);
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => silentUpdateItem(uniqueId, { obs: value }), 1000);
    }
};

window.updateHtmlContent = function (uniqueId) {
    const editableDiv = document.getElementById('editable-html-area');
    const item = selectedItems.find(x => x.uniqueId === uniqueId);
    if (item) {
        const newHtml = editableDiv.innerHTML;
        item.html = newHtml;
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => silentUpdateItem(uniqueId, { html_snapshot: newHtml }), 1000);
    }
};

window.closePreviewModal = function () {
    document.getElementById('preview-modal').style.display = 'none';
};

window.closeFileSelectionModal = function () {
    document.getElementById('file-selection-modal').style.display = 'none';
};

window.confirmFileSelection = function () {
    const filePath = document.getElementById('file-select-list').value;
    const pageNum = parseInt(document.getElementById('file-page-number').value) || 1;
    if (!filePath) return;
    window.closeFileSelectionModal();
    openAnnotationEditor(filePath, pageNum);
};

window.closeAnnotationModal = function () {
    document.getElementById('annotation-modal').style.display = 'none';
    if (fabricCanvas) { fabricCanvas.dispose(); fabricCanvas = null; }
};

window.setDrawMode = function (mode) {
    if (!fabricCanvas) return;
    if (mode === 'rect') {
        fabricCanvas.add(new fabric.Rect({
            left: 100, top: 100, fill: 'transparent',
            stroke: currentAnnotationColor, strokeWidth: 3, width: 100, height: 100
        }));
    } else if (mode === 'arrow') {
        const triangle = new fabric.Triangle({
            width: 15, height: 15, fill: currentAnnotationColor, left: 235, top: 65, angle: 90
        });
        const line = new fabric.Line([50, 100, 200, 100], { stroke: currentAnnotationColor, strokeWidth: 3 });
        fabricCanvas.add(new fabric.Group([line, triangle]));
    } else if (mode === 'text') {
        fabricCanvas.add(new fabric.IText('Obs', { left: 100, top: 100, fill: currentAnnotationColor, fontSize: 30 }));
    }
};

window.setAnnotationColor = function (color) {
    currentAnnotationColor = color;
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
        if (active.type === 'i-text') active.set('fill', color);
        else active.set('stroke', color);
        fabricCanvas.requestRenderAll();
    }
};

window.deleteActiveObject = function () {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) fabricCanvas.remove(active);
};

window.saveAnnotationCavas = function () {
    if (!fabricCanvas) return;
    const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 0.5 });
    if (currentAnnotationItem) {
        const htmlInjection = `<h3>Indicação do problema no arquivo</h3><img src="${dataUrl}" style="max-width:100%; border:1px solid #ccc; margin-top:10px;"><br>`;
        const newHtml = (currentAnnotationItem.html || '') + htmlInjection;
        currentAnnotationItem.html = newHtml;
        renderPreview(currentAnnotationItem);
        silentUpdateItem(currentAnnotationItem.uniqueId, { html_snapshot: newHtml });
    }
    window.closeAnnotationModal();
};

window.onclick = function (event) {
    const modal = document.getElementById('preview-modal');
    if (event.target == modal) modal.style.display = "none";
};

// --- HELPERS ---
function checkLogin() {
    const saved = localStorage.getItem('sagra_user_ponto');
    if (!saved) {
        alert("Sessão expirada.");
        window.location.href = 'index.html';
        return;
    }
    currentUser = saved;
}

function updateHeaderUser() {
    const el = document.getElementById('header-user-id');
    if (el) el.textContent = `ID: ${currentUser}`;
}

async function fetchVersions(ano, id) {
    const select = document.getElementById('anl-versao');
    select.innerHTML = '<option>Carregando...</option>';
    try {
        const res = await fetch(`${API_BASE_URL}/os/${ano}/${id}/versions`);
        if (res.ok) {
            const data = await res.json();
            select.innerHTML = '';
            versionPaths = {};
            if (data.versions && data.versions.length > 0) {
                data.versions.forEach(v => {
                    const val = `v${v.version}`;
                    versionPaths[val] = v.path;
                    const opt = document.createElement('option');
                    opt.value = val;
                    opt.textContent = `${v.version}`;
                    select.appendChild(opt);
                });
                select.value = `v${data.versions.length}`;
            } else {
                select.innerHTML = '<option value="">Nenhuma pasta "Original"</option>';
            }
        } else { select.innerHTML = '<option value="">Erro buscar versões</option>'; }
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">Erro conexão</option>';
    }
}

async function fetchOsTitle(ano, id) {
    try {
        const res = await fetch(`${API_BASE_URL}/os/${ano}/${id}/details`);
        if (res.ok) {
            const data = await res.json();
            document.getElementById('anl-titulo').value = data.Titulo || 'Sem Título';
        }
    } catch (e) { console.error(e); }
}

async function initAnalysis() {
    try {
        const res = await fetch(`${API_BASE_URL}/analise/ensure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nro_os: parseInt(currentOs),
                ano_os: parseInt(currentAno),
                usuario: currentUser
            })
        });
        const data = await res.json();
        currentAnalysisId = data.id;
        await loadExistingItems();
    } catch (e) { console.error("Erro init analysis:", e); }
}

async function loadExistingItems() {
    try {
        const res = await fetch(`${API_BASE_URL}/analise/${currentAno}/${currentOs}/full`);
        const data = await res.json();
        if (data.exists && data.items) {
            selectedItems = data.items;
            renderSelectedList();
            if (data.versao) document.getElementById('anl-versao').value = data.versao;
            if (data.componente) document.getElementById('anl-componente').value = data.componente;
        }
    } catch (e) { console.error(e); }
}

async function updateAnalysisHeader() { }

async function loadLibrary() {
    const container = document.getElementById('library-list');
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
    try {
        const res = await fetch(`${API_BASE_URL}/analise/problemas-padrao`);
        if (!res.ok) throw new Error("Erro servidor");
        libraryData = await res.json();
        renderLibrary(libraryData);
    } catch (e) {
        container.innerHTML = '<div class="empty-state" style="color:red;">Erro biblioteca</div>';
    }
}

function renderLibrary(data) {
    const container = document.getElementById('library-list');
    container.innerHTML = '';
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-state">Biblioteca vazia</div>';
        return;
    }
    data.sort((a, b) => (a.TituloPT || "").localeCompare(b.TituloPT || ""));
    data.forEach(item => {
        const el = document.createElement('div');
        el.className = 'library-item';
        el.innerHTML = `<span>${item.TituloPT}</span><i class="fas fa-plus-circle"></i>`;
        el.onclick = () => addItemToAnalysis(item);
        container.appendChild(el);
    });
}

function filterLibrary() {
    const term = document.getElementById('search-library').value.toLowerCase();
    const filtered = libraryData.filter(item => (item.TituloPT || "").toLowerCase().includes(term));
    renderLibrary(filtered);
}

async function addItemToAnalysis(item) {
    if (!currentAnalysisId) { alert("Aguarde carregamento."); return; }
    const comp = document.getElementById('anl-componente').value || 'Geral';
    try {
        const res = await fetch(`${API_BASE_URL}/analise/item/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_analise: currentAnalysisId,
                id_padrao: item.ID,
                componente: comp,
                obs: '',
                html_snapshot: item.ProbTecHTML
            })
        });
        const data = await res.json();
        const instance = {
            uniqueId: data.id,
            originalId: item.ID,
            titulo: item.TituloPT,
            html: item.ProbTecHTML,
            obs: '',
            componenteOrigem: comp
        };
        selectedItems.push(instance);
        renderSelectedList();
        window.selectItem(instance.uniqueId); // Use global
    } catch (e) { alert("Erro ao adicionar: " + e.message); }
}

function renderSelectedList() {
    const container = document.getElementById('selected-list');
    const counter = document.getElementById('count-items');
    if (counter) counter.textContent = `${selectedItems.length} itens`;
    container.innerHTML = '';

    if (selectedItems.length === 0) {
        container.innerHTML = '<div class="empty-state">Selecione erros na biblioteca.</div>';
        return;
    }

    const groups = {};
    selectedItems.forEach(item => {
        const groupName = item.componenteOrigem || 'Outros';
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(item);
    });

    Object.keys(groups).forEach(groupName => {
        const header = document.createElement('div');
        header.className = 'cat-header';
        header.textContent = groupName.toUpperCase();
        header.style.marginTop = '10px';
        container.appendChild(header);

        groups[groupName].forEach(item => {
            const el = document.createElement('div');
            el.className = 'selected-item';
            el.dataset.id = item.uniqueId;
            el.innerHTML = `
            <div class="item-header" onclick="selectItem(${item.uniqueId})">
                <div class="item-title">${item.titulo}</div>
                <button class="icon-btn" style="color:#d9534f;" onclick="removeItem(${item.uniqueId}, event)">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
            <div class="item-obs-area">
                <label style="font-size:10px; font-weight:bold; color:#666;">Observação</label>
                <textarea class="form-control" rows="2" oninput="updateObs(${item.uniqueId}, this.value)">${item.obs || ''}</textarea>
            </div>`;
            container.appendChild(el);
        });
    });
}

// Make selectItem global too
window.selectItem = function (uniqueId) {
    document.querySelectorAll('.selected-item').forEach(el => el.classList.remove('active'));
    const el = document.querySelector(`.selected-item[data-id="${uniqueId}"]`);
    if (el) el.classList.add('active');
    const item = selectedItems.find(x => x.uniqueId === uniqueId);
    if (item) renderPreview(item);
};

// --- UPDATES & ANNOTATION ---
let updateTimeout = null;
async function silentUpdateItem(uniqueId, fields) {
    try {
        await fetch(`${API_BASE_URL}/analise/item/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_item: uniqueId, ...fields })
        });
    } catch (e) { console.error("Erro salvando item:", e); }
}

function renderPreview(item) {
    const container = document.getElementById('preview-container');
    let htmlContent = item.html || '<p style="color:#999; font-style:italic;">(Sem conteúdo)</p>';
    container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding:5px 5px 0px 5px; margin-bottom:10px; color:#999; font-size:0.8rem;">
                <span style="font-weight:bold;">SIMULAÇÃO (${item.componenteOrigem || 'Geral'})</span>
                <button type="button" onclick="alert('DEBUG: Click detectado!'); window.startAnnotation('${item.uniqueId}', event)" class="btn-action" style="padding: 2px 8px; width: auto !important; font-size: 0.75rem; line-height: 1.2; height: auto; min-height: 24px; background-color: var(--primary-green); color: white; border-radius: 4px; border:none; cursor:pointer;">
                    <i class="fas fa-pen-to-square"></i> Indicar no Arquivo
                </button>
            </div>
            <div id="editable-html-area" contenteditable="true" class="editable-box" oninput="updateHtmlContent(${item.uniqueId})">
                 ${htmlContent}
            </div>
            <div style="margin-top:20px; border-top: 1px dashed #ccc; padding-top:10px;">
                <label style="font-size:10px; color:#666;">Observação Adicional</label>
                <div style="background:#fff3cd; padding:10px; border-left:4px solid #ffc107; color:#856404;">
                    ${item.obs || '(Vazio)'}
                </div>
            </div>
        </div>`;
}

// --- FILE SELECTION & FABRIC HELPERS ---
async function openFileSelectionModal(path) {
    const modal = document.getElementById('file-selection-modal');
    alert("DEBUG: openFileModal chamado. Path: " + path + " | Modal DOM: " + (modal ? "ACHOU" : "NÃO ACHOU"));
    const select = document.getElementById('file-select-list');
    select.innerHTML = '<option>Carregando...</option>';
    if (modal) {
        modal.style.display = 'block';
        modal.style.zIndex = '99999'; // Force Z-Index
    }

    try {
        const res = await fetch(`${API_BASE_URL}/files/list?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        select.innerHTML = '';
        if (data.files && data.files.length > 0) {
            data.files.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.path;
                opt.textContent = f.name;
                select.appendChild(opt);
            });
        } else {
            select.innerHTML = '<option value="">Nenhum arquivo encontrado</option>';
        }
    } catch (e) { select.innerHTML = '<option>Erro ao listar</option>'; }
}

async function openAnnotationEditor(filePath, pageNum) {
    const modal = document.getElementById('annotation-modal');
    modal.style.display = 'block';
    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.innerHTML = '<canvas id="annotation-canvas"></canvas>';

    if (fabricCanvas) fabricCanvas.dispose();
    fabricCanvas = new fabric.Canvas('annotation-canvas');
    fabricCanvas.setWidth(800);
    fabricCanvas.setHeight(1100);

    try {
        const loadingTask = pdfjsLib.getDocument(`${API_BASE_URL}/files/serve?filepath=${encodeURIComponent(filePath)}`);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });

        const tempCanvas = document.createElement('canvas');
        const context = tempCanvas.getContext('2d');
        tempCanvas.height = viewport.height;
        tempCanvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        const imgData = tempCanvas.toDataURL('image/png');
        fabric.Image.fromURL(imgData, function (img) {
            fabricCanvas.setWidth(viewport.width);
            fabricCanvas.setHeight(viewport.height);
            fabricCanvas.setBackgroundImage(img, fabricCanvas.renderAll.bind(fabricCanvas));
        });
    } catch (e) {
        alert("Erro carregar PDF: " + e.message);
        window.closeAnnotationModal();
    }
}

// --- FABRIC VARS ---
let currentAnnotationItem = null;
let fabricCanvas = null;
let currentAnnotationColor = 'red';

console.log("analise.js: Script carregado com sucesso.");

// --- OVERRIDES FOR DEBUGGING ---
async function logToBackend(msg) {
    console.log("LOGGING: " + msg);
    try {
        await fetch(`${API_BASE_URL}/debug/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
        });
    } catch (e) { console.error("Falha ao logar no backend", e); }
}

window.startAnnotation = async function (uniqueId, event) {
    await logToBackend(`TRACE 1: Start. ID=${uniqueId}`);
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    try {
        currentAnnotationItem = selectedItems.find(x => x.uniqueId == uniqueId);
        if (!currentAnnotationItem) {
            await logToBackend("TRACE 2: Item FAIL");
            return;
        }
        await logToBackend("TRACE 2: Item OK");

        const versaoSelect = document.getElementById('anl-versao');
        const versaoKey = versaoSelect ? versaoSelect.value : null;
        let path = versionPaths[versaoKey];

        await logToBackend(`TRACE 3: Key=${versaoKey} Path=${path}`);

        if (!path) {
            await logToBackend("TRACE 4: Path FAIL");
            alert("Erro: Caminho não encontrado.");
            return;
        }

        await logToBackend("TRACE 5: Calling openFileSelectionModal");
        openFileSelectionModal(path);
    } catch (e) {
        await logToBackend("TRACE ERROR: " + e.message);
        console.error(e);
    }
};

const originalOpenFile = openFileSelectionModal;
window.openFileSelectionModal = async function (path) {
    await logToBackend(`TRACE 6: Inside openFileSelectionModal. Path=${path}`);
    const modal = document.getElementById('file-selection-modal');
    await logToBackend(`TRACE 7: Modal DOM found? ${!!modal}`);
    if (modal) {
        await logToBackend(`TRACE 8: Current Display: ${modal.style.display}`);

        // DIAGNOSTICADO: Verificar Pai
        try {
            await logToBackend(`TRACE 8.1: Parent Node: ${modal.parentNode.tagName} ID: ${modal.parentNode.id}`);

            // FORCE MOVE TO BODY IF NOT THERE
            if (modal.parentNode !== document.body) {
                await logToBackend("TRACE 8.2: Moving modal to document.body");
                document.body.appendChild(modal);
            }
        } catch (e) { await logToBackend("TRACE 8.ERR: " + e.message); }

        modal.style.display = 'block';
        modal.style.visibility = 'visible';
        modal.style.opacity = '1';
        modal.style.zIndex = '2147483647'; // Max Integer
        modal.style.backgroundColor = 'rgba(0,0,0,0.8)'; // Force dark background to be visible

        await logToBackend(`TRACE 9: Set Display Block & Moved. New Display: ${modal.style.display}`);
    }

    // Call original logic (except the display part which we duplicated/forced)
    // To avoid issues, we'll just replicate the fetch logic here safely
    try {
        const select = document.getElementById('file-select-list');
        select.innerHTML = '<option>Carregando...</option>';
        const res = await fetch(`${API_BASE_URL}/files/list?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        select.innerHTML = '';
        if (data.files && data.files.length > 0) {
            data.files.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.path;
                opt.textContent = f.name;
                select.appendChild(opt);
            });
            await logToBackend(`TRACE 10: Files Loaded: ${data.files.length}`);
        } else {
            select.innerHTML = '<option value="">Nenhum arquivo encontrado</option>';
            await logToBackend(`TRACE 10: No files found`);
        }
    } catch (e) {
        await logToBackend(`TRACE ERROR in OpenFile: ${e.message}`);
    }
}; // Closing openFileSelectionModal properly

// --- OVERRIDE: Confirm File Selection with Trace ---
window.confirmFileSelection = async function () {
    const filePath = document.getElementById('file-select-list').value;
    const pageNum = parseInt(document.getElementById('file-page-number').value) || 1;

    await logToBackend(`TRACE 11: Confirm Selection. Path=${filePath} Page=${pageNum}`);

    if (!filePath) {
        await logToBackend("TRACE 11.1: No file selected");
        return;
    }

    window.closeFileSelectionModal();
    await logToBackend("TRACE 12: Calling openAnnotationEditor");
    openAnnotationEditor(filePath, pageNum);
};

// --- OVERRIDE: Open Annotation Editor with Fix ---
const originalOpenAnnotation = openAnnotationEditor;
window.openAnnotationEditor = async function (filePath, pageNum) {
    await logToBackend(`TRACE 13: Inside openAnnotationEditor. File=${filePath} Page=${pageNum}`);
    const modal = document.getElementById('annotation-modal');

    if (modal) {
        // DIAGNOSTICADO: Verificar Pai
        try {
            await logToBackend(`TRACE 13.1: Annotation Modal Parent: ${modal.parentNode.tagName} ID: ${modal.parentNode.id}`);

            // FORCE MOVE TO BODY IF NOT THERE
            if (modal.parentNode !== document.body) {
                await logToBackend("TRACE 13.2: Moving annotation modal to document.body");
                document.body.appendChild(modal);
            }
        } catch (e) { await logToBackend("TRACE 13.ERR: " + e.message); }

        modal.style.display = 'block';
        modal.style.visibility = 'visible';
        modal.style.opacity = '1';
        modal.style.zIndex = '2147483647'; // Max Integer
        modal.style.backgroundColor = 'rgba(0,0,0,0.9)';

        await logToBackend(`TRACE 14: Annotation Modal set to visible`);
    } else {
        await logToBackend("TRACE 14.FAIL: Annotation modal NOT FOUND in DOM");
        return;
    }

    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.innerHTML = '<canvas id="annotation-canvas"></canvas>';

    if (fabricCanvas) fabricCanvas.dispose();
    try {
        fabricCanvas = new fabric.Canvas('annotation-canvas');
        fabricCanvas.setWidth(800);
        fabricCanvas.setHeight(1100);
        await logToBackend("TRACE 15: Fabric Canvas initialized");
    } catch (e) { await logToBackend("TRACE 15.ERR: " + e.message); }

    try {
        await logToBackend(`TRACE 16: Fetching PDF...`);
        const loadingTask = pdfjsLib.getDocument(`${API_BASE_URL}/files/serve?filepath=${encodeURIComponent(filePath)}`);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });

        const tempCanvas = document.createElement('canvas');
        const context = tempCanvas.getContext('2d');
        tempCanvas.height = viewport.height;
        tempCanvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        const imgData = tempCanvas.toDataURL('image/png');
        fabric.Image.fromURL(imgData, function (img) {
            fabricCanvas.setWidth(viewport.width);
            fabricCanvas.setHeight(viewport.height);
            fabricCanvas.setBackgroundImage(img, fabricCanvas.renderAll.bind(fabricCanvas));
        });
        await logToBackend(`TRACE 17: PDF Rendered successfully`);
    } catch (e) {
        await logToBackend("TRACE ERROR PDF: " + e.message);
        alert("Erro carregar PDF: " + e.message);
        window.closeAnnotationModal();
    }
};