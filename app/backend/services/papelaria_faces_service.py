"""
Frente e verso independentes (modo «Prova PDF»).

Um produto frente e verso pode combinar a FRENTE de um modelo com o VERSO de
outro. Cada modelo oferece «fontes de face» — (modelo, página do PDF):

* modelo «Frente e Verso» → frente = página 1, verso = página 2
  (os modelos combinados antigos são reaproveitados sem arquivo novo);
* modelo «Somente Frente»/«Frente» → frente = página 1;
* modelo «Verso» → verso = página 1.

As opções valem por produto + cores. Em cada recorte há no máximo um modelo
padrão de frente e um de verso (colunas PadraoFrente/PadraoVerso), que já vêm
selecionados ao criar a prova.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

FACE_FRENTE = "frente"
FACE_VERSO = "verso"
FACES = (FACE_FRENTE, FACE_VERSO)
COMPOSICAO_DADOS_KEY = "__composicao"

PAPEL_FRENTE_VERSO = "frente_verso"
PAPEL_FRENTE = "frente"
PAPEL_VERSO = "verso"


class ComposicaoError(ValueError):
    """Composição frente/verso inválida."""


def papel_do_modelo(frente_versao: Optional[str]) -> str:
    v = (frente_versao or "").strip().lower()
    if "frente" in v and "verso" in v:
        return PAPEL_FRENTE_VERSO
    if "verso" in v:
        return PAPEL_VERSO
    return PAPEL_FRENTE


def pagina_da_face(frente_versao: Optional[str], face: str) -> Optional[int]:
    """Página do PDF do modelo que serve de ``face`` (ou None se não serve)."""
    papel = papel_do_modelo(frente_versao)
    if face == FACE_FRENTE:
        return 1 if papel in (PAPEL_FRENTE_VERSO, PAPEL_FRENTE) else None
    if face == FACE_VERSO:
        if papel == PAPEL_FRENTE_VERSO:
            return 2
        if papel == PAPEL_VERSO:
            return 1
    return None


def face_do_modelo(modelo: dict[str, Any], face: str) -> Optional[int]:
    """Página da face no modelo, respeitando faces removidas (ou None)."""
    if face == FACE_FRENTE and modelo.get("ocultar_frente"):
        return None
    if face == FACE_VERSO and modelo.get("ocultar_verso"):
        return None
    return pagina_da_face(modelo.get("frente_versao"), face)


def _mesmo_recorte(modelo: dict[str, Any], produto: str, cores: str) -> bool:
    from services.papelaria_models_service import _normalizar_cores_os, normalizar_texto_produto

    return normalizar_texto_produto(modelo.get("produto") or "") == normalizar_texto_produto(
        produto or ""
    ) and _normalizar_cores_os(modelo.get("cores") or "") == _normalizar_cores_os(cores or "")


def _paginas_pdf(modelo_id: int) -> int:
    from services import papelaria_prova_pdf_service as pdf_svc

    caminho = pdf_svc.caminho_pdf(modelo_id)
    if not caminho.is_file():
        return 0
    try:
        import fitz

        with fitz.open(str(caminho)) as doc:
            return int(doc.page_count)
    except Exception as exc:  # PDF ilegível não derruba a lista
        logger.warning("Faces: não foi possível ler o PDF do modelo %s: %s", modelo_id, exc)
        return 0


def _rotulo_fonte(modelo: dict[str, Any], face: str, pagina: int) -> str:
    # Frentes e versos são exibidos sempre separados: só o nome do modelo.
    return (modelo.get("nome_exibicao") or modelo.get("arquivo_modelo") or f"Modelo {modelo.get('id')}").strip()


def listar_fontes(produto: str, cores: str, modelos: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
    """
    Frentes e versos disponíveis para produto + cores.

    ``disponivel`` só é verdadeiro quando há ao menos uma frente e um verso com
    PDF do modelo configurado (a composição é feita no servidor).
    """
    from services import papelaria_models_service as models_svc
    from services import papelaria_prova_pdf_service as pdf_svc

    todos = modelos if modelos is not None else models_svc.list_modelos_admin()
    out: dict[str, list[dict[str, Any]]] = {FACE_FRENTE: [], FACE_VERSO: []}
    paginas_cache: dict[int, int] = {}
    for m in todos:
        if not _mesmo_recorte(m, produto, cores):
            continue
        mid = int(m.get("id") or 0)
        if not mid:
            continue
        for face in FACES:
            pagina = face_do_modelo(m, face)
            if pagina is None:
                continue
            if mid not in paginas_cache:
                paginas_cache[mid] = _paginas_pdf(mid) if pdf_svc.tem_modelo_pdf(mid) else 0
            tem_pdf = paginas_cache[mid] >= pagina
            out[face].append(
                {
                    "modelo_id": mid,
                    "pagina": pagina,
                    "rotulo": _rotulo_fonte(m, face, pagina),
                    "arquivo_modelo": m.get("arquivo_modelo") or "",
                    "tem_pdf": tem_pdf,
                    "padrao": bool(m.get("padrao_frente" if face == FACE_FRENTE else "padrao_verso")),
                }
            )
    for face in FACES:
        out[face].sort(key=lambda f: (not f["padrao"], not f["tem_pdf"], f["rotulo"].lower()))

    def _padrao(face: str) -> Optional[dict[str, Any]]:
        com_pdf = [f for f in out[face] if f["tem_pdf"]]
        escolhida = next((f for f in com_pdf if f["padrao"]), None)
        if escolhida is None:
            return None
        return {"modelo_id": escolhida["modelo_id"], "pagina": escolhida["pagina"]}

    disponivel = any(f["tem_pdf"] for f in out[FACE_FRENTE]) and any(
        f["tem_pdf"] for f in out[FACE_VERSO]
    )
    return {
        "produto": produto,
        "cores": cores,
        "disponivel": disponivel,
        "frente": out[FACE_FRENTE],
        "verso": out[FACE_VERSO],
        "padrao": {FACE_FRENTE: _padrao(FACE_FRENTE), FACE_VERSO: _padrao(FACE_VERSO)},
    }


def fontes_para_modelo(modelo_id: int) -> dict[str, Any]:
    """Fontes de face do recorte (produto + cores) do modelo, com o modo atual."""
    from services import papelaria_models_service as models_svc
    from services.papelaria_prova_modo import MODO_PROVA_PDF, get_modo

    modelo = models_svc.get_modelo_by_id(int(modelo_id))
    if not modelo:
        raise LookupError("Modelo não encontrado.")
    dados = listar_fontes(modelo.get("produto") or "", modelo.get("cores") or "")
    modo_ok = get_modo() == MODO_PROVA_PDF
    dados["modo_prova_pdf"] = modo_ok
    dados["papel_modelo"] = papel_do_modelo(modelo.get("frente_versao"))
    # A página decide se a OS é frente e verso (modelo combinado ou OS F/V);
    # aqui basta haver frente e verso com PDF no modo Prova PDF.
    dados["disponivel"] = bool(dados["disponivel"] and modo_ok)
    return dados


def definir_padrao(modelo_id: int, face: str, padrao: bool) -> dict[str, Any]:
    """Marca/desmarca o modelo como padrão da face no seu recorte (produto + cores)."""
    from services import papelaria_models_service as models_svc

    if face not in FACES:
        raise ComposicaoError("Face inválida (use frente ou verso).")
    models_svc.ensure_papelaria_modelos_table()
    modelo = models_svc.get_modelo_by_id(int(modelo_id))
    if not modelo:
        raise LookupError("Modelo não encontrado.")
    if face_do_modelo(modelo, face) is None:
        raise ComposicaoError(
            f"Este modelo ({modelo.get('frente_versao') or 'sem frente/verso'}) não tem {face}."
        )
    coluna = "PadraoFrente" if face == FACE_FRENTE else "PadraoVerso"
    if padrao:
        irmaos = [
            int(m["id"])
            for m in models_svc.list_modelos_admin()
            if _mesmo_recorte(m, modelo.get("produto") or "", modelo.get("cores") or "")
            and int(m["id"]) != int(modelo_id)
        ]
        if irmaos:
            marcadores = ", ".join(f"%(id{i})s" for i in range(len(irmaos)))
            params = {f"id{i}": v for i, v in enumerate(irmaos)}
            db.execute_query(
                f"UPDATE tabPapelariaModelos SET {coluna} = 0 WHERE ID IN ({marcadores})",
                params,
            )
    db.execute_query(
        f"UPDATE tabPapelariaModelos SET {coluna} = %(v)s WHERE ID = %(id)s",
        {"v": 1 if padrao else 0, "id": int(modelo_id)},
    )
    return models_svc.get_modelo_by_id(int(modelo_id)) or {}


def remover_face(modelo_id: int, face: str) -> dict[str, Any]:
    """
    Remove a frente ou o verso. Modelo de uma face só é excluído (desativado);
    modelo antigo de 2 páginas perde só aquela face — se a outra já tiver sido
    removida, o modelo inteiro é excluído.
    """
    from services import papelaria_models_service as models_svc

    if face not in FACES:
        raise ComposicaoError("Face inválida (use frente ou verso).")
    models_svc.ensure_papelaria_modelos_table()
    modelo = models_svc.get_modelo_by_id(int(modelo_id))
    if not modelo:
        raise LookupError("Modelo não encontrado.")
    if face_do_modelo(modelo, face) is None:
        raise ComposicaoError(f"Este modelo não tem {face}.")
    outra = FACE_VERSO if face == FACE_FRENTE else FACE_FRENTE
    if face_do_modelo(modelo, outra) is None:
        models_svc.delete_modelo_admin(int(modelo_id))
        return {"excluido": True, "modelo_id": int(modelo_id)}
    ocultar = "OcultarFrente" if face == FACE_FRENTE else "OcultarVerso"
    padrao = "PadraoFrente" if face == FACE_FRENTE else "PadraoVerso"
    db.execute_query(
        f"UPDATE tabPapelariaModelos SET {ocultar} = 1, {padrao} = 0 WHERE ID = %(id)s",
        {"id": int(modelo_id)},
    )
    return {"excluido": False, "modelo_id": int(modelo_id), "modelo": models_svc.get_modelo_by_id(int(modelo_id))}


def normalizar_composicao(
    raw: Any, *, permitir_repeticao: bool = False
) -> Optional[dict[str, dict[str, int]]]:
    """
    Valida o formato {"frente": {"modelo_id", "pagina"}, "verso": {...}}.
    Com ``permitir_repeticao``, ``modelo_id`` 0 é a face da base da repetição
    de SP (página 1 = Frente, 2 = Verso da prova antiga).
    """
    if raw in (None, "", {}):
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ComposicaoError("Composição frente/verso: JSON inválido.") from exc
    if not isinstance(raw, dict):
        raise ComposicaoError("Composição frente/verso inválida.")
    out: dict[str, dict[str, int]] = {}
    for face in FACES:
        parte = raw.get(face)
        if not isinstance(parte, dict):
            raise ComposicaoError(f"Composição sem {face}.")
        try:
            mid = int(parte.get("modelo_id") or 0)
            pagina = int(parte.get("pagina") or 0)
        except (TypeError, ValueError) as exc:
            raise ComposicaoError(f"Composição: {face} inválida.") from exc
        if mid < 0 or (mid == 0 and not permitir_repeticao) or pagina <= 0:
            raise ComposicaoError(f"Composição: {face} inválida.")
        out[face] = {"modelo_id": mid, "pagina": pagina}
    return out


def validar_composicao(
    raw: Any, modelo_base: dict[str, Any], *, permitir_repeticao: bool = False
) -> Optional[dict[str, dict[str, int]]]:
    """
    Confere se frente e verso pertencem ao recorte do modelo base, servem para
    a face pedida e têm PDF do modelo configurado. Faces da repetição de SP
    (``modelo_id`` 0) vêm da base da própria OS e não passam por aqui.
    """
    comp = normalizar_composicao(raw, permitir_repeticao=permitir_repeticao)
    if comp is None:
        return None
    fontes = listar_fontes(modelo_base.get("produto") or "", modelo_base.get("cores") or "")
    for face in FACES:
        alvo = comp[face]
        if alvo["modelo_id"] == 0:
            continue
        achada = next(
            (
                f
                for f in fontes[face]
                if f["modelo_id"] == alvo["modelo_id"] and f["pagina"] == alvo["pagina"]
            ),
            None,
        )
        if achada is None:
            raise ComposicaoError(
                f"O {face} escolhido não pertence a {modelo_base.get('produto')} · {modelo_base.get('cores')}."
            )
        if not achada["tem_pdf"]:
            raise ComposicaoError(
                f"O {face} escolhido ({achada['rotulo']}) não tem PDF do modelo configurado."
            )
    if comp[FACE_FRENTE]["modelo_id"] not in (0, int(modelo_base.get("id") or 0)):
        raise ComposicaoError("A frente da composição deve ser o modelo da prova.")
    return comp


def composicao_do_job(job: dict[str, Any]) -> Optional[dict[str, dict[str, int]]]:
    """Composição gravada nos dados do job (ou None para o fluxo normal)."""
    try:
        dados = job.get("dados") or {}
        return normalizar_composicao(
            dados.get(COMPOSICAO_DADOS_KEY), permitir_repeticao="__repeticao" in dados
        )
    except ComposicaoError:
        logger.warning("Job %s: composição frente/verso inválida — ignorada.", job.get("id"))
        return None
