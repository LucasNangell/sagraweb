"""Parse de dimensões a partir do nome do formato (coeficiente A4)."""
from __future__ import annotations

from formato_dimensions import resolve_formato_dimensions
from os_calc_fields import calculate_coef_a4


class TestResolveFormatoDimensions:
    def test_50mmx50mm(self):
        assert resolve_formato_dimensions("50mmx50mm") == (50.0, 50.0)

    def test_50mm_cross_50mm_unicode(self):
        assert resolve_formato_dimensions("50MM×50MM") == (50.0, 50.0)

    def test_210mm_x_297mm(self):
        assert resolve_formato_dimensions("210mm x 297mm") == (210.0, 297.0)

    def test_sem_unidade_e_iso(self):
        assert resolve_formato_dimensions("50x50") == (50.0, 50.0)
        assert resolve_formato_dimensions("A4") == (210.0, 297.0)

    def test_coef_a4_50mmx50mm(self):
        dims = resolve_formato_dimensions("50mmx50mm")
        assert dims is not None
        coef = calculate_coef_a4(dims[0], dims[1])
        assert round(coef, 1) == 24.9
