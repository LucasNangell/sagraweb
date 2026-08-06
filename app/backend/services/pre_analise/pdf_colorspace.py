"""

Detecção confiável de espaços de cor em PDF (PyMuPDF).



Usa metadados de get_page_images(), Pixmap.colorspace e análise do content stream

— evita falsos positivos de tuplas RGB em get_drawings() ou '/RGB' em strings.

"""

from __future__ import annotations



import logging

import re

from typing import Any, Dict, List, Optional, Set, Tuple



logger = logging.getLogger(__name__)



try:

    import fitz

except ImportError:  # pragma: no cover

    fitz = None  # type: ignore



# Operadores PDF: rg/RG = cor DeviceRGB (3 componentes)

_RGB_OP_RE = re.compile(r"(?<![\w/])(rg|RG)(?![\w])")

_RGB_TRIPLET_OP_RE = re.compile(

    r"([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+(rg|RG)\b"

)

_RGB_BLACK_EPS = 1e-5

_DEVICE_RGB_CS_RE = re.compile(

    r"(/DeviceRGB\s+CS\b|/DeviceRGB\s+cs\b|\[\s*/DeviceRGB\s*\])",

    re.IGNORECASE,

)

_CS_NAME_USE_RE = re.compile(r"/([A-Za-z0-9]+)\s+cs\b")



_RGB_NAMES = frozenset({"devicergb", "rgb", "calrgb", "lab"})

_CMYK_NAMES = frozenset({"devicecmyk", "cmyk"})

_GRAY_NAMES = frozenset({"devicegray", "gray", "grey"})





def _norm_cs(name: str) -> str:

    return (name or "").strip().lstrip("/").lower()





def _iccbased_is_rgb(doc: Any, xref: int) -> bool:

    """Resolve ICCBased: N=3 → RGB; N=4 → CMYK; Alternate define o modelo."""

    try:

        obj = doc.xref_object(xref)

    except Exception:

        return False

    upper = obj.upper()

    m_n = re.search(r"/N\s+(\d+)", obj)

    if m_n:

        n = int(m_n.group(1))

        if n == 4:

            return False

        if n == 1:

            return False

        if n == 3:

            return True

    if re.search(r"/Alternate\s*/DeviceCMYK", obj, re.IGNORECASE):

        return False

    if re.search(r"/Alternate\s*/DeviceRGB", obj, re.IGNORECASE):

        return True

    if re.search(r"/Alternate\s*/DeviceGray", obj, re.IGNORECASE):

        return False

    # Perfil sRGB / RGB no stream

    if "RGB" in upper and "CMYK" not in upper:

        return True

    return False





def _resolve_colorspace_ref(doc: Any, ref: str, depth: int = 0) -> str:

    """Resolve referência ou nome direto de ColorSpace."""

    if depth > 5:

        return ""

    ref = (ref or "").strip()

    if not ref:

        return ""

    if ref.startswith("/"):

        return _norm_cs(ref)

    m = re.match(r"(\d+)\s+(\d+)\s+R", ref)

    if not m:

        return _norm_cs(ref)

    xref = int(m.group(1))

    try:

        obj = doc.xref_object(xref)

    except Exception:

        return ""

    upper = obj.upper()

    if "/DEVICERGB" in upper:

        return "devicergb"

    if "/DEVICECMYK" in upper:

        return "devicecmyk"

    if "/DEVICEGRAY" in upper:

        return "devicegray"

    if "/INDEXED" in upper:

        m_base = re.search(r"/Indexed\s+(/\w+|\d+\s+\d+\s+R)", obj, re.IGNORECASE)

        if m_base:

            return "indexed:" + _resolve_colorspace_ref(doc, m_base.group(1), depth + 1)

        return "indexed"

    if "/ICCBASED" in upper:

        return "iccbased:rgb" if _iccbased_is_rgb(doc, xref) else "iccbased:cmyk"

    if "/SEPARATION" in upper or "/DEVICEN" in upper:

        return "devicen"

    if "/PATTERN" in upper:

        return "pattern"

    m_arr = re.search(r"\[\s*(/\w+|\d+\s+\d+\s+R)", obj)

    if m_arr:

        return _resolve_colorspace_ref(doc, m_arr.group(1), depth + 1)

    return ""





