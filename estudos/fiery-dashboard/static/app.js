const grade = document.getElementById("grade");
const kpis = document.getElementById("kpis");
const horaEl = document.getElementById("hora");
const atualizadoEl = document.getElementById("atualizado");
const liveDot = document.getElementById("live-dot");
const painel = document.getElementById("painel");
const sombra = document.getElementById("sombra");
const painelTitulo = document.getElementById("painel-titulo");
const painelKicker = document.getElementById("painel-kicker");
const painelCorpo = document.getElementById("painel-corpo");
const fechar = document.getElementById("fechar");

let estado = null;
let selecionada = null;

const COUNTS_CARD = [
  ["Em espera", "Espera"],
  ["Processando", "Proc."],
  ["Processado", "Pronto"],
  ["Imprimindo", "Imp."],
  ["Concluído", "OK"],
  ["Arquivado", "Arq."],
];

function slug(texto) {
  return (texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function fmtData(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.replace("T", " ").slice(0, 19);
  return d.toLocaleString("pt-BR");
}

function fmtNum(valor) {
  if (valor == null || valor === "") return "—";
  return Number(valor).toLocaleString("pt-BR");
}

function badgeClass(status) {
  const s = slug(status);
  if (["imprimindo", "processando", "processado", "alerta", "atencao", "manutencao", "offline", "ociosa", "setup"].includes(s)) {
    return s;
  }
  return "";
}

function tickHora() {
  horaEl.textContent = new Date().toLocaleTimeString("pt-BR");
}

function renderKpis(data) {
  const t = data.totais || {};
  const itens = [
    ["Online", `${data.online ?? 0}/${(data.online ?? 0) + (data.offline ?? 0)}`],
    ["Imprimindo", t["Imprimindo"] ?? 0],
    ["Processando", t["Processando"] ?? 0],
    ["Em espera", t["Em espera"] ?? 0],
    ["Atenção", data.atencao ?? 0],
  ];
  kpis.innerHTML = itens
    .map(([label, valor]) => `<div class="kpi"><span>${label}</span><strong>${valor}</strong></div>`)
    .join("");
}

function barraProgresso(job) {
  if (!job || job.percentual == null) return "";
  return `<div class="barra"><span style="width:${Math.max(0, Math.min(100, job.percentual))}%"></span></div>
    <div class="progresso-txt">${fmtNum(job.percentual)}% · ${fmtNum(job.amount)} / ${fmtNum(job.total_amount)}</div>`;
}

function linhaJob(rotulo, job) {
  if (!job) return "";
  const nome = job.nome || job.id || "Sem nome";
  return `<div class="job-linha">
    <div class="rotulo">${rotulo}</div>
    <h3 title="${nome}">${nome}</h3>
    ${barraProgresso(job)}
  </div>`;
}

function renderCards(data) {
  const html = (data.maquinas || [])
    .map((m) => {
      const atividade = m.atividade || {};
      const status = m.online ? atividade.status || "Ociosa" : "Offline";
      const classes = ["card"];
      if (!m.online) classes.push("offline");
      if (status === "Imprimindo" || atividade.imprimindo) classes.push("imprimindo");
      if (status === "Processando" || atividade.processando) classes.push("processando");
      if (["Atenção", "Manutenção", "Falha"].includes(status) || m.dispositivo?.device_condition_label === "Atenção") {
        classes.push("alerta");
      }
      const jobsAtivos = [
        linhaJob("Imprimindo", atividade.imprimindo),
        linhaJob("Processando", atividade.processando),
      ].join("");
      const atividadeHtml = jobsAtivos
        ? jobsAtivos
        : `<div class="job-linha">
            <div class="rotulo">${m.online ? "Atividade" : "Conexão"}</div>
            <h3 title="${atividade.titulo || m.erro || ""}">${atividade.titulo || m.erro || "Sem dados"}</h3>
            ${barraProgresso(atividade)}
          </div>`;
      const counts = COUNTS_CARD.map(
        ([key, label]) => `<div><strong>${m.contagem?.[key] ?? 0}</strong><span>${label}</span></div>`
      ).join("");
      return `<article class="${classes.join(" ")}" data-id="${m.id}" tabindex="0" role="button">
        <div class="card-cab">
          <div>
            <h2>${m.nome}</h2>
            <p>${m.host}</p>
          </div>
          <span class="badge ${badgeClass(status)}">${status}</span>
        </div>
        <div class="atividade">${atividadeHtml}</div>
        <div class="contagens">${counts}</div>
      </article>`;
    })
    .join("");
  if (grade.dataset.sig === html) return;
  grade.dataset.sig = html;
  grade.innerHTML = html;
}

function dl(rotulo, valor) {
  return `<div><dt>${rotulo}</dt><dd>${valor || "—"}</dd></div>`;
}

function renderPainel(maquina) {
  if (!maquina) return;
  painel.hidden = false;
  sombra.hidden = false;
  painelKicker.textContent = `${maquina.host} · ${maquina.tipo === "cor" ? "Colorida" : "Preto e branco"}`;
  painelTitulo.textContent = maquina.nome;
  const d = maquina.dispositivo || {};
  const trabalhos = maquina.trabalhos || [];
  const papeis = maquina.papeis || [];
  const linhas = trabalhos.length
    ? trabalhos
        .map(
          (t) => `<tr>
            <td>${t.nome || t.id}<div class="progresso-txt">${t.part_id || t.id || ""}</div></td>
            <td><span class="chip">${t.status}</span><div class="progresso-txt">${t.status_original || ""}</div></td>
            <td>${t.percentual != null ? `${fmtNum(t.percentual)}%` : "—"}</td>
            <td>${fmtData(t.enviado_em)}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="4">Nenhum trabalho na fila JMF.</td></tr>`;
  const papelLinhas = papeis
    .slice(0, 24)
    .map(
      (p) => `<tr>
        <td>${p.nome}</td>
        <td>${p.peso ? `${p.peso} g/m²` : "—"}</td>
        <td>${p.tipo || "—"}</td>
        <td>${p.status || "—"}</td>
      </tr>`
    )
    .join("");

  painelCorpo.innerHTML = `
    ${maquina.erro ? `<p class="erro-linha">${maquina.erro}</p>` : ""}
    <section class="bloco">
      <h3>Máquina</h3>
      <dl class="meta">
        ${dl("Estado", d.device_status_label || (maquina.online ? "Online" : "Offline"))}
        ${dl("Condição", d.device_condition_label)}
        ${dl("Modo", d.operation_mode_label)}
        ${dl("Fila", maquina.fila_status_label)}
        ${dl("Modelo", d.model || d.friendly_name)}
        ${dl("Fiery", [d.fiery_version, d.product_version].filter(Boolean).join(" · "))}
        ${dl("Fabricante", d.manufacturer)}
        ${dl("Calibração", fmtData(d.last_calibrated))}
        ${dl("Contador", d.production_counter != null ? `${fmtNum(d.production_counter)} ${d.counter_unit || ""}` : "—")}
        ${dl("Módulo", [d.module_type, d.module_status_label].filter(Boolean).join(" · "))}
        ${dl("JMF", d.jmf_url || `http://${maquina.host}:8010`)}
        ${dl("Agente", [d.agent_name, d.agent_version].filter(Boolean).join(" "))}
      </dl>
    </section>
    <section class="bloco">
      <h3>Trabalhos (${trabalhos.length})</h3>
      <table class="tabela">
        <thead><tr><th>Trabalho</th><th>Status</th><th>Progresso</th><th>Enviado</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </section>
    <section class="bloco">
      <h3>Catálogo de papel (${papeis.length})</h3>
      <table class="tabela">
        <thead><tr><th>Nome</th><th>Gramatura</th><th>Tipo</th><th>Status</th></tr></thead>
        <tbody>${papelLinhas || `<tr><td colspan="4">Catálogo indisponível neste servidor.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function aplicar(data) {
  estado = data;
  liveDot.className = `ponto ${data.offline === 8 ? "erro" : "ok"}`;
  atualizadoEl.textContent = data.atualizado_em
    ? `atualizado ${fmtData(data.atualizado_em)}`
    : "aguardando Fiery…";
  renderKpis(data);
  renderCards(data);
  if (selecionada) {
    const atual = (data.maquinas || []).find((m) => m.id === selecionada);
    if (atual) renderPainel(atual);
  }
}

function abrir(id) {
  selecionada = id;
  const maquina = (estado?.maquinas || []).find((m) => m.id === id);
  if (maquina) renderPainel(maquina);
}

function fecharPainel() {
  selecionada = null;
  painel.hidden = true;
  sombra.hidden = true;
}

grade.addEventListener("click", (ev) => {
  const card = ev.target.closest(".card");
  if (card) abrir(card.dataset.id);
});
grade.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === " ") {
    const card = ev.target.closest(".card");
    if (card) {
      ev.preventDefault();
      abrir(card.dataset.id);
    }
  }
});
fechar.addEventListener("click", fecharPainel);
sombra.addEventListener("click", fecharPainel);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") fecharPainel();
});

function conectar() {
  const src = new EventSource("/api/stream");
  src.addEventListener("estado", (ev) => {
    try {
      aplicar(JSON.parse(ev.data));
    } catch (erro) {
      console.error(erro);
    }
  });
  src.onerror = () => {
    liveDot.className = "ponto erro";
    atualizadoEl.textContent = "reconectando…";
  };
}

tickHora();
setInterval(tickHora, 1000);
fetch("/api/estado")
  .then((r) => r.json())
  .then(aplicar)
  .catch(() => {
    liveDot.className = "ponto erro";
  })
  .finally(conectar);
