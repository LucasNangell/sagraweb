/**
 * SAGRA Web — Editor Simulador do CorelDRAW & Fila de Workers
 * Conecta campos canônicos ao desenho e simula geração no Corel.
 */

const COREL_TEMPLATES = {
  'ct_visita': {
    name: 'Cartão de Visita',
    width: 350, height: 200,
    fields: [
      { id: 'NomeDep', label: 'Nome do Deputado/a', type: 'text', default: 'Rodrigo Neves' },
      { id: 'Genero', label: 'Gênero / Cargo', type: 'text', default: 'Deputado Federal' },
      { id: 'PartidoDep', label: 'Partido / UF', type: 'text', default: 'PT/SP' },
      { id: 'Endereco', label: 'Endereço da Câmara', type: 'text', default: 'Câmara dos Deputados, Anexo IV, Gabinete 412' },
      { id: 'Contato', label: 'Telefones e E-mail', type: 'text', default: 'Fones: 3215-5412 / dep.rodrigoneves@camara.leg.br' }
    ],
    layers: ['NomeDep (Texto)', 'Genero (Texto)', 'PartidoDep (Texto)', 'Endereco (Texto)', 'Contato (Texto)', 'Brasão da República (Vetor)', 'Margem de Corte (Retângulo)']
  },
  'ct_duplo': {
    name: 'Cartão Duplo Paisagem',
    width: 350, height: 200,
    fields: [
      { id: 'NomeDep', label: 'Nome do Deputado/a', type: 'text', default: 'Aline Silva' },
      { id: 'Genero', label: 'Gênero / Cargo', type: 'text', default: 'Deputada Federal' },
      { id: 'PartidoDep', label: 'Partido / UF', type: 'text', default: 'PL/RJ' },
      { id: 'Endereco', label: 'Endereço da Câmara', type: 'text', default: 'Câmara dos Deputados, Anexo III, Gabinete 254' },
      { id: 'Contato', label: 'Telefones e E-mail', type: 'text', default: 'Fones: 3215-5254 / dep.alinesilva@camara.leg.br' },
      { id: 'NomeAssessor', label: 'Nome do Assessor', type: 'text', default: 'Carlos Eduardo' },
      { id: 'Funcao', label: 'Função do Assessor', type: 'text', default: 'Chefe de Gabinete' },
      { id: 'ContatoAssessor', label: 'Contato do Assessor', type: 'text', default: 'Celular: (85) 99999-8888' }
    ],
    layers: ['NomeDep (Texto)', 'Genero (Texto)', 'PartidoDep (Texto)', 'Endereco (Texto)', 'Contato (Texto)', 'NomeAssessor (Texto)', 'Funcao (Texto)', 'ContatoAssessor (Texto)', 'Box Assessor (Retângulo)', 'Vinco de Dobra (Linha)']
  },
  'timbrado': {
    name: 'Timbrado A4',
    width: 250, height: 350,
    fields: [
      { id: 'Cabecalho', label: 'Cabeçalho Timbrado', type: 'textarea', default: 'GABINETE DO DEPUTADO ROBERTO FREIRE\nMDB/PE' },
      { id: 'Rodape', label: 'Rodapé Timbrado', type: 'textarea', default: 'Câmara dos Deputados, Anexo IV, Gabinete 923 - Fones: 3215-5923 - dep.robertofreire@camara.leg.br' }
    ],
    layers: ['Cabecalho (Texto)', 'Rodape (Texto)', 'Brasão Colorido (Vetor)', 'Papel A4 (Retângulo)']
  }
};

let currentPresetKey = '';

// Inicia escopo do editor de Corel
function initCorelEditor() {
  const productSelect = document.getElementById('papelaria-product-select');
  if (productSelect) {
    productSelect.addEventListener('change', (e) => {
      loadCorelPreset(e.target.value);
    });
  }
}

