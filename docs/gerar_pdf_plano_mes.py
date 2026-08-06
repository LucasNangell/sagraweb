#!/usr/bin/env python3
"""Gera PDF profissional do Plano MES de Produção Gráfica — SAGRA."""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    CondPageBreak,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)

OUT = Path(__file__).resolve().parent / "Plano_MES_Producao_Grafica_SAGRA.pdf"

# Paleta corporativa (sem roxo / cream AI-default)
NAVY = colors.HexColor("#0B1F33")
TEAL = colors.HexColor("#0E7490")
TEAL_DARK = colors.HexColor("#155E75")
SLATE = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#CBD5E1")
ROW_ALT = colors.HexColor("#F1F5F9")
WHITE = colors.white
ACCENT = colors.HexColor("#0F766E")
WARN = colors.HexColor("#B45309")
PAGE_W, PAGE_H = A4


def styles():
    base = getSampleStyleSheet()
    s = {
        "cover_brand": ParagraphStyle(
            "cover_brand",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=14,
            textColor=TEAL,
            alignment=TA_CENTER,
            spaceAfter=6,
            tracking=2,
        ),
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=26,
            leading=32,
            textColor=NAVY,
            alignment=TA_CENTER,
            spaceAfter=14,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=12,
            leading=16,
            textColor=SLATE,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "cover_meta": ParagraphStyle(
            "cover_meta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceBefore=20,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=NAVY,
            spaceBefore=18,
            spaceAfter=10,
            borderPadding=3,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12.5,
            leading=16,
            textColor=TEAL_DARK,
            spaceBefore=12,
            spaceAfter=6,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10.5,
            leading=14,
            textColor=SLATE,
            spaceBefore=8,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13.5,
            textColor=SLATE,
            alignment=TA_JUSTIFY,
            spaceAfter=6,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            textColor=SLATE,
            leftIndent=4,
        ),
        "mono": ParagraphStyle(
            "mono",
            parent=base["Normal"],
            fontName="Courier",
            fontSize=8,
            leading=11,
            textColor=NAVY,
            backColor=ROW_ALT,
            leftIndent=6,
            rightIndent=6,
            spaceBefore=4,
            spaceAfter=8,
        ),
        "toc": ParagraphStyle(
            "toc",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=16,
            textColor=SLATE,
        ),
        "toc_h": ParagraphStyle(
            "toc_h",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=16,
            textColor=NAVY,
            spaceBefore=4,
        ),
        "caption": ParagraphStyle(
            "caption",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=8,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceBefore=2,
            spaceAfter=10,
        ),
        "callout": ParagraphStyle(
            "callout",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            textColor=NAVY,
            leftIndent=8,
            rightIndent=8,
        ),
        "footer": ParagraphStyle(
            "footer",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=MUTED,
        ),
        "th": ParagraphStyle(
            "th",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=WHITE,
        ),
        "td": ParagraphStyle(
            "td",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10.5,
            textColor=SLATE,
        ),
        "td_b": ParagraphStyle(
            "td_b",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10.5,
            textColor=NAVY,
        ),
    }
    return s


def header_footer(canvas, doc):
    canvas.saveState()
    # top rule
    canvas.setStrokeColor(TEAL)
    canvas.setLineWidth(1.5)
    canvas.line(1.8 * cm, PAGE_H - 1.2 * cm, PAGE_W - 1.8 * cm, PAGE_H - 1.2 * cm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(1.8 * cm, PAGE_H - 1.05 * cm, "SAGRA Web  ·  Plano MES Produção Gráfica")
    canvas.drawRightString(PAGE_W - 1.8 * cm, PAGE_H - 1.05 * cm, "Confidencial — uso interno")

    # bottom
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(1.8 * cm, 1.3 * cm, PAGE_W - 1.8 * cm, 1.3 * cm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(1.8 * cm, 0.85 * cm, "Câmara / SEFOC — Sistema de Ordens de Serviço")
    canvas.drawRightString(PAGE_W - 1.8 * cm, 0.85 * cm, f"Página {doc.page}")
    canvas.restoreState()


def cover_page(story, s):
    story.append(Spacer(1, 3.2 * cm))
    story.append(Paragraph("SAGRA WEB", s["cover_brand"]))
    story.append(
        HRFlowable(width="40%", thickness=2, color=TEAL, spaceBefore=4, spaceAfter=18, hAlign="CENTER")
    )
    story.append(
        Paragraph(
            "Plano de Implementação<br/>MES de Produção Gráfica",
            s["cover_title"],
        )
    )
    story.append(
        Paragraph(
            "Evolução do sistema de Ordens de Serviço para um Manufacturing<br/>"
            "Execution System com fila de produção, SLA, estoque e<br/>"
            "sincronização automática entre setores.",
            s["cover_sub"],
        )
    )
    story.append(Spacer(1, 1.2 * cm))

    meta = [
        [Paragraph("<b>Documento</b>", s["td_b"]), Paragraph("Plano técnico-funcional faseado", s["td"])],
        [Paragraph("<b>Escopo</b>", s["td_b"]), Paragraph("Fases 0–9 · Marcos M1–M6", s["td"])],
        [Paragraph("<b>Base</b>", s["td_b"]), Paragraph("OS · TechSpec · Sub OS · PCP · Realtime", s["td"])],
        [Paragraph("<b>MVP operacional</b>", s["td_b"]), Paragraph("Marco M3 (Fases 2–3)", s["td"])],
        [Paragraph("<b>Sincronia capa/miolo</b>", s["td_b"]), Paragraph("Marco M5 (Fases 6–7)", s["td"])],
        [Paragraph("<b>Estimativa M5</b>", s["td_b"]), Paragraph("~6–9 meses (equipe familiar ao monorepo)", s["td"])],
        [Paragraph("<b>Data</b>", s["td_b"]), Paragraph("Julho 2026", s["td"])],
    ]
    t = Table(meta, colWidths=[4.2 * cm, 10 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), ROW_ALT),
                ("BOX", (0, 0), (-1, -1), 0.8, TEAL),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 2 * cm))
    story.append(
        Paragraph(
            "Este documento descreve funcionamento, jornada de uso e impacto<br/>"
            "de cada funcionalidade, na ordem correta de implementação.",
            s["cover_meta"],
        )
    )
    story.append(PageBreak())


