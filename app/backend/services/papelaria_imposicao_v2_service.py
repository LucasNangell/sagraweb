"""Geração de imposição pelo perfil v2 (genérico, sem regras por produto).

Um produto × variante só usa este caminho quando o perfil está aprovado
(``AtivoV2``). Enquanto isso o fluxo antigo de ``papelaria_jobs_service``
continua intacto. O perfil é compilado para o mesmo formato de configuração
que o gerador de JDF já usa, então reenvio, nomes de arquivo, polling do
Apogee e finalização seguem o mesmo código.
"""
from __future__ import annotations

import copy
import json
import logging
import os
from typing import Any, Optional

from services import papelaria_imposicao_perfil_service as perfil_svc
from services import papelaria_imposicao_perfil_store as store

logger = logging.getLogger(__name__)


def _jobs():
    from services import papelaria_jobs_service as jobs_svc

    return jobs_svc


# ---------------------------------------------------------------------------
# Candidatas à juntada
# ---------------------------------------------------------------------------


def _produtos_compativeis(perfil: dict[str, Any], produto_ancora: str) -> set[str]:
    nomes = {str(produto_ancora or "").strip().lower()}
    for item in (perfil.get("juntada") or {}).get("produtos_compativeis") or []:
        nomes.add(str(item).strip().lower())
    nomes.discard("")
    return nomes


def _tem_base_sefoc(ano: int, nro: int) -> bool:
    jobs = _jobs()
    try:
        sefoc = jobs.resolve_os_papelaria_dir(ano, nro, create=False)
    except Exception:
        return False
    if not os.path.isdir(sefoc):
        return False
    try:
        names = os.listdir(sefoc)
    except OSError:
        return False
    for name in names:
        low = name.lower()
        if low.endswith("basesefoc.pdf") or low.endswith("basesefoc.cdr"):
            return True
    return False


def listar_candidatas(
    *,
    ano: int,
    nro: int,
    produto: str,
    perfil: dict[str, Any],
) -> dict[str, Any]:
    """OSs que podem entrar na mesma folha, segundo as regras do perfil."""
    from database import db
    from services.papelaria_imposicao_juntada_service import _os_tiragem, _ultima_situacao

    jobs = _jobs()
    junt = perfil.get("juntada") or {}
    capacidade = perfil_svc.capacidade_juntada(perfil)
    situacao_os = _ultima_situacao(ano, nro)
    situacao = junt.get("situacao_candidatas") or situacao_os
    base = {
        "ancora": {"ano": ano, "nro": nro, "produto": produto},
        "situacao": situacao or "",
        "situacao_os": situacao_os or "",
        "max_slots": len(perfil["slots"]["frente"]),
        "max_os": capacidade,
        "regra": junt.get("regra_tiragem"),
        "candidatas": [],
    }
    if not junt.get("ativo"):
        return base

    try:
        base["ancora"]["tiragem"] = jobs._load_os_tiragem(ano, nro)
    except Exception:
        return base
    try:
        base["ancora"]["label"] = jobs.get_os_folder_basename(ano, nro)
    except Exception:
        base["ancora"]["label"] = f"{int(nro):05d}"
    if not situacao:
        return base

    rows = db.execute_query(
        """
        SELECT p.NroProtocolo AS nro, p.AnoProtocolo AS ano,
               d.TipoPublicacaoLink AS produto,
               d.Tiragem AS tiragem,
               d.TiragemSolicitada AS tiragem_solicitada
        FROM tabAndamento a
        INNER JOIN tabProtocolos p
          ON p.NroProtocolo = a.NroProtocoloLink
         AND p.AnoProtocolo = a.AnoProtocoloLink
        LEFT JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet
         AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE a.UltimoStatus = 1
          AND a.SituacaoLink = %(situacao)s
          AND NOT (p.NroProtocolo = %(nro)s AND p.AnoProtocolo = %(ano)s)
        ORDER BY p.AnoProtocolo DESC, p.NroProtocolo DESC
        LIMIT 200
        """,
        {"situacao": situacao, "nro": int(nro), "ano": int(ano)},
    )
    aceitos = _produtos_compativeis(perfil, produto)
    for row in rows or []:
        cand_produto = str(row.get("produto") or "").strip()
        if cand_produto.lower() not in aceitos:
            continue
        cand_ano, cand_nro = int(row["ano"]), int(row["nro"])
        try:
            cand_tiragem = _os_tiragem(row)
        except ValueError:
            continue
        if not _tem_base_sefoc(cand_ano, cand_nro):
            continue
        try:
            alloc = perfil_svc.alocar_slots(perfil, [base["ancora"]["tiragem"], cand_tiragem])
        except ValueError:
            continue
        try:
            label = jobs.get_os_folder_basename(cand_ano, cand_nro)
        except Exception:
            label = f"{cand_nro:05d}"
        base["candidatas"].append(
            {
                "ano": cand_ano,
                "nro": cand_nro,
                "produto": cand_produto,
                "tiragem": cand_tiragem,
                "label": label,
                "slots_com_ancora": alloc["slots"],
                "total_slots_com_ancora": alloc["total_slots"],
            }
        )
    return base