def colorspace_from_image_tuple(doc: Any, img: Tuple[Any, ...]) -> Tuple[str, str]:

    """

    Extrai corespace da tupla de page.get_images(full=True).



    (xref, smask, w, h, bpc, colorspace, alt_colorspace, ...)

    """

    cs_raw = str(img[5]).strip() if len(img) > 5 and img[5] else ""

    alt_raw = str(img[6]).strip() if len(img) > 6 and img[6] else ""

    if cs_raw:

        cs_norm = _norm_cs(cs_raw)

        if cs_norm == "iccbased":

            xref = int(img[0])

            resolved = "iccbased:rgb" if _iccbased_is_rgb(doc, xref) else "iccbased:cmyk"

            return resolved, alt_raw

        if cs_norm == "indexed" and alt_raw:

            base = _resolve_colorspace_ref(doc, alt_raw)

            return f"indexed:{base}", alt_raw

        return cs_norm, alt_raw

    # Fallback: Pixmap

    xref = int(img[0])

    try:

        pix = fitz.Pixmap(doc, xref)

        if pix.colorspace is not None:

            name = _norm_cs(pix.colorspace.name)

            if pix.n == 4:

                return "devicecmyk", alt_raw

            if pix.n == 1:

                return "devicegray", alt_raw

            if pix.n == 3:

                return name if name else "devicergb", alt_raw

    except Exception as exc:

        logger.debug("Pixmap cs xref %s: %s", xref, exc)

    try:

        _k, cs_ref = doc.xref_get_key(xref, "ColorSpace")

        if cs_ref:

            return _resolve_colorspace_ref(doc, cs_ref), alt_raw

    except Exception:

        pass

    return "", alt_raw





def is_rgb_colorspace(cs: str) -> bool:

    """True apenas para modelos que imprimem em RGB (não CMYK/Gray)."""

    if not cs:

        return False

    cs = cs.lower()

    if cs in _CMYK_NAMES or cs in _GRAY_NAMES:

        return False

    if cs.startswith("iccbased:cmyk"):

        return False

    if cs.startswith("iccbased:rgb") or cs == "iccbased":

        return True

    if cs in _RGB_NAMES or "devicergb" in cs:

        return True

    if cs.startswith("indexed:"):

        base = cs.split(":", 1)[-1]

        return is_rgb_colorspace(base)

    if "cmyk" in cs:

        return False

    if cs in ("devicen", "pattern", "separation"):

        return False

    return False





def is_rgb_image(doc: Any, img: Tuple[Any, ...]) -> bool:

    """Imagem embutida em DeviceRGB / ICC RGB / Indexed sobre RGB."""

    xref = int(img[0])

    smask = int(img[1]) if len(img) > 1 else 0

    # Máscaras de transparência costumam ser cinza — não são conteúdo RGB

    if smask == 0:

        pass

    cs, _alt = colorspace_from_image_tuple(doc, img)

    return is_rgb_colorspace(cs)





def _page_resource_rgb_cs_names(page: Any, doc: Any) -> Set[str]:

    """Nomes de recursos (/Cs1 etc.) que apontam para DeviceRGB."""

    names: Set[str] = set()

    names.add("DeviceRGB")

    try:

        xref = page.xref

        res_key = doc.xref_get_key(xref, "Resources")

        if res_key[0] != "Resources":

            return names

        res_ref = res_key[1]

        res_xref_m = re.match(r"(\d+)\s+(\d+)\s+R", res_ref)

        if not res_xref_m:

            return names

        res_xref = int(res_xref_m.group(1))

        cs_key = doc.xref_get_key(res_xref, "ColorSpace")

        if cs_key[0] != "ColorSpace":

            return names

        cs_ref = cs_key[1]

        if re.match(r"\d+\s+\d+\s+R", cs_ref):

            cs_xref = int(cs_ref.split()[0])

            cs_obj = doc.xref_object(cs_xref)

        else:

            cs_obj = doc.xref_object(res_xref)

            if "/ColorSpace" not in cs_obj:

                return names

        # Parse /Cs1 /DeviceRGB pairs

        for m in re.finditer(r"/([A-Za-z0-9]+)\s+(/DeviceRGB|\d+\s+\d+\s+R)", cs_obj):

            cname, target = m.group(1), m.group(2)

            if target.startswith("/DeviceRGB"):

                names.add(cname)

            elif _resolve_colorspace_ref(doc, target) == "devicergb":

                names.add(cname)

    except Exception as exc:

        logger.debug("resource rgb cs page %s: %s", page.number, exc)

    return names