def make_table(headers, rows, col_widths, s):
    data = [[Paragraph(h, s["th"]) for h in headers]]
    for row in rows:
        cells = []
        for i, cell in enumerate(row):
            style = s["td_b"] if i == 0 else s["td"]
            cells.append(Paragraph(str(cell), style))
        data.append(cells)
    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("BOX", (0, 0), (-1, -1), 0.6, NAVY),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    t.setStyle(TableStyle(style_cmds))
    return t


def bullets(items, s):
    return ListFlowable(
        [ListItem(Paragraph(i, s["bullet"]), leftIndent=8, bulletColor=TEAL) for i in items],
        bulletType="bullet",
        start="•",
        leftIndent=12,
        bulletFontSize=9,
        spaceBefore=2,
        spaceAfter=8,
    )


def numbered(items, s):
    return ListFlowable(
        [ListItem(Paragraph(i, s["bullet"]), leftIndent=8, bulletColor=TEAL) for i in items],
        bulletType="1",
        leftIndent=12,
        bulletFontSize=9,
        spaceBefore=2,
        spaceAfter=8,
    )


def callout_box(text, s, title="Destaque"):
    inner = Paragraph(f"<b>{title}.</b> {text}", s["callout"])
    t = Table([[inner]], colWidths=[16.4 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ECFEFF")),
                ("BOX", (0, 0), (-1, -1), 1.2, TEAL),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return t


def phase_header(story, s, num, title, marco):
    story.append(CondPageBreak(4 * cm))
    story.append(Paragraph(f"Fase {num} — {title}", s["h1"]))
    story.append(
        HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8)
    )
    story.append(Paragraph(f"<b>Marco:</b> {marco}", s["body"]))


def build():
    s = styles()
    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=1.8 * cm,
        rightMargin=1.8 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
        title="Plano MES Produção Gráfica — SAGRA",
        author="SAGRA Web",
        subject="Plano de implementação faseado MES gráfica",
    )
    story = []

    # —— CAPA ——
    cover_page(story, s)

    # —— SUMÁRIO ——
    story.append(Paragraph("Sumário", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=10))
    toc_items = [
        "1. Visão do produto",
        "2. Estado atual e base de construção",
        "3. Decisões de arquitetura",
        "4. Personas e uso do sistema",
        "5. Ordem das fases",
        "6. Fase 0 — Fundamentos de domínio",
        "7. Fase 1 — Roteiro a partir do TechSpec",
        "8. Fase 2 — WIP e execução no chão",
        "9. Fase 3 — Fila PCP e gestor",
        "10. Fase 4 — SLA e lead time",
        "11. Fase 5 — Controle de estoque",
        "12. Fase 6 — Motor de sincronização",
        "13. Fase 7 — Despacho automático",
        "14. Fase 8 — Visibilidade e governança",
        "15. Fase 9 — Calibração contínua",
        "16. Jornada ponta a ponta",
        "17. Impacto transversal",
        "18. Riscos, mitigação e rollout",
        "19. Marcos e estimativa",
        "20. Princípio de implementação",
    ]
    for item in toc_items:
        story.append(Paragraph(item, s["toc"]))
    story.append(PageBreak())

    # —— 1 VISÃO ——
    story.append(Paragraph("1. Visão do produto", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8))
    story.append(
        Paragraph(
            "Transformar o SAGRA de um sistema de <b>ordens de serviço com fila PCP e "
            "andamentos manuais</b> em um <b>MES (Manufacturing Execution System) de gráfica</b>: "
            "cada OS vira um plano de produção com operações tipadas (corte, offset, digital, "
            "laminação, acabamento…), executáveis no chão de fábrica, priorizáveis pelo gestor, "
            "com estoque, prazo interno e <b>despacho sincronizado</b> para que componentes "
            "paralelos (ex.: capa e miolo) cheguem juntos ao acabamento.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Nada do fluxo legado de OS/andamento/PCP é descartado. O MES <b>soma uma camada</b> "
            "por cima e, onde fizer sentido, <b>espelha</b> progresso no andamento atual para não "
            "quebrar busca, painéis, portal do cliente e integrações.",
            s["body"],
        )
    )
    story.append(
        callout_box(
            "O legado continua operando; o MES adiciona operações tipadas, filas por centro, "
            "estoque, SLA e um motor que libera trabalho em sincronia entre setores.",
            s,
            "Princípio",
        )
    )

    # —— 2 ESTADO ATUAL ——
    story.append(Paragraph("2. Estado atual e base de construção", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8))
    story.append(
        Paragraph(
            "O SAGRA já possui o núcleo corporativo adequado. A lacuna é a camada de "
            "<b>operações de chão de fábrica</b>.",
            s["body"],
        )
    )
    story.append(
        make_table(
            ["Capacidade", "Como funciona hoje", "Limite"],
            [
                ["OS + detalhes", "Protocolo + detalhes; acabamento em texto livre", "Não descreve passos executáveis"],
                ["TechSpec", "Componentes/lotes: páginas, máquina, papel, cores", "Spec técnica, não roteiro de chão"],
                ["Sub OS", "Andamento independente por componente", "Ainda é situação + setor, não operação"],
                ["Andamento", "Histórico append-only; vocabulário aberto", "Sem máquina de estados; sem pred/succ"],
                ["PCP (/pcp)", "Kanban por setor; drag em tab_pcp_fila; WebSocket", "Ordena OS no setor, não ops tipadas"],
                ["Gravação / Papelaria", "Filas e workers especializados", "Pré-impressão/chapas, não MES completo"],
                ["Estoque", "Inexistente (cotas e lookups de papel)", "Sem reserva/baixa física"],
                ["Prazo", "EntregData + predição KNN no PCP", "Sem lead time interno de produção"],
            ],
            [3.2 * cm, 7.2 * cm, 6 * cm],
            s,
        )
    )
    story.append(
        Paragraph(
            "Âncoras: os_routes, pcp_routes, pcp_queue_service, os_componentes_service, "
            "realtime, Sub OS SQL, feature apps/web/src/features/pcp/.",
            s["caption"],
        )
    )

    # —— 3 ARQUITETURA ——
    story.append(Paragraph("3. Decisões de arquitetura (fixadas)", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8))
    story.append(
        numbered(
            [
                "<b>MySQL-only</b> para tabelas MES (igual Sub OS/gravação). Access MDB não recebe essas tabelas.",
                "Feature flag <b>SAGRA_MES_ENABLED</b> (e depois flags por setor) — rollout sem big-bang.",
                "<b>Andamento legado permanece</b>; MES escreve espelhos pontuais sem apagar histórico.",
                "<b>RBAC:</b> nova flag sb_gestor_producao + reuso de sb_pcp; operadores por centro de trabalho.",
                "<b>Scheduler no processo da API</b> (timer + eventos), padrão claim/heartbeat do Papelaria — sem Celery/Redis na v1.",
                "<b>Otimização v1 = por OS</b> (sincronizar ramos da mesma OS) + filas por centro; global multi-OS depois da calibração.",
            ],
            s,
        )
    )
    story.append(Paragraph("Fluxo alvo (resumo)", s["h2"]))
    story.append(
        Paragraph(
            "Gerência cria OS + TechSpec → Gera roteiro de ops → Motor libera ops → "
            "Filas por setor → Operador executa → (conclusão realimenta o motor) → "
            "Espelho no andamento legado.",
            s["body"],
        )
    )

    # —— 4 PERSONAS ——
    story.append(Paragraph("4. Personas e uso do sistema", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8))
    story.append(
        make_table(
            ["Persona", "Papel", "Telas principais"],
            [
                ["Analista / Gerência", "Cadastra OS, TechSpec, acabamentos tipados; preview do roteiro", "/gerencia, detalhe da OS"],
                ["Gestor de produção", "Prioriza filas, confirma liberações, resolve bloqueios", "/pcp, /producao/gestao, alertas"],
                ["Operador de setor", "Vê o liberado no seu centro; inicia/pausa/conclui", "/producao/setor ou painel setor"],
                ["Almoxarifado", "Entradas, ajustes, saldos, reposição", "/estoque"],
                ["Admin", "Catálogos MES, tempos, máquinas, permissões, flags", "Configurações / Usuários"],
                ["Cliente / gabinete", "Vê andamentos/espelhos; sem MES interno", "Portal existente"],
            ],
            [3.4 * cm, 7.2 * cm, 5.8 * cm],
            s,
        )
    )

    # —— 5 ORDEM ——
    story.append(Paragraph("5. Ordem das fases e por quê", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8))
    story.append(
        Paragraph(
            "Implementar fora de ordem quebra o sistema: sem catálogo não há roteiro; sem roteiro "
            "não há WIP; sem WIP o motor não tem o que sincronizar; sem estoque o despacho libera "
            "trabalho impossível de executar.",
            s["body"],
        )
    )
    story.append(
        make_table(
            ["Fase", "Nome", "Pré-requisito", "Marco"],
            [
                ["0", "Fundamentos de domínio", "—", "M1"],
                ["1", "Roteiro a partir do TechSpec", "0", "M2"],
                ["2", "WIP / execução no chão", "1", "M3 (parte)"],
                ["3", "Fila PCP + gestor", "1–2", "M3 MVP operacional"],
                ["4", "SLA e lead time", "1–2", "M4"],
                ["5", "Estoque", "1", "M4"],
                ["6", "Motor de sincronização", "2–5", "M5"],
                ["7", "Despacho automático", "6", "M5"],
                ["8", "Painéis e governança", "3–7", "M6"],
                ["9", "Calibração contínua", "4, 7–8", "contínuo"],
            ],
            [1.4 * cm, 5.5 * cm, 3.5 * cm, 6 * cm],
            s,
        )
    )
    story.append(Spacer(1, 6))
    story.append(
        callout_box(
            "Roteiro visível + operadores executando ops + gestor reordenando fila com reflexo "
            "nas OS. A sincronia perfeita capa/miolo é o Marco M5 (Fases 6–7).",
            s,
            "MVP de valor (M3)",
        )
    )
    story.append(PageBreak())

    # —— FASE 0 ——
    phase_header(story, s, "0", "Fundamentos de domínio", "M1 · 3–5 semanas")
    story.append(Paragraph("Objetivo", s["h2"]))
    story.append(
        Paragraph(
            "Criar o <b>vocabulário mestre</b> da gráfica (centros, operações, máquinas, materiais, "
            "permissões) sem alterar o dia a dia de quem abre OS ou usa o PCP.",
            s["body"],
        )
    )
    story.append(Paragraph("Como funciona", s["h2"]))
    story.append(Paragraph("Centros de trabalho", s["h3"]))
    story.append(
        Paragraph(
            "Postos lógicos: Corte, Gravação, Offset, Digital, Laminação, Acabamento, Expedição. "
            "Mapeamento opcional para SetorLink legado (ex.: Digital ↔ setor real do andamento), "
            "para que painéis e buscas atuais continuem coerentes quando o MES espelhar andamentos.",
            s["body"],
        )
    )
    story.append(Paragraph("Catálogo de operações", s["h3"]))
    story.append(
        Paragraph(
            "Cada operação tipada (“Cortar papel”, “Imprimir offset”, “Laminar fosco”, "
            "“Encadernar grampo”) define: centro responsável; tempo-padrão (setup + unitário); "
            "insumos típicos (referência); se exige máquina específica ou qualquer do centro.",
            s["body"],
        )
    )
    story.append(Paragraph("Máquinas e materiais", s["h3"]))
    story.append(
        Paragraph(
            "Máquinas com centro, capacidade nominal e status ativo. Materiais (SKU) espelhando "
            "papéis/películas do lookup da OS — nesta fase <b>sem saldo nem reserva</b>, só o "
            "dicionário compartilhado entre TechSpec e roteiro.",
            s["body"],
        )
    )
    story.append(Paragraph("Permissões e feature flag", s["h3"]))
    story.append(
        bullets(
            [
                "<b>sb_gestor_producao:</b> reordenar filas, confirmar despachos, desbloquear ops, ver plano.",
                "Operador age só no seu centro (permissão por centro ou setor).",
                "Admin MES edita catálogos.",
                "Com <b>SAGRA_MES_ENABLED=false</b>, nenhum botão novo no fluxo operacional.",
            ],
            s,
        )
    )
    story.append(Paragraph("Como o usuário usa", s["h2"]))
    story.append(
        numbered(
            [
                "Admin abre Configurações → “Produção / MES”.",
                "Cadastra centros e associa aos setores existentes.",
                "Cadastra operações e amarra cada uma a um centro.",
                "Cadastra máquinas e (opcional) materiais SKU.",
                "Em Usuários, marca gestores e operadores por centro.",
                "Equipe de chão <b>não muda nada</b> no trabalho diário nesta fase.",
            ],
            s,
        )
    )
    story.append(Paragraph("Impacto", s["h2"]))
    story.append(
        make_table(
            ["Área", "Impacto"],
            [
                ["Banco", "Novas tabelas MySQL; deploy/sql + ensure_* no startup"],
                ["API", "Routers CRUD admin; zero mudança de comportamento em OS/PCP"],
                ["Front", "Telas de config; menu só para admin"],
                ["Operação diária", "Nenhum — flag desligada"],
                ["Risco", "Baixo; seed corrigível antes de ligar o MES"],
            ],
            [3.5 * cm, 12.9 * cm],
            s,
        )
    )
    story.append(Paragraph("Critério de aceite", s["h2"]))
    story.append(
        Paragraph(
            "CRUD completo; permissões gravadas; seed SEFOC carregado; OS/PCP idênticos ao "
            "comportamento atual com flag off.",
            s["body"],
        )
    )

    # —— FASE 1 ——
    phase_header(story, s, "1", "Roteiro de produção a partir do TechSpec", "M2 · +4–6 semanas")
    story.append(Paragraph("Objetivo", s["h2"]))
    story.append(
        Paragraph(
            "Toda OS pronta para produção ganha um <b>grafo de operações</b>: o que fazer, em que "
            "ordem, o que pode rodar em paralelo, e onde os ramos se encontram (acabamento).",
            s["body"],
        )
    )
    story.append(Paragraph("Como funciona", s["h2"]))
    story.append(Paragraph("TechSpec v2 (retrocompatível)", s["h3"]))
    story.append(
        Paragraph(
            "Além de componentes/lotes atuais, a Gerência informa: <b>processo gráfico</b> "
            "(offset, digital, híbrido…); <b>acabamentos tipados</b> (laminação, verniz, dobra, "
            "grampo…); formato/folhas estimadas. Texto livre de DescAcabamento permanece como "
            "observação. OS antigas sem v2 não geram roteiro (ou roteiro mínimo manual).",
            s["body"],
        )
    )
    story.append(Paragraph("Geração do roteiro", s["h3"]))
    story.append(
        numbered(
            [
                "Lê TechSpec v2 + catálogo (Fase 0).",
                "Por componente (Sub OS), monta a cadeia típica (ex.: capa: corte → offset → laminação; miolo: digital).",
                "Cria nó de convergência: Acabamento/Expedição com predecessoras = fim de cada ramo.",
                "Grava tab_mes_roteiro + tab_mes_roteiro_ops (ordem, centro, pred_ids, tempo, material).",
                "Status inicial: <b>aguardando</b> (ainda não liberada ao chão).",
            ],
            s,
        )
    )
    story.append(Paragraph("Exemplo — revista capa + miolo", s["h3"]))
    story.append(
        Paragraph(
            "OS 4521/2026<br/>"
            "├── Sub OS Capa<br/>"
            "│&nbsp;&nbsp;&nbsp;├── Op1 Corte papel capa [Corte]<br/>"
            "│&nbsp;&nbsp;&nbsp;├── Op2 Impressão offset capa [Offset] ← depende Op1<br/>"
            "│&nbsp;&nbsp;&nbsp;└── Op3 Laminação capa [Laminação] ← depende Op2<br/>"
            "├── Sub OS Miolo<br/>"
            "│&nbsp;&nbsp;&nbsp;└── Op4 Impressão digital miolo [Digital] ← paralelo a Op1–Op3<br/>"
            "└── Convergência OS<br/>"
            "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── Op5 Acabamento [Acabamento] ← depende Op3 E Op4",
            s["mono"],
        )
    )
    story.append(Paragraph("Recálculo", s["h3"]))
    story.append(
        Paragraph(
            "Edição do TechSpec regenera o roteiro somente se nenhuma op estiver em execução/"
            "concluída; caso contrário, exige confirmação do gestor (“invalidar progresso e regenerar”).",
            s["body"],
        )
    )
    story.append(Paragraph("Como o usuário usa", s["h2"]))
    story.append(
        numbered(
            [
                "Usuário com sb_gerencia abre /gerencia e cria/edita a OS.",
                "Monta componentes (capa, miolo) como hoje.",
                "Em cada componente escolhe processo e acabamentos tipados.",
                "Painel “Preview do roteiro” mostra timeline/Gantt dos ramos e do encontro.",
                "Ao salvar (MES on), o roteiro é gerado/atualizado.",
                "Aba “Produção” no detalhe da OS lista ops e dependências.",
            ],
            s,
        )
    )
    story.append(Paragraph("Impacto", s["h2"]))
    story.append(
        make_table(
            ["Área", "Impacto"],
            [
                ["Gerência", "Novos campos; DescAcabamento deixa de ser única fonte do acabamento"],
                ["Banco", "tab_mes_roteiro* ligadas a protocolo + sub_os_id"],
                ["Sub OS", "Cada componente ganha roteiro; andamento Sub OS pode coexistir"],
                ["PCP", "Ainda não muda ordenação (até Fase 3)"],
                ["Treinamento", "Analistas tipam acabamentos — migração gradual"],
                ["Risco", "Médio — mitigar com templates por produto e preview obrigatório"],
            ],
            [3.2 * cm, 13.2 * cm],
            s,
        )
    )
    story.append(Paragraph("Critério de aceite", s["h2"]))
    story.append(
        Paragraph(
            "OS capa offset + miolo digital gera o grafo do exemplo; preview bate com o salvo; "
            "TechSpec v1 não quebra; regeneração bloqueada com ops já iniciadas.",
            s["body"],
        )
    )
    story.append(PageBreak())

    # —— FASE 2 ——
    phase_header(story, s, "2", "WIP e execução no chão de fábrica", "M3 (parte) · +parte das 6–8 semanas")
    story.append(Paragraph("Objetivo", s["h2"]))
    story.append(
        Paragraph(
            "Cada operação ganha <b>ciclo de vida real</b>: iniciar, pausar, concluir ou bloquear. "
            "O chão trabalha sobre <b>ordens de operação</b>, não só situação livre da OS.",
            s["body"],
        )
    )
    story.append(Paragraph("Estados da operação", s["h2"]))
    story.append(
        Paragraph(
            "aguardando → liberada (motor/gestor) → em_execucao (operador inicia) ⇄ pausada → "
            "concluida. Também: liberada/em_execucao → bloqueada; bloqueada → liberada (gestor); "
            "concluida → retrabalho → liberada. Transições inválidas são rejeitadas pela API.",
            s["body"],
        )
    )
    story.append(Paragraph("Claim, espelho e predecessoras", s["h2"]))
    story.append(
        bullets(
            [
                "<b>Claim:</b> ao Iniciar, op fica com o operador (heartbeat); timeout ou gestor força reassumir.",
                "<b>Espelho andamento:</b> mudanças relevantes criam andamento/Sub OS com situação configurável por centro.",
                "<b>Predecessoras:</b> op só libera se predecessoras concluídas (exceto política do motor na Fase 6).",
            ],
            s,
        )
    )
    story.append(Paragraph("Como o usuário usa", s["h2"]))
    story.append(Paragraph("Operador (Digital)", s["h3"]))
    story.append(
        numbered(
            [
                "Abre /producao/setor (Digital) ou painel TV.",
                "Vê lista ordenada de ops liberadas/em execução do centro.",
                "Iniciar → em_execucao; cronômetro; claim impede outro operador.",
                "Pausar + motivo se a máquina travar.",
                "Concluir (qty boa/refugo se exigido).",
                "Acabamento não aparece se a capa ainda não terminou.",
            ],
            s,
        )
    )
    story.append(Paragraph("Gestor e analista", s["h3"]))
    story.append(
        Paragraph(
            "Gestor desbloqueia/reatribui e pode forçar conclusão com auditoria. Analista acompanha "
            "checks na aba Produção — sem “cadê a capa?” por telefone.",
            s["body"],
        )
    )
    story.append(Paragraph("Impacto", s["h2"]))
    story.append(
        make_table(
            ["Área", "Impacto"],
            [
                ["Cultura operacional", "Maior — apontamento na op; UI mínima (3 botões); piloto 1 setor"],
                ["Andamento", "Continua; volume pode aumentar (espelhos)"],
                ["PCP", "Cards por OS; detalhe mostra ops"],
                ["Performance", "Mais writes + WS mes_op_update; indexes status/centro"],
                ["Risco", "Resistência a apontamento — mitigar com piloto"],
            ],
            [3.8 * cm, 12.6 * cm],
            s,
        )
    )
    story.append(Paragraph("Critério de aceite", s["h2"]))
    story.append(
        Paragraph(
            "Miolo concluído + capa em laminação ⇒ Acabamento permanece aguardando; ao concluir "
            "capa, Acabamento fica elegível; histórico MES e espelho coerentes.",
            s["body"],
        )
    )

    # —— FASE 3 ——
    phase_header(story, s, "3", "Fila de produção profissional e gestor", "M3 MVP · +parte das 6–8 semanas")
    story.append(Paragraph("Objetivo", s["h2"]))
    story.append(
        Paragraph(
            "O <b>gestor de produção</b> controla a ordem de trabalho. Reordenar a fila "
            "<b>reflete imediatamente</b> nas OS/ops que os setores veem — evolução do PCP atual.",
            s["body"],
        )
    )
    story.append(Paragraph("Como funciona", s["h2"]))
    story.append(
        Paragraph(
            "<b>Antes:</b> OS cujo último andamento está no setor. <b>Depois:</b> operações "
            "liberadas/em execução do centro, agrupadas visualmente por OS. O card mantém número "
            "da OS, produto, prazo e prioridade; expandir mostra ops ativas daquele centro.",
            s["body"],
        )
    )
    story.append(Paragraph("Reordenação", s["h3"]))
    story.append(
        numbered(
            [
                "Gestor (sb_pcp / sb_gestor_producao) arrasta o card na coluna do centro.",
                "API valida itens, grava ordem em tab_mes_fila_centro (espelha tab_pcp_fila na transição).",
                "Atualiza prioridade_efetiva; invalida cache; broadcast WS pcp_queue_update + mes_fila_update.",
                "Telas de operador e TVs reordenam em tempo real.",
            ],
            s,
        )
    )
    story.append(Paragraph("Prioridade efetiva", s["h3"]))
    story.append(
        numbered(
            [
                "Ordem manual do gestor (drag)",
                "Prioridade da OS (Prometido &gt; Solicitado &gt; demais)",
                "EntregData do cliente",
                "ETA / caminho crítico (Fase 4)",
                "Chegada na fila",
            ],
            s,
        )
    )
    story.append(
        Paragraph(
            "Posição “# na fila do setor X” aparece no card e no detalhe da OS. Drag em um centro "
            "não reordena outros centros; o motor (Fase 6) pode reagir à prioridade global da OS. "
            "Pin impede o motor de alterar a ordem até desmarcar.",
            s["body"],
        )
    )
    story.append(Paragraph("Como o usuário usa", s["h2"]))
    story.append(
        numbered(
            [
                "Gestor abre /pcp (kanban por centro).",
                "Filtra Offset, identifica gargalo.",
                "Arrasta OS urgente para o topo.",
                "Em segundos, painel e operador refletem a nova ordem.",
                "Opcional: pin na ordem.",
            ],
            s,
        )
    )
    story.append(Paragraph("Impacto", s["h2"]))
    story.append(
        make_table(
            ["Área", "Impacto"],
            [
                ["PCP", "Evolução, não substituição; convivência OS-only vs ops"],
                ["Operadores", "Sentem priorização do gestor em tempo real"],
                ["Conflito", "Last-write-wins + optimistic lock / toast"],
                ["Risco", "Médio — mentalidade “ops no centro”; card de OS como unidade visual"],
            ],
            [3.2 * cm, 13.2 * cm],
            s,
        )
    )
    story.append(Paragraph("Critério de aceite", s["h2"]))
    story.append(
        Paragraph(
            "Drag no PCP altera lista do operador via WS; posição na OS; pin impede reordenação automática.",
            s["body"],
        )
    )
    story.append(PageBreak())

    # —— FASE 4 ——
    phase_header(story, s, "4", "Tempo-alvo e SLA desde a criação", "M4 · +parte das 6–8 semanas")
    story.append(Paragraph("Objetivo", s["h2"]))
    story.append(
        Paragraph(
            "Responder com dados: desde que a OS entrou, <b>quanto deveria demorar</b> e "
            "<b>quanto falta no caminho crítico</b> — além do prazo ao cliente (EntregData).",
            s["body"],
        )
    )
    story.append(Paragraph("Como funciona", s["h2"]))
    story.append(
        bullets(
            [
                "<b>Tempos padrão:</b> por produto/operação/faixa (setup + qtd × unitário).",
                "Caminho crítico = lead time interno; prazo_producao_estimado = início + crítico + buffer.",
                "sla_status: no_prazo | risco | atrasado.",
                "Recalcula em atraso de op, reorder, regeneração de roteiro ou calibração (Fase 9).",
                "Visibilidade: badges no PCP, Gantt previsto vs real, Web Push ao gestor.",
                "SLA interno ≠ EntregData — os dois são exibidos; alerta crítico se ambos estouram.",
            ],
            s,
        )
    )
    story.append(Paragraph("Como o usuário usa", s["h2"]))
    story.append(
        numbered(
            [
                "Admin cadastra tempos padrão iniciais (mesmo grosseiros).",
                "OS com roteiro já nasce com ETA interno.",
                "Gestor filtra “só atrasadas” no PCP.",
                "Operador vê urgência por badge, sem calcular de cabeça.",
                "Relatório semanal: % no prazo; tempo médio por centro.",
            ],
            s,
        )
    )
    story.append(Paragraph("Impacto", s["h2"]))
    story.append(
        make_table(
            ["Área", "Impacto"],
            [
                ["Predição KNN", "Continua; depois absorve features MES"],
                ["Gestão", "Tempos ruins geram falso alerta — revisão humana inicial"],
                ["Risco", "Baixo-médio; valor alto mesmo com precisão imperfeita"],
            ],
            [3.2 * cm, 13.2 * cm],
            s,
        )
    )
    story.append(Paragraph("Critério de aceite", s["h2"]))
    story.append(
        Paragraph(
            "OS nova exibe ETA; atraso simulado move sla_status e dispara alerta; card PCP mostra "
            "tempo restante do caminho crítico.",
            s["body"],
        )
    )

    # —— FASE 5 ——
    phase_header(story, s, "5", "Controle de estoque", "M4 · +parte das 6–8 semanas")
    story.append(Paragraph("Objetivo", s["h2"]))
    story.append(
        Paragraph(
            "Não liberar impressão sem material; <b>reservar na liberação</b> e <b>baixar na "
            "conclusão</b>; dar ao almoxarifado saldos e movimentação.",
            s["body"],
        )
    )
    story.append(Paragraph("Como funciona", s["h2"]))
    story.append(
        Paragraph(
            "Entidades: SKU, saldo, movimentos (entrada, saída, ajuste, reserva, consumo, estorno), "
            "reserva por op/OS. Cotas gráficas do gabinete permanecem separadas do estoque físico.",
            s["body"],
        )
    )
    story.append(Paragraph("Fluxo feliz", s["h3"]))
    story.append(
        numbered(
            [
                "Roteiro estima consumo (folhas, película, chapas).",
                "Na liberação: tenta reservar.",
                "Saldo ok → reserva + op liberada.",
                "Saldo insuficiente → op bloqueada (estoque); alerta gestor/almoxarifado.",
                "Entrada de material → reprocessa → libera.",
                "Conclusão da op → reserva vira consumo.",
                "Cancelamento → estorna reserva.",
            ],
            s,
        )
    )
    story.append(Paragraph("Como o usuário usa", s["h2"]))
    story.append(
        bullets(
            [
                "<b>Almoxarifado:</b> /estoque → entrada de NF → vê bloqueios → após entrada, bloqueios somem.",
                "<b>Gestor:</b> filtra bloqueadas por estoque; pode substituir papel no TechSpec.",
                "<b>Operador:</b> só vê badge de bloqueio; não lança estoque no dia a dia.",
            ],
            s,
        )
    )
    story.append(Paragraph("Impacto", s["h2"]))
    story.append(
        make_table(
            ["Área", "Impacto"],
            [
                ["Processo", "Exige disciplina de lançar entradas"],
                ["Liberação", "Acoplamento com Fases 6–7"],
                ["Risco", "Alto na adoção — piloto informativo, depois bloqueante"],
            ],
            [3.2 * cm, 13.2 * cm],
            s,
        )
    )
    story.append(Paragraph("Critério de aceite", s["h2"]))
    story.append(
        Paragraph(
            "Sem saldo ⇒ não libera (modo bloqueante); entrada + reprocessamento libera; "
            "conclusão baixa saldo; cancelamento estorna.",
            s["body"],
        )
    )
    story.append(PageBreak())

    # —— FASE 6 ——
    phase_header(story, s, "6", "Motor de sincronização e otimização", "M5 · +parte das 8–10 semanas")
    story.append(Paragraph("Objetivo", s["h2"]))
    story.append(
        Paragraph(
            "Coração do plano: <b>otimizar a produção de uma OS</b> liberando e segurando "
            "operações para que ramos paralelos <b>cheguem juntos</b> ao acabamento, reduzindo "
            "espera ociosa e lead time.",
            s["body"],
        )
    )
    story.append(Paragraph("Algoritmo v1 (backward + forward)", s["h2"]))
    story.append(
        numbered(
            [
                "<b>Entrada:</b> roteiros, filas/prioridades, capacidade, estoque, SLA.",
                "<b>Backward</b> a partir do sink (Acabamento): quando cada op deveria terminar.",
                "<b>Forward</b> com capacidade: encaixa ops nas filas sem violar predecessoras.",
                "<b>Liberar</b> se predecessoras ok + estoque ok + início planejado ≤ agora + folga + prioridade.",
                "<b>Segurar</b> ramo curto se liberar cedo só encheria o centro (exceto pin “liberar tudo”).",
                "Se miolo for curto e capa longa, pode atrasar o miolo para convergirem — desde que não estoure SLA.",
            ],
            s,
        )
    )
    story.append(
        Paragraph(
            "Exemplo temporal: enquanto o miolo imprime na digital (~8h), a capa já percorre "
            "corte → offset → laminação em paralelo. Acabamento só libera quando ambos concluem.",
            s["body"],
        )
    )
    story.append(
        callout_box(
            "Cada ciclo grava tab_mes_plano_execucao com motivos auditáveis "
            "(“aguardando sync com capa”, “estoque”, “capacidade Offset”). "
            "v1 otimiza dentro da OS; scoring global multi-OS vem depois.",
            s,
            "Auditoria",
        )
    )
    story.append(Paragraph("Como o usuário usa", s["h2"]))
    story.append(
        numbered(
            [
                "Piloto em <b>semi-auto</b>: gestor vê sugestões e confirma o lote.",
                "Produção estável: liga <b>auto</b> (eventos + tick 30–60s).",
                "Sempre pode pin/override na fila (Fase 3).",
            ],
            s,
        )
    )
    story.append(Paragraph("Impacto", s["h2"]))
    story.append(
        make_table(
            ["Área", "Impacto"],
            [
                ["Lead time", "Queda de espera ociosa no acabamento"],
                ["WIP", "Menos semi-acabado parado (com política de hold)"],
                ["Complexidade", "Alta — semi-auto primeiro; testes de simulação obrigatórios"],
                ["Risco", "Alto se tempos/estoque forem ruins"],
            ],
            [3.2 * cm, 13.2 * cm],
            s,
        )
    )
    story.append(Paragraph("Critério de aceite", s["h2"]))
    story.append(
        Paragraph(
            "Cenário capa+miolo: digital e cadeia da capa despachados em paralelo; acabamento só "
            "com ambos prontos; espera no acabamento abaixo do limiar; UI explica holds.",
            s["body"],
        )
    )

    # —— FASE 7 ——
    phase_header(story, s, "7", "Despacho automático de comandos aos setores", "M5 · +parte das 8–10 semanas")
    story.append(Paragraph("Objetivo", s["h2"]))
    story.append(
        Paragraph(
            "Transformar a decisão do motor em <b>comando concreto</b>: item na fila, notificação, "
            "painel — e integrações com Gravação/Papelaria quando couber.",
            s["body"],
        )
    )
    story.append(Paragraph("Ao liberar uma op", s["h2"]))
    story.append(
        numbered(
            [
                "Status → liberada.",
                "Insert/update na fila do centro na posição da prioridade.",
                "Evento WS para setor + PCP + painéis.",
                "Notificação in-app (opcional Web Push).",
                "Efeitos: Gravação alinha módulos existentes; Papelaria enfileira job Corel; impressão/acabamento = fila + ticket digital.",
                "Idempotência por roteiro_op_id — sem comandos duplicados.",
            ],
            s,
        )
    )
    story.append(Paragraph("Cadeia no exemplo", s["h3"]))
    story.append(
        Paragraph(
            "t0 Motor libera Op4 (digital) + Op1 (corte)<br/>"
            "t1 Corte conclui → libera Op2 (offset)<br/>"
            "t2 Offset conclui → libera Op3 (laminação)<br/>"
            "t3 Digital conclui (paralelo)<br/>"
            "t4 Laminação conclui → libera Op5 (acabamento)",
            s["mono"],
        )
    )
    story.append(Paragraph("Modos", s["h3"]))
    story.append(
        bullets(
            [
                "<b>Automático:</b> motor aplica sem confirmação.",
                "<b>Semi-auto:</b> sugere; gestor confirma (recomendado no go-live).",
                "<b>Manual:</b> escape sempre disponível na aba Produção / PCP.",
            ],
            s,
        )
    )
    story.append(Paragraph("Como o usuário usa", s["h2"]))
    story.append(
        Paragraph(
            "Laminação: quando a capa sai do offset, a op <b>aparece sozinha</b> na lista — sem "
            "telefone do PCP. Gestor monitora “Despachos da última hora” e usa override se travar.",
            s["body"],
        )
    )
    story.append(Paragraph("Impacto", s["h2"]))
    story.append(
        make_table(
            ["Área", "Impacto"],
            [
                ["Comunicação", "Reduz corre entre setores"],
                ["Integrações", "Contrato claro op ↔ Gravação/Papelaria"],
                ["Falhas", "Outbox + reprocessamento (comando perdido é grave)"],
                ["Risco", "Médio-alto na integração; baixo se só fila MES no piloto"],
            ],
            [3.2 * cm, 13.2 * cm],
            s,
        )
    )
    story.append(Paragraph("Critério de aceite", s["h2"]))
    story.append(
        Paragraph(
            "Log ponta a ponta com timestamps; sem duplicados; painel atualiza sem F5; semi-auto e auto testados.",
            s["body"],
        )
    )
    story.append(PageBreak())

    # —— FASE 8 ——
    phase_header(story, s, "8", "Visibilidade, governança e fechamento", "M6 · contínuo pós go-live")
    story.append(Paragraph("Objetivo", s["h2"]))
    story.append(
        Paragraph(
            "Dar à chefia <b>visão de fábrica</b> e fechar o ciclo (entrega/cancelamento) sem ops "
            "ou reservas órfãs.",
            s["body"],
        )
    )
    story.append(Paragraph("Como funciona", s["h2"]))
    story.append(
        bullets(
            [
                "Painéis: carga por máquina/centro, gargalo, OS em risco SLA, Gantt por OS.",
                "Relatórios: lead time real vs padrão, tempo médio, refugo %, OEE simples.",
                "Entregue/Cancelada: cancela ops abertas, estorna reservas, limpa filas, arquiva plano.",
                "Flags por centro para piloto (Digital on, Offset off).",
            ],
            s,
        )
    )
    story.append(Paragraph("Como o usuário usa", s["h2"]))
    story.append(
        Paragraph(
            "Direção: TV com gargalo e atrasos. Gestor: manhã abre risco de SLA e reordena. "
            "Admin: liga MES só no centro piloto.",
            s["body"],
        )
    )
    story.append(Paragraph("Impacto e aceite", s["h2"]))
    story.append(
        Paragraph(
            "Baixo risco técnico; alto valor de adesão. Aceite: cancelar OS zera reservas e limpa "
            "filas; painel piloto mostra ops reais; relatório de lead time exportável.",
            s["body"],
        )
    )

    # —— FASE 9 ——
    phase_header(story, s, "9", "Calibração contínua", "Contínuo após go-live")
    story.append(Paragraph("Objetivo", s["h2"]))
    story.append(
        Paragraph(
            "O sistema <b>aprende com a execução real</b> para melhorar ETA e sincronização.",
            s["body"],
        )
    )
    story.append(
        numbered(
            [
                "Op concluída grava duração real (descontando pausas).",
                "Job diário atualiza média móvel dos tempos padrão (só com N amostral suficiente).",
                "Atraso &gt; limiar → re-planeja a OS e re-despacha se necessário.",
                "KNN do PCP ganha features de roteiro/gargalo/caminho crítico.",
            ],
            s,
        )
    )
    story.append(
        Paragraph(
            "Admin revisa “sugerido vs atual” e aprova em lote no início; depois auto-update com "
            "auditoria. Impacto: melhora M5 sem mudar UX; mitigar outliers com mediana e exclusão de retrabalho.",
            s["body"],
        )
    )

    # —— JORNADA ——
    story.append(Paragraph("16. Jornada ponta a ponta (após M5)", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8))
    story.append(
        Paragraph(
            "Cenário: <b>revista, capa offset + laminação, miolo digital</b>.",
            s["body"],
        )
    )
    story.append(
        numbered(
            [
                "Gerência cadastra OS 4521 com TechSpec v2 → preview → salvar.",
                "Sistema gera 5 ops + ETA; estima papel e película.",
                "Gestor (ou motor) libera produção; estoque reserva; Op1 (corte) e Op4 (digital) entram nas filas.",
                "Corte conclui → despacha Offset; Digital imprime em paralelo.",
                "Offset conclui → despacha Laminação.",
                "Digital e Laminação concluem → despacha Acabamento (juntos).",
                "Acabamento conclui → espelho andamento → Expedição/entrega.",
                "Consumos baixados; SLA registrado; tempos reais alimentam calibração.",
            ],
            s,
        )
    )
    story.append(
        Paragraph(
            "Durante tudo, o gestor pode furar a fila no PCP e o reflexo é imediato nos setores.",
            s["body"],
        )
    )

    # —— IMPACTO TRANSVERSAL ——
    story.append(Paragraph("17. Impacto transversal por camada", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8))
    story.append(
        make_table(
            ["Camada", "O que muda", "O que NÃO muda"],
            [
                ["MySQL", "Tabelas tab_mes_* / tab_estoque_*", "Protocolo/detalhes; andamento append-only"],
                ["MDB", "Nada do MES", "Dual-write legado intacto"],
                ["API", "Routers mes_*/estoque_*; hooks OS/terminal", "Contratos de busca OS"],
                ["Front", "Gerência, PCP, /producao/*, /estoque", "Home/busca; portal (só espelhos)"],
                ["Auth", "Novas flags", "Modelo IP + user overlay"],
                ["Realtime", "Novos eventos", "Hub atual"],
                ["Workers", "Papelaria/gravação como efeito de op", "Corel COM na essência"],
            ],
            [2.6 * cm, 7 * cm, 6.8 * cm],
            s,
        )
    )
    story.append(PageBreak())

    # —— RISCOS ——
    story.append(Paragraph("18. Riscos, mitigação e rollout", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8))
    story.append(
        make_table(
            ["Risco", "Mitigação"],
            [
                ["Operadores não apontam", "UI de 3 botões; piloto 1 setor; alerta de op parada"],
                ["Tempos padrão errados", "Começar grosseiro; Fase 9 + aprovação humana"],
                ["Estoque desatualizado", "Modo informativo → bloqueante"],
                ["Scheduler “inteligente demais”", "Semi-auto → auto; pin manual"],
                ["Confusão andamento vs MES", "Documentar espelhos; aba Produção como fonte operacional"],
                ["Big-bang", "Flag global + por centro; M3 antes de M5"],
            ],
            [5.5 * cm, 10.9 * cm],
            s,
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        callout_box(
            "M1 dados mestres → M2 preview roteiro → piloto Digital (M3) → estoque informativo → "
            "SLA → estoque bloqueante → semi-auto sync → auto em todos os centros.",
            s,
            "Rollout sugerido",
        )
    )

    # —— MARCOS ——
    story.append(Paragraph("19. Marcos e estimativa", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8))
    story.append(
        make_table(
            ["Marco", "Conteúdo", "Estimativa indicativa"],
            [
                ["M1", "Fase 0", "3–5 semanas"],
                ["M2", "Fase 1", "+4–6 semanas"],
                ["M3", "Fases 2–3 (MVP operacional)", "+6–8 semanas → ~3–4 meses total"],
                ["M4", "Fases 4–5", "+6–8 semanas"],
                ["M5", "Fases 6–7 (sincronia + despacho)", "+8–10 semanas → ~6–9 meses total"],
                ["M6", "Fases 8–9", "Contínuo pós go-live"],
            ],
            [2.2 * cm, 6.5 * cm, 7.7 * cm],
            s,
        )
    )
    story.append(
        Paragraph(
            "Estimativa para equipe pequena full-stack já familiar com o monorepo; paralelizar "
            "front/back encurta o calendário.",
            s["caption"],
        )
    )

    # —— PRINCÍPIO ——
    story.append(Paragraph("20. Princípio de implementação", s["h1"]))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=0, spaceAfter=8))
    story.append(
        Paragraph(
            "Cada fase deve entregar <b>valor usável isolado</b> com feature flag, testes de "
            "regressão em OS/PCP/andamento, e script SQL em deploy/sql/. <b>Não iniciar a Fase 6</b> "
            "antes de haver roteiro + WIP + (no mínimo) estoque informativo e tempos iniciais — "
            "senão o motor otimiza dados fantasmas.",
            s["body"],
        )
    )
    story.append(Spacer(1, 1.2 * cm))
    story.append(
        HRFlowable(width="100%", thickness=1.5, color=NAVY, spaceBefore=4, spaceAfter=10)
    )
    story.append(
        Paragraph(
            "Fim do documento · SAGRA Web · Plano MES Produção Gráfica · Julho 2026",
            s["caption"],
        )
    )

    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    return OUT


if __name__ == "__main__":
    path = build()
    print(f"PDF gerado: {path}")
    print(f"Tamanho: {path.stat().st_size / 1024:.1f} KB")
