const { createApp, ref, computed, onMounted, onUnmounted, nextTick } = Vue;

createApp({
    setup() {
        const apiPort = window.SAGRA_API_PORT || window.location.port || 8001;
        const API_BASE_URL = `http://${window.location.hostname}:${apiPort}/api`;
        const XPOSE_STATUS_URL = window.SAGRA_XPOSE_STATUS_URL || `${API_BASE_URL}/gravacao/xpose/status`;

        const state = ref({ queue: [], printed: [], meta: { errors: [], generated_at: null, source_paths: {} } });
        const queueHead = ref({ totalOs: 0, totalChapas: 0, entries: [] });
        const xposeState = ref({ tickets: [], paths: [], meta: {} });
        const osDetailsCache = ref({});
        const loading = ref(false);
        const errorMsg = ref(null);
        const lastUpdated = ref('—');
        const pollMs = ref(5000);
        const nowTick = ref(Date.now());

        let pollTimer = null;
        let tickTimer = null;
        let wsTimer = null;
        const wsRef = ref(null);
        const wsReady = ref(false);

        const printedStatusSet = new Set(['printed', 'done', 'completed', 'successo', 'success']);
        const statusOrder = ['printing', 'part printed', 'ready'];
        const pathStatusOrder = ['printing', 'ready', 'printed', 'other'];

        const parseDateSafe = (value) => {
            if (!value) return null;
            const dt = new Date(value);
            return Number.isNaN(dt.getTime()) ? null : dt;
        };

        const normalizeXposeTicket = (ticket) => {
            if (!ticket) return null;
            const nr_os = ticket.nros || ticket.nr_os || ticket.os || ticket.nr || ticket.numero_os || ticket.NroProtocolo || ticket.nrOs;
            const ano = ticket.anoos || ticket.ano_os || ticket.ano || ticket.anoTicket || ticket.AnoProtocolo || ticket.anoOs;
            const created = ticket.created || ticket.created_at || ticket.criado_em || ticket.criado || ticket.data || ticket.Data || null;
            const last_update = ticket.last_update || ticket.updated_at || ticket.atualizado_em || null;
            return {
                ...ticket,
                name: ticket.name || ticket.ticket_name || ticket.nome || ticket.caderno,
                status: ticket.status || ticket.situacao || ticket.state,
                created_at: parseDateSafe(created)?.toISOString() || created,
                last_update: parseDateSafe(last_update)?.toISOString() || last_update,
                nr_os,
                ano,
            };
        };

        const normalizeXposePath = (path, ticketNameToCad = {}) => {
            if (!path) return null;
            
            // Try to get ticket_name from various field names
            let ticketName = path.ticket_name || path.ticket || path.ticketName || path.nome_ticket;
            
            // If still not found, try to extract from path_name
            if (!ticketName && path.path_name) {
                const pathName = path.path_name.toString();
                
                // Strategy: Remove (Cad X) from start and ([CMYK]).tif from end
                // Example: "(Cad 1) 06558-06572_SM72_Pasta_FF.PDF (C).tif"
                //       -> "06558-06572_SM72_Pasta_FF.PDF"
                
                let cleaned = pathName;
                // Remove (Cad X) from the beginning
                cleaned = cleaned.replace(/^\s*\([^)]*\)\s*/, '');
                // Remove ([CMYK]).tif or similar from the end
                cleaned = cleaned.replace(/\s*\([CMYK]\)\.tif$/i, '');
                // Remove any trailing .tif if still there
                cleaned = cleaned.replace(/\.(tif|pdf|txt|tmp)$/i, '');
                
                if (cleaned && cleaned.trim().length > 2) {
                    ticketName = cleaned.trim();
                }
            }
            
            const start = path.inicio || path.start_at || path.start || path.data_inicio;
            const end = path.fim || path.end_at || path.finish_at || path.printed_at || path.data_fim;
            
            const normalized = normalizePath(
                {
                    ...path,
                    ticket_name: ticketName,
                    path_name: path.path_name || path.nome || path.name || path.chapa,
                    colour: path.colour || path.color || path.cor,
                    start_at: start,
                    printed_at: end,
                    caderno: path.caderno || ticketNameToCad[ticketName] || null,
                    status: path.status || path.situacao || path.state,
                },
                ticketNameToCad,
            );
            
            // Debug: show first few paths that fail to extract ticket_name
            if (!ticketName && path.path_name) {
                console.warn('[normalizeXposePath] Failed to extract ticket_name from:', {
                    path_name: path.path_name,
                    ticket_name: path.ticket_name,
                    ticket: path.ticket,
                    caderno: path.caderno
                });
            }
            
            return normalized;
        };

        const inferOs = (name) => {
            // DEPRECATED: This function should NOT be used anymore
            // nr_os and ano must come from database (xpose_tickets or job.inferred_os)
            // Keeping this as empty fallback for safety
            return { nr_os: null, ano: null };
        };

        const guessColour = (path) => {
            const raw = path?.raw || {};
            const direct = path?.colour || raw.Colour;
            if (direct) return direct;
            const evento = path?.descricao_evento || raw.descricao_evento || '';
            const tiff = path?.tiff || raw.TiffName || raw.TIFFName || raw.File || '';
            const source = `${evento} ${tiff}`;
            const m = source.match(/\(([CMYK])\)/i) || source.match(/[_-](C|M|Y|K)(?:\.|$)/i);
            return m ? m[1].toUpperCase() : null;
        };

        const extractCadColour = (path) => {
            const raw = path?.raw || {};
            const nome = path?.nome_chapa || raw.nome_chapa || '';
            const evento = path?.descricao_evento || raw.descricao_evento || '';
            const tiff = path?.tiff || raw.TiffName || raw.TIFFName || raw.File || '';
            const source = `${nome} ${evento} ${tiff}`;

            let cad = null;
            const parenMatches = source.match(/\([^\)]+\)/g) || [];
            for (const seg of parenMatches) {
                const inside = seg.replace(/[()]/g, '').trim();
                if (/^cad\s+/i.test(inside) || /cad\s+/i.test(inside)) {
                    cad = inside.replace(/^cad\s*/i, '').trim();
                    break;
                }
            }

            const colourMatch = source.match(/\(([CMYK])\)/i) || source.match(/[_-](C|M|Y|K)(?:\.|$)/i);
            const colour = colourMatch ? colourMatch[1].toUpperCase() : null;

            return { cad, colour };
        };

        const extractCaderno = (path) => {
            // If caderno is already set (legacy), extract just the "Cad XX" part
            if (path?.caderno) {
                const cadMatch = path.caderno.match(/\(Cad\s+([^)]+)\)/i);
                if (cadMatch && cadMatch[1]) {
                    return cadMatch[1].trim();
                }
                // Fallback: if caderno looks like a full path, try extractCadColour
                return extractCadColour(path).cad;
            }
            
            // Otherwise, extract from path name
            return extractCadColour(path).cad;
        };

        const normalizePath = (path, ticketNameToCad = {}) => {
            const raw = path?.raw || {};
            const status = (path?.status || raw.Status || raw.State || '').trim();
            const colour = path?.colour || raw.colour || guessColour(path);
            const caderno = path?.caderno || extractCaderno(path) || ticketNameToCad[path?.ticket_name];

            const pathName = path?.path_name || raw.path_name || path?.nome_chapa || raw.nome_chapa || path?.nome || path?.name;

            const printed_at = path?.printed_at || path?.fim || null;
            const start_at = path?.start_at || path?.inicio || null;

            const statusLabel = caderno ? `${status || '—'} · Cad ${caderno}` : (status || '—');

            return {
                ...path,
                raw,
                colour,
                path_name: pathName,
                status: status || '—',
                status_label: statusLabel,
                caderno,
                printed_at,
                start_at,
            };
        };

        const normalizeJob = (job) => {
            if (!job) return null;
            const raw = job.raw || {};
            const status = job.status || raw.Status || '—';
            const template = job.template || raw.Template || '—';
            const priority = job.priority || raw.Priority || '—';
            const machine = (job.media && job.media.name) || raw.MediaName || job.machine_serial_number || '—';
            const created_at = job.created_at || job.created_at_raw || raw.Created || null;
            const printed_at = job.printed_at || job.printed_at_raw || raw.Printed || null;

            const paths = Array.isArray(job.paths) ? job.paths.map(normalizePath) : [];

            const plates_total = paths.length || job.metrics?.plates_total || 0;
            const plates_printed = paths.filter((p) => printedStatusSet.has((p.status || '').toLowerCase()) || p.printed_at).length;
            const progress_pct = plates_total ? Math.round((plates_printed / plates_total) * 100) : null;

            const metrics = {
                ...job.metrics,
                plates_total,
                plates_printed,
                progress_pct,
            };

            // Use inferred_os from backend (xpose_tickets or database)
            // If backend didn't fill ano, try to extract from created_at year
            let inferred_os = job.inferred_os || { nr_os: null, ano: null };
            if (inferred_os.nr_os && !inferred_os.ano && created_at) {
                const dateObj = new Date(created_at);
                if (!Number.isNaN(dateObj.getTime())) {
                    inferred_os = { ...inferred_os, ano: dateObj.getFullYear().toString() };
                }
            }

            return {
                ...job,
                raw,
                status,
                template,
                priority,
                machine,
                created_at,
                printed_at,
                paths,
                metrics,
                inferred_os,
            };
        };

        const statusRank = (s) => {
            const v = (s || '').toLowerCase();
            const idx = statusOrder.findIndex((x) => v.startsWith(x));
            return idx >= 0 ? idx : statusOrder.length;
        };

        const mergeJobsByOs = (jobs) => {
            const map = new Map();
            for (const job of jobs) {
                const nr = job?.inferred_os?.nr_os;
                const ano = job?.inferred_os?.ano;
                const keyFull = nr ? `${nr}-${ano || ''}` : null;
                const keyNrOnly = nr || null;
                const fallbackKey = job?.name || Math.random().toString();

                const chosenKey =
                    (keyFull && map.has(keyFull) && keyFull) ||
                    (keyNrOnly && map.has(keyNrOnly) && keyNrOnly) ||
                    keyFull ||
                    keyNrOnly ||
                    fallbackKey;

                if (!map.has(chosenKey)) {
                    map.set(chosenKey, { ...job, paths: [...(job.paths || [])] });
                    // If we keyed by nr only but have a full key alternative, also alias the full key
                    if (nr && !map.has(keyNrOnly)) {
                        map.set(keyNrOnly, map.get(chosenKey));
                    }
                    if (nr && keyFull && !map.has(keyFull)) {
                        map.set(keyFull, map.get(chosenKey));
                    }
                    continue;
                }
                const curr = map.get(chosenKey);
                if (statusRank(job.status) < statusRank(curr.status)) {
                    curr.status = job.status;
                }
                if (!curr.created_at || (job.created_at && job.created_at < curr.created_at)) {
                    curr.created_at = job.created_at;
                }
                if (job.printed_at && (!curr.printed_at || job.printed_at > curr.printed_at)) {
                    curr.printed_at = job.printed_at;
                }
                curr.produto = curr.produto || job.produto;
                curr.solicitante = curr.solicitante || job.solicitante;
                curr.template = curr.template || job.template;
                curr.machine = curr.machine || job.machine;
                const seen = new Set(curr.paths.map((p) => `${p.caderno || ''}|${p.colour || ''}|${p.printed_at || ''}`));
                for (const p of job.paths || []) {
                    const k = `${p.caderno || ''}|${p.colour || ''}|${p.printed_at || ''}`;
                    if (!seen.has(k)) {
                        curr.paths.push(p);
                        seen.add(k);
                    }
                }
                map.set(chosenKey, curr);
                if (nr && keyNrOnly) map.set(keyNrOnly, curr);
                if (nr && keyFull) map.set(keyFull, curr);
            }

            return Array.from(new Set(map.values())).map((j) => {
                const total = (j.paths || []).length;
                const printedCt = (j.paths || []).filter((p) => printedStatusSet.has((p.status || '').toLowerCase()) || p.printed_at).length;
                return {
                    ...j,
                    metrics: {
                        ...(j.metrics || {}),
                        plates_total: total,
                        plates_printed: printedCt,
                        progress_pct: total ? Math.round((printedCt / total) * 100) : null,
                    },
                };
            });
        };

        const osStatusFromTickets = (tickets = []) => {
            const statuses = tickets.map((t) => (t.status || '').toLowerCase());
            console.debug('[osStatusFromTickets] Input statuses:', statuses);
            if (statuses.some((s) => s.startsWith('printing'))) {
                console.debug('[osStatusFromTickets] Detectado: Printing');
                return 'Printing';
            }
            if (statuses.some((s) => s.startsWith('part'))) {
                console.debug('[osStatusFromTickets] Detectado: Part Printed');
                return 'Part Printed';
            }
            if (statuses.some((s) => s.startsWith('ready'))) {
                console.debug('[osStatusFromTickets] Detectado: Ready');
                return 'Ready';
            }
            const fallback = statuses[0] || 'Ready';
            console.debug('[osStatusFromTickets] Fallback:', fallback);
            return fallback;
        };

        const buildJobsFromXpose = (ticketsRaw, pathsRaw) => {
            console.log('[buildJobsFromXpose] Starting with', {
                ticketsCount: Array.isArray(ticketsRaw) ? ticketsRaw.length : 'not-array',
                pathsCount: Array.isArray(pathsRaw) ? pathsRaw.length : 'not-array',
            });
            
            const tickets = Array.isArray(ticketsRaw) ? ticketsRaw.map(normalizeXposeTicket).filter(Boolean) : [];
            const ticketMap = new Map();
            const ticketNameToCad = {};

            tickets.forEach((t) => {
                ticketMap.set(t.name, t);
                ticketNameToCad[t.name] = t.name;
            });

            const paths = Array.isArray(pathsRaw) ? pathsRaw.map((p) => normalizeXposePath(p, ticketNameToCad)).filter(Boolean) : [];
            
            // Debug: show first few paths
            console.log('[buildJobsFromXpose] Normalized tickets sample:', tickets.slice(0, 3).map(t => ({name: t.name, status: t.status, nr_os: t.nr_os, ano: t.ano})));
            console.log('[buildJobsFromXpose] Normalized paths sample:', paths.slice(0, 3).map(p => ({ticket_name: p.ticket_name, path_name: p.path_name, status: p.status})));
            const osMap = new Map();

            const ensureGroup = (nr_os, ano, fallbackKey) => {
                const key = nr_os ? `${nr_os}-${ano || ''}` : fallbackKey || Math.random().toString();
                if (!osMap.has(key)) {
                    osMap.set(key, {
                        key,
                        nr_os,
                        ano,
                        tickets: [],
                        paths: [],
                        created_at: null,
                        last_update: null,
                    });
                }
                return osMap.get(key);
            };

            tickets.forEach((t) => {
                const group = ensureGroup(t.nr_os, t.ano, t.name);
                group.tickets.push(t);
                if (!group.created_at || (t.created_at && t.created_at < group.created_at)) {
                    group.created_at = t.created_at;
                }
                if (!group.last_update || (t.last_update && t.last_update > group.last_update)) {
                    group.last_update = t.last_update;
                }
            });

            paths.forEach((p) => {
                const ticket = ticketMap.get(p.ticket_name);
                // Use ticket's nr_os/ano if available (from xpose_tickets database)
                const inferred = ticket && ticket.nr_os 
                    ? { nr_os: ticket.nr_os, ano: ticket.ano } 
                    : { nr_os: null, ano: null };
                const group = ensureGroup(inferred.nr_os, inferred.ano, p.ticket_name || p.path_name || p.caderno);
                
                // IMPORTANT: Ensure ticket_name is always set so ticketPathGroups can group correctly
                const pathWithTicket = { 
                    ...p, 
                    ticket_name: p.ticket_name || ticket?.name || null,
                    caderno: p.caderno || ticket?.name || p.ticket_name 
                };
                group.paths.push(pathWithTicket);
                
                if (!group.created_at && ticket?.created_at) {
                    group.created_at = ticket.created_at;
                }
                if ((!group.last_update || (ticket?.last_update && ticket.last_update > group.last_update)) && ticket?.last_update) {
                    group.last_update = ticket.last_update;
                }
            });

            const jobs = [];
            const completedJobs = [];

            for (const group of osMap.values()) {
                const status = osStatusFromTickets(group.tickets);
                const total = group.paths.length;
                const completedPaths = group.paths.filter((p) => p.printed_at || printedStatusSet.has((p.status || '').toLowerCase()));
                const lastPrintedAt = completedPaths.reduce((acc, p) => {
                    if (!p.printed_at) return acc;
                    if (!acc) return p.printed_at;
                    return p.printed_at > acc ? p.printed_at : acc;
                }, null);
                const durations = group.paths
                    .map((p) => {
                        const start = parseDateSafe(p.start_at || p.inicio);
                        const end = parseDateSafe(p.printed_at || p.fim);
                        if (!start || !end) return null;
                        const diff = (end - start) / 1000;
                        return diff > 0 ? diff : null;
                    })
                    .filter((v) => typeof v === 'number');

                const avgSeconds = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
                const remaining = Math.max(0, total - completedPaths.length);
                const etaSeconds = avgSeconds ? remaining * avgSeconds : null;
                const etaDate = etaSeconds ? new Date(Date.now() + etaSeconds * 1000) : null;

                const job = {
                    key: group.key,
                    name: group.tickets[0]?.name || `OS ${group.nr_os || '—'}/${group.ano || ''}`,
                    status,
                    created_at: group.created_at,
                    last_update: group.last_update,
                    printed_at: lastPrintedAt,
                    machine: 'XPose',
                    inferred_os: { nr_os: group.nr_os, ano: group.ano },
                    paths: group.paths,
                    tickets: group.tickets,
                    metrics: {
                        plates_total: total,
                        plates_printed: completedPaths.length,
                        progress_pct: total ? Math.round((completedPaths.length / total) * 100) : null,
                        avgSeconds,
                        etaSeconds,
                        etaDate,
                    },
                };

                if (total && completedPaths.length === total) {
                    job.status = 'Printed';
                }

                jobs.push(job);
                if (total && completedPaths.length === total) {
                    completedJobs.push(job);
                }
            }

            const readyTickets = tickets.filter((t) => (t.status || '').toLowerCase().startsWith('ready'));
            const readyTicketNames = new Set(readyTickets.map((t) => t.name));

            const readyOsMap = new Map();
            readyTickets.forEach((t) => {
                const key = `${t.nr_os || t.nros || ''}-${t.ano || t.anoos || ''}`;
                if (!readyOsMap.has(key)) {
                    readyOsMap.set(key, { os: { nr_os: t.nr_os || t.nros, ano: t.ano || t.anoos }, chapas: 0, created_at: t.created_at });
                }
            });

            paths.forEach((p) => {
                if (!readyTicketNames.has(p.ticket_name)) return;
                const statusReady = (p.status || '').toLowerCase().startsWith('ready');
                if (!statusReady) return;
                const ticket = ticketMap.get(p.ticket_name);
                const key = `${ticket?.nr_os || ''}-${ticket?.ano || ''}`;
                const entry = readyOsMap.get(key);
                if (entry) {
                    entry.chapas += 1;
                    if (!entry.created_at && ticket?.created_at) {
                        entry.created_at = ticket.created_at;
                    }
                }
            });

            const readyEntries = Array.from(readyOsMap.values()).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
            const readyStats = {
                totalOs: readyEntries.length,
                totalChapas: readyEntries.reduce((acc, item) => acc + (item.chapas || 0), 0),
                entries: readyEntries,
            };

            return { jobs, readyStats, completedJobs };
        };

        const fetchOsDetails = async (nr_os, ano) => {
            if (!nr_os || !ano) return null;
            const key = `${nr_os}-${ano}`;
            if (osDetailsCache.value[key]) {
                return osDetailsCache.value[key];
            }
            try {
                const resp = await fetch(`${API_BASE_URL}/os/${ano}/${nr_os}/details`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                osDetailsCache.value = { ...osDetailsCache.value, [key]: data };
                return data;
            } catch (err) {
                osDetailsCache.value = { ...osDetailsCache.value, [key]: null };
                return null;
            }
        };

        const hydrateOsDetails = async (jobs) => {
            const targets = jobs.filter((j) => j?.inferred_os?.nr_os && j?.inferred_os?.ano);
            await Promise.all(
                targets.map(async (job) => {
                    const det = await fetchOsDetails(job.inferred_os.nr_os, job.inferred_os.ano);
                    if (det) {
                        job.produto = det.TipoPublicacaoLink || det.produto || job.produto;
                        job.titulo = det.Titulo || det.titulo || job.titulo;
                        job.solicitante = det.NomeUsuario || det.solicitante || job.solicitante;
                        job.created_at = job.created_at || det.DataEntrada;
                    }
                }),
            );
            return jobs;
        };

        const sortedQueue = computed(() => {
            const items = Array.isArray(state.value.queue) ? state.value.queue.map(normalizeJob).filter(Boolean) : [];
            const merged = mergeJobsByOs(items).filter((j) => (j.status || '').toLowerCase() !== 'printed');
            const sorted = merged.sort((a, b) => {
                const ra = statusRank(a.status);
                const rb = statusRank(b.status);
                if (ra !== rb) return ra - rb;
                return (b.created_at || '').localeCompare(a.created_at || '');
            });
            
            if (sorted.length > 0) {
                console.log('[sortedQueue] Queue has', sorted.length, 'items:', sorted.map(j => ({
                    name: j.name,
                    status: j.status,
                    statusLower: (j.status || '').toLowerCase(),
                    isPrinting: (j.status || '').toLowerCase().startsWith('printing')
                })));
            }
            
            return sorted;
        });


        const printingJobs = computed(() => {
            const items = sortedQueue.value.filter((j) => (j.status || '').toLowerCase().startsWith('printing'));
            if (items.length > 0) {
                console.log('[printingJobs] Found printing jobs:', items.map(j => ({name: j.name, status: j.status})));
            }
            return [...items].sort((a, b) => {
                const ca = a.created_at || '';
                const cb = b.created_at || '';
                if (ca !== cb) return ca.localeCompare(cb);
                const osa = a.inferred_os?.nr_os || '';
                const osb = b.inferred_os?.nr_os || '';
                return osa.localeCompare(osb);
            });
        });

        const currentPrintingJob = computed(() => printingJobs.value[0] || null);

        const getCurrentPrintingJob = () => currentPrintingJob.value;

        const liveJobs = computed(() => {
            console.log('[liveJobs] Computing live jobs. printingJobs:', printingJobs.value.length);
            if (printingJobs.value.length) {
                console.log('[liveJobs] Returning printing jobs:', printingJobs.value.map(j => j.name));
                return printingJobs.value;
            }
            const partPrinted = sortedQueue.value.filter((j) => (j.status || '').toLowerCase().startsWith('part printed'));
            if (partPrinted.length) {
                console.log('[liveJobs] Returning part printed job:', partPrinted[0].name);
                return [partPrinted[0]];
            }
            const ready = sortedQueue.value.filter((j) => (j.status || '').toLowerCase().startsWith('ready'));
            if (ready.length) return [ready[0]];
            return [];
        });

        const queueNonPrinting = computed(() => {
            const liveKeys = new Set(liveJobs.value.map((j) => j.key || j.name));
            return sortedQueue.value.filter((j) => {
                const v = (j.status || '').toLowerCase();
                return v !== 'printed' && !v.startsWith('printing') && !liveKeys.has(j.key || j.name);
            });
        });

        const printedJobs = computed(() => {
            const explicitPrinted = Array.isArray(state.value.printed) ? state.value.printed : [];
            const fromQueue = Array.isArray(state.value.queue)
                ? state.value.queue.filter((j) => (j.status || '').toLowerCase() === 'printed')
                : [];
            const items = [...explicitPrinted, ...fromQueue].map(normalizeJob).filter(Boolean);
            const merged = mergeJobsByOs(items);
            return merged.sort((a, b) => (b.printed_at || '').localeCompare(a.printed_at || ''));
        });

        const totalPlates = computed(() => {
            const queuePlates = sortedQueue.value.reduce((acc, job) => acc + (job.metrics?.plates_total || 0), 0);
            const printedPlates = printedJobs.value.reduce((acc, job) => acc + (job.metrics?.plates_total || 0), 0);
            return { queuePlates, printedPlates };
        });

        // --- JobTicket events (on-demand) ---
        const historyCache = ref({}); // key: job.name -> { loading, error, events }

        const loadingHistory = (job) => {
            if (!job?.name) return false;
            const entry = historyCache.value[job.name];
            return entry?.loading === true;
        };

        const historyFor = (job) => {
            if (!job?.name) return { events: [], error: null };
            return historyCache.value[job.name] || { events: [], error: null };
        };

        const openHistory = async (job) => {
            if (!job?.name || !job?.template) {
                historyCache.value = {
                    ...historyCache.value,
                    [job?.name || '']: { loading: false, error: 'Histórico de gravação não disponível.', events: [] }
                };
                return;
            }

            const key = job.name;
            historyCache.value = { ...historyCache.value, [key]: { loading: true, error: null, events: [] } };

            const params = new URLSearchParams({ template: job.template, name: job.name });
            const url = `${API_BASE_URL}/gravacao/jobticket?${params.toString()}`;

            try {
                const resp = await fetch(url);
                if (!resp.ok) {
                    const text = await resp.text();
                    throw new Error(text || `HTTP ${resp.status}`);
                }
                const data = await resp.json();
                historyCache.value = { ...historyCache.value, [key]: { loading: false, error: data.error || null, events: data.events || [] } };
            } catch (err) {
                historyCache.value = { ...historyCache.value, [key]: { loading: false, error: err?.message || 'Histórico de gravação não disponível.', events: [] } };
            }
        };

        const applyLegacyPayload = async (data) => {
            console.log('[applyLegacyPayload] Incoming data structure:');
            console.log('  queue:', data.queue?.length, 'items');
            if (data.queue && data.queue.length > 0) {
                const firstJob = data.queue[0];
                console.log('  First job:', {
                    name: firstJob.name,
                    inferred_os: firstJob.inferred_os,
                    hasTickets: Array.isArray(firstJob.tickets),
                    ticketsCount: firstJob.tickets?.length,
                    hasPaths: Array.isArray(firstJob.paths),
                    pathsCount: firstJob.paths?.length,
                    firstPath: firstJob.paths?.[0]
                });
            }
            state.value = data;
            
            // Calculate queue head stats: count distinct OS with Ready status and chapas Ready
            const readyJobs = (data.queue || []).filter(j => (j.status || '').toLowerCase().includes('ready'));
            const readyOsMap = new Map(); // Key: "nr_os-ano", consolidates multiple jobs with same OS
            let readyChapasCount = 0;
            
            readyJobs.forEach(job => {
                // Only count valid OS numbers (not "00000" or empty)
                if (job.inferred_os?.nr_os && job.inferred_os.nr_os !== '00000' && job.inferred_os.nr_os !== '0') {
                    const osKey = `${job.inferred_os.nr_os}-${job.inferred_os.ano || ''}`;
                    
                    const readyPaths = (job.paths || []).filter(p => (p.status || '').toLowerCase().includes('ready'));
                    readyChapasCount += readyPaths.length;
                    
                    // Consolidate: if same OS already exists, add chapas count
                    if (readyOsMap.has(osKey)) {
                        const existing = readyOsMap.get(osKey);
                        existing.chapas += readyPaths.length;
                        if (job.created_at && (!existing.created_at || job.created_at < existing.created_at)) {
                            existing.created_at = job.created_at;
                        }
                    } else {
                        readyOsMap.set(osKey, {
                            key: osKey,
                            os: job.inferred_os,
                            chapas: readyPaths.length,
                            created_at: job.created_at
                        });
                    }
                }
            });
            
            const entries = Array.from(readyOsMap.values())
                .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
            
            console.log('[applyLegacyPayload] Queue head entries:', entries.slice(0, 3));
            
            queueHead.value = { 
                totalOs: readyOsMap.size, 
                totalChapas: readyChapasCount, 
                entries
            };
            
            errorMsg.value = null;
            lastUpdated.value = new Date().toLocaleTimeString();
            await nextTick();
            if (window.lucide?.createIcons) {
                window.lucide.createIcons();
            }
        };

        const applyXposePayload = async (data) => {
            console.log('[applyXposePayload] Received data:', {
                hasTickets: Array.isArray(data?.tickets),
                ticketsCount: Array.isArray(data?.tickets) ? data.tickets.length : null,
                hasPaths: Array.isArray(data?.paths),
                pathsCount: Array.isArray(data?.paths) ? data.paths.length : null,
                errors: data?.meta?.errors,
            });
            
            const hasXposeData = Array.isArray(data?.tickets) && Array.isArray(data?.paths);
            if (!hasXposeData) {
                throw new Error('Resposta sem dados de xpose_tickets/xpose_paths');
            }
            const { jobs, readyStats, completedJobs } = buildJobsFromXpose(data.tickets, data.paths);
            console.log('[applyXposePayload] Built jobs:', {
                jobsCount: jobs.length,
                completedJobsCount: completedJobs.length,
                printingJobs: jobs.filter(j => (j.status || '').toLowerCase().startsWith('printing')).length,
            });
            
            const enrichedJobs = await hydrateOsDetails(jobs);
            const meta = data.meta || {};
            state.value = {
                queue: enrichedJobs,
                printed: completedJobs,
                meta: {
                    errors: meta.errors || [],
                    generated_at: meta.generated_at || null,
                    source_paths: meta.source_paths || {},
                },
            };
            xposeState.value = { tickets: data.tickets || [], paths: data.paths || [], meta: data.meta || {} };
            queueHead.value = readyStats;
            errorMsg.value = null;
            lastUpdated.value = new Date().toLocaleTimeString();
            console.log('[applyXposePayload] State updated. liveJobs will be computed from:',
                printingJobs.value.length + ' printing jobs'
            );
            await nextTick();
            if (window.lucide?.createIcons) {
                window.lucide.createIcons();
            }
        };

        const fetchData = async () => {
            loading.value = true;
            errorMsg.value = null;
            console.log('[fetchData] Starting fetch from:', XPOSE_STATUS_URL);
            try {
                const response = await fetch(XPOSE_STATUS_URL, { cache: 'no-cache' });
                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`HTTP ${response.status} ${response.statusText || ''} – ${text || XPOSE_STATUS_URL}`.trim());
                }
                const data = await response.json();
                console.log('[fetchData] XPose endpoint returned successfully');
                await applyXposePayload(data);
            } catch (errXpose) {
                console.warn('Fallback para payload legado após falha no xpose:', errXpose?.message || errXpose);
                try {
                    const legacyUrl = `${API_BASE_URL}/gravacao/status`;
                    const response = await fetch(legacyUrl, { cache: 'no-cache' });
                    if (!response.ok) {
                        const text = await response.text();
                        throw new Error(`HTTP ${response.status} ${response.statusText || ''} – ${text || legacyUrl}`.trim());
                    }
                    const data = await response.json();
                    console.log('[fetchData] Legacy endpoint returned successfully');
                    await applyLegacyPayload(data);
                } catch (errLegacy) {
                    console.error('Erro ao buscar gravação:', errLegacy);
                    errorMsg.value = errLegacy?.message || errXpose?.message || 'Falha ao carregar dados';
                    state.value = { queue: [], printed: [], meta: { errors: [], generated_at: null, source_paths: {} } };
                    queueHead.value = { totalOs: 0, totalChapas: 0, entries: [] };
                }
            } finally {
                loading.value = false;
            }
        };

        const formatDateTime = (value) => {
            if (!value) return '—';
            const dt = new Date(value);
            if (Number.isNaN(dt.getTime())) return value;
            return dt.toLocaleString('pt-BR', { hour12: false });
        };

        const formatDuration = (seconds) => {
            if (seconds === 0) return '0s';
            if (!seconds || Number.isNaN(seconds)) return '—';
            const s = Math.max(0, Math.round(seconds));
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const rem = s % 60;
            const parts = [];
            if (h) parts.push(`${h}h`);
            if (m) parts.push(`${m}m`);
            if (!h && rem) parts.push(`${rem}s`);
            return parts.join(' ') || `${rem}s`;
        };

        const elapsedFor = (job) => {
            const sec = job?.metrics?.elapsed_seconds;
            if (typeof sec === 'number') return formatDuration(sec);
            const created = job?.created_at ? new Date(job.created_at) : null;
            if (created && !Number.isNaN(created.getTime())) {
                const diff = (nowTick.value - created.getTime()) / 1000;
                return formatDuration(diff);
            }
            return '—';
        };

        const durationFor = (job) => {
            const sec = job?.metrics?.duration_seconds;
            if (typeof sec === 'number') return formatDuration(sec);
            if (job?.created_at && job?.printed_at) {
                const a = new Date(job.created_at);
                const b = new Date(job.printed_at);
                if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
                    return formatDuration((b - a) / 1000);
                }
            }
            return '—';
        };

        const progressPct = (job) => {
            if (!job?.metrics?.plates_total) return null;
            const pct = job.metrics.progress_pct;
            if (typeof pct === 'number') return Math.min(100, Math.max(0, pct));
            const printed = job.metrics.plates_printed || 0;
            const total = job.metrics.plates_total;
            return Math.round((printed / total) * 100);
        };

        const plateStats = (job) => {
            const total = job?.metrics?.plates_total || 0;
            const printed = job?.metrics?.plates_printed || 0;

            const durations = Array.isArray(job?.paths)
                ? job.paths
                    .map((p) => {
                        const start = parseDateSafe(p.start_at || p.inicio);
                        const end = parseDateSafe(p.printed_at || p.fim);
                        if (!start || !end) return null;
                        const diff = (end - start) / 1000;
                        return diff > 0 ? diff : null;
                    })
                    .filter((v) => typeof v === 'number')
                : [];

            const avgSeconds = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
            const remaining = Math.max(0, total - printed);
            const etaSeconds = avgSeconds ? remaining * avgSeconds : null;
            const etaDate = etaSeconds ? new Date(Date.now() + etaSeconds * 1000) : null;

            return { total, printed, avgSeconds, etaSeconds, etaDate };
        };

        const statusClass = (status) => {
            const val = (status || '').toLowerCase();
            if (val === 'printed') return 'ok';
            if (val.includes('ready') || val.includes('waiting') || val.includes('printing') || val.includes('part')) return 'warn';
            return '';
        };

        const isPrinting = (job) => ((job?.status || '').toLowerCase().startsWith('printing'));

        const pathClass = (path) => {
            const val = (path?.status || '').toLowerCase();
            if (printedStatusSet.has(val) || path?.printed_at) return 'ok';
            if (val.includes('ready') || val.includes('waiting') || val.includes('printing')) return 'warn';
            return '';
        };

        const colourOrder = { C: 0, M: 1, Y: 2, K: 3 };

        const normalizePlateStatus = (path) => {
            const val = (path?.status || '').toLowerCase();
            if (printedStatusSet.has(val) || val === 'printed' || path?.printed_at) return 'printed';
            if (val.includes('print')) return 'printing';
            if (val.includes('ready') || val.includes('waiting')) return 'ready';
            return 'other';
        };

        const pathStatusRank = (path) => {
            const key = normalizePlateStatus(path);
            const idx = pathStatusOrder.indexOf(key);
            return idx >= 0 ? idx : pathStatusOrder.length;
        };

        const ticketPathGroups = (job) => {
            if (!job) return [];
            const ticketList = Array.isArray(job.tickets) ? job.tickets : [];
            const pathList = Array.isArray(job.paths) ? job.paths : [];
            const byTicket = new Map();

            // Analyze what we have
            const uniqueTicketNames = new Set(pathList.map(p => p.ticket_name).filter(Boolean));
            const uniqueCadernos = new Set(pathList.map(p => p.caderno).filter(Boolean));

            console.log('[ticketPathGroups DEBUG]', {
                jobName: job.name,
                ticketsCount: ticketList.length,
                pathsCount: pathList.length,
                uniqueTicketNames: Array.from(uniqueTicketNames),
                uniqueCadernos: Array.from(uniqueCadernos),
                shouldGroupByCaderno: uniqueCadernos.size > 1 && uniqueTicketNames.size === 0
            });

            // First, add explicit tickets from job.tickets
            ticketList.forEach((t) => {
                const key = t.name || t.ticket_name;
                if (!key) return;
                byTicket.set(key, { ticket: t, paths: [] });
            });

            // Decide grouping strategy
            const shouldGroupByCaderno = uniqueCadernos.size > 1 && uniqueTicketNames.size === 0;

            // Group paths
            pathList.forEach((p) => {
                let key = null;

                // PRIMARY: use ticket_name if available
                if (p.ticket_name) {
                    key = p.ticket_name;
                } 
                // SECONDARY: use caderno only if we have multiple different cadernos (legacy multi-group)
                else if (shouldGroupByCaderno && p.caderno) {
                    // Extract just "Cad XX" part from full path
                    const cadMatch = p.caderno.match(/\(Cad\s+([^)]+)\)/i);
                    key = cadMatch ? `Cad ${cadMatch[1]}` : p.caderno;
                }

                // If we have a key, use it
                if (key) {
                    if (!byTicket.has(key)) {
                        byTicket.set(key, { ticket: { name: key, status: job.status }, paths: [] });
                    }
                    byTicket.get(key).paths.push(p);
                    return;
                }

                // Fallback: if we still have no key, add to first group or create default
                if (byTicket.size > 0) {
                    const firstKey = Array.from(byTicket.keys())[0];
                    byTicket.get(firstKey).paths.push(p);
                } else {
                    const defaultKey = job.name || 'Trabalho';
                    if (!byTicket.has(defaultKey)) {
                        byTicket.set(defaultKey, { ticket: { name: defaultKey, status: job.status }, paths: [] });
                    }
                    byTicket.get(defaultKey).paths.push(p);
                }
            });

            const groups = Array.from(byTicket.values());
            console.log('[ticketPathGroups RESULT]', {
                groupsCount: groups.length,
                groups: groups.map(g => ({ ticket: g.ticket.name, pathsCount: g.paths.length }))
            });
            groups.sort((a, b) => (a.ticket?.created_at || '').localeCompare(b.ticket?.created_at || '') || (a.ticket?.name || '').localeCompare(b.ticket?.name || ''));
            groups.forEach((g) => {
                g.paths.sort((a, b) => {
                    const sa = parseDateSafe(a.start_at || a.inicio);
                    const sb = parseDateSafe(b.start_at || b.inicio);
                    if (sa && sb && sa.getTime() !== sb.getTime()) return sa - sb;
                    const na = (a.path_name || '').toString();
                    const nb = (b.path_name || '').toString();
                    return na.localeCompare(nb);
                });
            });
            return groups;
        };
        const orderedPaths = (job) => {
            const paths = Array.isArray(job?.paths) ? [...job.paths] : [];
            return paths.sort((a, b) => {
                const cadA = (a?.caderno || '').toString();
                const cadB = (b?.caderno || '').toString();
                if (cadA && cadB && cadA !== cadB) return cadA.localeCompare(cadB);
                const nameA = (a?.path_name || '').toString();
                const nameB = (b?.path_name || '').toString();
                if (nameA && nameB && nameA !== nameB) return nameA.localeCompare(nameB);
                const ca = colourOrder[a?.colour] ?? 99;
                const cb = colourOrder[b?.colour] ?? 99;
                return ca - cb;
            });
        };

        const getOrderedPlates = (job) => {
            const paths = Array.isArray(job?.paths) ? [...job.paths] : [];
            paths.sort((a, b) => {
                const ra = pathStatusRank(a);
                const rb = pathStatusRank(b);
                if (ra !== rb) return ra - rb;
                const ca = colourOrder[a?.colour] ?? 99;
                const cb = colourOrder[b?.colour] ?? 99;
                return ca - cb;
            });

            const buckets = { printing: [], ready: [], printed: [], other: [] };
            for (const p of paths) {
                const key = normalizePlateStatus(p);
                buckets[key].push(p);
            }

            return pathStatusOrder
                .map((key) => ({
                    key,
                    label:
                        key === 'printing'
                            ? 'Chapa sendo gravada'
                            : key === 'ready'
                                ? 'Pendentes'
                                : key === 'printed'
                                    ? 'Gravadas'
                                    : 'Outras',
                    items: buckets[key],
                }))
                .filter((g) => g.items.length);
        };

        const getPlateGroups = (job) => {
            const paths = Array.isArray(job?.paths) ? job.paths.map((p, idx) => ({ ...p, _idx: idx })) : [];
            const printing = paths.filter((p) => normalizePlateStatus(p) === 'printing');
            const ready = paths.filter((p) => normalizePlateStatus(p) === 'ready');
            const printed = paths
                .filter((p) => normalizePlateStatus(p) === 'printed')
                .sort((a, b) => (b.printed_at || '').localeCompare(a.printed_at || ''));

            const groups = [];
            if (printing.length) {
                groups.push({ key: 'printing', label: 'Gravando agora', items: printing.slice(0, 1) });
            }
            if (ready.length) {
                groups.push({ key: 'ready', label: 'Pendentes', items: ready });
            }
            if (printed.length) {
                groups.push({ key: 'printed', label: 'Gravadas', items: printed });
            }
            return groups;
        };

        const getPlateRows = (job) => {
            const paths = Array.isArray(job?.paths) ? job.paths : [];
            const statusRanked = paths.map((p, idx) => ({ ...p, _idx: idx, _status: normalizePlateStatus(p) }));
            statusRanked.sort((a, b) => {
                const cadA = (a.caderno || '').toString();
                const cadB = (b.caderno || '').toString();
                if (cadA && cadB && cadA !== cadB) return cadA.localeCompare(cadB);

                const nameA = (a.path_name || '').toString();
                const nameB = (b.path_name || '').toString();
                if (nameA && nameB && nameA !== nameB) return nameA.localeCompare(nameB);

                const ra = pathStatusRank(a);
                const rb = pathStatusRank(b);
                if (ra !== rb) return ra - rb;
                if (a._status === 'printed' && b._status === 'printed') {
                    return (b.printed_at || '').localeCompare(a.printed_at || '');
                }
                return (a._idx || 0) - (b._idx || 0);
            });
            return statusRanked.map((p) => ({
                ...p,
                status_normalized: p._status,
            }));
        };

        const pathLabel = (path) => {
            if (!path) return '—';
            const parsed = extractCadColour(path);
            const cad = path.caderno || path.numero_caderno || path.cad || parsed.cad;
            const colour = (path.colour || path.color || parsed.colour || '').toString().toUpperCase();
            const name = path.path_name || path.nome_chapa || path.nome || path.name;
            const parts = [];
            if (cad) parts.push(`Cad ${cad}`);
            if (name) parts.push(name);
            if (colour) parts.push(`Cor ${colour}`);
            return parts.join(' · ') || 'Chapa';
        };

        const cleanPathName = (rawName = '', ticketName = '') => {
            if (!rawName) return '';
            let name = rawName;
            if (ticketName) {
                try {
                    const re = new RegExp(`^\s*${ticketName}\s*[-_]?\s*`, 'i');
                    name = name.replace(re, '');
                } catch (err) {
                    /* ignore regex errors */
                }
            }
            name = name.replace(/^cad\s*\(?\d+\)?[-_\s]*/i, '');
            return name.trim();
        };

        const pathDisplay = (path, ticketName = '') => {
            const base = path?.path_name || pathLabel(path) || '';
            const cleaned = cleanPathName(base, ticketName || path?.caderno || '');
            return cleaned || base || 'Chapa';
        };

        const shortName = (job) => {
            if (!job) return '—';
            const inferred = job.inferred_os || {};
            const osText = inferred.nr_os ? `${inferred.nr_os}${inferred.ano ? '/' + String(inferred.ano).slice(-2) : ''}` : (job.name || '—');
            const produto = job.produto || job.name || '—';
            return `${osText} - ${produto}`;
        };

        const osLabel = (job) => {
            const inferred = job?.inferred_os || {};
            if (inferred.nr_os && inferred.ano) return `OS ${inferred.nr_os}/${String(inferred.ano).slice(-2)}`;
            if (inferred.nr_os) return `OS ${inferred.nr_os}`;
            return null;
        };

        const timeline = (job) => {
            const events = Array.isArray(job?.history) ? job.history : [];
            return events.slice(-3);
        };

        const startAutoRefresh = () => {
            if (pollTimer) return;
            pollTimer = setInterval(fetchData, pollMs.value);
        };

        const stopAutoRefresh = () => {
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = null;
        };

        const stopWebSocket = () => {
            if (wsTimer) {
                clearTimeout(wsTimer);
                wsTimer = null;
            }
            if (wsRef.value) {
                wsRef.value.onopen = null;
                wsRef.value.onmessage = null;
                wsRef.value.onerror = null;
                wsRef.value.onclose = null;
                wsRef.value.close();
                wsRef.value = null;
            }
            wsReady.value = false;
        };

        const startWebSocket = () => {
            if (!('WebSocket' in window)) return;
            stopWebSocket();
            const wsUrl = API_BASE_URL.replace(/^http/i, 'ws') + '/gravacao/status/ws';
            try {
                const ws = new WebSocket(wsUrl);
                wsRef.value = ws;
                ws.onopen = () => {
                    wsReady.value = true;
                    stopAutoRefresh();
                };
                ws.onmessage = async (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data?.queue) {
                            await applyPayload(data);
                        }
                    } catch (err) {
                        console.warn('Falha ao interpretar WebSocket de gravacao:', err);
                    }
                };
                ws.onerror = () => {
                    wsReady.value = false;
                };
                ws.onclose = () => {
                    wsReady.value = false;
                    wsRef.value = null;
                    if (!pollTimer) startAutoRefresh();
                    if (!wsTimer) {
                        wsTimer = setTimeout(() => {
                            wsTimer = null;
                            startWebSocket();
                        }, 8000);
                    }
                };
            } catch (err) {
                console.warn('WebSocket de gravacao indisponivel:', err);
                wsReady.value = false;
                if (!pollTimer) startAutoRefresh();
            }
        };

        onMounted(() => {
            fetchData();
            startAutoRefresh();
            startWebSocket();
            tickTimer = setInterval(() => { nowTick.value = Date.now(); }, 1000);
        });

        onUnmounted(() => {
            stopAutoRefresh();
            stopWebSocket();
            if (tickTimer) {
                clearInterval(tickTimer);
                tickTimer = null;
            }
        });

        return {
            state,
            loading,
            errorMsg,
            lastUpdated,
            pollMs,
            sortedQueue,
            printingJobs,
            currentPrintingJob,
            liveJobs,
            getCurrentPrintingJob,
            queueNonPrinting,
            printedJobs,
            totalPlates,
            queueHead,
            formatDateTime,
            formatDuration,
            elapsedFor,
            durationFor,
            progressPct,
            plateStats,
            statusClass,
            isPrinting,
            pathClass,
            orderedPaths,
            getOrderedPlates,
            getPlateGroups,
            getPlateRows,
            ticketPathGroups,
            pathLabel,
            pathDisplay,
            shortName,
            osLabel,
            timeline,
            loadingHistory,
            historyFor,
            openHistory,
            fetchData,
        };
    },
}).mount('#app');
