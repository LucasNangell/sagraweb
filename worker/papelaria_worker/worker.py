"""
Worker Windows — processa fila de jobs Papelaria via CorelDRAW COM.
Uso: python worker.py --config config.yaml
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path

from api_client import PapelariaWorkerApiClient, PapelariaWorkerApiError
from config import WorkerConfig, load_config
from runtime import (
    application_dir,
    config_embutida_no_exe,
    default_config_path,
    is_frozen,
)
from corel_generator import (
    CorelGenerationError,
    aguardar_corel_disponivel,
    cleanup_temp_dir,
    corel_em_uso_externamente,
    encerrar_corel_forcadamente,
    exportar_prova_de_cdr_existente,
    gerar_arquivo_corel,
    humanizar_erro_corel,
    inspecionar_cdr,
    reset_corel_session,
    validar_acesso_export_cdr,
    validar_acesso_job,
)
from credenciais_depol_generator import gerar_credenciais_depol
from auto_update import try_auto_update
from power import allow_sleep, prevent_sleep
from system_load import collect_system_load, is_local_load_acceptable

_shutdown = False
_corel_wait_logged = False
_load_wait_logged = False
_processing_job = False
_last_auto_update_check = 0.0


def _should_stop() -> bool:
    return _shutdown


def _log_corel_aguardando() -> None:
    global _corel_wait_logged
    if not _corel_wait_logged:
        logging.info(
            "CorelDRAW em uso nesta máquina — worker aguardando fechamento "
            "(outras máquinas da frota podem processar jobs)."
        )
        _corel_wait_logged = True


def _reset_corel_wait_log() -> None:
    global _corel_wait_logged
    _corel_wait_logged = False


def _heartbeat_meta(cfg: WorkerConfig, **extra: object) -> dict:
    meta = dict(extra)
    if cfg.load_balance_enabled:
        meta["system_load"] = collect_system_load()
    return meta


def _log_load_aguardando(reason: str) -> None:
    global _load_wait_logged
    if not _load_wait_logged:
        logging.info(
            "Máquina ocupada (%s) — aguardando recursos (outras máquinas podem processar).",
            reason,
        )
        _load_wait_logged = True


def _reset_load_wait_log() -> None:
    global _load_wait_logged
    _load_wait_logged = False


def _maybe_auto_update(cfg: WorkerConfig) -> None:
    global _last_auto_update_check
    if not cfg.auto_update_enabled or not is_frozen():
        return
    if _processing_job or _shutdown:
        return
    now = time.time()
    if now - _last_auto_update_check < cfg.auto_update_check_sec:
        return
    _last_auto_update_check = now
    try:
        try_auto_update(
            Path(sys.executable).resolve(),
            cfg.auto_update_source,
            [],
        )
    except Exception:
        logging.exception("Falha ao verificar auto-atualização do worker")


def _ativar_protecao_suspensao(cfg: WorkerConfig) -> None:
    if not cfg.prevent_sleep:
        return
    if prevent_sleep():
        logging.info(
            "Proteção contra suspensão ativa — sistema não entrará em sleep/hibernate."
        )


def _liberar_protecao_suspensao(cfg: WorkerConfig) -> None:
    if not cfg.prevent_sleep:
        return
    if allow_sleep():
        logging.info("Proteção contra suspensão desativada.")


def _pode_claim_local(cfg: WorkerConfig) -> bool:
    if not cfg.load_balance_enabled:
        return True
    load = collect_system_load()
    ok, reason = is_local_load_acceptable(
        load,
        max_cpu_percent=cfg.max_cpu_percent,
        max_memory_percent=cfg.max_memory_percent,
    )
    if not ok:
        _log_load_aguardando(reason)
        return False
    return True


def _esperar_corel_livre(cfg: WorkerConfig) -> bool:
    intervalo = max(3, cfg.poll_interval_sec)
    return aguardar_corel_disponivel(
        intervalo,
        should_stop=_should_stop,
        on_waiting=_log_corel_aguardando,
    )


def _build_api_client(cfg: WorkerConfig) -> PapelariaWorkerApiClient:
    if cfg.ssl_verify is False:
        import urllib3

        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        logging.warning(
            "ssl_verify=false — certificado HTTPS do servidor não será validado."
        )
    return PapelariaWorkerApiClient(
        cfg.api_base_url,
        cfg.worker_secret,
        cfg.worker_id,
        ssl_verify=cfg.ssl_verify,
    )


def _setup_logging(logs_dir: str, *, console: bool = True) -> None:
    os.makedirs(logs_dir, exist_ok=True)
    log_file = Path(logs_dir) / f"worker_{datetime.now():%Y%m%d}.log"

    handlers: list[logging.Handler] = [
        logging.FileHandler(log_file, encoding="utf-8"),
    ]
    if console:
        handlers.insert(0, logging.StreamHandler(sys.stdout))

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=handlers,
    )


def _handle_signal(signum, _frame):
    global _shutdown
    # Não usar logging aqui — handler pode disparar durante I/O do logger (reentrant).
    _shutdown = True


def _resolve_model_path(models_dir: str, arquivo_modelo: str) -> str:
    nome = (arquivo_modelo or "").strip()
    if not nome.lower().endswith(".cdr"):
        nome = f"{nome}.cdr"
    path = os.path.join(models_dir, nome)
    if not os.path.isfile(path):
        raise FileNotFoundError(
            f"Modelo .cdr não encontrado: {path}. "
            f"Verifique se '{nome}' existe em {models_dir}."
        )
    return path


def process_inspect(api: PapelariaWorkerApiClient, cfg: WorkerConfig, inspect: dict) -> None:
    global _processing_job
    _processing_job = True
    inspect_id = inspect["inspect_id"]
    local_cdr = os.path.join(cfg.temp_dir, "inspect", f"{inspect_id}.cdr")
    try:
        _ativar_protecao_suspensao(cfg)
        logging.info("Inspecionando .cdr %s — %s", inspect_id, inspect.get("filename"))
        if not _esperar_corel_livre(cfg):
            api.fail_inspect(inspect_id, "CorelDRAW indisponível para inspeção.")
            return
        api.download_inspect_cdr(inspect_id, local_cdr)
        result = inspecionar_cdr(local_cdr, corel_visible=cfg.corel_visible)
        api.complete_inspect(
            inspect_id,
            campos=result.get("campos") or {},
            variaveis=result.get("variaveis") or [],
            preview_layout=result.get("preview_layout"),
        )
        logging.info(
            "Inspeção %s concluída — %s campo(s), %s variável(is).",
            inspect_id,
            len(result.get("campos") or {}),
            len(result.get("variaveis") or []),
        )
    except (CorelGenerationError, FileNotFoundError, OSError) as exc:
        msg = humanizar_erro_corel(exc)
        logging.error("Inspeção %s falhou: %s", inspect_id, msg)
        reset_corel_session()
        api.fail_inspect(inspect_id, msg)
    except PapelariaWorkerApiError as exc:
        logging.error("Inspeção %s — erro API: %s", inspect_id, exc)
        try:
            api.fail_inspect(inspect_id, str(exc))
        except PapelariaWorkerApiError:
            pass
    except Exception as exc:
        msg = humanizar_erro_corel(exc)
        logging.exception("Inspeção %s falhou (inesperado): %s", inspect_id, msg)
        reset_corel_session()
        api.fail_inspect(inspect_id, msg)
    finally:
        _processing_job = False
        reset_corel_session()
        if os.path.isfile(local_cdr):
            try:
                os.remove(local_cdr)
            except OSError:
                pass


def process_job(api: PapelariaWorkerApiClient, cfg: WorkerConfig, job: dict) -> None:
    global _processing_job
    _processing_job = True
    try:
        _process_job_body(api, cfg, job)
    finally:
        _processing_job = False


def _process_job_body(api: PapelariaWorkerApiClient, cfg: WorkerConfig, job: dict) -> None:
    job_id = int(job["job_id"])
    _ativar_protecao_suspensao(cfg)
    logging.info("Processando job #%s — OS %s/%s", job_id, job["nro"], job["ano"])

    tipo_job = (job.get("tipo_job") or "create").strip()
    output_dir = job["output_dir"]
    cdr_name = job["output_cdr_name"]
    pdf_name = job["output_pdf_name"]
    output_cdr = os.path.join(output_dir, cdr_name)
    output_pdf = os.path.join(output_dir, pdf_name)

    if tipo_job == "export_existing_cdr":
        input_cdr = (job.get("input_cdr_path") or "").strip()
        try:
            validar_acesso_export_cdr(input_cdr, output_dir)
        except CorelGenerationError as exc:
            logging.error("Job #%s — pré-validação export CDR falhou: %s", job_id, exc)
            api.fail(job_id, str(exc), retryable=False)
            return
    elif tipo_job == "credenciais_depol":
        dados_pre = job.get("dados") or {}
        jpg_dir = str(dados_pre.get("jpg_dir") or "").strip()
        svg_dir = str(dados_pre.get("svg_dir") or "").strip()
        missing = []
        if not jpg_dir or not os.path.isdir(jpg_dir):
            missing.append(f"jpg_dir={jpg_dir or '(vazio)'}")
        if not svg_dir or not os.path.isdir(svg_dir):
            missing.append(f"svg_dir={svg_dir or '(vazio)'}")
        if not os.path.isdir(output_dir):
            try:
                os.makedirs(output_dir, exist_ok=True)
            except OSError:
                missing.append(f"output_dir={output_dir}")
        if missing:
            msg = "Pré-validação DEPOL falhou: " + "; ".join(missing)
            logging.error("Job #%s — %s", job_id, msg)
            api.fail(job_id, msg, retryable=False)
            return
    else:
        caminho_modelo = _resolve_model_path(cfg.models_dir, job["arquivo_modelo"])
        models_cache_dir = os.path.join(cfg.temp_dir, "_models_cache")
        try:
            validar_acesso_job(
                caminho_modelo,
                output_dir,
                models_cache_dir=models_cache_dir,
            )
        except CorelGenerationError as exc:
            logging.error("Job #%s — pré-validação falhou: %s", job_id, exc)
            api.fail(job_id, str(exc), retryable=False)
            return

    stop_heartbeat = threading.Event()
    cancel_requested = threading.Event()
    cancel_reason = {"text": "Job cancelado pelo usuário."}

    def _abortar_corel_por_cancelamento() -> None:
        encerrar_corel_forcadamente(matar_processo=cfg.kill_corel_on_timeout)

    def _heartbeat_while_processing() -> None:
        while not stop_heartbeat.wait(10):
            try:
                hb = api.heartbeat(
                    _heartbeat_meta(cfg, processing_job_id=job_id)
                )
                if hb.get("cancelled_job_id") == job_id:
                    cancel_requested.set()
                    cancel_reason["text"] = str(
                        hb.get("cancelled_reason")
                        or "Job cancelado ou redirecionado para outro worker."
                    )
                    logging.info(
                        "Job #%s cancelado/redirecionado — encerrando Corel (%s).",
                        job_id,
                        cancel_reason["text"],
                    )
                    _abortar_corel_por_cancelamento()
            except PapelariaWorkerApiError as exc:
                logging.warning("Heartbeat durante job #%s falhou: %s", job_id, exc)

    heartbeat_thread = threading.Thread(
        target=_heartbeat_while_processing,
        name=f"papelaria-hb-{job_id}",
        daemon=True,
    )
    heartbeat_thread.start()

    try:
        if tipo_job == "export_existing_cdr":
            input_cdr = (job.get("input_cdr_path") or "").strip()
            api.append_log(
                job_id,
                f"Iniciando exportação de prova — {os.path.basename(input_cdr)}",
                "info",
            )
            result = exportar_prova_de_cdr_existente(
                caminho_cdr=input_cdr,
                temp_dir=cfg.temp_dir,
                output_pdf_path=output_pdf,
                corel_visible=cfg.corel_visible,
                job_timeout_sec=cfg.job_timeout_sec,
                job_id=job_id,
            )
        elif tipo_job == "credenciais_depol":
            dados = job.get("dados") or {}
            n_itens = len(dados.get("itens") or [])
            api.append_log(
                job_id,
                f"Iniciando Credenciais DEPOL — {n_itens} página(s)",
                "info",
            )
            result = gerar_credenciais_depol(
                dados=dados,
                temp_dir=cfg.temp_dir,
                output_cdr_path=output_cdr,
                output_pdf_path=output_pdf,
                corel_visible=cfg.corel_visible,
                job_timeout_sec=cfg.job_timeout_sec,
                job_id=job_id,
            )
        else:
            modelo = {
                "produto": job.get("produto"),
                "cores": job.get("cores"),
                "campos": job.get("campos") or {},
            }
            dados = job.get("dados") or {}
            caminho_modelo = _resolve_model_path(cfg.models_dir, job["arquivo_modelo"])
            api.append_log(job_id, f"Iniciando geração — modelo {job['arquivo_modelo']}", "info")
            result = gerar_arquivo_corel(
                modelo=modelo,
                dados=dados,
                caminho_modelo=caminho_modelo,
                temp_dir=cfg.temp_dir,
                output_cdr_path=output_cdr,
                output_pdf_path=output_pdf,
                corel_visible=cfg.corel_visible,
                job_timeout_sec=cfg.job_timeout_sec,
                job_id=job_id,
                preview_config=job.get("preview_config"),
                campos_dinamicos_layout=job.get("campos_dinamicos_layout"),
                exclusoes=job.get("exclusoes") or [],
            )
        if cancel_requested.is_set():
            api.append_log(
                job_id,
                f"{cancel_reason['text']} — arquivos descartados.",
                "warning",
            )
            logging.info(
                "Job #%s cancelado — resultado descartado (%s / %s).",
                job_id,
                cdr_name,
                pdf_name,
            )
            return

        log_resumo = "; ".join(result.logs[-5:]) if result.logs else "OK"
        cdr_for_complete = cdr_name
        if tipo_job == "export_existing_cdr":
            input_cdr = (job.get("input_cdr_path") or "").strip()
            if input_cdr:
                cdr_for_complete = os.path.basename(input_cdr)
        try:
            api.complete(job_id, cdr_for_complete, pdf_name, log_resumo=log_resumo)
        except PapelariaWorkerApiError as exc:
            if exc.status_code == 400 and "cancelado" in str(exc).lower():
                logging.info("Job #%s já cancelado na API — resultado descartado.", job_id)
                return
            raise
        logging.info(
            "Job #%s concluído — %s / %s (pasta: %s)",
            job_id,
            cdr_for_complete,
            pdf_name,
            output_dir,
        )
    except (CorelGenerationError, FileNotFoundError, OSError) as exc:
        tb = traceback.format_exc()
        msg_usuario = humanizar_erro_corel(exc)
        logging.error("Job #%s falhou: %s", job_id, msg_usuario)
        if isinstance(exc, CorelGenerationError):
            reset_corel_session()
        msg_lower = msg_usuario.lower()
        retryable = isinstance(exc, CorelGenerationError) and (
            "timeout" in msg_lower
            or "desconectado" in msg_lower
            or "não respondeu" in msg_lower
        )
        api.fail(job_id, msg_usuario, log_resumo=tb[-3000:], retryable=retryable)
    except Exception as exc:
        tb = traceback.format_exc()
        msg_usuario = humanizar_erro_corel(exc)
        logging.error("Job #%s falhou (inesperado): %s", job_id, msg_usuario)
        reset_corel_session()
        api.fail(job_id, msg_usuario, log_resumo=tb[-3000:], retryable=False)
    finally:
        stop_heartbeat.set()
        heartbeat_thread.join(timeout=3)
        cleanup_temp_dir(cfg.temp_dir, job_id)
        reset_corel_session()


def run_loop(cfg: WorkerConfig) -> int:
    global _last_auto_update_check
    api = _build_api_client(cfg)
    os.makedirs(cfg.temp_dir, exist_ok=True)
    os.makedirs(cfg.logs_dir, exist_ok=True)
    _ativar_protecao_suspensao(cfg)

    if cfg.auto_update_enabled and is_frozen():
        _last_auto_update_check = 0.0
        _maybe_auto_update(cfg)

    try:
        return _run_loop_inner(api, cfg)
    finally:
        _liberar_protecao_suspensao(cfg)


def _run_loop_inner(api: PapelariaWorkerApiClient, cfg: WorkerConfig) -> int:
    logging.info(
        "Worker %s iniciado — API %s",
        cfg.worker_id,
        cfg.api_base_url,
    )

    logging.info("Verificando se o CorelDRAW está livre nesta máquina...")
    if not _esperar_corel_livre(cfg):
        logging.info("Worker encerrado antes de iniciar (Corel ainda em uso).")
        return 0

    try:
        hb = api.heartbeat(_heartbeat_meta(cfg, event="startup", version="1.0"))
        requeued = hb.get("requeued_jobs") or []
        if requeued:
            logging.info(
                "Jobs reenfileirados após reinício do worker: %s",
                requeued,
            )
        logging.info("Heartbeat OK: %s", hb.get("heartbeat_em"))
    except PapelariaWorkerApiError as exc:
        logging.error("Falha no heartbeat inicial: %s", exc)
        return 1

    while not _shutdown:
        try:
            api.heartbeat(_heartbeat_meta(cfg))
            if corel_em_uso_externamente():
                _log_corel_aguardando()
                time.sleep(max(3, cfg.poll_interval_sec))
                continue
            _reset_corel_wait_log()
            if not _pode_claim_local(cfg):
                time.sleep(max(3, cfg.poll_interval_sec))
                continue
            _reset_load_wait_log()
            job = api.claim()
            if job:
                process_job(api, cfg, job)
                continue
            inspect = api.claim_inspect()
            if inspect:
                process_inspect(api, cfg, inspect)
                continue
            _maybe_auto_update(cfg)
            time.sleep(max(2, cfg.poll_interval_sec))
        except PapelariaWorkerApiError as exc:
            logging.error("Erro API: %s", exc)
            time.sleep(max(5, cfg.poll_interval_sec))
        except Exception:
            logging.exception("Erro inesperado no loop do worker")
            time.sleep(max(5, cfg.poll_interval_sec))

    reset_corel_session()
    logging.info("Worker encerrado.")
    return 0


def main(argv: list[str] | None = None) -> int:
    if is_frozen():
        os.chdir(application_dir())

    parser = argparse.ArgumentParser(description="SAGRA Papelaria CorelDRAW Worker")
    parser.add_argument(
        "--config",
        default=str(default_config_path()),
        help="Caminho do arquivo YAML de configuração",
    )
    parser.add_argument(
        "--test-connection",
        action="store_true",
        help="Testa conexão com API e encerra",
    )
    args = parser.parse_args(argv)

    if is_frozen() and config_embutida_no_exe():
        args.config = str(default_config_path())

    cfg = load_config(args.config)
    _setup_logging(cfg.logs_dir, console=not is_frozen())

    if config_embutida_no_exe():
        logging.info("Configuração embutida no executável — API %s", cfg.api_base_url)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    if args.test_connection:
        api = _build_api_client(cfg)
        try:
            result = api.test_connection()
            if is_frozen():
                logging.info("Conexão OK: %s", result)
            else:
                print("Conexão OK:", result)
            return 0
        except PapelariaWorkerApiError as exc:
            if is_frozen():
                logging.error("Falha na conexão: %s", exc)
            else:
                print("Falha:", exc)
            return 1

    return run_loop(cfg)


if __name__ == "__main__":
    raise SystemExit(main())
