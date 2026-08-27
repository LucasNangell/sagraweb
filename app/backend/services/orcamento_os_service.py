"""Mapeia OS → entradas de orçamento, calcula e persiste snapshot."""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Optional

from database import db
from formato_dimensions import resolve_formato_dimensions
from os_calc_fields import classify_cores_kind
from services import orcamento_admin_service as admin_svc
from services.orcamento_engine import calcular, match_papel, suggest_formato
from services.os_componentes_service import load_componentes_for_os

logger = logging.getLogger(__name__)

_ACAB_LAMINA = re.compile(r"lamin", re.IGNORECASE)
_ACAB_FRENTE_VERSO = re.compile(r"frente\s*e?\s*verso|f/?v|ambos", re.IGNORECASE)
_ACAB_ESPIRAL = re.compile(r"espiral|wire[\s-]?o", re.IGNORECASE)
_ACAB_GRAMPO = re.compile(r"gramp", re.IGNORECASE)
_ACAB_COLA = re.compile(r"cola|hot\s*melt|lombada", re.IGNORECASE)
_ACAB_PVC = re.compile(r"pvc|capa\s*pl[aá]st", re.IGNORECASE)
_ACAB_SO_FRENTE = re.compile(r"somente na frente|s[oó] (na )?frente", re.IGNORECASE)


def _os_details(ano: int, os_id: int) -> dict:
    query = """
    SELECT
        p.NroProtocolo, p.AnoProtocolo, p.NomeUsuario, p.Titular, p.OrgInteressado,
        p.SiglaOrgao, p.ProcessoSolicit, p.DataEntrada, p.CodUsuarioLink,
        d.Titulo, d.TipoPublicacaoLink, d.FormatoLink, d.MaquinaLink,
        d.Tiragem, d.TiragemSolicitada, d.Pags, d.FrenteVerso,
        d.PapelLink, d.PapelDescricao, d.Cores, d.CoresDescricao, d.DescAcabamento
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d
      ON p.NroProtocolo = d.NroProtocoloLinkDet
     AND p.AnoProtocolo = d.AnoProtocoloLinkDet
    WHERE p.NroProtocolo = %s AND p.AnoProtocolo = %s
    """
    rows = db.execute_query(query, (os_id, ano))
    if not rows:
        raise KeyError("OS não encontrada.")
    return dict(rows[0])


def _parse_acabamento(texto: Optional[str]) -> dict:
    raw = texto or ""
    laminacao = bool(_ACAB_LAMINA.search(raw))
    so_frente = bool(_ACAB_SO_FRENTE.search(raw))
    fv_lam = laminacao and bool(_ACAB_FRENTE_VERSO.search(raw)) and not so_frente
    return {
        "laminacao": laminacao,
        "laminacao_fv": fv_lam,
        "espiral": bool(_ACAB_ESPIRAL.search(raw)),
        "grampo": bool(_ACAB_GRAMPO.search(raw)),
        "cola": bool(_ACAB_COLA.search(raw)),
        "capa_pvc": bool(_ACAB_PVC.search(raw)),
    }


def _is_color(cores: Optional[str]) -> bool:
    kind = classify_cores_kind(cores)
    if kind == "PB":
        return False
    return True if kind == "COLOR" else bool(cores)


def _tecnologia_from_maquina(maquina: Optional[str]) -> str:
    text = (maquina or "").lower()
    if "offset" in text:
        return "offset"
    if "digital" in text:
        return "digital"
    return "auto"


def _dimensoes(formato: Optional[str]) -> tuple[float, float]:
    dims = resolve_formato_dimensions(formato)
    if not dims:
        return (0.0, 0.0)
    a, b = dims
    return (min(a, b), max(a, b))


def _componente_from_lote(
    *,
    nome: str,
    tipo: str,
    lote: dict,
    fallback: dict,
    acab: dict,
    insumos: list[dict],
) -> dict:
    papel_nome = lote.get("papel_link") or lote.get("papel_desc") or fallback.get("PapelLink")
    cores = lote.get("cores_link") or lote.get("cores_desc") or fallback.get("Cores")
    papel = match_papel(papel_nome, insumos)
    menor, maior = _dimensoes(fallback.get("FormatoLink"))
    fv = bool(fallback.get("FrenteVerso"))
    return {
        "nome": nome,
        "tipo": tipo or "UNICO",
        "menor_mm": menor,
        "maior_mm": maior,
        "paginas": int(lote.get("paginas") or fallback.get("Pags") or 1),
        "cor": _is_color(cores),
        "frente_verso": fv,
        "verso_cor": fv and _is_color(cores),
        "papel_codigo": (papel or {}).get("codigo"),
        "papel_nome_os": papel_nome,
        "laminacao": acab["laminacao"] if (tipo or "").upper() in {"CAPA", "UNICO", ""} else False,
        "laminacao_fv": acab["laminacao_fv"] if (tipo or "").upper() in {"CAPA", "UNICO", ""} else False,
        "espiral": acab["espiral"],
        "grampo": acab["grampo"],
        "cola": acab["cola"],
        "capa_pvc": acab["capa_pvc"],
        "verniz": 0,
        "faca_cliche": 0,
    }


