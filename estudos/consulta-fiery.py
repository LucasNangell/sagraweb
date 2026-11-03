import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

import requests

PORTA_JMF = 8010
# O primeiro é o XeroxCor-01. Os demais seguem o mesmo prefixo 10.123.
SERVIDORES = (
    "10.123.1.197",
    "10.123.1.201",
    "10.123.2.212",
    "10.123.2.226",
    "10.123.2.195",
    "10.123.1.220",
    "10.123.1.198",
    "10.123.1.203",
)
HEADERS = {"Content-Type": "application/vnd.cip4-jmf+xml"}
NS = {"jdf": "http://www.CIP4.org/JDFSchema_1_1"}

# Este Fiery (JDF 1.9) não implementa JobQuery. QueueStatus devolve a fila
# inteira quando StatusList cobre todos os QueueEntryStatus do JDF.
STATUS_LIST = (
    "Waiting Held Running Suspended Completed Aborted PendingReturn Removed"
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

_EM_ESPERA = {
    "held",
    "waiting",
    "setup",
    "ready",
    "suspended",
    "stopped",
    "pendingreturn",
    "spooling",
    "spooled",
}
_PROCESSANDO = {"ripping", "riping", "processing", "inprogress"}
_PROCESSADO = {"processed"}
_IMPRIMINDO = {"printing", "running"}
_IMPRESSO = {"printed", "proofed"}
_CONCLUIDO = {"completed", "closed"}
_ARQUIVADO = {"aborted", "cancelled", "canceled", "removed", "archived"}


def _normalizar(valor):
  return (valor or "").strip().lower().replace(" ", "").replace("_", "")


def traduzir_status(status_fila, status_fase=None, detalhes=None):
  """Traduz fila, fase e StatusDetails para os status do painel.

  StatusDetails separa RIP (Processando), RIP concluído (Processado)
  e impressão (Imprimindo). Sem detalhe, Running na fila é impressão.
  """
  detalhe = _normalizar(detalhes)
  fase = _normalizar(status_fase)
  fila = _normalizar(status_fila)

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

  if detalhe in _PROCESSANDO:
    return "Processando"
  if detalhe in _IMPRIMINDO or fase in _IMPRIMINDO or fila in _IMPRIMINDO:
    return "Imprimindo"
  if fase in _PROCESSANDO:
    return "Processando"

  bruto = detalhes or status_fase or status_fila or "Desconhecido"
  return f"Outro ({bruto})"


def _fase_ativa(entry):
  fases = entry.findall("jdf:JobPhase", NS)
  for fase in fases:
    if _normalizar(fase.get("Status")) in {"inprogress", "setup", "running", "suspended"}:
      return fase
  return fases[-1] if fases else None


def _payload_fila():
  return f"""<?xml version="1.0" encoding="UTF-8"?>
<JMF xmlns="http://www.CIP4.org/JDFSchema_1_1" SenderID="PainelInterno" Version="1.4">
  <Query ID="Q_Queue" Type="QueueStatus">
    <QueueFilter QueueEntryDetails="JobPhase" StatusList="{STATUS_LIST}"/>
  </Query>
</JMF>"""


def consultar_servidor(host):
  """Consulta a fila de um Fiery. Falha de um host não impede os demais."""
  url = f"http://{host}:{PORTA_JMF}"
  resultado = {"host": host, "nome": host, "erro": None, "trabalhos": []}
  try:
    response = requests.post(
        url,
        data=_payload_fila().encode("utf-8"),
        headers=HEADERS,
        timeout=(4, 20),
    )
  except requests.Timeout:
    resultado["erro"] = f"Sem resposta em {host}:{PORTA_JMF}"
    return resultado
  except requests.RequestException as exc:
    resultado["erro"] = f"Erro de conexão com {host}:{PORTA_JMF} ({exc.__class__.__name__})"
    return resultado

  if response.status_code != 200:
    resultado["erro"] = f"Erro HTTP {response.status_code}"
    return resultado

  try:
    root = ET.fromstring(response.content)
  except ET.ParseError as exc:
    resultado["erro"] = f"Resposta XML inválida: {exc}"
    return resultado

  resposta = root.find("jdf:Response", NS)
  codigo = resposta.get("ReturnCode") if resposta is not None else None
  if codigo not in (None, "0"):
    comentario = root.find(".//jdf:Comment", NS)
    detalhe = (comentario.text or "").strip() if comentario is not None else ""
    resultado["erro"] = f"ReturnCode {codigo}. {detalhe}".rstrip()
    return resultado

  fila = root.find(".//jdf:Queue", NS)
  if fila is not None and fila.get("DeviceID"):
    resultado["nome"] = fila.get("DeviceID")

  for entry in root.findall(".//jdf:QueueEntry", NS):
    fase = _fase_ativa(entry)
    status_fila = entry.get("Status", "")
    status_fase = fase.get("Status", "") if fase is not None else ""
    detalhes = fase.get("StatusDetails", "") if fase is not None else ""
    resultado["trabalhos"].append({
        "servidor": host,
        "servidor_nome": resultado["nome"],
        "id": entry.get("JobID", "Desconhecido"),
        "part_id": entry.get("JobPartID", ""),
        "queue_entry_id": entry.get("QueueEntryID", ""),
        "status_original": detalhes or status_fase or status_fila or "Desconhecido",
        "status": traduzir_status(status_fila, status_fase, detalhes),
        "enviado_em": entry.get("SubmissionTime", ""),
    })
  return resultado


def consultar_todos_trabalhos():
  with ThreadPoolExecutor(max_workers=len(SERVIDORES)) as pool:
    return list(pool.map(consultar_servidor, SERVIDORES))


def resumir_por_status(trabalhos):
  contagem = {status: 0 for status in STATUS_EXIBICAO}
  outros = {}
  for trabalho in trabalhos:
    status = trabalho["status"]
    if status in contagem:
      contagem[status] += 1
    else:
      outros[status] = outros.get(status, 0) + 1
  return contagem, outros


def _imprimir_contagem(trabalhos, recuo=""):
  contagem, outros = resumir_por_status(trabalhos)
  for status in STATUS_EXIBICAO:
    print(f"{recuo}{status:<15} {contagem[status]}")
  for status, quantidade in sorted(outros.items()):
    print(f"{recuo}{status:<15} {quantidade}")


if __name__ == "__main__":
  print(f"Consultando {len(SERVIDORES)} servidores Fiery...")
  resultados = consultar_todos_trabalhos()
  todos = [trabalho for resultado in resultados for trabalho in resultado["trabalhos"]]

  print(f"\nTotal de trabalhos encontrados: {len(todos)}\n")
  print("Por status:")
  _imprimir_contagem(todos, recuo="  ")

  for resultado in resultados:
    nome = resultado["nome"]
    titulo = resultado["host"] if nome == resultado["host"] else f"{resultado['host']} ({nome})"
    print(f"\n{titulo}")
    if resultado["erro"]:
      print(f"  {resultado['erro']}")
      continue
    print(f"  {len(resultado['trabalhos'])} trabalho(s)")
    _imprimir_contagem(resultado["trabalhos"], recuo="  ")

  print(f"\n{'SERVIDOR':<28} | {'NOME DO TRABALHO':<35} | {'STATUS':<15} | {'ENVIADO EM'}")
  print("-" * 110)
  for trabalho in todos:
    print(
        f"{trabalho['servidor_nome']:<28} | {trabalho['id']:<35} | "
        f"{trabalho['status']:<15} | {trabalho['enviado_em']}"
    )