// Carrega preset no formulário e redesenha a prancheta
function loadCorelPreset(presetKey) {
  currentPresetKey = presetKey;
  const fieldsContainer = document.getElementById('papelaria-dynamic-fields');
  const artboard = document.getElementById('corel-artboard');
  const inspector = document.getElementById('corel-inspector-shapes');
  
  if (!presetKey || !COREL_TEMPLATES[presetKey]) {
    fieldsContainer.innerHTML = '<p class="placeholder-text">Selecione um modelo de papelaria para renderizar o formulário.</p>';
    artboard.innerHTML = '';
    inspector.innerHTML = '';
    return;
  }
  
  const preset = COREL_TEMPLATES[presetKey];
  
  // Ajustar dimensões da prancheta
  artboard.style.width = preset.width + 'px';
  artboard.style.height = preset.height + 'px';
  
  // Renderizar formulário dinâmico
  fieldsContainer.innerHTML = '';
  preset.fields.forEach(f => {
    const div = document.createElement('div');
    div.className = 'form-group';
    
    const label = document.createElement('label');
    label.textContent = f.label;
    label.setAttribute('for', 'corel-field-' + f.id);
    
    let input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.type = f.type;
    }
    input.id = 'corel-field-' + f.id;
    input.value = f.default;
    input.setAttribute('data-field-id', f.id);
    
    // Escuta de alteração em tempo real para sincronizar o desenho
    input.addEventListener('input', updateCorelCanvasPreview);
    
    div.appendChild(label);
    div.appendChild(input);
    fieldsContainer.appendChild(div);
  });
  
  // Preencher inspector de camadas
  inspector.innerHTML = '';
  preset.layers.forEach(lay => {
    const li = document.createElement('li');
    li.innerHTML = `<i class="fa-solid fa-shapes"></i> ${lay}`;
    inspector.appendChild(li);
  });
  
  // Desenhar primeira versão na prancheta
  updateCorelCanvasPreview();
}

// Coleta valores do formulário
function getCorelFormFields() {
  const fields = {};
  if (!currentPresetKey || !COREL_TEMPLATES[currentPresetKey]) return fields;
  
  COREL_TEMPLATES[currentPresetKey].fields.forEach(f => {
    const el = document.getElementById('corel-field-' + f.id);
    if (el) {
      fields[f.id] = el.value;
    }
  });
  return fields;
}

// Atualiza a prancheta visual do CorelDRAW com dados preenchidos
function updateCorelCanvasPreview() {
  const artboard = document.getElementById('corel-rendered-design');
  if (!artboard || !currentPresetKey) return;
  
  const fields = getCorelFormFields();
  
  if (currentPresetKey === 'ct_visita' || currentPresetKey === 'ct_duplo') {
    const nome = fields.NomeDep || 'Nome do Deputado';
    const cargo = fields.Genero || 'Deputado Federal';
    const partido = fields.PartidoDep || 'PT/SP';
    const end = fields.Endereco || 'Endereço...';
    const fones = fields.Contato || 'Contato...';
    
    let assessorHtml = '';
    if (currentPresetKey === 'ct_duplo') {
      const assNome = fields.NomeAssessor || '';
      const assCargo = fields.Funcao || '';
      if (assNome) {
        assessorHtml = `
          <div class="corel-ctvisita-assessor">
            <div class="corel-ctvisita-assessor-nome">${assNome}</div>
            <div class="corel-ctvisita-assessor-cargo">${assCargo}</div>
          </div>
        `;
      }
    }
    
    artboard.innerHTML = `
      <div class="corel-ctvisita-preview">
        <div class="corel-ctvisita-logo">
          <i class="fa-solid fa-star"></i>
          <span>Câmara dos Deputados</span>
        </div>
        <div>
          <div class="corel-ctvisita-dep">${nome}</div>
          <div class="corel-ctvisita-cargo">${cargo}</div>
          <div class="corel-ctvisita-partido">${partido}</div>
          ${assessorHtml}
        </div>
        <div class="corel-ctvisita-footer">
          <div>${end}</div>
          <div>${fones}</div>
        </div>
      </div>
    `;
  } else if (currentPresetKey === 'timbrado') {
    const cab = fields.Cabecalho || '';
    const rod = fields.Rodape || '';
    
    artboard.innerHTML = `
      <div class="corel-timbrado-preview">
        <div class="corel-timbrado-header">
          <div class="corel-timbrado-hdr-title">${cab.replace(/\n/g, '<br>')}</div>
        </div>
        <div class="corel-timbrado-body">
          <span>[Área Útil do Papel Timbrado]</span>
        </div>
        <div class="corel-timbrado-footer">
          <span>${rod}</span>
        </div>
      </div>
    `;
  }
}

