export const queryKeys = {
  aux: {
    setores: ["aux", "setores"] as const,
    situacoes: ["aux", "situacoes"] as const,
    categorias: ["aux", "categorias"] as const,
    maquinas: ["aux", "maquinas"] as const,
    andamentos: ["aux", "andamentos"] as const,
    papeisLombada: ["aux", "papeis-lombada"] as const,
  },
  os: {
    search: (filters: unknown) => ["os", "search", filters] as const,
    searchPrefix: ["os", "search"] as const,
    path: (ano: number, id: number) => ["os", "path", ano, id] as const,
    details: (ano: number, id: number) => ["os", "details", ano, id] as const,
    history: (ano: number, id: number) => ["os", "history", ano, id] as const,
    auditLog: (ano: number, id: number) => ["os", "auditLog", ano, id] as const,
    folderBrowse: (ano: number, id: number, relative: string) =>
      ["os", "folderBrowse", ano, id, relative] as const,
    folderPlan: (ano: number, id: number) =>
      ["os", "folderPlan", ano, id] as const,
    vinculos: (ano: number, id: number) => ["os", "vinculos", ano, id] as const,
    vinculoGrupo: (ano: number, id: number) =>
      ["os", "vinculoGrupo", ano, id] as const,
    notificacaoWatch: (ano: number, id: number) =>
      ["os", "notificacaoWatch", ano, id] as const,
    componentes: (ano: number, id: number) => ["os", "componentes", ano, id] as const,
    sequenciaProducao: (ano: number, id: number) =>
      ["os", "sequenciaProducao", ano, id] as const,
    subOs: (ano: number, id: number) => ["os", "subOs", ano, id] as const,
    subOsSummary: (ano: number, id: number) => ["os", "subOsSummary", ano, id] as const,
    subOsHistory: (ano: number, id: number, subOsId: number) =>
      ["os", "subOsHistory", ano, id, subOsId] as const,
  },
  settings: {
    savedFilters: (ponto: string, context = "os") =>
      ["settings", "savedFilters", ponto, context] as const,
    defaultFilters: (ponto: string, context = "os") =>
      ["settings", "defaultFilters", ponto, context] as const,
  },
  notifications: (ponto: string) => ["notifications", ponto] as const,
  pcp: {
    queue: (setor: string) => ["pcp", "queue", setor] as const,
  },
  cotasGraf: {
    prefix: ["cotasGraf"] as const,
    list: (filters: unknown) => ["cotasGraf", "list", filters] as const,
    solicitantesCotas: (filters: unknown) =>
      ["cotasGraf", "solicitantesCotas", filters] as const,
    solicitanteHistorico: (cliente: unknown) =>
      ["cotasGraf", "solicitanteHistorico", cliente] as const,
  },
  gravacaoExterna: {
    prefix: ["gravacaoExterna"] as const,
    list: (filters: unknown) => ["gravacaoExterna", "list", filters] as const,
    aguardandoEntrega: (filters: unknown) =>
      ["gravacaoExterna", "aguardandoEntrega", filters] as const,
    detail: (ano: number, nrOs: number) =>
      ["gravacaoExterna", "detail", ano, nrOs] as const,
    mensagens: (ano: number, nrOs: number) =>
      ["gravacaoExterna", "mensagens", ano, nrOs] as const,
    launcher: (ano: number, nrOs: number) =>
      ["gravacaoExterna", "launcher", ano, nrOs] as const,
  },
  gravacaoPendente: {
    prefix: ["gravacaoPendente"] as const,
    list: (filters: unknown) => ["gravacaoPendente", "list", filters] as const,
    detail: (ano: number, nrOs: number) =>
      ["gravacaoPendente", "detail", ano, nrOs] as const,
    historico: (limit?: number) =>
      ["gravacaoPendente", "historico", limit ?? 100] as const,
    fornecedores: ["gravacaoPendente", "fornecedores"] as const,
    configDetalhes: ["gravacaoPendente", "configDetalhes"] as const,
  },
  portal: {
    pt: (token: string, os: number, ano: number) =>
      ["portal", "pt", token, os, ano] as const,
    prova: (token: string, os: number, ano: number) =>
      ["portal", "prova", token, os, ano] as const,
    osArquivos: (token: string, os: number, ano: number) =>
      ["portal", "os-arquivos", token, os, ano] as const,
  },
  gerencia: {
    categorias: ["gerencia", "categorias"] as const,
    produtos: ["gerencia", "produtos"] as const,
    maquinas: ["gerencia", "maquinas"] as const,
    papeis: ["gerencia", "papeis"] as const,
    cores: ["gerencia", "cores"] as const,
    formatos: ["gerencia", "formatos"] as const,
    formasEntrega: ["gerencia", "formas-entrega"] as const,
    responsaveisGrafica: ["gerencia", "responsaveis-grafica"] as const,
    acabamentos: ["gerencia", "acabamentos"] as const,
    details: (ano: number, id: number) => ["gerencia", "details", ano, id] as const,
  },
  analise: {
    library: ["analise", "library"] as const,
    full: (ano: number, osId: number) => ["analise", "full", ano, osId] as const,
    versions: (ano: number, osId: number) => ["analise", "versions", ano, osId] as const,
    andamento: (ano: number, osId: number) => ["analise", "andamento", ano, osId] as const,
    files: (path: string) => ["analise", "files", path] as const,
    pdfPages: (path: string) => ["analise", "pdf-pages", path] as const,
  },
  adminIps: {
    list: ["adminIps", "list"] as const,
    groups: ["adminIps", "groups"] as const,
    accessRequests: ["adminIps", "accessRequests"] as const,
  },
  relatorio: {
    previewCount: (filters: unknown) =>
      ["relatorio", "previewCount", filters] as const,
  },
  email: {
    inbox: ["email", "inbox"] as const,
    config: ["email", "config"] as const,
    pendencias: (setor: string) => ["email", "pendencias", setor] as const,
    notificationStatus: (setor: string) =>
      ["email", "notificationStatus", setor] as const,
    ptHtml: (ano: number, os: number) => ["email", "ptHtml", ano, os] as const,
    protocolo: (ano: number, os: number) =>
      ["email", "protocolo", ano, os] as const,
    deputadoEmails: (nome: string, ano: number, os: number) =>
      ["email", "deputadoEmails", nome, ano, os] as const,
    proofFiles: (ano: number, os: number) =>
      ["email", "proofFiles", ano, os] as const,
  },
  usuarios: {
    list: ["usuarios", "list"] as const,
    online: ["usuarios", "online"] as const,
  },
  support: {
    adminMessages: (status?: string) =>
      ["support", "adminMessages", status ?? "all"] as const,
    adminTicket: (id: number) => ["support", "adminTicket", id] as const,
    assignedTickets: (status?: string) =>
      ["support", "assignedTickets", status ?? "all"] as const,
    assignedTicket: (id: number) => ["support", "assignedTicket", id] as const,
    userTickets: (status?: string) =>
      ["support", "userTickets", status ?? "all"] as const,
    userTicket: (id: number) => ["support", "userTicket", id] as const,
    clienteTicket: (id: number) => ["support", "clienteTicket", id] as const,
    clienteOpenTicket: (ano: number, nrOs: number) =>
      ["support", "clienteOpenTicket", ano, nrOs] as const,
    settings: ["support", "settings"] as const,
    adminSettings: ["support", "adminSettings"] as const,
    clienteSettings: ["support", "clienteSettings"] as const,
  },
  papelaria: {
    modelos: ["papelaria", "modelos"] as const,
    fields: (modelId: string) => ["papelaria", "fields", modelId] as const,
    contexto: (ano: number, nro: number) =>
      ["papelaria", "contexto", ano, nro] as const,
    cdrPath: (ano: number, nro: number) =>
      ["papelaria", "cdrPath", ano, nro] as const,
    corelModelo: (id: number) => ["papelaria", "corelModelo", id] as const,
    jobsOs: (ano: number, nro: number) =>
      ["papelaria", "jobs", ano, nro] as const,
    job: (jobId: number) => ["papelaria", "job", jobId] as const,
    previewPages: (jobId: number) =>
      ["papelaria", "previewPages", jobId] as const,
    svgModelos: ["papelaria", "svg", "modelos"] as const,
    svgFields: (codigo: string) => ["papelaria", "svg", "fields", codigo] as const,
    svgPrefill: (ano: number, nro: number) =>
      ["papelaria", "svg", "prefill", ano, nro] as const,
  },
  credenciaisDepol: {
    modelos: ["credenciais-depol", "modelos"] as const,
    pedidos: (filter: string) =>
      ["credenciais-depol", "pedidos", filter] as const,
    pedido: (id: number) => ["credenciais-depol", "pedido", id] as const,
    pedidoJob: (id: number) =>
      ["credenciais-depol", "pedidoJob", id] as const,
  },
} as const;
