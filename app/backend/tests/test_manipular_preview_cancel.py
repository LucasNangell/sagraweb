import pytest

from services import manipular_imagem_service as svc


def test_newer_preview_generation_marks_older_stale():
    svc.clear_jobs_for_tests()
    job_id = "abc123"
    svc.note_preview_generation(job_id, 2)
    assert svc.is_preview_stale(job_id, 1) is True
    assert svc.is_preview_stale(job_id, 2) is False


def test_aplicar_mascara_job_raises_stale(monkeypatch):
    svc.clear_jobs_for_tests()
    content = pytest.importorskip("PIL")  # noqa: F841
    from io import BytesIO

    import numpy as np
    from PIL import Image

    arr = np.zeros((4, 4, 4), dtype=np.uint8)
    arr[:, :, :3] = 40
    arr[:, :2, 3] = 255
    arr[:, 2:, 3] = 0
    buf = BytesIO()
    Image.fromarray(arr, "RGBA").save(buf, "PNG")
    info = svc.analisar_mascaras(buf.getvalue(), "t.png")
    svc.note_preview_generation(info["job_id"], 9)
    with pytest.raises(svc.PreviewStaleError):
        svc.aplicar_mascara_job(
            info["job_id"],
            preview=True,
            preview_generation=1,
        )