def map_os_to_payload(ano: int, os_id: int, catalog: Optional[dict] = None) -> dict:
    catalog = catalog or admin_svc.load_catalog()
    row = _os_details(ano, os_id)
    acab = _parse_acabamento(row.get("DescAcabamento"))
    insumos = catalog["insumos"]
    componentes_os = load_componentes_for_os(os_id, ano, ativos_only=True)
    componentes: list[dict] = []
    for comp in componentes_os:
        lotes = comp.get("lotes") or [{}]
        tipo = (comp.get("tipo") or "UNICO").upper()
        for lote in lotes:
            componentes.append(
                _componente_from_lote(
                    nome=comp.get("nome") or tipo.title(),
                    tipo=tipo,
                    lote=lote if isinstance(lote, dict) else {},
                    fallback=row,
                    acab=acab,
                    insumos=insumos,
                )
            )
    if not componentes:
        componentes.append(
            _componente_from_lote(
                nome=row.get("TipoPublicacaoLink") or "Publicação",
                tipo="UNICO",
                lote={},
                fallback=row,
                acab=acab,
                insumos=insumos,
            )
        )

    menor, maior = _dimensoes(row.get("FormatoLink"))
    fmt = suggest_formato(menor, maior, catalog["formatos"]) if menor else None
    papel_os = row.get("PapelLink") or row.get("PapelDescricao")
    return {
        "os": {
            "nro_protocolo": int(row["NroProtocolo"]),
            "ano_protocolo": int(row["AnoProtocolo"]),
            "titulo": row.get("Titulo") or "",
            "solicitante": row.get("OrgInteressado") or row.get("NomeUsuario") or "",
            "processo": row.get("ProcessoSolicit") or "",
            "data_entrada": str(row.get("DataEntrada") or ""),
            "produto": row.get("TipoPublicacaoLink") or "",
            "formato_os": row.get("FormatoLink") or "",
            "maquina": row.get("MaquinaLink") or "",
            "papel_os": papel_os or "",
            "cores_os": row.get("Cores") or "",
            "acabamento_os": row.get("DescAcabamento") or "",
            "formato_sugerido": (fmt or {}).get("codigo"),
        },
        "tiragem": int(row.get("Tiragem") or row.get("TiragemSolicitada") or 1),
        "tecnologia": _tecnologia_from_maquina(row.get("MaquinaLink")),
        "componentes": componentes,
        "observacoes": "",
    }


def calcular_payload(payload: dict, catalog: Optional[dict] = None) -> dict:
    catalog = catalog or admin_svc.load_catalog()
    resultado = calcular(payload, catalog)
    papeis = [i for i in catalog["insumos"] if i.get("categoria") == "papel"]
    espirais = [i for i in catalog["insumos"] if i.get("categoria") == "espiral"]
    return {
        "entrada": payload,
        "opcoes": {"papeis": papeis, "espirais": espirais},
        "catalogo_resumo": {
            "insumos": len(catalog["insumos"]),
            "formatos": [f["codigo"] for f in catalog["formatos"]],
        },
        "parametros": catalog["parametros"],
        "resultado": resultado,
        "oficio": montar_oficio_preview(payload, resultado, catalog["parametros"]),
    }


def montar_especificacao(payload: dict) -> str:
    os_meta = payload.get("os") or {}
    comps = payload.get("componentes") or []
    partes = []
    produto = os_meta.get("produto") or "Publicação"
    titulo = os_meta.get("titulo") or ""
    partes.append(f"Serviço: Orçamento. Publicação: {titulo or produto}")
    if comps:
        c0 = comps[0]
        menor = c0.get("menor_mm")
        maior = c0.get("maior_mm")
        if menor and maior:
            partes.append(f"no formato {int(menor)}x{int(maior)}mm")
        papel = c0.get("papel_codigo") or c0.get("papel_nome_os") or os_meta.get("papel_os")
        if papel:
            partes.append(f"Papel {papel}")
        cor = "policromia" if c0.get("cor") else "preto"
        fv = "frente e verso" if c0.get("frente_verso") else "frente"
        partes.append(f"impressão {fv} em {cor}")
        pags = sum(int(c.get("paginas") or 0) for c in comps)
        partes.append(f"Nº de páginas: {pags:02d}")
        partes.append(f"Tiragem: {int(payload.get('tiragem') or 0)}")
        acab = []
        if c0.get("laminacao"):
            acab.append(
                "laminação fosca "
                + ("frente e verso" if c0.get("laminacao_fv") else "somente na frente")
            )
        if c0.get("grampo"):
            acab.append("grampo")
        if c0.get("cola"):
            acab.append("cola")
        if c0.get("espiral"):
            acab.append("espiral")
        if c0.get("capa_pvc"):
            acab.append("capa PVC")
        if acab:
            partes.append("Acabamento: refile e " + ", ".join(acab))
    return ". ".join(partes) + "."