# ---------------------------------------------------------------------------
# Preparação do JDF a partir do perfil
# ---------------------------------------------------------------------------


def _slots_ll(perfil: dict[str, Any], slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Slots com x/y absolutos no sistema do PDF (canto inferior esquerdo)."""
    temp = copy.deepcopy(perfil)
    temp["slots"] = {"frente": slots, "verso": []}
    resolved = perfil_svc.slots_topo_esquerda(temp, face="frente")
    by_id = {s["id"]: s for s in resolved}
    folha = perfil_svc.folha_mm(perfil)
    if folha is None:
        raise ValueError("Perfil sem tamanho de folha.")
    out = []
    for slot in slots:
        pos = by_id.get(slot["id"])
        if pos is None:
            raise ValueError(f"Slot {slot['id']} sem posição resolvida.")
        out.append(
            {
                **slot,
                "x_ll": pos["x_mm"],
                "y_ll": perfil_svc.topo_para_pdf_ll(pos["y_mm"], pos["altura_mm"], folha[1]),
                "largura_mm": pos["largura_mm"],
                "altura_mm": pos["altura_mm"],
            }
        )
    return out


def preparar_config_pipeline(
    *,
    perfil: dict[str, Any],
    dados: dict[str, Any],
    ano: int,
    nro: int,
    sefoc_dir: str,
    gang_pdf_path: str,
) -> tuple[dict[str, Any], str]:
    """
    Pipeline de arte pré-impressa: um slot por página do PDF combinado.

    Retorna (config_para_jdf, caminho_pdf_base). Com ``arte.rotacao = no_pdf``
    as páginas são giradas no PDF e o JDF só translada; com ``no_jdf`` a
    rotação vai no CTM de cada ContentObject.
    """
    from services import papelaria_jdf_service as jdf_svc

    jobs = _jobs()
    perfil = perfil_svc.normalize_perfil(perfil)
    slots_info = dados.get("juntada_slots") if isinstance(dados, dict) else None
    n_slots = 0
    if isinstance(slots_info, dict):
        try:
            n_slots = int(slots_info.get("total_slots") or 0)
        except (TypeError, ValueError):
            n_slots = 0
    if n_slots < 1:
        n_slots = len(perfil["slots"]["frente"])
    lote_slots = perfil_svc.slots_para_lote(perfil, n_slots)
    posicionados = _slots_ll(perfil, lote_slots)
    page = perfil_svc.pagina_mm(perfil)
    if page is None:
        raise ValueError("Arte pré-impressa exige tamanho de página fixo no perfil.")

    gang_src = os.path.normpath((gang_pdf_path or "").strip())
    if not gang_src or not os.path.isfile(gang_src):
        raise FileNotFoundError(f"PDF combinado (pré-impresso) ausente: {gang_src or '(vazio)'}")

    base_cfg = perfil_svc.compilar_config_jdf(perfil, slots_frente=lote_slots)
    cols = int(base_cfg["grid"]["colunas"])
    rows = int(base_cfg["grid"]["linhas"])
    if perfil["posicionamento"] == "grade":
        cells = [(int(s["col"]), int(s["row"])) for s in lote_slots]
    else:
        cells = perfil_svc.celulas_manual(perfil, lote_slots)[2]

    base_pdf = gang_src
    if perfil["arte"]["rotacao"] == "no_pdf":
        rotations = [int(s.get("rotacao") or 0) for s in lote_slots]
        while len(rotations) < jdf_svc.read_pdf_page_count(gang_src):
            rotations.append(0)
        prefix = jobs.get_os_folder_basename(ano, nro)
        baked = os.path.normpath(os.path.join(sefoc_dir, f"{prefix}-ImposicaoGang-Rotated.pdf"))
        base_pdf = jdf_svc.bake_page_rotations_into_pdf(
            source_pdf_path=gang_src,
            output_pdf_path=baked,
            rotations=rotations,
        )
        fw, fh = perfil_svc.footprint_mm(page[0], page[1], rotations[0] if rotations else 0)
        pagina_cfg = {"origem": "fixixa", "largura_mm": fw, "altura_mm": fh}
        ocupadas = [
            {"col": c, "row": r, "pagina": s["pagina"], "x_mm": round(s["x_ll"], 4), "y_mm": round(s["y_ll"], 4)}
            for s, (c, r) in zip(posicionados, cells)
        ]
    else:
        pagina_cfg = {"origem": "fixixa", "largura_mm": page[0], "altura_mm": page[1]}
        ocupadas = []
        for s, (c, r) in zip(posicionados, cells):
            entry: dict[str, Any] = {
                "col": c,
                "row": r,
                "pagina": s["pagina"],
                "x_mm": round(s["x_ll"], 4),
                "y_mm": round(s["y_ll"], 4),
            }
            if int(s.get("rotacao") or 0):
                entry["rotacao"] = int(s["rotacao"])
            ocupadas.append(entry)

    cfg = dict(base_cfg)
    cfg["pagina"] = pagina_cfg
    cfg["grid"] = {"colunas": cols, "linhas": rows, "ocupadas": ocupadas}
    cfg = _aplicar_marcas_op(
        cfg,
        perfil=perfil,
        nros=jobs._lote_nros_from_dados(dados, ano=ano, nro=nro),
        sefoc_dir=sefoc_dir,
        ano=ano,
        nro=nro,
    )
    return cfg, base_pdf


def _aplicar_marcas_op(
    cfg: dict[str, Any],
    *,
    perfil: dict[str, Any],
    nros: list[int],
    sefoc_dir: str,
    ano: int,
    nro: int,
) -> dict[str, Any]:
    """
    Prepara o PDF de marcas na pasta da OS (rede), onde o Apogee lê:
    - carimbar OP → cópia com os números das OPs;
    - PDF guardado no servidor → cópia simples;
    - caminho de rede informado → usado como está.
    """
    marcas = perfil.get("marcas") or {}
    if not marcas.get("ativo"):
        return {**cfg, "marcas_corte": False, "marcas_pdf_path": None}
    from services import papelaria_imposicao_marcas_service as marcas_svc
    from services import papelaria_jdf_service as jdf_svc

    jobs = _jobs()
    prefix = jobs.get_os_folder_basename(ano, nro)
    if marcas.get("carimbar_op"):
        src = perfil_svc.marcas_pdf(perfil) or ""
        if not src:
            raise ValueError("Perfil com carimbo de OP sem PDF de marcas.")
        out = os.path.normpath(os.path.join(sefoc_dir, f"{prefix}-Marcas-OP.pdf"))
        ready = jdf_svc.prepare_marcas_pdf_with_ops(
            source_pdf_path=src,
            output_pdf_path=out,
            nros=nros,
        )
        return {**cfg, "marcas_corte": True, "marcas_pdf_path": ready}
    if marcas.get("arquivo"):
        dest = marcas_svc.copiar_para_pasta(
            marcas["arquivo"], sefoc_dir, f"{prefix}-Marcas.pdf"
        )
        return {**cfg, "marcas_corte": True, "marcas_pdf_path": dest}
    return cfg


# ---------------------------------------------------------------------------
# Criação do job
# ---------------------------------------------------------------------------


def create_imposicao_job_v2(
    *,
    ano: int,
    nro: int,
    solicitado_por: str,
    modelo: dict[str, Any],
    produto: str,
    variante: str,
    registro: dict[str, Any],
    juntada_os: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Gera o JDF (síncrono) ou enfileira o pipeline pré-impresso (worker)."""
    from database import db

    jobs = _jobs()
    perfil = perfil_svc.normalize_perfil(registro["perfil"])
    validacao = perfil_svc.validar_perfil(perfil)
    if not validacao["completo"]:
        msgs = "; ".join(e["mensagem"] for e in validacao["erros"][:3])
        raise ValueError(f"Perfil de imposição {variante} com erros: {msgs}")
    perfil = validacao["perfil"] or perfil

    membros: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = {(int(ano), int(nro))}
    for item in juntada_os or []:
        key = (int(item.get("ano")), int(item.get("nro")))
        if key in seen:
            continue
        seen.add(key)
        jobs._validate_os_exists(key[0], key[1])
        membros.append({"ano": key[0], "nro": key[1]})
    if membros and not perfil["juntada"]["ativo"]:
        raise ValueError("A juntada não está ativa no perfil de imposição deste produto.")

    v2_meta = {
        "produto": produto,
        "variante": variante,
        "perfil": perfil,
        "perfil_id": registro.get("id"),
        "aprovado_em": registro.get("aprovado_em"),
    }
    destino = perfil["saida"]["destino_pdf"]
    sefoc_dir = jobs.resolve_os_papelaria_dir(ano, nro, create=False)
    ordem = jobs.next_queue_position()

    if perfil_svc.pipeline_para(perfil) == "worker":
        lote = [{"ano": int(ano), "nro": int(nro)}, *membros]
        tiragens = [jobs._load_os_tiragem(int(x["ano"]), int(x["nro"])) for x in lote]
        slots_info = perfil_svc.alocar_slots(perfil, tiragens)
        lote_slots = perfil_svc.slots_para_lote(perfil, slots_info["total_slots"])
        config_base = perfil_svc.compilar_config_jdf(perfil, slots_frente=lote_slots)

        membros_meta = []
        for m in membros:
            try:
                label = jobs.get_os_folder_basename(m["ano"], m["nro"])
            except Exception:
                label = f"{int(m['nro']):05d}"
            membros_meta.append(
                {
                    "ano": m["ano"],
                    "nro": m["nro"],
                    "label": label,
                    "tiragem": jobs._load_os_tiragem(m["ano"], m["nro"]),
                }
            )
        lote_payload = []
        for idx, item in enumerate(lote):
            ia, ir = int(item["ano"]), int(item["nro"])
            cdr_info = jobs.select_os_usable_cdr(ia, ir)
            sefoc_m = jobs.resolve_os_papelaria_dir(ia, ir, create=True)
            pre_name = jobs.build_pre_impresso_pdf_name(ia, ir)
            lote_payload.append(
                {
                    "ano": ia,
                    "nro": ir,
                    "tiragem": tiragens[idx],
                    "slots": int(slots_info["slots"][idx]),
                    "cdr_path": cdr_info["absolute_path"],
                    "pre_pdf_name": pre_name,
                    "pre_pdf_path": os.path.normpath(os.path.join(sefoc_m, pre_name)),
                    "label": jobs.get_os_folder_basename(ia, ir),
                }
            )
        from services.papelaria_imposicao_juntada_service import format_juntada_descricao

        ancora_label = jobs.get_os_folder_basename(ano, nro)
        gang_name = jobs.build_imposicao_gang_pdf_name(ano, nro)
        dados_clean = {
            "imposicao_v2": v2_meta,
            "imposicao_config": config_base,
            "imposicao_config_base": config_base,
            "imposicao_variante": variante,
            "usar_pre_impresso": True,
            "imposicao_destino": destino,
            "aguardando_apogee": False,
            "pre_impresso_pipeline": True,
            "ancora": {"ano": ano, "nro": nro, "label": ancora_label},
            "juntada_membros": membros_meta,
            "juntada_lote": lote_payload,
            "juntada_slots": slots_info,
            "gang_pdf_name": gang_name,
            "gang_pdf_path": os.path.normpath(os.path.join(sefoc_dir, gang_name)),
            "jdf_comment": format_juntada_descricao(
                {"ano": ano, "nro": nro, "label": ancora_label}, membros_meta
            ),
            "jdf_import_root": perfil["saida"]["jdf_hotfolder"],
            "imposicao_pasta_saida": perfil["saida"].get("pasta_pdf"),
            "compose_com_template": False,
            "jdf_sem_imposicao": False,
            "pasta_art_blank_pages": False,
        }
        insert_params = {
            "nro": nro,
            "ano": ano,
            "tipo": jobs.TIPO_JOB_IMPOSICAO,
            "produto": produto,
            "modelo_id": int(modelo["id"]),
            "arquivo": (modelo.get("arquivo_modelo") or "").strip(),
            "dados": json.dumps(dados_clean, ensure_ascii=False),
            "status": jobs.STATUS_PENDING,
            "ordem": ordem,
            "ponto": solicitado_por,
            "prova_revisao": jobs.PROVA_REVISAO_NA,
        }

        def _insert_pending(cursor) -> int:
            cursor.execute(
                """
                INSERT INTO tabPapelariaJobs (
                    NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                    DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID,
                    ArquivoPdfGerado, ProvaRevisao, ConcluidoEm
                ) VALUES (
                    %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                    %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, NULL,
                    NULL, %(prova_revisao)s, NULL
                )
                """,
                insert_params,
            )
            return int(cursor.lastrowid)

        job_id = int(db.execute_transaction([_insert_pending])[0])
        job = jobs.get_job(job_id)
        if not job:
            raise RuntimeError("Falha ao recuperar job criado.")
        jobs.append_job_log(
            job_id,
            (
                f"Imposição {variante} (perfil) enfileirada — âncora {int(nro):05d}"
                + (f" + {len(membros_meta)} OS juntada(s)" if membros_meta else "")
                + f"; slots={slots_info['slots']}."
            ),
            "info",
        )
        jobs.broadcast_job_update(job)
        return job

    # --- Síncrono: BaseSefoc.pdf da OS ---
    removed_digital = jobs.clear_digital_imposicao_pdfs(sefoc_dir) if destino == "digital" else []
    base_pdf_path = jobs.resolve_base_sefoc_pdf_path(ano, nro)
    config_base = perfil_svc.compilar_config_jdf(perfil)
    config_base = _aplicar_marcas_op(
        config_base, perfil=perfil, nros=[int(nro)], sefoc_dir=sefoc_dir, ano=ano, nro=nro
    )
    config, paginas_info = adaptar_ao_pdf(
        config_base, perfil=perfil, base_pdf_path=base_pdf_path
    )
    artifacts = jobs._build_imposicao_jdf_artifacts(
        ano=ano,
        nro=nro,
        produto=produto,
        config=config,
        base_pdf_path=base_pdf_path,
    )
    dados_clean = {
        "imposicao_v2": v2_meta,
        "base_pdf": os.path.basename(base_pdf_path),
        "imposicao_config": config,
        "imposicao_config_base": config_base,
        "imposicao_variante": variante,
        "usar_pre_impresso": False,
        "imposicao_destino": destino,
        "imposicao_pasta_saida": perfil["saida"].get("pasta_pdf"),
        "jdf_path": artifacts["jdf_path"],
        "jdf_dir": artifacts["jdf_dir"],
        "jdf_name": artifacts["jdf_name"],
        "aguardando_apogee": True,
    }
    if paginas_info is not None:
        dados_clean["imposicao_paginas"] = paginas_info
    if removed_digital:
        dados_clean["imposicao_pdfs_removidos"] = removed_digital
    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": jobs.TIPO_JOB_IMPOSICAO,
        "produto": produto,
        "modelo_id": int(modelo["id"]),
        "arquivo": (modelo.get("arquivo_modelo") or "").strip(),
        "dados": json.dumps(dados_clean, ensure_ascii=False),
        "status": jobs.STATUS_COMPLETED,
        "ordem": ordem,
        "ponto": solicitado_por,
        "prova_revisao": jobs.PROVA_REVISAO_NA,
    }

    def _insert_job(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID,
                ArquivoPdfGerado, ProvaRevisao, ConcluidoEm
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, NULL,
                NULL, %(prova_revisao)s, NOW()
            )
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    job_id = int(db.execute_transaction([_insert_job])[0])
    job = jobs.get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")
    extra = (
        f" PDF(s) Digital anterior(es) removido(s): {', '.join(removed_digital)}."
        if removed_digital
        else ""
    )
    adaptacao = perfil_svc.descrever_adaptacao(paginas_info or {})
    jobs.append_job_log(
        job_id,
        (
            f"JDF {variante} (perfil) enviado ao Apogee: {artifacts['jdf_name']} "
            f"({artifacts['jdf_dir']}) a partir de {os.path.basename(base_pdf_path)}.{extra}"
            + (f" {adaptacao}" if adaptacao else "")
        ),
        "info",
    )
    jobs.broadcast_job_update(job)
    return job


