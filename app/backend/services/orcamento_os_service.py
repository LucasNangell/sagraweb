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
from services.orcamento_engine import (
    calcular,
    insumo_by_codigo,
    match_papel,
    normalize_text,
    parse_cores_impressao,
    suggest_formato,
)
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
    cores_nm = lote.get("impressao") or lote.get("cores_link") or lote.get("cores_desc") or fallback.get("Cores")
    papel = match_papel(papel_nome, insumos)
    formato = str(lote.get("formato") or "").strip() or fallback.get("FormatoLink")
    menor, maior = _dimensoes(formato)
    spec = parse_cores_impressao(cores_nm)
    if spec is not None:
        cor = bool(spec["cor"])
        fv = bool(spec["frente_verso"])
        verso_cor = bool(spec["verso_cor"])
        impressao = f"{spec['frente']}/{spec['verso']}"
    else:
        cor = _is_color(cores_nm)
        fv = (
            bool(lote.get("frente_verso"))
            if "frente_verso" in lote
            else bool(fallback.get("FrenteVerso"))
        )
        verso_cor = False
        impressao = str(lote.get("impressao") or "").strip()
    return {
        "nome": nome,
        "tipo": tipo or "UNICO",
        "menor_mm": menor,
        "maior_mm": maior,
        "paginas": int(lote.get("paginas") or fallback.get("Pags") or 1),
        "cor": cor,
        "frente_verso": fv,
        "verso_cor": verso_cor,
        "impressao": impressao,
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
        "oficio": montar_oficio_preview(
            payload, resultado, catalog["parametros"], catalog.get("insumos") or []
        ),
    }


_CODIGO_INSUMO_RE = re.compile(r"^[a-z]\d+$", re.IGNORECASE)


def _parece_codigo_insumo(value: Optional[str]) -> bool:
    return bool(_CODIGO_INSUMO_RE.match(str(value or "").strip()))


def _comp_rotulo(comp: dict, idx: int, total: int) -> str:
    if total <= 1:
        return ""
    nome = str(comp.get("nome") or "").strip()
    tipo = str(comp.get("tipo") or "").strip()
    if tipo.upper() in {"UNICO", "ÚNICO"}:
        tipo = ""
    return nome or tipo.title() or f"Componente {idx + 1}"


def _formato_mm(comp: dict) -> str:
    try:
        menor = float(comp.get("menor_mm") or 0)
        maior = float(comp.get("maior_mm") or 0)
    except (TypeError, ValueError):
        return ""
    if menor <= 0 or maior <= 0:
        return ""
    return f"{int(menor)}×{int(maior)} mm"


def _resultado_comp(resultado: Optional[dict], idx: int) -> dict:
    escolhido = (resultado or {}).get("escolhido") or {}
    rows = escolhido.get("componentes") or []
    if 0 <= idx < len(rows) and isinstance(rows[idx], dict):
        return rows[idx]
    return {}


def _descricao_papel(
    comp: dict,
    os_meta: dict,
    insumos: list[dict],
    resultado_row: Optional[dict] = None,
) -> str:
    """Nome do papel para o ofício: texto da OS; senão descrição do cadastro. Nunca código pX."""
    os_name = str(comp.get("papel_nome_os") or os_meta.get("papel_os") or "").strip()
    if os_name and _parece_codigo_insumo(os_name):
        os_name = ""
    if os_name:
        return os_name
    catalog_spec = str((resultado_row or {}).get("papel_especificacao") or "").strip()
    if not catalog_spec:
        item = insumo_by_codigo(insumos, comp.get("papel_codigo"))
        if item:
            catalog_spec = str(item.get("especificacao") or "").strip()
    if catalog_spec and not _parece_codigo_insumo(catalog_spec):
        return catalog_spec
    return ""


def _descricao_espiral(comp: dict, insumos: list[dict]) -> str:
    item = insumo_by_codigo(insumos, comp.get("espiral_codigo"))
    if item and item.get("especificacao"):
        return str(item["especificacao"]).strip()
    return "espiral"


