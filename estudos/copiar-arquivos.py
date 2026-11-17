"""
copia_rapida.py — Cópia paralela de arquivos (flat) com máxima performance.

Uso:
    python copia_rapida.py <origem> <destino> [workers]

Exemplo:
    python copia_rapida.py "C:\\Dados" "D:\\Backup"
"""

import os
import sys
import shutil
import time
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from collections import defaultdict

# ----------------------- worker (roda em subprocesso) -----------------------
def _copiar_arquivo(args):
    """
    args = (src_str, dst_str)
    Retorna (ok: bool, src: str, erro: str | None)
    """
    src, dst = args
    try:
        # copyfile: apenas dados, sem metadados (mais rápido que copy2)
        shutil.copyfile(src, dst)
        return (True, src, None)
    except Exception as e:
        return (False, src, repr(e))


# ----------------------- nomes únicos (pré-computado) -----------------------
def _resolver_nomes(arquivos: list[Path], destino: Path) -> list[tuple[str, str]]:
    """
    Gera pares (origem, destino_final) resolvendo colisões de nomes de forma
    eficiente. Constrói o conjunto de nomes já usados no destino uma única vez
    em vez de checar `exists()` por arquivo.
    """
    # Nomes já existentes no destino (uma única listagem)
    try:
        existentes = {p.name.lower() for p in destino.iterdir() if p.is_file()}
    except FileNotFoundError:
        existentes = set()

    usados = set(existentes)
    contadores = defaultdict(int)  # base -> próximo sufixo
    pares = []

    for arq in arquivos:
        nome = arq.name
        chave = nome.lower()

        if chave not in usados:
            usados.add(chave)
            pares.append((str(arq), str(destino / nome)))
            continue

        # Colisão: gera sufixo _N
        base, ext = os.path.splitext(nome)
        n = contadores[chave] or 1
        while True:
            candidato = f"{base}_{n}{ext}"
            c = candidato.lower()
            if c not in usados:
                usados.add(c)
                contadores[chave] = n + 1
                pares.append((str(arq), str(destino / candidato)))
                break
            n += 1

    return pares


# ----------------------- principal -----------------------
def copiar_rapido(origem: str, destino: str, workers: int | None = None):
    t0 = time.perf_counter()

    origem = Path(origem).resolve()
    destino = Path(destino).resolve()

    if not origem.is_dir():
        print(f"❌ Origem inválida: {origem}")
        sys.exit(1)
    if origem == destino:
        print("❌ Origem e destino não podem ser iguais.")
        sys.exit(1)

    destino.mkdir(parents=True, exist_ok=True)

    # 1) Coleta de arquivos (rápida — usa os.scandir via rglob)
    print(f"🔍 Escaneando {origem} ...")
    arquivos = [p for p in origem.rglob("*") if p.is_file()]
    total = len(arquivos)
    print(f"📦 {total} arquivo(s) encontrado(s) em {time.perf_counter()-t0:.1f}s")

    if total == 0:
        return

    # 2) Pré-resolve nomes de destino (rápido, em memória)
    print("🧮 Resolvendo colisões de nomes ...")
    pares = _resolver_nomes(arquivos, destino)

    # 3) Escolha de workers: para I/O, mais que núcleos ajuda
    if workers is None:
        cpu = os.cpu_count() or 4
        # processos são mais pesados; 4x núcleos costuma saturar disco/rede
        workers = min(cpu * 4, 32)
    print(f"⚙️  Copiando com {workers} processos paralelos ...\n")

    # 4) Cópia paralela com ProcessPoolExecutor (contorna o GIL)
    copiados = 0
    erros = 0
    inicio = time.perf_counter()

    with ProcessPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(_copiar_arquivo, par) for par in pares]
        for i, fut in enumerate(as_completed(futures), 1):
            ok, src, erro = fut.result()
            if ok:
                copiados += 1
            else:
                erros += 1
                print(f"❌ {src}: {erro}")
            # Progresso a cada ~2% ou a cada 500 arquivos
            if i % max(1, total // 50) == 0 or i == total:
                pct = i * 100 // total
                print(f"  [{i}/{total}] {pct}%")

    dur = time.perf_counter() - inicio
    mb = sum(os.path.getsize(a) for a in arquivos) / (1024 * 1024)
    print("\n" + "=" * 55)
    print(f"✔️  Copiados : {copiados}")
    if erros:
        print(f"⚠️  Falhas   : {erros}")
    print(f"⏱️  Tempo    : {dur:.2f}s")
    print(f"📊 Volume   : {mb:.1f} MB")
    print(f"🚀 Throughput: {mb/dur:.1f} MB/s  ({copiados/dur:.0f} arq/s)")
    print("=" * 55)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python copia_rapida.py <origem> <destino> [workers]")
        sys.exit(1)
    origem = sys.argv[1]
    destino = sys.argv[2]
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else None
    copiar_rapido(origem, destino, workers)