def _content_has_non_black_rgb_ops(text: str) -> bool:

    """rg/RG com cor diferente de preto puro (0 0 0) — ignora traços pretos RGB triviais."""

    for m in _RGB_TRIPLET_OP_RE.finditer(text):

        r, g, b = float(m.group(1)), float(m.group(2)), float(m.group(3))

        if r > _RGB_BLACK_EPS or g > _RGB_BLACK_EPS or b > _RGB_BLACK_EPS:

            return True

    return False





def page_content_uses_rgb_operators(page: Any, doc: Any) -> bool:

    """

    Detecta operadores rg/RG no content stream (exceto 0 0 0 preto puro).



    Arquivos CMYK usam k/K ou scn CMYK — não disparam este teste.

    """

    try:

        content = page.read_contents() or b""

    except Exception:

        content = b""

    if not content:

        return False

    text = content.decode("latin-1", errors="ignore")

    if not _RGB_OP_RE.search(text):

        return False

    if _content_has_non_black_rgb_ops(text):

        return True

    # DeviceRGB explícito com qualquer rg (inclui preto, se CS nomeado)

    if _DEVICE_RGB_CS_RE.search(text):

        return _RGB_OP_RE.search(text) is not None

    rgb_names = _page_resource_rgb_cs_names(page, doc)

    for m in _CS_NAME_USE_RE.finditer(text):

        if m.group(1) in rgb_names:

            return True

    return False





def find_rgb_images_on_page(page: Any, doc: Any) -> List[Dict[str, Any]]:

    hits: List[Dict[str, Any]] = []

    seen: Set[int] = set()

    try:

        images = page.get_images(full=True)

    except TypeError:

        images = page.get_images()

    for img in images:

        xref = int(img[0])

        if xref in seen:

            continue

        seen.add(xref)

        if not is_rgb_image(doc, img):

            continue

        cs, alt = colorspace_from_image_tuple(doc, img)

        hits.append(

            {

                "xref": xref,

                "colorspace": cs,

                "alt_colorspace": alt or None,

            }

        )

    return hits





def page_has_rgb_content(page: Any, doc: Any) -> Tuple[bool, Dict[str, Any]]:

    """

    Retorna (tem_rgb, detalhes) para uma página.

    """

    images = find_rgb_images_on_page(page, doc)

    vector_rgb = page_content_uses_rgb_operators(page, doc)

    has = bool(images) or vector_rgb

    return has, {

        "images": images,

        "vector_rgb_operators": vector_rgb,

    }





def analyze_document_rgb(doc: Any) -> Dict[str, Any]:

    """

    Análise de RGB por página.



    Returns:

        pages: lista 1-based com RGB real

        details: por página, imagens e vetores

    """

    pages: List[int] = []

    details: Dict[int, Dict[str, Any]] = {}

    for i in range(doc.page_count):

        page = doc.load_page(i)

        has, info = page_has_rgb_content(page, doc)

        if has:

            pages.append(i + 1)

            details[i + 1] = info

    return {"pages": pages, "details": details}





def analyze_rgb_elements(doc: Any) -> Dict[str, Any]:

    """Detalhamento para check cores_elementos_rgb."""

    result = analyze_document_rgb(doc)

    images: List[Dict[str, Any]] = []

    for pno, info in result["details"].items():

        for img in info.get("images") or []:

            images.append(

                {

                    "page": pno,

                    "xref": img["xref"],

                    "colorspace": img.get("colorspace"),

                }

            )

    return {

        "pages": result["pages"],

        "images": images,

        "pages_vector_rgb": [

            p for p, info in result["details"].items() if info.get("vector_rgb_operators")

        ],

    }