def _acabamentos(comp: dict, insumos: list[dict]) -> list[str]:
    itens: list[str] = []
    if comp.get("laminacao"):
        itens.append(
            "laminação fosca "
            + ("frente e verso" if comp.get("laminacao_fv") else "somente na frente")
        )
    if comp.get("grampo"):
        itens.append("grampo")
    if comp.get("cola"):
        itens.append("cola")
    if comp.get("espiral"):
        itens.append(_descricao_espiral(comp, insumos))
    if comp.get("capa_pvc"):
        itens.append("capa PVC")
    return itens


def _linha(label: str, valor: str) -> dict:
    return {"label": label, "valor": valor}


def montar_especificacao_grupos(
    payload: dict,
    resultado: Optional[dict] = None,
    insumos: Optional[list] = None,
) -> list[dict]:
    """Tabela do ofício: grupos Produto / Material / Impressão / Acabamento."""
    os_meta = payload.get("os") or {}
    comps = [c for c in (payload.get("componentes") or []) if isinstance(c, dict)]
    insumos = insumos or []
    tec = str((resultado or {}).get("tecnologia_escolhida") or payload.get("tecnologia") or "")
    tec_label = "Digital" if tec.strip().lower() == "digital" else (
        "Offset" if tec.strip().lower() == "offset" else ""
    )
    n = len(comps)
    pags = sum(int(c.get("paginas") or 0) for c in comps)
    produto = str(os_meta.get("produto") or "Publicação").strip() or "Publicação"
    titulo = str(os_meta.get("titulo") or "").strip()

    produto_linhas: list[dict] = [_linha("Publicação", produto)]
    if titulo and normalize_text(titulo) != normalize_text(produto):
        produto_linhas.append(_linha("Título", titulo))
    formatos = [_formato_mm(c) for c in comps]
    formatos_ok = [f for f in formatos if f]
    if formatos_ok and len(set(formatos_ok)) == 1:
        produto_linhas.append(_linha("Formato", formatos_ok[0]))
    elif formatos_ok:
        for idx, comp in enumerate(comps):
            fmt = formatos[idx]
            if not fmt:
                continue
            rotulo = _comp_rotulo(comp, idx, n)
            produto_linhas.append(_linha(f"Formato ({rotulo})" if rotulo else "Formato", fmt))
    if pags:
        produto_linhas.append(_linha("Páginas", f"{pags:02d}"))
    produto_linhas.append(_linha("Tiragem", str(int(payload.get("tiragem") or 0))))
    if tec_label:
        produto_linhas.append(_linha("Tecnologia", tec_label))

    material_linhas: list[dict] = []
    for idx, comp in enumerate(comps):
        rotulo = _comp_rotulo(comp, idx, n)
        papel = _descricao_papel(comp, os_meta, insumos, _resultado_comp(resultado, idx))
        if papel:
            label = f"Papel ({rotulo})" if rotulo else "Papel"
            material_linhas.append(_linha(label, papel))
        if comp.get("espiral"):
            esp = _descricao_espiral(comp, insumos)
            if esp and not any(l["valor"] == esp for l in material_linhas):
                material_linhas.append(_linha("Espiral", esp))

    impressao_linhas: list[dict] = []
    cores = [("policromia" if c.get("cor") else "preto") for c in comps]
    fvs = [("frente e verso" if c.get("frente_verso") else "frente") for c in comps]
    if comps and len(set(cores)) == 1 and len(set(fvs)) == 1:
        impressao_linhas.append(_linha("Cores", cores[0]))
        impressao_linhas.append(_linha("Impressão", fvs[0]))
    else:
        for idx, comp in enumerate(comps):
            rotulo = _comp_rotulo(comp, idx, n) or f"Componente {idx + 1}"
            impressao_linhas.append(
                _linha(rotulo, f"{fvs[idx]} em {cores[idx]}")
            )

    acab_linhas: list[dict] = []
    acab_por_comp = [_acabamentos(c, insumos) for c in comps]
    if any(acab_por_comp):
        if n <= 1:
            itens = ["refile", *(acab_por_comp[0] if acab_por_comp else [])]
            acab_linhas.append(_linha("Acabamento", ", ".join(itens)))
        elif len({tuple(a) for a in acab_por_comp}) == 1:
            itens = ["refile", *acab_por_comp[0]]
            acab_linhas.append(_linha("Acabamento", ", ".join(itens)))
        else:
            for idx, itens in enumerate(acab_por_comp):
                if not itens:
                    continue
                rotulo = _comp_rotulo(comps[idx], idx, n) or f"Componente {idx + 1}"
                acab_linhas.append(_linha(rotulo, "refile, " + ", ".join(itens)))

    grupos: list[dict] = [{"titulo": "Produto", "linhas": produto_linhas}]
    if material_linhas:
        grupos.append({"titulo": "Material", "linhas": material_linhas})
    if impressao_linhas:
        grupos.append({"titulo": "Impressão", "linhas": impressao_linhas})
    if acab_linhas:
        grupos.append({"titulo": "Acabamento", "linhas": acab_linhas})
    return grupos


