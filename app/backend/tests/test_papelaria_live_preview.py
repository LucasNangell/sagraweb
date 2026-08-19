"""Testes — prévia em tempo real Papelaria (DEV)."""
from __future__ import annotations

import pytest


class TestPapelariaLivePreviewConfig:
    def test_validate_example_config(self):
        from services.papelaria_live_preview_service import (
            example_preview_config,
            validate_preview_config_payload,
        )

        validate_preview_config_payload(example_preview_config())

    def test_invalid_align_rejected(self):
        from services.papelaria_live_preview_service import validate_preview_config_payload

        cfg = {
            "canvas": {"width": 100, "height": 100},
            "faces": [
                {
                    "id": "frente",
                    "baseImage": "frente_base.png",
                    "elementos": [
                        {
                            "id": "t1",
                            "tipo": "texto",
                            "template": "{nome}",
                            "x": 0,
                            "y": 0,
                            "width": 50,
                            "height": 20,
                            "fontSize": 12,
                            "align": "justify",
                        }
                    ],
                }
            ],
        }
        with pytest.raises(ValueError, match="align"):
            validate_preview_config_payload(cfg)

    def test_normalize_empty_returns_none(self):
        from services.papelaria_live_preview_service import normalize_preview_config_json

        assert normalize_preview_config_json(None) is None
        assert normalize_preview_config_json("") is None

    def test_resolve_face_base_blocks_traversal(self, tmp_path, monkeypatch):
        from services import papelaria_live_preview_service as svc

        modelo_dir = tmp_path / "previews" / "7"
        modelo_dir.mkdir(parents=True)
        (modelo_dir / "frente_base.png").write_bytes(b"png")

        monkeypatch.setattr(svc, "PREVIEW_BASE_ROOT", tmp_path / "previews")

        path = svc.resolve_face_base_image_path(
            7,
            "frente",
            preview_config={
                "faces": [{"id": "frente", "baseImage": "frente_base.png"}]
            },
        )
        assert path.endswith("frente_base.png")

        with pytest.raises(ValueError):
            svc.validate_face_id("../etc")

    def test_build_preview_config_from_inspect(self):
        from services.papelaria_live_preview_service import (
            build_preview_config_from_inspect,
            validate_preview_config_payload,
        )

        campos = {
            "Nome": "{nome_deputado}",
            "PartidoUF": "{partido}/{uf}",
            "Gabinete": "Gab. {gabinete}",
            "Email": "{email}",
            "Genero": "{genero}",
            "Assessor": "{nome_assessor}",
        }
        variaveis = ["nome_deputado", "partido", "uf", "gabinete", "email", "genero", "nome_assessor"]
        cfg = build_preview_config_from_inspect(
            campos, variaveis, "Frente", habilitar_campos_dinamicos=True
        )
        validate_preview_config_payload(cfg)
        frente = cfg["faces"][0]
        assert len(frente["elementos"]) == 6
        assert cfg["camposDinamicos"]
        templates = {el["template"] for el in frente["elementos"]}
        assert "{nome_deputado}" in templates
        assert "{partido}/{uf}" in templates

    def test_normalize_campos_sem_variaveis(self):
        from services.papelaria_live_preview_service import (
            build_preview_config_from_inspect,
            validate_preview_config_payload,
        )
        from services.papelaria_models_service import (
            build_campos_formulario,
            normalize_campos_from_inspect,
        )

        raw = {
            "NomeDep": "Maria da Silva",
            "Genero": "Deputada Federal",
            "PartidoDep": "PT/DF",
            "Endereco": (
                "Câmara dos Deputados\nAnexo IV, Gabinete 123\nCEP 70160-900 - Brasília/DF"
            ),
            "Contato": (
                "Fones: (61) 3215-5123\n3215-3123\ndeputada@camara.leg.br"
            ),
        }
        campos, variaveis, labels = normalize_campos_from_inspect(raw)
        assert "Contato" not in variaveis
        assert "nome_deputado" in variaveis
        assert "genero" in variaveis
        assert "partido" in variaveis
        assert "uf" in variaveis
        assert "anexo" in variaveis
        assert "gabinete" in variaveis
        assert "email" in variaveis
        assert labels == {}
        assert campos["Contato"] == (
            "Fones: (61) 3215-5{gabinete}\n3215-3{gabinete}\n{email}"
        )
        form = build_campos_formulario(variaveis)
        form_keys = {f["key"] for f in form}
        assert "Contato" not in form_keys
        assert len(form_keys) == len(variaveis)
        cfg = build_preview_config_from_inspect(campos, variaveis, "Frente")
        validate_preview_config_payload(cfg)
        assert cfg["canvas"] == {"width": 964, "height": 567}
        frente = cfg["faces"][0]
        assert len(frente["elementos"]) == 5
        by_id = {el["id"]: el for el in frente["elementos"]}
        assert by_id["NomeDep"]["x"] == 116
        assert "posicaoSlot" not in by_id["NomeDep"]
        assert "ITC Stone Sans" in by_id["NomeDep"]["fontFamily"]

    def test_build_complete_layout_without_worker(self):
        from services.papelaria_live_preview_service import (
            _build_complete_inspect_layout,
            build_preview_config_from_inspect,
            validate_preview_config_payload,
        )

        campos = {
            "NomeDep": "{nome_deputado}",
            "Genero": "{genero}",
            "PartidoDep": "{partido}/{uf}",
            "Endereco": (
                "Câmara dos Deputados\nAnexo {anexo}, Gabinete {gabinete}\n"
                "CEP 70160-900 - Brasília/DF"
            ),
            "Contato": "Fones: (61) 3215-5{gabinete}\n3215-3{gabinete}\n{email}",
            "RedeInstagram": "{RedeInstagram}",
        }
        merged = _build_complete_inspect_layout(campos, None, "Frente")
        assert merged["canvas"]["width"] == 964
        assert len(merged["elementos"]) == 6
        cfg = build_preview_config_from_inspect(campos, ["nome_deputado"], "Frente")
        validate_preview_config_payload(cfg)
        assert cfg["canvas"]["width"] == 964
        assert "camposDinamicos" not in cfg
        assert "habilitarCamposDinamicos" not in cfg

    def test_redeinstagram_on_verso_with_worker_page(self):
        from services.papelaria_live_preview_service import (
            build_preview_config_from_inspect,
            validate_preview_config_payload,
        )

        campos = {
            "NomeDep": "{nome_deputado}",
            "Genero": "{genero}",
            "PartidoDep": "{partido}/{uf}",
            "Endereco": (
                "Câmara dos Deputados\nAnexo {anexo}, Gabinete {gabinete}\n"
                "CEP 70160-900 - Brasília/DF"
            ),
            "Contato": "Fones: (61) 3215-5{gabinete}\n3215-3{gabinete}\n{email}",
            "RedeInstagram": "{RedeInstagram}",
        }
        layout = {
            "canvas": {"width": 964, "height": 567},
            "elementos": [
                {
                    "campo": "RedeInstagram",
                    "page": 2,
                    "pageWidth": 964,
                    "pageHeight": 567,
                    "fontSize": 32,
                    "fontWeight": 500,
                    "align": "center",
                    "anchor": "middle",
                    "fontFamily": (
                        '"ITC Stone Sans Std", "Stone Sans", Arial, Helvetica, sans-serif'
                    ),
                },
            ],
        }
        cfg = build_preview_config_from_inspect(
            campos,
            ["RedeInstagram"],
            "Frente e Verso",
            preview_layout=layout,
        )
        validate_preview_config_payload(cfg)
        frente = next(f for f in cfg["faces"] if f["id"] == "frente")
        verso = next(f for f in cfg["faces"] if f["id"] == "verso")
        assert not any(el["id"] == "RedeInstagram" for el in frente["elementos"])
        assert len(verso["elementos"]) == 1
        assert verso["elementos"][0]["id"] == "RedeInstagram"
        assert verso["elementos"][0]["fontSize"] == 32
        assert "camposDinamicos" not in cfg

    def test_build_preview_config_from_corel_layout(self):
        from services.papelaria_live_preview_service import (
            build_preview_config_from_inspect,
            validate_preview_config_payload,
        )

        campos = {
            "NomeDep": "{nome_deputado}",
            "Genero": "{genero}",
            "PartidoDep": "{partido}/{uf}",
            "Endereco": (
                "Câmara dos Deputados\nAnexo {anexo}, Gabinete {gabinete}\n"
                "CEP 70160-900 - Brasília/DF"
            ),
            "Contato": "Fones: (61) 3215-5{gabinete}\n3215-3{gabinete}\n{email}",
        }
        variaveis = [
            "nome_deputado",
            "genero",
            "partido",
            "uf",
            "anexo",
            "gabinete",
            "email",
        ]
        layout = {
            "canvas": {"width": 964, "height": 567},
            "pages": [{"page": 1, "width": 964, "height": 567}],
            "elementos": [
                {
                    "campo": "NomeDep",
                    "page": 1,
                    "pageWidth": 964,
                    "pageHeight": 567,
                    "x": 116,
                    "y": 233,
                    "width": 732,
                    "height": 59,
                    "fontSize": 44,
                    "align": "center",
                    "anchor": "middle",
                },
                {
                    "campo": "Contato",
                    "page": 1,
                    "pageWidth": 964,
                    "pageHeight": 567,
                    "x": 463,
                    "y": 441,
                    "width": 467,
                    "height": 95,
                    "fontSize": 28,
                    "align": "right",
                    "anchor": "start",
                },
            ],
        }
        cfg = build_preview_config_from_inspect(
            campos,
            variaveis,
            "Frente",
            preview_layout=layout,
        )
        validate_preview_config_payload(cfg)
        assert cfg["canvas"] == {"width": 964, "height": 567}
        frente = cfg["faces"][0]
        by_id = {el["id"]: el for el in frente["elementos"]}
        assert by_id["NomeDep"]["x"] == 116
        assert by_id["Contato"]["template"].startswith("Fones:")
        assert "posicaoSlot" not in by_id["NomeDep"]

    def test_normalize_campos_custom_desconhecidos(self):
        from services.papelaria_models_service import normalize_campos_from_inspect

        raw = {
            "Instagram": "@camara",
            "Site": "www.camara.leg.br",
        }
        campos, variaveis, labels = normalize_campos_from_inspect(raw)
        assert len(variaveis) == 2
        assert all("{" in v and "}" in v for v in campos.values())
        assert len(labels) == 2
        assert "Instagram" in labels.values()


class TestOverlayCamposPreview:
    def test_preview_template_substitui_campo_corel_mesmo_id(self):
        from services.papelaria_live_preview_service import overlay_campos_com_templates_preview

        campos = {"Cabecalho": "Gabinete do Deputado\n{nome_deputado}"}
        preview = {
            "faces": [
                {
                    "id": "frente",
                    "elementos": [
                        {
                            "id": "Cabecalho",
                            "tipo": "texto",
                            "template": "Gabinete {artigo} {genero_curto}\n**{nome_deputado}**",
                        }
                    ],
                }
            ]
        }
        out = overlay_campos_com_templates_preview(campos, preview)
        assert "**{nome_deputado}**" in out["Cabecalho"]
        assert out["Cabecalho"].startswith("Gabinete {artigo}")

