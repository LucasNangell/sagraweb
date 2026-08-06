/**
 * SAGRA Web — Motor de Visualização 3D (CSS 3D Transforms)
 * Permite rotação interativa, zoom, dobras e atualização de texturas dinâmicas.
 */

class SagraMockup3D {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    
    this.productEl = this.container.querySelector('.pm3d-product');
    this.sceneEl = this.container.querySelector('.pm3d-scene') || this.productEl.parentElement;
    
    // Configurações padrão
    this.options = Object.assign({
      preset: 'ct_visita', // ct_visita, ct_duplo, timbrado
      zoom: 1.0,
      rotX: 10,
      rotY: -30,
      fold: 0.3, // 0 = fechado, 1 = aberto
      artworkUrl: '', // URL ou DataURL SVG
      onRotate: null
    }, options);
    
    this.isDragging = false;
    this.prevMouseX = 0;
    this.prevMouseY = 0;
    
    this.init();
  }
  
  init() {
    this.setupListeners();
    this.render();
  }
  
  setupListeners() {
    // Rotação por arraste do mouse no viewport
    this.container.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.prevMouseX = e.clientX;
      this.prevMouseY = e.clientY;
    });
    
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const deltaX = e.clientX - this.prevMouseX;
      const deltaY = e.clientY - this.prevMouseY;
      
      this.options.rotY += deltaX * 0.5;
      this.options.rotX -= deltaY * 0.5;
      
      // Limitar rotação X para evitar inversão total da câmera
      this.options.rotX = Math.max(-60, Math.min(60, this.options.rotX));
      
      this.prevMouseX = e.clientX;
      this.prevMouseY = e.clientY;
      
      this.updateSceneTransform();
      
      if (typeof this.options.onRotate === 'function') {
        this.options.onRotate(this.options.rotX, this.options.rotY);
      }
    });
    
    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
    
    // Suporte para touch em dispositivos móveis
    this.container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.prevMouseX = e.touches[0].clientX;
        this.prevMouseY = e.touches[0].clientY;
      }
    });
    
    window.addEventListener('touchmove', (e) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      
      const deltaX = e.touches[0].clientX - this.prevMouseX;
      const deltaY = e.touches[0].clientY - this.prevMouseY;
      
      this.options.rotY += deltaX * 0.5;
      this.options.rotX -= deltaY * 0.5;
      
      this.options.rotX = Math.max(-60, Math.min(60, this.options.rotX));
      
      this.prevMouseX = e.touches[0].clientX;
      this.prevMouseY = e.touches[0].clientY;
      
      this.updateSceneTransform();
    });
    
    window.addEventListener('touchend', () => {
      this.isDragging = false;
    });
  }
  
  setArtwork(url) {
    this.options.artworkUrl = url;
    this.render();
  }
  
  setPreset(preset) {
    this.options.preset = preset;
    this.render();
  }
  
  setZoom(zoom) {
    this.options.zoom = parseFloat(zoom);
    this.updateSceneTransform();
  }
  
  setRotY(rotY) {
    this.options.rotY = parseFloat(rotY);
    this.updateSceneTransform();
  }
  
  setFold(fold) {
    this.options.fold = parseFloat(fold);
    this.updateFacesTransform();
  }
  
  resetCamera() {
    this.options.zoom = 1.0;
    this.options.rotX = 10;
    this.options.rotY = -30;
    this.options.fold = 0.3;
    this.updateSceneTransform();
    this.updateFacesTransform();
  }
  
  updateSceneTransform() {
    if (this.sceneEl) {
      this.sceneEl.style.transform = `rotateX(${this.options.rotX}deg) rotateY(${this.options.rotY}deg) scale(${this.options.zoom})`;
    }
  }
  
  // Atualiza as faces baseado no nível de dobra
  updateFacesTransform() {
    const preset = this.options.preset;
    const fold = this.options.fold;
    
    if (preset === 'ct_duplo') {
      // Cartão Duplo: A capa abre no vinco
      // capa: gira ao redor da borda direita de 0% a 180%
      const foldAngle = 180 - (fold * 180); // 0 aberto (180deg), 1 fechado (0deg)
      const capaEl = this.productEl.querySelector('[data-face-id="capa"]');
      if (capaEl) {
        capaEl.style.transform = `rotateY(${foldAngle}deg)`;
      }
    }
  }
  
  render() {
    if (!this.productEl) return;
    
    this.productEl.innerHTML = '';
    const preset = this.options.preset;
    const artUrl = this.options.artworkUrl || this.getDefaultArtwork();
    
    this.updateSceneTransform();
    
    if (preset === 'ct_duplo') {
      // Cartão Dobrado (Abertura Horizontal Lateral)
      // Largura aberta: 200px (100px cada folha), Altura: 120px
      this.productEl.style.width = '200px';
      this.productEl.style.height = '120px';
      
      // Folha Direita/Trás (Base interna)
      const baseEl = document.createElement('div');
      baseEl.className = 'pm3d-face';
      baseEl.setAttribute('data-face-id', 'interior');
      Object.assign(baseEl.style, {
        width: '50%',
        height: '100%',
        left: '50%',
        top: '0',
        zIndex: 1,
        backgroundImage: `url("${artUrl}")`,
        backgroundSize: '200% 100%',
        backgroundPosition: '100% 0%', // Lado direito do SVG
        transform: 'translateZ(-0.5px)'
      });
      
      // Folha Esquerda/Frente (Dobra)
      const foldEl = document.createElement('div');
      foldEl.className = 'pm3d-face';
      foldEl.setAttribute('data-face-id', 'capa');
      Object.assign(foldEl.style, {
        width: '50%',
        height: '100%',
        left: '0%',
        top: '0%',
        zIndex: 3,
        backgroundImage: `url("${artUrl}")`,
        backgroundSize: '200% 100%',
        backgroundPosition: '0% 0%', // Lado esquerdo do SVG (capa)
        transformOrigin: 'right center',
        transform: `rotateY(${(1 - this.options.fold) * 180}deg)`,
        borderRight: '1px solid rgba(0,0,0,0.15)' // Simula a dobra do papel
      });
      
      // Sombra projetada pela capa na folha de trás
      const innerShadow = document.createElement('div');
      innerShadow.style.cssText = `
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: linear-gradient(to right, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.03) 20%, transparent 100%);
        pointer-events: none;
      `;
      baseEl.appendChild(innerShadow);
      
      this.productEl.appendChild(baseEl);
      this.productEl.appendChild(foldEl);
      
    } else if (preset === 'timbrado') {
      // Papel Timbrado A4 (Plano levemente inclinado)
      // Proporções A4: 180px x 254px
      this.productEl.style.width = '180px';
      this.productEl.style.height = '254px';
      
      const faceEl = document.createElement('div');
      faceEl.className = 'pm3d-face';
      Object.assign(faceEl.style, {
        width: '100%',
        height: '100%',
        left: '0',
        top: '0',
        backgroundImage: `url("${artUrl}")`,
        backgroundSize: '100% 100%',
        transform: 'translateZ(0px)',
        boxShadow: '2px 8px 24px rgba(0, 0, 0, 0.3)'
      });
      this.productEl.appendChild(faceEl);
      
    } else {
      // Cartão de Visita Simples 90x50
      // Proporções: 220px x 122px
      this.productEl.style.width = '220px';
      this.productEl.style.height = '122px';
      
      // Frente
      const frenteEl = document.createElement('div');
      frenteEl.className = 'pm3d-face pm3d-face--front';
      Object.assign(frenteEl.style, {
        width: '100%',
        height: '100%',
        left: '0',
        top: '0',
        backgroundImage: `url("${artUrl}")`,
        backgroundSize: '100% 100%',
        transform: 'translateZ(1px)'
      });
      
      // Verso (rotacionado 180 graus no eixo Y)
      const versoEl = document.createElement('div');
      versoEl.className = 'pm3d-face pm3d-face--back';
      Object.assign(versoEl.style, {
        width: '100%',
        height: '100%',
        left: '0',
        top: '0',
        backgroundImage: `url("${artUrl}")`,
        backgroundSize: '100% 100%',
        transform: 'translateZ(-1px) rotateY(180deg)'
      });
      
      this.productEl.appendChild(frenteEl);
      this.productEl.appendChild(versoEl);
    }
    
    this.updateFacesTransform();
  }
  
  // Retorna uma arte padrão caso nenhuma seja carregada
  getDefaultArtwork() {
    const svgStr = `
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340">
        <rect width="600" height="340" fill="#1e293b"/>
        <circle cx="300" cy="170" r="120" fill="none" stroke="#334155" stroke-width="1"/>
        <line x1="0" y1="170" x2="600" y2="170" stroke="#334155" stroke-width="1" stroke-dasharray="4 6"/>
        <text x="300" y="160" font-family="'Outfit', sans-serif" font-size="28" font-weight="bold" fill="#38bdf8" text-anchor="middle">SAGRA WEB</text>
        <text x="300" y="195" font-family="'Inter', sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">Aguardando Processamento CorelDRAW...</text>
      </svg>
    `;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgStr);
  }
}