def _numero_por_extenso(n: int) -> str:
    unidades = {
        1: "um", 2: "dois", 3: "três", 4: "quatro", 5: "cinco",
        6: "seis", 7: "sete", 8: "oito", 9: "nove", 10: "dez",
        11: "onze", 12: "doze", 13: "treze", 14: "quatorze", 15: "quinze",
    }
    return unidades.get(int(n), str(n))


def montar_oficio_preview(payload: dict, resultado: dict, params: dict) -> dict:
    os_meta = payload.get("os") or {}
    escolhido = resultado.get("escolhido") or {}
    tec = resultado.get("tecnologia_escolhida") or "digital"
    tec_label = "Digital" if tec == "digital" else "Offset"
    validade = int(float(params.get("validade_dias") or 180))
    prazo = int(float(params.get("prazo_entrega_dias") or 7))
    clausula_val = str(params.get("pdf_clausula_validade") or "").format(validade_dias=validade)
    clausula_ent = str(params.get("pdf_clausula_entrega") or "").format(
        tecnologia=tec_label,
        prazo_entrega_dias=f"{prazo:02d}",
        prazo_extenso=_numero_por_extenso(prazo),
    )
    pags = sum(int(c.get("paginas") or 0) for c in (payload.get("componentes") or []))
    return {
        "solicitante": os_meta.get("solicitante") or "",
        "titulo": os_meta.get("titulo") or "",
        "processo": os_meta.get("processo") or "",
        "numero": None,
        "ano": None,
        "os_numero": os_meta.get("nro_protocolo"),
        "os_ano": os_meta.get("ano_protocolo"),
        "data_entrada": os_meta.get("data_entrada") or "",
        "especificacao": montar_especificacao(payload),
        "paginas": pags,
        "tiragem": int(payload.get("tiragem") or 0),
        "valor_total": escolhido.get("total") or resultado.get("total"),
        "tecnologia_label": tec_label,
        "validade_dias": validade,
        "prazo_entrega_dias": prazo,
        "clausula_validade": clausula_val,
        "clausula_entrega": clausula_ent,
        "signatario": params.get("pdf_signatario") or "",
        "cargo": params.get("pdf_cargo") or "",
        "endereco": params.get("pdf_endereco") or "",
        "telefone": params.get("pdf_telefone") or "",
    }


def orcamento_da_os(ano: int, os_id: int) -> dict:
    catalog = admin_svc.load_catalog()
    payload = map_os_to_payload(ano, os_id, catalog)
    return calcular_payload(payload, catalog)


def _next_numero(ano: int) -> int:
    rows = db.execute_query(
        "SELECT COALESCE(MAX(numero), 0) AS n FROM tab_orcamento WHERE ano = %s",
        (ano,),
    )
    return int((rows[0] or {}).get("n") or 0) + 1


def persistir_orcamento(payload: dict, ponto: Optional[str] = None) -> dict:
    catalog = admin_svc.load_catalog()
    computed = calcular_payload(payload, catalog)
    resultado = computed["resultado"]
    os_meta = payload.get("os") or {}
    ano = int(date.today().year)
    ano_os = int(os_meta.get("ano_protocolo") or ano)
    nro = int(os_meta.get("nro_protocolo") or 0)
    numero = _next_numero(ano)
    oficio = dict(computed.get("oficio") or {})
    oficio["numero"] = numero
    oficio["ano"] = ano
    snapshot = {
        "entrada": payload,
        "resultado": resultado,
        "oficio": oficio,
        "parametros": catalog["parametros"],
    }

    def _tx(cursor):
        cursor.execute(
            """
            INSERT INTO tab_orcamento (
                numero, ano, nro_protocolo, ano_protocolo, tecnologia,
                valor_total, valor_unitario, snapshot_json, criado_por
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                numero, ano, nro, ano_os,
                resultado.get("tecnologia_escolhida"),
                resultado.get("total"),
                resultado.get("unitario"),
                json.dumps(snapshot, ensure_ascii=False, default=str),
                ponto,
            ),
        )
        return int(cursor.lastrowid)

    rec_id = int(db.execute_transaction([_tx])[0])
    computed["oficio"] = oficio
    return {
        "id": rec_id,
        "numero": numero,
        "ano": ano,
        **computed,
    }


def get_orcamento(orcamento_id: int) -> dict:
    rows = db.execute_query("SELECT * FROM tab_orcamento WHERE id = %s", (orcamento_id,))
    if not rows:
        raise KeyError("Orçamento não encontrado.")
    row = rows[0]
    snap = row.get("snapshot_json")
    if isinstance(snap, str):
        snap = json.loads(snap)
    return {
        "id": int(row["id"]),
        "numero": int(row["numero"]),
        "ano": int(row["ano"]),
        "nro_protocolo": int(row["nro_protocolo"]),
        "ano_protocolo": int(row["ano_protocolo"]),
        "tecnologia": row.get("tecnologia"),
        "valor_total": float(row.get("valor_total") or 0),
        "valor_unitario": float(row.get("valor_unitario") or 0),
        "criado_em": str(row.get("criado_em") or ""),
        "criado_por": row.get("criado_por"),
        "snapshot": snap or {},
    }