# ---------------------------------------------------------------------------
# Páginas do PDF × páginas do perfil
# ---------------------------------------------------------------------------


def _contar_paginas(pdf_path: str) -> Optional[int]:
    from services import papelaria_jdf_service as jdf_svc

    try:
        return int(jdf_svc.read_pdf_page_count(pdf_path))
    except Exception as exc:
        logger.warning("Não foi possível contar as páginas de %s: %s", pdf_path, exc)
        return None


def adaptar_ao_pdf(
    config: dict[str, Any],
    *,
    perfil: dict[str, Any],
    base_pdf_path: str,
) -> tuple[dict[str, Any], Optional[dict[str, Any]]]:
    """
    Ajusta a configuração ao número de páginas do PDF da OS, conforme
    ``perfil.paginas_faltantes``. Sem conseguir ler o PDF, segue como antes.
    """
    n = _contar_paginas(base_pdf_path)
    if n is None:
        return config, None
    modo = str(perfil.get("paginas_faltantes") or "adaptar")
    return perfil_svc.adaptar_config_a_paginas(config, n, modo=modo)


def config_para_reenvio(
    dados: dict[str, Any],
    *,
    base_pdf_path: str,
) -> Optional[dict[str, Any]]:
    """
    Reenvio de JDF de job do perfil: refaz o ajuste às páginas com o PDF
    atual (o BaseSefoc pode ter sido refeito com mais ou menos páginas).
    ``None`` = usar a configuração gravada no job.
    """
    meta = dados.get("imposicao_v2")
    base = dados.get("imposicao_config_base")
    if not isinstance(meta, dict) or not isinstance(base, dict):
        return None
    if dados.get("usar_pre_impresso") or dados.get("pre_impresso_pipeline"):
        return None
    if "imposicao_paginas" not in dados:
        return None
    from services import papelaria_imposicao_config_service as cfg_svc

    perfil = meta.get("perfil") if isinstance(meta.get("perfil"), dict) else {}
    config = cfg_svc.validate_imposicao_config_payload(base, require_marcas_pdf=True)
    novo, info = adaptar_ao_pdf(config, perfil=perfil, base_pdf_path=base_pdf_path)
    if info is not None:
        dados["imposicao_paginas"] = info
    return novo


