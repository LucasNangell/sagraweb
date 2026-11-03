"""Coleta JMF dos Fiery: Status, QueueStatus, Resource/Media e SubmissionMethods."""

from __future__ import annotations

import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import unquote

import requests

PORTA_JMF = 8010
NS = {"jdf": "http://www.CIP4.org/JDFSchema_1_1"}
EFI = "{http://www.efi.com/fjdf}"
HEADERS = {"Content-Type": "application/vnd.cip4-jmf+xml"}

STATUS_LIST = (
    "Waiting Held Running Suspended Completed Aborted PendingReturn Removed"
)

IMPRESSORAS = (
    {"id": "pb-01", "nome": "Xerox PB-01", "host": "10.123.1.201", "tipo": "pb"},
    {"id": "pb-02", "nome": "Xerox PB-02", "host": "10.123.2.212", "tipo": "pb"},
    {"id": "pb-03", "nome": "Xerox PB-03", "host": "10.123.2.226", "tipo": "pb"},
    {"id": "pb-04", "nome": "Xerox PB-04", "host": "10.123.2.195", "tipo": "pb"},
    {"id": "pb-05", "nome": "Xerox PB-05", "host": "10.123.1.220", "tipo": "pb"},
    {"id": "pb-06", "nome": "Xerox PB-06", "host": "10.123.1.198", "tipo": "pb"},
    {"id": "cor-01", "nome": "Xerox Cor-01", "host": "10.123.1.197", "tipo": "cor"},
    {"id": "cor-02", "nome": "Xerox Cor-02", "host": "10.123.1.203", "tipo": "cor"},
)

STATUS_EXIBICAO = (
    "Em espera",
    "Processando",
    "Processado",
    "Imprimindo",
    "Impresso",
    "Concluído",
    "Arquivado",
)

STATUS_FILA = {
    "waiting": "Aguardando",
    "held": "Em espera",
    "running": "Em operação",
    "setup": "Setup",
    "blocked": "Bloqueada",
    "closed": "Fechada",
    "full": "Cheia",
}

STATUS_DISPOSITIVO = {
    "idle": "Ociosa",
    "running": "Em operação",
    "setup": "Setup",
    "down": "Parada",
    "stopped": "Parada",
    "cleanup": "Limpeza",
    "unknown": "Desconhecido",
}

CONDICAO_DISPOSITIVO = {
    "ok": "Normal",
    "needsattention": "Atenção",
    "failure": "Falha",
}

MODO_OPERACAO = {
    "productive": "Produtiva",
    "maintenance": "Manutenção",
}

_EM_ESPERA = {
    "held", "waiting", "setup", "ready", "suspended", "stopped",
    "pendingreturn", "spooling", "spooled",
}
_PROCESSANDO = {"ripping", "riping", "processing", "inprogress", "testruninprogress"}
_PROCESSADO = {"processed"}
_IMPRIMINDO = {"printing", "running"}
_IMPRESSO = {"printed", "proofed"}
_CONCLUIDO = {"completed", "closed"}
_ARQUIVADO = {"aborted", "cancelled", "canceled", "removed", "archived"}

_cache_media: dict[str, tuple[float, list]] = {}
_cache_lock = threading.Lock()
CACHE_MEDIA_S = 90.0


def _normalizar(valor):
    return (valor or "").strip().lower().replace(" ", "").replace("_", "")


def _texto(valor):
    return (valor or "").strip()


def _float(valor):
    if valor in (None, ""):
        return None
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def _efi(el, nome):
    if el is None:
        return ""
    return _texto(el.get(f"{EFI}{nome}") or el.get(nome))


def traduzir_status(status_fila, status_fase=None, detalhes=None):
    detalhe = _normalizar(detalhes)
    fase = _normalizar(status_fase)
    fila = _normalizar(status_fila)

    for chave in (detalhe, fase):
        if chave in _PROCESSANDO:
            return "Processando"
        if chave in _IMPRIMINDO:
            return "Imprimindo"

    for chave in (detalhe, fase, fila):
        if chave in _EM_ESPERA:
            return "Em espera"
        if chave in _PROCESSADO:
            return "Processado"
        if chave in _IMPRESSO:
            return "Impresso"
        if chave in _CONCLUIDO:
            return "Concluído"
        if chave in _ARQUIVADO:
            return "Arquivado"

    if fila in _IMPRIMINDO:
        return "Imprimindo"
    if fila in _PROCESSANDO:
        return "Processando"

    bruto = detalhes or status_fase or status_fila or "Desconhecido"
    return f"Outro ({bruto})"