// Prefill utilizando API fictícia da câmara
function prefillPapelariaFromOS(os) {
  if (!os || !currentPresetKey) return;
  
  const map = {
    'NomeDep': os.titular,
    'Genero': 'Deputado Federal',
    'PartidoDep': `${os.partido}/${os.uf}`,
    'Endereco': `Câmara dos Deputados, Anexo ${os.anexo}, Gabinete ${os.gabinete}`,
    'Contato': `Fones: 3215-5${os.gabinete.padStart(3, '0')} / ${os.email}`,
    'Cabecalho': `GABINETE DO DEPUTADO ${os.titular.toUpperCase()}\n${os.partido}/${os.uf}`,
    'Rodape': `Câmara dos Deputados, Anexo ${os.anexo}, Gabinete ${os.gabinete} - Fones: 3215-5${os.gabinete.padStart(3, '0')} - ${os.email}`
  };
  
  COREL_TEMPLATES[currentPresetKey].fields.forEach(f => {
    const el = document.getElementById('corel-field-' + f.id);
    if (el && map[f.id]) {
      el.value = map[f.id];
    }
  });
  
  updateCorelCanvasPreview();
  showToast('Campos preenchidos com sucesso a partir dos metadados da OS!');
}

// Dispara simulação do Worker CorelDRAW
function triggerCorelWorkerSimulation(nrOs, ano, callback) {
  if (!currentPresetKey) return;
  
  const modal = document.getElementById('modal-worker');
  const progressFill = document.getElementById('worker-progress-fill');
  const logOutput = document.getElementById('worker-log-output');
  const btnClose = document.getElementById('btn-close-worker-modal');
  
  modal.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressFill.textContent = '0%';
  logOutput.innerHTML = '';
  btnClose.setAttribute('disabled', 'true');
  
  const logs = [
    { t: 500,  p: 5,   msg: 'CLAIM: Requisitando processamento do Job de Papelaria...' },
    { t: 1200, p: 15,  msg: 'CLAIM: Job aceito pelo Worker-Corel-01.' },
    { t: 2000, p: 30,  msg: 'INITIALIZE: Abrindo canal COM. Conectando à instância ativa do CorelDRAW...' },
    { t: 2800, p: 45,  msg: `LOAD: Abrindo modelo original: \\\\redecamara\\DfsData\\CSP\\WEB\\${currentPresetKey}.cdr` },
    { t: 3600, p: 60,  msg: 'FIND SHAPES: Localizando objetos nomeados no documento: ' + COREL_TEMPLATES[currentPresetKey].fields.map(f => f.id).join(', ') },
    { t: 4500, p: 75,  msg: 'REPLACE: Substituindo propriedades Text.Story.Text por dados do formulário SagraWeb...' },
    { t: 5500, p: 85,  msg: 'SAVE: Salvando arquivo temporário gerado em C:\\temp\\...' },
    { t: 6500, p: 95,  msg: 'EXPORT PDF: Executando PublishToPDF. Incorporando fontes do sistema.' },
    { t: 7200, p: 100, msg: 'SYNC: Arquivos copiados com sucesso para a pasta da OS. Finalizando processo.' }
  ];
  
  logs.forEach(log => {
    setTimeout(() => {
      progressFill.style.width = log.p + '%';
      progressFill.textContent = log.p + '%';
      
      const line = document.createElement('div');
      line.className = 'worker-log-line';
      line.innerHTML = `<span class="text-success">[${new Date().toLocaleTimeString()}]</span> ${log.msg}`;
      logOutput.appendChild(line);
      logOutput.scrollTop = logOutput.scrollHeight;
      
      if (log.p === 100) {
        btnClose.removeAttribute('disabled');
        btnClose.textContent = 'Ver Prova 3D Gerada';
        
        // Callback para atualizar status
        if (typeof callback === 'function') {
          callback();
        }
      }
    }, log.t);
  });
}