def aviso_paginas_os(
    *, ano: int, nro: int, perfil: dict[str, Any]
) -> Optional[str]:
    """
    Aviso para o diálogo quando o BaseSefoc da OS tem menos páginas do que
    o perfil usa (ex.: só frente). ``None`` quando está tudo certo ou não
    dá para ler o PDF.
    """
    if perfil_svc.pipeline_para(perfil) != "sincrono":
        return None
    if perfil_svc.max_pagina_perfil(perfil) <= 1:
        return None
    from services import papelaria_jobs_service as jobs

    try:
        pdf = jobs.resolve_base_sefoc_pdf_path(ano, nro)
    except Exception:
        return None
    n = _contar_paginas(pdf)
    if n is None:
        return None
    try:
        cfg = perfil_svc.compilar_config_jdf(perfil)
        _cfg, info = perfil_svc.adaptar_config_a_paginas(
            cfg, n, modo=str(perfil.get("paginas_faltantes") or "adaptar")
        )
    except ValueError as exc:
        return str(exc)
    except Exception:
        return None
    if not info.get("ajustado"):
        return None
    plural = "s" if n != 1 else ""
    if info.get("so_frente"):
        return f"O PDF da OS tem {n} página{plural}: será gerado só frente."
    return f"O PDF da OS tem {n} página{plural}: slots sem página ficarão vazios."