def _traduz(mapa, valor):
    chave = _normalizar(valor)
    if not chave:
        return ""
    return mapa.get(chave, valor)


def _fase_ativa(entry):
    fases = entry.findall("jdf:JobPhase", NS)
    for fase in fases:
        if _normalizar(fase.get("Status")) in {"inprogress", "setup", "running", "suspended"}:
            return fase
    return fases[-1] if fases else None


def _payload_fila():
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<JMF xmlns="http://www.CIP4.org/JDFSchema_1_1" SenderID="PainelFiery" Version="1.4">
  <Query ID="Q_Queue" Type="QueueStatus">
    <QueueFilter QueueEntryDetails="JDF" StatusList="{STATUS_LIST}"/>
  </Query>
</JMF>"""


def _payload_status():
    return """<?xml version="1.0" encoding="UTF-8"?>
<JMF xmlns="http://www.CIP4.org/JDFSchema_1_1" SenderID="PainelFiery" Version="1.4">
  <Query ID="Q_Status" Type="Status">
    <StatusQuParams DeviceDetails="Details" JobDetails="Full"/>
  </Query>
</JMF>"""


def _payload_media():
    return """<?xml version="1.0" encoding="UTF-8"?>
<JMF xmlns="http://www.CIP4.org/JDFSchema_1_1" SenderID="PainelFiery" Version="1.4">
  <Query ID="Q_Media" Type="Resource">
    <ResourceQuParams ResourceName="Media" Exact="false"/>
  </Query>