def montar_especificacao(
    payload: dict,
    resultado: Optional[dict] = None,
    insumos: Optional[list] = None,
) -> str:
    partes: list[str] = []
    for grupo in montar_especificacao_grupos(payload, resultado, insumos):
        for linha in grupo.get("linhas") or []:
            label = str(linha.get("label") or "").strip()
            valor = str(linha.get("valor") or "").strip()
            if not valor:
                continue
            partes.append(f"{label}: {valor}" if label else valor)
    return ". ".join(partes) + ("." if partes else "")


def _numero_por_extenso(n: int) -> str:
    unidades = {
        1: "um", 2: "dois", 3: "três", 4: "quatro", 5: "cinco",
        6: "seis", 7: "sete", 8: "oito", 9: "nove", 10: "dez",
        11: "onze", 12: "doze", 13: "treze", 14: "quatorze", 15: "quinze",
    }
    return unidades.get(int(n), str(n))


def montar_oficio_preview(
    payload: dict,
    resultado: dict,
    params: dict,
    insumos: Optional[list] = None,
) -> dict:
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
    grupos = montar_especificacao_grupos(payload, resultado, insumos or [])
    return {
        "solicitante": os_meta.get("solicitante") or "",
        "titulo": os_meta.get("titulo") or "",
        "processo": os_meta.get("processo") or "",
        "numero": None,
        "ano": None,
        "os_numero": os_meta.get("nro_protocolo"),
        "os_ano": os_meta.get("ano_protocolo"),
        "data_entrada": os_meta.get("data_entrada") or "",
        "data_geracao": date.today().isoformat(),
        "especificacao": montar_especificacao(payload, resultado, insumos or []),
        "especificacao_grupos": grupos,
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
    computed = calcular_payload(payload, catalog)
    try:
        from services.orcamento_realizado_service import comparativo_da_os

        comparativo = comparativo_da_os(ano, os_id, computed)
        if comparativo:
            computed["comparativo"] = comparativo
    except Exception:
        logger.exception("Orçamento: falha ao montar comparativo OS %s/%s", os_id, ano)
    return computed


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
    oficio["data_geracao"] = date.today().isoformat()
    escolhido = resultado.get("escolhido") or {}
    snapshot = {
        "entrada": payload,
        "resultado": resultado,
        "oficio": oficio,
        "parametros": catalog["parametros"],
        "roteiro": escolhido.get("pessoal_detalhe") or [],
        "usa_pessoal_hora": bool(escolhido.get("usa_pessoal_hora")),
        "custo_pessoal": escolhido.get("custo_pessoal") or 0,
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