# ---------------------------------------------------------------------------
# Opções para o diálogo Offset/Digital
# ---------------------------------------------------------------------------


def _resumo_config_antiga(cfg: Optional[dict[str, Any]]) -> Optional[str]:
    if not isinstance(cfg, dict):
        return None
    try:
        from services import papelaria_imposicao_config_service as cfg_svc

        folha = cfg.get("folha_mm") or {}
        n = len(cfg_svc.resolve_grid_ocupadas(cfg.get("grid") or {}))
        parts = [f"{float(folha.get('largura')):g}×{float(folha.get('altura')):g} mm", f"{n} slot" + ("" if n == 1 else "s")]
        if cfg.get("marcas_corte"):
            parts.append("marcas ✓")
        if cfg.get("usar_pre_impresso"):
            parts.append("pré-impresso")
        return " · ".join(parts)
    except Exception:
        return None


def opcoes_os(*, ano: int, nro: int, modelo: dict[str, Any]) -> dict[str, Any]:
    """
    Estado de cada variante para o diálogo da página Papelaria.

    ``fonte`` = "perfil" (v2 aprovado) | "configuracao_antiga" | None.
    """
    from services import papelaria_imposicao_juntada_service as juntada_svc
    from services import papelaria_produto_imposicao_service as prod_imp_svc

    produto = (modelo.get("produto") or "").strip()
    legado = prod_imp_svc.resolve_imposicao_opcoes(
        produto=produto,
        modelo_imposicao_config_json=modelo.get("imposicao_config_json"),
    )
    variantes: dict[str, Any] = {}
    juntada: dict[str, Any] = {}
    for var in perfil_svc.VARIANTES:
        reg = store.get_perfil_ativo(produto, var) if produto else None
        if reg:
            val = perfil_svc.validar_perfil(reg["perfil"], verificar_arquivos=False)
            perfil = val["perfil"] or reg["perfil"]
            variantes[var] = {
                "disponivel": bool(val["completo"]),
                "fonte": "perfil",
                "resumo": perfil_svc.resumo_perfil(perfil),
                "destino_pdf": perfil["saida"]["destino_pdf"],
                "pasta_pdf": perfil["saida"].get("pasta_pdf"),
                "erros": [e["mensagem"] for e in val["erros"]],
                "aviso": aviso_paginas_os(ano=ano, nro=nro, perfil=perfil) if val["completo"] else None,
            }
            if perfil["juntada"]["ativo"]:
                try:
                    juntada[var] = listar_candidatas(ano=ano, nro=nro, produto=produto, perfil=perfil)
                except Exception as exc:
                    logger.warning("Candidatas juntada v2 %s/%s: %s", nro, ano, exc)
                    juntada[var] = {"candidatas": [], "max_os": perfil_svc.capacidade_juntada(perfil)}
            continue
        cfg = legado.get(var)
        if isinstance(cfg, dict):
            variantes[var] = {
                "disponivel": True,
                "fonte": "configuracao_antiga",
                "resumo": _resumo_config_antiga(cfg),
                "destino_pdf": "offset" if cfg.get("usar_pre_impresso") else "digital",
                "pasta_pdf": None,
                "erros": [],
            }
            # Fluxo antigo: juntada só com pré-impresso nos produtos que ele conhece.
            if cfg.get("usar_pre_impresso") and juntada_svc.is_pre_impresso_produto(produto):
                try:
                    juntada[var] = juntada_svc.list_imposicao_candidatas(ano=ano, nro=nro, produto=produto)
                except Exception as exc:
                    logger.warning("Candidatas juntada legado %s/%s: %s", nro, ano, exc)
        else:
            variantes[var] = {
                "disponivel": False,
                "fonte": None,
                "resumo": None,
                "destino_pdf": None,
                "pasta_pdf": None,
                "erros": ["Variante não configurada para este produto."],
            }
    return {
        "produto": produto,
        "variantes": variantes,
        "juntada": juntada,
        "variantes_disponiveis": [v for v in perfil_svc.VARIANTES if variantes[v]["disponivel"]],
    }