</JMF>"""


def _post_jmf(host, xml, timeout=(3.5, 12)):
    url = f"http://{host}:{PORTA_JMF}"
    try:
        response = requests.post(
            url, data=xml.encode("utf-8"), headers=HEADERS, timeout=timeout
        )
    except requests.Timeout:
        return None, f"Sem resposta em {host}:{PORTA_JMF}"
    except requests.RequestException as exc:
        return None, f"Erro de conexão ({exc.__class__.__name__})"

    if response.status_code != 200:
        return None, f"Erro HTTP {response.status_code}"

    try:
        root = ET.fromstring(response.content)
    except ET.ParseError as exc:
        return None, f"XML inválido: {exc}"

    resposta = root.find("jdf:Response", NS)
    codigo = resposta.get("ReturnCode") if resposta is not None else None
    if codigo not in (None, "0"):
        comentario = root.find(".//jdf:Comment", NS)
        detalhe = _texto(comentario.text if comentario is not None else "")
        return None, f"ReturnCode {codigo}. {detalhe}".rstrip()
    return root, None


def _nome_trabalho(el, fallback=""):
    if el is None:
        return fallback
    return (
        _texto(el.get("DescriptiveName"))
        or _texto(el.get("JobID"))
        or fallback
        or "Desconhecido"
    )


def _basename_url(url):
    if not url:
        return ""
    texto = unquote(url.replace("\\", "/"))
    if "path=" in texto.lower():
        texto = texto.split("path=", 1)[-1]
        texto = unquote(texto).replace("\\", "/")
    nome = texto.rsplit("/", 1)[-1].split("?")[0].strip()
    return nome if "." in nome else ""


def _arquivo_do_trabalho(entry):
    if entry is None:
        return ""
    for spec in entry.findall(".//jdf:FileSpec", NS):
        nome = _texto(spec.get("UserFileName"))
        if nome:
            return nome
    for spec in entry.findall(".//jdf:FileSpec", NS):
        nome = _basename_url(spec.get("URL"))
        if nome:
            return nome
    jdf = entry.find(".//jdf:JDF", NS)
    if jdf is not None:
        return _texto(jdf.get("DescriptiveName"))
    return ""


def _progresso(el):
    if el is None:
        return None, None, None
    amount = _float(el.get("Amount"))
    total = _float(el.get("TotalAmount"))
    percentual = _float(el.get("PercentCompleted"))
    if percentual is None and amount is not None and total:
        percentual = round((amount / total) * 100, 1)
    return amount, total, percentual


def _parse_trabalho(entry, host, nome):
    fase = _fase_ativa(entry)
    status_fila = entry.get("Status", "")
    status_fase = fase.get("Status", "") if fase is not None else ""
    detalhes = fase.get("StatusDetails", "") if fase is not None else ""
    amount, total, percentual = _progresso(fase)
    job_id = entry.get("JobID", "Desconhecido")
    arquivo = _arquivo_do_trabalho(entry)

    return {
        "id": job_id,
        "arquivo": arquivo,
        "nome": arquivo or _nome_trabalho(fase, _nome_trabalho(entry, job_id)),
        "part_id": entry.get("JobPartID", ""),
        "queue_entry_id": entry.get("QueueEntryID", ""),
        "prioridade": entry.get("Priority", ""),
        "status_fila": status_fila,
        "status_fase": status_fase,
        "status_detalhes": detalhes,
        "status_original": detalhes or status_fase or status_fila or "Desconhecido",
        "status": traduzir_status(status_fila, status_fase, detalhes),
        "enviado_em": entry.get("SubmissionTime", ""),
        "iniciado_em": (fase.get("StartTime") if fase is not None else "") or entry.get("StartTime", ""),
        "encerrado_em": entry.get("EndTime", "") or (fase.get("EndTime") if fase is not None else ""),
        "amount": amount,
        "total_amount": total,
        "percentual": percentual,
        "desperdicio": _float(fase.get("Waste") if fase is not None else None),
        "servidor": host,
        "servidor_nome": nome,
    }


def _parse_fase_viva(fase, host, nome):
    status_fase = fase.get("Status", "")
    detalhes = fase.get("StatusDetails", "")
    job_id = fase.get("JobID", "Desconhecido")
    amount, total, percentual = _progresso(fase)
    arquivo = _arquivo_do_trabalho(fase)
    return {
        "id": job_id,
        "arquivo": arquivo,
        "nome": arquivo or _nome_trabalho(fase, job_id),
        "part_id": fase.get("JobPartID", ""),
        "queue_entry_id": fase.get("QueueEntryID", ""),
        "prioridade": "",
        "status_fila": status_fase,
        "status_fase": status_fase,
        "status_detalhes": detalhes,
        "status_original": detalhes or status_fase or "Desconhecido",
        "status": traduzir_status(status_fase, status_fase, detalhes),
        "enviado_em": "",
        "iniciado_em": fase.get("StartTime", "") or fase.get("PhaseStartTime", ""),
        "encerrado_em": "",
        "amount": amount,
        "total_amount": total,
        "percentual": percentual,
        "desperdicio": _float(fase.get("Waste")),
        "servidor": host,
        "servidor_nome": nome,
        "ao_vivo": True,
    }


def _parse_dispositivo(root):
    info = {}
    jmf = root
    info["fiery_timestamp"] = jmf.get("TimeStamp", "")
    info["agent_name"] = jmf.get("AgentName", "")
    info["agent_version"] = jmf.get("AgentVersion", "")
    info["ics_versions"] = jmf.get("ICSVersions", "")
    info["jmf_version"] = jmf.get("Version", "")

    device_info = root.find(".//jdf:DeviceInfo", NS)
    if device_info is not None:
        info["device_id"] = device_info.get("DeviceID", "")
        info["device_status"] = device_info.get("DeviceStatus", "")
        info["device_status_label"] = _traduz(STATUS_DISPOSITIVO, info["device_status"])
        info["device_condition"] = device_info.get("DeviceCondition", "")
        info["device_condition_label"] = _traduz(CONDICAO_DISPOSITIVO, info["device_condition"])
        info["operation_mode"] = device_info.get("DeviceOperationMode", "")
        info["operation_mode_label"] = _traduz(MODO_OPERACAO, info["operation_mode"])
        info["production_counter"] = _float(device_info.get("ProductionCounter"))
        info["counter_unit"] = device_info.get("CounterUnit", "")
        modulo = device_info.find("jdf:ModuleStatus", NS)
        if modulo is not None:
            info["module_type"] = modulo.get("ModuleType", "")
            info["module_status"] = modulo.get("DeviceStatus", "")
            info["module_status_label"] = _traduz(STATUS_DISPOSITIVO, info["module_status"])

    device = root.find(".//jdf:Device", NS)
    if device is not None:
        info["manufacturer"] = device.get("Manufacturer", "")
        info["model"] = device.get("ModelName") or device.get("DescriptiveName") or ""
        info["model_description"] = device.get("ModelDescription", "")
        info["friendly_name"] = device.get("FriendlyName", "")
        info["device_type"] = device.get("DeviceType", "")
        info["fiery_version"] = _efi(device, "FieryVersion")
        info["oem_model"] = _efi(device, "OEMModelName")
        info["product_version"] = _efi(device, "ProductVersion")
        info["last_calibrated"] = _efi(device, "LastCalibratedTime")
        info["jmf_url"] = device.get("JMFURL", "")
        info["jdf_versions"] = device.get("JDFVersions", "")
        info["device_ics"] = device.get("ICSVersions", "")
    return info


def _parse_media(root):
    itens = []
    for media in root.findall(".//jdf:Media", NS):
        dim = _texto(media.get("Dimension"))
        itens.append({
            "nome": media.get("DescriptiveName") or media.get("Brand") or "Papel",
            "marca": media.get("Brand", ""),
            "peso": media.get("Weight", ""),
            "tipo": media.get("MediaTypeDetails") or media.get("MediaType", ""),
            "cor": media.get("MediaColorName", ""),
            "revestimento": media.get("FrontCoatings", ""),
            "dimensao": dim,
            "produto": media.get("ProductID", ""),
            "status": media.get("Status", ""),
            "espessura": media.get("Thickness", ""),
            "alimentacao": _efi(media, "FeedDirection"),
        })
    return itens


def _media_cacheada(host):
    agora = time.monotonic()
    with _cache_lock:
        hit = _cache_media.get(host)
        if hit and agora - hit[0] < CACHE_MEDIA_S:
            return hit[1]
    root, erro = _post_jmf(host, _payload_media(), timeout=(3.5, 18))
    if erro or root is None:
        return hit[1] if hit else []
    itens = _parse_media(root)
    with _cache_lock:
        _cache_media[host] = (agora, itens)
    return itens


def _resumo_job(trabalho):
    return {
        "nome": trabalho.get("arquivo") or trabalho.get("nome") or trabalho.get("id") or "Sem nome",
        "id": trabalho.get("id"),
        "arquivo": trabalho.get("arquivo") or "",
        "status": trabalho.get("status"),
        "percentual": trabalho.get("percentual"),
        "amount": trabalho.get("amount"),
        "total_amount": trabalho.get("total_amount"),
    }


def _atividade(trabalhos, dispositivo):
    por_status = {status: [] for status in STATUS_EXIBICAO}
    for trabalho in trabalhos:
        por_status.setdefault(trabalho["status"], []).append(trabalho)

    imprimindo = _resumo_job(por_status["Imprimindo"][0]) if por_status.get("Imprimindo") else None
    processando = _resumo_job(por_status["Processando"][0]) if por_status.get("Processando") else None
    ativo = imprimindo or processando
    if ativo is None and por_status.get("Processado"):
        ativo = _resumo_job(por_status["Processado"][0])
    if ativo is None and por_status.get("Em espera"):
        ativo = _resumo_job(por_status["Em espera"][0])

    if imprimindo:
        status = "Imprimindo"
    elif processando:
        status = "Processando"
    elif dispositivo.get("device_condition_label") == "Atenção":
        status = "Atenção"
    elif dispositivo.get("operation_mode_label") == "Manutenção":
        status = "Manutenção"
    elif ativo:
        status = ativo["status"]
    else:
        status = dispositivo.get("device_status_label") or "Ociosa"

    titulo = (ativo or {}).get("nome")
    if not titulo:
        if status == "Atenção":
            titulo = "Máquina precisa de atenção"
        elif status == "Manutenção":
            titulo = "Modo manutenção"
        else:
            titulo = "Nenhum trabalho em processo"

    progresso = ativo or {}
    return {
        "status": status,
        "titulo": titulo,
        "percentual": progresso.get("percentual"),
        "amount": progresso.get("amount"),
        "total_amount": progresso.get("total_amount"),
        "imprimindo": imprimindo,
        "processando": processando,
    }


def consultar_impressora(impressora):
    host = impressora["host"]
    base = {
        "id": impressora["id"],
        "nome": impressora["nome"],
        "host": host,
        "tipo": impressora["tipo"],
        "online": False,
        "erro": None,
        "trabalhos": [],
        "contagem": {status: 0 for status in STATUS_EXIBICAO},
        "outros": 0,
        "dispositivo": {},
        "fila_status": "",
        "fila_status_label": "",
        "papeis": [],
        "atividade": {
            "status": "Offline",
            "titulo": "Sem conexão",
            "percentual": None,
            "amount": None,
            "total_amount": None,
            "imprimindo": None,
            "processando": None,
        },
    }

    with ThreadPoolExecutor(max_workers=2) as pool:
        fut_status = pool.submit(_post_jmf, host, _payload_status())
        fut_fila = pool.submit(_post_jmf, host, _payload_fila())
        root_status, erro_status = fut_status.result()
        root_fila, erro_fila = fut_fila.result()

    if erro_status and erro_fila:
        base["erro"] = erro_status or erro_fila
        return base

    base["online"] = True
    erros = [item for item in (erro_status, erro_fila) if item]
    if erros:
        base["erro"] = " | ".join(erros)

    if root_status is not None:
        base["dispositivo"] = _parse_dispositivo(root_status)

    nome_fiery = base["dispositivo"].get("device_id") or impressora["nome"]
    indice = {}

    def _incorporar(trabalho):
        chave = (trabalho.get("id"), trabalho.get("part_id") or trabalho.get("queue_entry_id"))
        if chave in indice:
            atual = base["trabalhos"][indice[chave]]
            if trabalho.get("ao_vivo"):
                atual["status"] = trabalho["status"]
                atual["status_fase"] = trabalho["status_fase"]
                atual["status_detalhes"] = trabalho["status_detalhes"]
                atual["status_original"] = trabalho["status_original"]
                atual["percentual"] = trabalho.get("percentual") if trabalho.get("percentual") is not None else atual.get("percentual")
                atual["amount"] = trabalho.get("amount") if trabalho.get("amount") is not None else atual.get("amount")
                atual["total_amount"] = trabalho.get("total_amount") if trabalho.get("total_amount") is not None else atual.get("total_amount")
                if trabalho.get("arquivo"):
                    atual["arquivo"] = trabalho["arquivo"]
                    atual["nome"] = trabalho["arquivo"]
                elif not atual.get("arquivo"):
                    atual["nome"] = trabalho.get("nome") or atual.get("nome")
            return
        indice[chave] = len(base["trabalhos"])
        base["trabalhos"].append(trabalho)

    if root_fila is not None:
        fila = root_fila.find(".//jdf:Queue", NS)
        if fila is not None:
            base["fila_status"] = fila.get("Status", "")
            base["fila_status_label"] = _traduz(STATUS_FILA, base["fila_status"])
            if not base["dispositivo"].get("device_id") and fila.get("DeviceID"):
                base["dispositivo"]["device_id"] = fila.get("DeviceID")
                nome_fiery = base["dispositivo"]["device_id"]
        for entry in root_fila.findall(".//jdf:QueueEntry", NS):
            _incorporar(_parse_trabalho(entry, host, nome_fiery))

    if root_status is not None:
        for fase in root_status.findall(".//jdf:DeviceInfo/jdf:JobPhase", NS):
            _incorporar(_parse_fase_viva(fase, host, nome_fiery))

    for trabalho in base["trabalhos"]:
        if trabalho["status"] in base["contagem"]:
            base["contagem"][trabalho["status"]] += 1
        else:
            base["outros"] += 1

    if base["online"]:
        base["papeis"] = _media_cacheada(host)
        base["atividade"] = _atividade(base["trabalhos"], base["dispositivo"])
    return base


def consultar_todas():
    with ThreadPoolExecutor(max_workers=len(IMPRESSORAS)) as pool:
        maquinas = list(pool.map(consultar_impressora, IMPRESSORAS))

    totais = {status: 0 for status in STATUS_EXIBICAO}
    online = 0
    atencao = 0
    for maquina in maquinas:
        if maquina["online"]:
            online += 1
        if maquina["online"] and maquina["dispositivo"].get("device_condition_label") in {"Atenção", "Falha"}:
            atencao += 1
        for status, qtd in maquina["contagem"].items():
            totais[status] += qtd

    return {
        "atualizado_em": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "totais": totais,
        "online": online,
        "offline": len(maquinas) - online,
        "atencao": atencao,
        "maquinas": maquinas,
    }
