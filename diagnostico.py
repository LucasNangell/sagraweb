# convert-preto.py
import pikepdf
import sys

def _fix_separation_all(cs_array, counters):
    """Se cs_array for [/Separation /All /DeviceCMYK <fn>], troca a função
    por uma que mapeia tint 0..1 -> CMYK 0 0 0 tint (só K)."""
    try:
        if not isinstance(cs_array, pikepdf.Array):
            return False
        if len(cs_array) < 4:
            return False
        if str(cs_array[0]) != '/Separation':
            return False
        if str(cs_array[1]) != '/All':
            return False
        # cs_array[2] é o alternate space (normalmente /DeviceCMYK)
        # cs_array[3] é a função tint — substituímos por uma função
        # exponencial que mapeia 0..1 -> [0,0,0,tint]
        new_fn = pikepdf.Dictionary({
            '/FunctionType': 2,
            '/Domain': pikepdf.Array([0, 1]),
            '/C0': pikepdf.Array([0, 0, 0, 0]),
            '/C1': pikepdf.Array([0, 0, 0, 1]),
            '/N': 1,
            '/Range': pikepdf.Array([0, 1, 0, 1, 0, 1, 0, 1]),
        })
        cs_array[3] = new_fn
        counters['cs_fixed'] += 1
        return True
    except Exception as e:
        print(f"  [aviso] falha ao ajustar ColorSpace: {e}")
        return False


def _walk_resources(res, counters, depth=0, seen=None):
    """Percorre recursivamente /Resources procurando /ColorSpace com /Separation /All."""
    if res is None or depth > 20:
        return
    if seen is None:
        seen = set()
    try:
        oid = id(res.obj)
    except AttributeError:
        oid = id(res)
    if oid in seen:
        return
    seen.add(oid)

    # 1) ColorSpaces declarados aqui
    try:
        cs_dict = res.get('/ColorSpace')
    except Exception:
        cs_dict = None
    if cs_dict is not None:
        for name, cs in cs_dict.items():
            _fix_separation_all(cs, counters)

    # 2) Form XObjects (recursivo)
    try:
        xo = res.get('/XObject')
    except Exception:
        xo = None
    if xo is not None:
        for name, x in xo.items():
            try:
                if str(x.get('/Subtype', '')) != '/Form':
                    continue
            except Exception:
                continue
            try:
                inner = x.get('/Resources')
            except Exception:
                inner = None
            if inner is not None:
                _walk_resources(inner, counters, depth + 1, seen)

    # 3) Patterns (tiling) — cada pattern tem seu /Resources
    try:
        pats = res.get('/Pattern')
    except Exception:
        pats = None
    if pats is not None:
        for name, p in pats.items():
            if isinstance(p, pikepdf.Stream):
                try:
                    inner = p.get('/Resources')
                except Exception:
                    inner = None
                if inner is not None:
                    _walk_resources(inner, counters, depth + 1, seen)


def convert_registration_to_k100(input_pdf, output_pdf):
    try:
        pdf = pikepdf.open(input_pdf, allow_overwriting_input=False)
    except Exception as e:
        print(f"Erro ao abrir o PDF: {e}")
        return

    counters = {'cs_fixed': 0, 'pages_touched': 0}

    for i, page in enumerate(pdf.pages, start=1):
        before = counters['cs_fixed']
        try:
            res = page.get('/Resources')
        except Exception:
            res = None
        if res is not None:
            _walk_resources(res, counters)
        if counters['cs_fixed'] > before:
            counters['pages_touched'] += 1
            print(f"  Página {i}: {counters['cs_fixed'] - before} ColorSpace(s) ajustado(s).")

    if counters['cs_fixed'] > 0:
        pdf.save(output_pdf)
        print(f"\n✓ Concluído.")
        print(f"  ColorSpaces /Separation /All ajustados : {counters['cs_fixed']}")
        print(f"  Páginas afetadas                       : {counters['pages_touched']}")
        print(f"  Arquivo de saída                       : {output_pdf}")
    else:
        print("\nNenhum /Separation /All encontrado.")

    pdf.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Uso: python convert-preto.py <entrada.pdf> <saida.pdf>")
        sys.exit(1)
    convert_registration_to_k100(sys.argv[1], sys.argv[2])