def previa_juntada(
    *,
    produto: str,
    variante: str,
    tiragens: list[int],
    modelo: dict[str, Any],
) -> dict[str, Any]:
    """Distribuição de slots para a seleção atual do diálogo."""
    reg = store.get_perfil_ativo(produto, variante)
    if reg:
        return perfil_svc.alocar_slots(reg["perfil"], tiragens)
    from services import papelaria_imposicao_juntada_service as juntada_svc

    _ = modelo
    return juntada_svc.alocar_slots(tiragens, produto=produto)


# ---------------------------------------------------------------------------
# Fluxo antigo: configuração efetiva (para comparar e importar)
# ---------------------------------------------------------------------------


def config_efetiva_antiga(
    *,
    produto: str,
    variante: str,
    modelo_imposicao_config_json: Any = None,
) -> Optional[dict[str, Any]]:
    """
    Configuração que o fluxo antigo realmente usa ao gerar (antes do bake),
    com a folha cheia de slots. None se a variante não existe no fluxo antigo.
    """
    from services import papelaria_imposicao_config_service as cfg_svc
    from services import papelaria_imposicao_juntada_service as juntada_svc
    from services import papelaria_produto_imposicao_service as prod_imp_svc

    opcoes = prod_imp_svc.resolve_imposicao_opcoes(
        produto=produto, modelo_imposicao_config_json=modelo_imposicao_config_json
    )
    cfg = opcoes.get(variante)
    if not isinstance(cfg, dict):
        return None
    cfg = cfg_svc.validate_imposicao_config_payload(cfg, require_marcas_pdf=False)
    if not (cfg.get("usar_pre_impresso") and juntada_svc.is_pre_impresso_produto(produto)):
        return cfg
    # Mesma sobrescrita que create_imposicao_job/_prepare fazem no fluxo antigo.
    padrao = juntada_svc.grid_padrao_pre_impresso(produto)
    n_slots = juntada_svc.max_slots(produto)
    ocupadas = juntada_svc.placements_pre_impresso(produto, n_slots=n_slots)
    if juntada_svc.is_pasta_avulso_familia(produto):
        pagina = {"origem": "fixixa", **juntada_svc.PAGINA_PASTA_MM}
    else:
        pagina = {"origem": "fixixa", **juntada_svc.PAGINA_TIMBRADO_MM}
    return {
        **cfg,
        "folha_mm": dict(juntada_svc.FOLHA_PRE_IMPRESSO_MM),
        "pagina": pagina,
        "grid": {
            "colunas": int(padrao["colunas"]),
            "linhas": int(padrao["linhas"]),
            "ocupadas": [
                {k: o[k] for k in ("col", "row", "pagina", "rotacao", "x_mm", "y_mm") if k in o}
                for o in ocupadas
            ],
        },
        "marcas_corte": True,
        "marcas_pdf_path": cfg.get("marcas_pdf_path"),
    }


