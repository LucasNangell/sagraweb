const { createApp, ref, onMounted, onUnmounted, watch } = Vue;

createApp({
    setup() {
        // =================================================================
        // WAKE LOCK API - Impede que o monitor desligue
        // =================================================================
        let wakeLock = null;
        let wakeLockSupported = false;

        // Verificar suporte ao Wake Lock API
        if ('wakeLock' in navigator) {
            wakeLockSupported = true;
            console.log('[Wake Lock] API suportada');
        } else {
            console.warn('[Wake Lock] API nao suportada - usando fallback');
        }

        // Solicitar Wake Lock
        const requestWakeLock = async () => {
            if (!wakeLockSupported) {
                return;
            }

            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('[Wake Lock] Ativado com sucesso');

                // Listener para quando o wake lock for liberado
                wakeLock.addEventListener('release', () => {
                    console.log('[Wake Lock] Liberado');
                    wakeLock = null;
                });

            } catch (err) {
                console.error('[Wake Lock] Erro ao ativar:', err.message);
                wakeLock = null;
            }
        };

        // Liberar Wake Lock
        const releaseWakeLock = async () => {
            if (wakeLock !== null) {
                try {
                    await wakeLock.release();
                    wakeLock = null;
                    console.log('[Wake Lock] Liberado manualmente');
                } catch (err) {
                    console.error('[Wake Lock] Erro ao liberar:', err);
                }
            }
        };

        // Gerenciar Wake Lock baseado na visibilidade da aba
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible') {
                console.log('[Wake Lock] Aba visivel - reativando');
                await requestWakeLock();
            } else {
                console.log('[Wake Lock] Aba oculta - liberando');
                await releaseWakeLock();
            }
        };

        // FALLBACK: Manter atividade sem Wake Lock API
        let fallbackIntervalId = null;
        const startFallback = () => {
            if (wakeLockSupported) {
                return; // Nao precisa de fallback
            }

            console.log('[Wake Lock Fallback] Iniciando manutenção de atividade');
            
            // Usar requestAnimationFrame para manter atividade
            let lastTime = Date.now();
            const keepActive = () => {
                const now = Date.now();
                // A cada 30 segundos, fazer uma micro-operacao
                if (now - lastTime > 30000) {
                    // Operacao invisivel que mantém navegador "ativo"
                    document.title = document.title; // No-op visual
                    lastTime = now;
                }
                fallbackIntervalId = requestAnimationFrame(keepActive);
            };

            fallbackIntervalId = requestAnimationFrame(keepActive);
        };

        const stopFallback = () => {
            if (fallbackIntervalId !== null) {
                cancelAnimationFrame(fallbackIntervalId);
                fallbackIntervalId = null;
                console.log('[Wake Lock Fallback] Parado');
            }
        };

        // Inicializar Wake Lock ao montar componente
        onMounted(async () => {
            console.log('[Wake Lock] Inicializando sistema');
            
            // Solicitar Wake Lock inicial
            await requestWakeLock();

            // Iniciar fallback se necessario
            if (!wakeLockSupported) {
                startFallback();
            }

            // Listeners para gerenciar visibilidade
            document.addEventListener('visibilitychange', handleVisibilityChange);
            
            // Listeners para foco da janela
            window.addEventListener('focus', async () => {
                console.log('[Wake Lock] Janela em foco - reativando');
                await requestWakeLock();
            });

            window.addEventListener('blur', async () => {
                console.log('[Wake Lock] Janela fora de foco - mantendo ativo');
                // Nao liberar no blur, apenas no visibility hidden
            });

            // Carregar configuracoes e dados
            loadConfig();
            await loadSetores();
            await loadAndamentos();
            fetchData();
            startTimer();
            setupWebSocket();

            // Initialize Lucide icons if available globally
            if (window.lucide) window.lucide.createIcons();
        });

        // Liberar recursos ao desmontar
        onUnmounted(() => {
            console.log('[Wake Lock] Limpando recursos');
            releaseWakeLock();
            stopFallback();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        });

        // =================================================================
        // FIM WAKE LOCK API
        // =================================================================

        // --- State ---
        const lastUpdated = ref("Carregando...");
        const progress = ref(0);
        const showSettings = ref(false);
        const setoresList = ref([]);
        const andamentosList = ref([]);

        // Configuration State (Persisted)
        const config = ref({
            sector: "SEFOC",
            columnCount: 4,
            columns: [
                {
                    id: 'col_0',
                    title: 'p/ Triagem',
                    statuses: ['Saída p/', 'Saída parcial p/', 'Entrada Inicial', 'Tramit. de Prova p/', 'Tramit. de Prévia p/', 'Comentário']
                },
                {
                    id: 'col_1',
                    title: 'Em Execução',
                    statuses: ['Em Execução', 'Recebido']
                },
                {
                    id: 'col_2',
                    title: 'Problemas Técnicos',
                    statuses: ['Problemas Técnicos', 'Problema Técnico']
                },
                {
                    id: 'col_3',
                    title: 'Enviar e-mail',
                    statuses: ['Encam. de Docum.']
                }
            ]
        });

        const tempConfig = ref(JSON.parse(JSON.stringify(config.value))); // Deep copy for modal editing

        // Display Data
        const columns = ref([]);
        const previousDataMap = ref(new Map()); // To track "New" items

        // --- Logic ---

        // Fetch available setores from API
        const loadSetores = async () => {
            try {
                const API_BASE_URL = `http://${window.location.hostname}:${window.SAGRA_API_PORT || 8000}/api`;
                const response = await fetch(`${API_BASE_URL}/aux/setores`);
                const result = await response.json();
                if (result && Array.isArray(result) && result.length > 0) {
                    setoresList.value = result.map(item => item.Setor);
                    console.log("Setores carregados:", setoresList.value);
                } else {
                    console.warn("Nenhum setor retornado da API");
                }
            } catch (error) {
                console.error("Error loading setores:", error);
            }
        };

        // Fetch available andamentos from API
        const loadAndamentos = async () => {
            try {
                const API_BASE_URL = `http://${window.location.hostname}:${window.SAGRA_API_PORT || 8000}/api`;
                const response = await fetch(`${API_BASE_URL}/aux/andamentos`);
                const result = await response.json();
                if (result && Array.isArray(result) && result.length > 0) {
                    andamentosList.value = result.map(item => item.Situacao);
                    console.log("Andamentos carregados:", andamentosList.value);
                } else {
                    console.warn("Nenhum andamento retornado da API");
                }
            } catch (error) {
                console.error("Error loading andamentos:", error);
            }
        };

        // Toggle andamento for a column
        const toggleAndamento = (colIdx, andamento) => {
            const col = tempConfig.value.columns[colIdx];
            const idx = col.statuses.indexOf(andamento);
            if (idx === -1) {
                col.statuses.push(andamento);
            } else {
                col.statuses.splice(idx, 1);
            }
        };

        // Add new column
        const addColumn = () => {
            if (tempConfig.value.columns.length >= 6) {
                alert('Máximo de 6 colunas atingido!');
                return;
            }
            const newId = `col_${Date.now()}`;
            tempConfig.value.columns.push({
                id: newId,
                title: `Coluna ${tempConfig.value.columns.length + 1}`,
                statuses: []
            });
            tempConfig.value.columnCount = tempConfig.value.columns.length;
        };

        // Remove column
        const removeColumn = (idx) => {
            if (tempConfig.value.columns.length <= 1) {
                alert('É necessário ter pelo menos 1 coluna!');
                return;
            }
            tempConfig.value.columns.splice(idx, 1);
            tempConfig.value.columnCount = tempConfig.value.columns.length;
        };

        // Adjust columns based on columnCount input
        const adjustColumns = () => {
            const targetCount = parseInt(tempConfig.value.columnCount) || 1;
            const currentCount = tempConfig.value.columns.length;

            // Validate bounds
            if (targetCount < 1) {
                tempConfig.value.columnCount = 1;
                return;
            }
            if (targetCount > 6) {
                tempConfig.value.columnCount = 6;
                return;
            }

            // Add columns if needed
            while (tempConfig.value.columns.length < targetCount) {
                const newId = `col_${Date.now()}_${tempConfig.value.columns.length}`;
                tempConfig.value.columns.push({
                    id: newId,
                    title: `Coluna ${tempConfig.value.columns.length + 1}`,
                    statuses: []
                });
            }

            // Remove columns if needed
            while (tempConfig.value.columns.length > targetCount) {
                tempConfig.value.columns.pop();
            }
        };

        // Load Config from LocalStorage
        const loadConfig = () => {
            const saved = localStorage.getItem('sagra_dashboard_config');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // Merge to ensure structure integrity
                    config.value.sector = parsed.sector || "SEFOC";
                    config.value.columnCount = parsed.columnCount || parsed.columns?.length || 4;
                    if (parsed.columns && parsed.columns.length > 0) {
                        config.value.columns = parsed.columns;
                    }
                } catch (e) { console.error("Error loading config", e); }
            }
            // Sync columnCount with actual columns length
            config.value.columnCount = config.value.columns.length;
            // Initialize display columns from config
            columns.value = config.value.columns.map(c => ({ ...c, items: [] }));
            tempConfig.value = JSON.parse(JSON.stringify(config.value));
        };

        const openSettings = () => {
            // Deep copy config when opening modal
            tempConfig.value = JSON.parse(JSON.stringify(config.value));
            showSettings.value = true;
        };

        const saveSettings = () => {
            config.value = JSON.parse(JSON.stringify(tempConfig.value));
            localStorage.setItem('sagra_dashboard_config', JSON.stringify(config.value));
            showSettings.value = false;
            // Re-init columns and fetch immediately
            columns.value = config.value.columns.map(c => ({ ...c, items: [] }));
            previousDataMap.value.clear(); // Clear history to avoid stale comparisons
            fetchData();
        };

        // Fetch Data from Real API
        const fetchData = async () => {
            try {
                // Build dynamic Filters
                // We fetch specific statuses based on columns config to optimize, 
                // OR we fetch all active for the sector and filter client-side.
                // Given the prompt "Filter by sector selected", fetching by sector is safer.

                const params = new URLSearchParams();
                params.append('setor', config.value.sector);
                params.append('include_finished', 'false');
                params.append('limit', '200'); // Fetch enough items

                // Add column statuses to filter
                // Flatten all statuses from all columns
                // const allStatuses = config.value.columns.flatMap(c => c.statuses);
                // allStatuses.forEach(s => params.append('situacao[]', s));
                // NOTE: API searches EXACT string. 'Saída p/' matches "Saída p/ SEFOC" via "LIKE" check in backend?
                // Looking at server.py: 
                // if situacao: ... AND a.SituacaoLink IN (...) -> EQUAL check usually.
                // BUT server_py: query += " AND a.SituacaoLink IN ({placeholders})" -> equal check.
                // However, the prompt says "Saída p/" but backend might store "Saída p/ EXPEDICAO".
                // We will fetch ALL for the sector and filter client-side to be robust against "Saída p/..." variations if needed,
                // OR relies on "situacao" param being exact.
                // LET'S FETCH EVERYTHING FOR THE SECTOR first to be safe.

                const API_BASE_URL = `http://${window.location.hostname}:${window.SAGRA_API_PORT || 8000}/api`;
                const response = await fetch(`${API_BASE_URL}/os/search?${params.toString()}`);
                const result = await response.json();

                if (result && result.data) {
                    processData(result.data);
                }

                lastUpdated.value = new Date().toLocaleTimeString();

            } catch (error) {
                console.error("Error fetching data:", error);
            }
        };

        const processData = (rawData) => {
            // Create a temp map for the new data
            const currentDataMap = new Map();

            // Temporary storage for columns
            const tempColumns = config.value.columns.map(c => ({ ...c, items: [] }));

            rawData.forEach(os => {
                const uniqueKey = `${os.nr_os}-${os.ano}`;
                const priorityType = os.prioridade ?
                    (os.prioridade.includes('Prometido') ? 'priority-high' :
                        os.prioridade.includes('Solicitado') ? 'priority-medium' : null) : null;
                const isNew = !previousDataMap.value.has(uniqueKey);

                const item = {
                    ...os,
                    uniqueKey,
                    priorityType,
                    isNew: isNew // Flag for animation
                };

                currentDataMap.set(uniqueKey, item);

                // Map to Column
                // Logic: Check which column's statuses list contains (or starts with) the OS status
                const colIndex = tempColumns.findIndex(col => {
                    return col.statuses.some(statusFilter => {
                        // Exact match OR Starts With (for "Saída p/...")
                        return os.situacao === statusFilter || os.situacao.startsWith(statusFilter);
                    });
                });

                if (colIndex !== -1) {
                    tempColumns[colIndex].items.push(item);
                }
            });

            // --- Sorting Logic (New Rule) ---
            // 1. Prometido p/
            // 2. Solicitado p/
            // 3. OS < 5000
            // 4. OS >= 5000
            // Internal Sort: Last Update ASC (Oldest First)
            const getWeight = (os) => {
                const prio = os.prioridade || "";
                if (prio.includes("Prometido p/")) return 0;
                if (prio.includes("Solicitado p/")) return 1;
                const nr = parseInt(os.nr_os);
                if (!isNaN(nr) && nr < 5000) return 2;
                return 3;
            };

            tempColumns.forEach(col => {
                col.items.sort((a, b) => {
                    const wA = getWeight(a);
                    const wB = getWeight(b);

                    if (wA !== wB) return wA - wB;

                    // Internal: Date ASC
                    // last_update comes from API (added to server.py)
                    const dA = a.last_update ? new Date(a.last_update).getTime() : 0;
                    const dB = b.last_update ? new Date(b.last_update).getTime() : 0;
                    return dA - dB;
                });
            });

            // Update Reactive State
            // We replace items but keep Vue's reactivity happy if possible, 
            // but for full list replacement usually just updating the array is fine.
            // Vue 3 transition-group handles the diff based on :key

            columns.value = tempColumns;

            // Update History Map for next cycle
            previousDataMap.value = currentDataMap;
        };

        // Progress Bar & Polling
        const startTimer = () => {
            progress.value = 0;
            const duration = 5000; // 5 seconds
            const interval = 100;

            const timer = setInterval(() => {
                progress.value += (interval / duration) * 100;
                if (progress.value >= 100) {
                    clearInterval(timer);
                    fetchData();
                    startTimer(); // Loop
                }
            }, interval);
        };

        const startWebSocket = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const port = window.SAGRA_API_PORT || 8000;
            const wsUrl = `${protocol}//${window.location.hostname}:${port}/ws`;

            let socket;

            const connect = () => {
                console.log("Connecting to WebSocket:", wsUrl);
                socket = new WebSocket(wsUrl);

                socket.onopen = () => {
                    console.log("WebSocket connected");
                };

                socket.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'system_update') {
                            // Debounce or just call? For now direct call is fine.
                            console.log("System update received:", data);
                            fetchData();
                        }
                    } catch (e) { console.error("WS Message Error", e); }
                };

                socket.onclose = () => {
                    console.warn("WebSocket disconnected. Reconnecting in 5s...");
                    setTimeout(connect, 5000);
                };

                socket.onerror = (err) => {
                    console.error("WebSocket Error", err);
                    socket.close();
                };
            };

            connect();
        };

        watch(showSettings, (val) => {
            if (!val && window.lucide) {
                // re-render icons when modal closes if needed
                setTimeout(() => window.lucide.createIcons(), 100);
            }
        });

        // Liberar Wake Lock quando o componente for desmontado
        onUnmounted(() => {
            releaseWakeLock();
        });

        return {
            config,
            tempConfig,
            columns,
            lastUpdated,
            progress,
            showSettings,
            openSettings,
            saveSettings,
            setoresList,
            andamentosList,
            toggleAndamento,
            addColumn,
            removeColumn,
            adjustColumns
        };
    }
}).mount('#app');