// Helper para gerar o arquivo SVG dinâmico a partir dos dados preenchidos no formulário
function generateDynamicArtworkSVG(presetType, fields) {
  let svg = '';
  
  if (presetType === 'ct_visita') {
    const nome = fields.NomeDep || 'Nome do Deputado';
    const cargo = fields.Genero || 'Deputado Federal';
    const partidoUf = fields.PartidoDep || 'SIGLA/UF';
    const endereco = fields.Endereco || 'Endereço Câmara';
    const fonesEmail = fields.Contato || 'Fones: 3215-5000 / email@camara.leg.br';
    
    // SVG de cartão simples
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="333" viewBox="0 0 600 333">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fafafa" />
            <stop offset="100%" stop-color="#f3f4f6" />
          </linearGradient>
        </defs>
        
        <!-- Frente do Cartão -->
        <rect width="600" height="333" fill="url(#grad)"/>
        
        <!-- Elemento Gráfico de Perspectiva (Marca D'água) -->
        <path d="M 0,0 L 220,0 L 100,333 L 0,333 Z" fill="#e5e7eb" opacity="0.3"/>
        <rect x="25" y="25" width="550" height="283" fill="none" stroke="#d1d5db" stroke-width="1"/>
        
        <!-- Logotipo da Câmara -->
        <g transform="translate(45, 50) scale(0.9)">
          <circle cx="20" cy="20" r="16" fill="#1e3a8a"/>
          <circle cx="20" cy="20" r="10" fill="#f59e0b"/>
          <text x="45" y="28" font-family="'Outfit', sans-serif" font-size="20" font-weight="800" fill="#1e3a8a">CÂMARA DOS DEPUTADOS</text>
        </g>
        
        <!-- Dados do Parlamentar -->
        <text x="45" y="150" font-family="'Outfit', sans-serif" font-size="28" font-weight="800" fill="#111827">${nome.toUpperCase()}</text>
        <text x="45" y="175" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="#4b5563" letter-spacing="1.5">${cargo.toUpperCase()}</text>
        <text x="45" y="195" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="#2563eb">${partidoUf}</text>
        
        <!-- Dados de Contato e Endereço -->
        <g transform="translate(45, 235)">
          <text x="0" y="0" font-family="'Inter', sans-serif" font-size="9" fill="#4b5563" font-weight="500">${endereco}</text>
          <text x="0" y="16" font-family="'Inter', sans-serif" font-size="9" fill="#4b5563" font-weight="500">${fonesEmail}</text>
        </g>
      </svg>
    `;
    
  } else if (presetType === 'ct_duplo') {
    const nome = fields.NomeDep || 'Nome do Deputado';
    const cargo = fields.Genero || 'Deputado Federal';
    const partidoUf = fields.PartidoDep || 'SIGLA/UF';
    const endereco = fields.Endereco || 'Endereço Câmara';
    const fonesEmail = fields.Contato || 'Fones: 3215-5000 / email@camara.leg.br';
    
    const assessorNome = fields.NomeAssessor || '';
    const assessorContato = fields.ContatoAssessor || '';
    const assessorFuncao = fields.Funcao || '';
    
    // SVG de cartão duplo (Capa no lado esquerdo, Interior no lado direito)
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360">
        <defs>
          <linearGradient id="grad-l" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e3a8a" />
            <stop offset="100%" stop-color="#0f172a" />
          </linearGradient>
          <linearGradient id="grad-r" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="100%" stop-color="#f8fafc" />
          </linearGradient>
        </defs>
        
        <!-- BACKGROUNDS -->
        <!-- Lado Esquerdo (Capa do Cartão Dobrado) -->
        <rect x="0" y="0" width="600" height="360" fill="url(#grad-l)"/>
        
        <!-- Lado Direito (Interior do Cartão Dobrado) -->
        <rect x="600" y="0" width="600" height="360" fill="url(#grad-r)"/>
        
        <!-- Vinco Central -->
        <line x1="600" y1="0" x2="600" y2="360" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="8 6"/>
        
        <!-- LADO ESQUERDO: DESIGN DA CAPA -->
        <g transform="translate(60, 80)">
          <!-- Brasão Simulado -->
          <circle cx="40" cy="40" r="30" fill="#ffffff" opacity="0.1"/>
          <circle cx="40" cy="40" r="20" fill="#f59e0b"/>
          <path d="M 40,10 L 48,32 L 32,32 Z" fill="#1e3a8a"/>
          
          <text x="90" y="38" font-family="'Outfit', sans-serif" font-size="20" font-weight="800" fill="#ffffff" letter-spacing="1">CÂMARA DOS DEPUTADOS</text>
          <text x="90" y="56" font-family="'Inter', sans-serif" font-size="11" font-weight="500" fill="#94a3b8" letter-spacing="3">GABINETE PARLAMENTAR</text>
        </g>
        
        <text x="60" y="220" font-family="'Outfit', sans-serif" font-size="36" font-weight="800" fill="#ffffff">${nome.toUpperCase()}</text>
        <text x="60" y="250" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#38bdf8" letter-spacing="2">${cargo.toUpperCase()}</text>
        <text x="60" y="275" font-family="'Inter', sans-serif" font-size="12" font-weight="500" fill="#94a3b8">${partidoUf}</text>
        
        <!-- LADO DIREITO: INFORMAÇÕES INTERNAS -->
        <!-- Logotipo discreto no topo -->
        <g transform="translate(660, 50) scale(0.7)">
          <circle cx="20" cy="20" r="16" fill="#1e3a8a"/>
          <circle cx="20" cy="20" r="10" fill="#f59e0b"/>
          <text x="45" y="28" font-family="'Outfit', sans-serif" font-size="20" font-weight="800" fill="#1e3a8a">CÂMARA DOS DEPUTADOS</text>
        </g>
        
        <!-- Endereço e Fones -->
        <g transform="translate(660, 110)">
          <text x="0" y="0" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="#1e3a8a">${nome}</text>
          <text x="0" y="20" font-family="'Inter', sans-serif" font-size="10" fill="#475569" font-weight="500">${endereco}</text>
          <text x="0" y="38" font-family="'Inter', sans-serif" font-size="10" fill="#475569" font-weight="500">${fonesEmail}</text>
        </g>
        
        <!-- Box de Assessor (Se preenchido) -->
        ${assessorNome ? `
        <g transform="translate(660, 200)">
          <rect x="0" y="0" width="480" height="90" fill="#eff6ff" rx="6" stroke="#bfdbfe" stroke-width="1"/>
          <text x="20" y="30" font-family="'Outfit', sans-serif" font-size="12" font-weight="700" fill="#1e40af">${assessorNome}</text>
          <text x="20" y="50" font-family="'Inter', sans-serif" font-size="10" font-weight="600" fill="#2563eb">${assessorFuncao}</text>
          <text x="20" y="70" font-family="'Inter', sans-serif" font-size="10" fill="#475569">${assessorContato}</text>
        </g>
        ` : ''}
      </svg>
    `;
    
  } else if (presetType === 'timbrado') {
    const cabecalho = fields.Cabecalho || 'GABINETE DO DEPUTADO\nCÂMARA DOS DEPUTADOS';
    const rodape = fields.Rodape || 'Câmara dos Deputados, Anexo IV, Gabinete 000';
    
    // Tratamento de quebras de linha no cabeçalho para o SVG
    const cabLines = cabecalho.split('\n');
    let cabTspans = '';
    cabLines.forEach((line, idx) => {
      cabTspans += `<tspan x="300" dy="${idx === 0 ? 0 : 16}" font-weight="${idx === 0 ? 'bold' : 'normal'}" font-size="${idx === 0 ? 14 : 11}">${line.toUpperCase()}</tspan>`;
    });

    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="420" height="595" viewBox="0 0 420 595">
        <!-- Fundo Papel -->
        <rect width="420" height="595" fill="#ffffff"/>
        
        <!-- Brasão República no Topo -->
        <g transform="translate(200, 30) scale(0.5)">
          <circle cx="20" cy="20" r="18" fill="#047857"/>
          <circle cx="20" cy="20" r="14" fill="#f59e0b"/>
          <circle cx="20" cy="20" r="10" fill="#1d4ed8"/>
        </g>
        
        <!-- Cabeçalho -->
        <text x="300" y="65" font-family="'Outfit', sans-serif" fill="#1e293b" text-anchor="middle">
          ${cabTspans}
        </text>
        
        <!-- Linha Divisória de Cabeçalho -->
        <line x1="40" y1="110" x2="380" y2="110" stroke="#0056ac" stroke-width="2"/>
        
        <!-- Linhas de Texto simulando papel escrito -->
        <g transform="translate(40, 160)" opacity="0.15">
          <line x1="0" y1="0" x2="340" y2="0" stroke="#334155" stroke-width="2"/>
          <line x1="0" y1="20" x2="340" y2="20" stroke="#334155" stroke-width="2"/>
          <line x1="0" y1="40" x2="300" y2="40" stroke="#334155" stroke-width="2"/>
          <line x1="0" y1="80" x2="340" y2="80" stroke="#334155" stroke-width="2"/>
          <line x1="0" y1="100" x2="340" y2="100" stroke="#334155" stroke-width="2"/>
          <line x1="0" y1="120" x2="340" y2="120" stroke="#334155" stroke-width="2"/>
          <line x1="0" y1="140" x2="200" y2="140" stroke="#334155" stroke-width="2"/>
        </g>
        
        <!-- Rodapé do Papel -->
        <line x1="40" y1="545" x2="380" y2="545" stroke="#cbd5e1" stroke-width="1"/>
        <text x="210" y="565" font-family="'Inter', sans-serif" font-size="7" fill="#64748b" text-anchor="middle" width="340">${rodape}</text>
      </svg>
    `;
  }
  
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.trim());
}