def comparar_com_fluxo_antigo(
    *,
    produto: str,
    variante: str,
    perfil: Any,
    pagina_mm: Optional[tuple[float, float]] = None,
) -> dict[str, Any]:
    val = perfil_svc.validar_perfil(perfil, verificar_arquivos=False)
    if val["perfil"] is None:
        raise ValueError(val["erros"][0]["mensagem"])
    if val["erros"]:
        return {
            "disponivel": False,
            "motivo": "Corrija os erros do perfil antes de comparar.",
            "erros": val["erros"],
        }
    antigo = config_efetiva_antiga(produto=produto, variante=variante)
    if antigo is None:
        return {
            "disponivel": False,
            "motivo": f"Não há configuração {variante} no fluxo antigo para comparar.",
        }
    novo = perfil_svc.compilar_config_jdf(val["perfil"])
    try:
        resultado = perfil_svc.comparar_configs(antigo, novo, page_size=pagina_mm)
    except ValueError as exc:
        return {"disponivel": False, "motivo": str(exc)}
    return {"disponivel": True, **resultado, "referencia": perfil_from_antigo(antigo)}


def perfil_from_antigo(cfg: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Valores efetivos do fluxo antigo expressos como perfil v2 (referência)."""
    if not isinstance(cfg, dict):
        return None
    try:
        return perfil_svc.perfil_from_v1(cfg)
    except Exception as exc:
        logger.warning("Conversão da configuração antiga para referência falhou: %s", exc)
        return None


def rascunho_da_configuracao_salva(*, produto: str, variante: str) -> dict[str, Any]:
    """
    Converte só o que está SALVO na configuração antiga do produto em rascunho.
    ``completo_no_banco`` = False quando o fluxo antigo sobrescrevia valores na
    geração (pré-impresso), indicando que o usuário precisa completar.
    """
    from services import papelaria_produto_imposicao_service as prod_imp_svc

    mapa = prod_imp_svc.get_produto_imposicao_map(produto)
    cfg = mapa.get(variante)
    if not isinstance(cfg, dict):
        return {"existe": False, "perfil": None, "completo_no_banco": False}
    perfil = perfil_svc.perfil_from_v1(cfg)
    return {
        "existe": True,
        "perfil": perfil,
        "completo_no_banco": not bool(cfg.get("usar_pre_impresso")),
    }
