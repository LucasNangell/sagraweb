#!/usr/bin/env python3
"""Gera PDF do relatório de dados ideais para o fluxo de produção SAGRA."""
from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUT = Path(__file__).resolve().parent / "Relatorio_Dados_Ideais_Fluxo_Producao.pdf"

NAVY = colors.HexColor("#0B1F33")
TEAL = colors.HexColor("#0E7490")
SLATE = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#CBD5E1")
ROW_ALT = colors.HexColor("#F1F5F9")
WHITE = colors.white
ACCENT = colors.HexColor("#0F766E")
WARN_BG = colors.HexColor("#FFFBEB")
WARN_FG = colors.HexColor("#92400E")
PAGE_W, PAGE_H = A4


def styles():
    base = getSampleStyleSheet()
    return {
        "cover_brand": ParagraphStyle(
            "cover_brand",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            textColor=TEAL,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=28,
            textColor=NAVY,
            alignment=TA_CENTER,
            spaceAfter=12,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            textColor=SLATE,
            alignment=TA_CENTER,
            spaceAfter=6,
        ),
        "cover_meta": ParagraphStyle(
            "cover_meta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=17,
            textColor=NAVY,
            spaceBefore=14,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=TEAL,
            spaceBefore=10,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            textColor=SLATE,
            alignment=TA_JUSTIFY,
            spaceAfter=7,
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
        "cell": ParagraphStyle(
            "cell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=11,
            textColor=SLATE,
        ),
        "cell_h": ParagraphStyle(
            "cell_h",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=11,
            textColor=WHITE,
        ),
        "callout": ParagraphStyle(
            "callout",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12.5,
            textColor=WARN_FG,
        ),
        "footer": ParagraphStyle(
            "footer",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "step_n": ParagraphStyle(
            "step_n",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            textColor=TEAL,
        ),
    }


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - 12 * mm, PAGE_W, 12 * mm, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(18 * mm, PAGE_H - 7.5 * mm, "SAGRA Web  ·  Câmara dos Deputados / SEFOC")
    canvas.drawRightString(PAGE_W - 18 * mm, PAGE_H - 7.5 * mm, "Fluxo de produção")
    canvas.setFillColor(LINE)
    canvas.rect(0, 0, PAGE_W, 12 * mm, fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(18 * mm, 5 * mm, "Guia de cadastro e operação — setembro/2026")
    canvas.drawRightString(PAGE_W - 18 * mm, 5 * mm, f"Página {doc.page}")
    canvas.restoreState()


def cover_header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - 28 * mm, PAGE_W, 28 * mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.rect(0, PAGE_H - 31 * mm, PAGE_W, 3 * mm, fill=1, stroke=0)
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, PAGE_W, 18 * mm, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(PAGE_W / 2, 8 * mm, "Documento interno  ·  não substitui o manual do sistema")
    canvas.restoreState()


def bullets(items, st):
    flow = []
    for t in items:
        flow.append(
            ListItem(Paragraph(t, st["bullet"]), leftIndent=12, bulletColor=TEAL, value="bullet")
        )
    return ListFlowable(
        flow,
        bulletType="bullet",
        start="•",
        leftIndent=16,
        bulletFontName="Helvetica",
        bulletFontSize=9,
        spaceAfter=8,
    )


def table_block(headers, rows, st, col_widths):
    head = [Paragraph(h, st["cell_h"]) for h in headers]
    data = [head]
    for row in rows:
        data.append([Paragraph(c, st["cell"]) for c in row])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.3, LINE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    t.setStyle(TableStyle(cmds))
    return t


def callout(text, st):
    inner = Paragraph(text, st["callout"])
    t = Table([[inner]], colWidths=[PAGE_W - 36 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WARN_BG),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#F59E0B")),
            ]
        )
    )
    return t


def numbered_steps(items, st):
    data = []
    for i, (title, body) in enumerate(items, 1):
        n = Paragraph(f"{i}.", st["step_n"])
        txt = Paragraph(f"<b>{title}</b> — {body}", st["body"])
        data.append([n, txt])
    t = Table(data, colWidths=[12 * mm, PAGE_W - 48 * mm])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return t


def build():
    st = styles()
    story = []

    story.append(Spacer(1, 42 * mm))
    story.append(Paragraph("SAGRA WEB  ·  SEFOC", st["cover_brand"]))
    story.append(HRFlowable(width="40%", thickness=1.5, color=TEAL, spaceAfter=16))
    story.append(
        Paragraph(
            "Dados ideais para o fluxo<br/>de produção funcionar",
            st["cover_title"],
        )
    )
    story.append(
        Paragraph(
            "Guia de cadastro e operação: o que registrar na OS e nos andamentos "
            "para prever término, identificar a etapa atual, recalcular após o "
            "retorno do cliente e, depois, organizar a fila entre setores.",
            st["cover_sub"],
        )
    )
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Setembro de 2026", st["cover_meta"]))
    story.append(Paragraph("Uso interno — implementação em andamento", st["cover_meta"]))
    story.append(PageBreak())

    story.append(Paragraph("Propósito deste documento", st["h1"]))
    story.append(
        Paragraph(
            "Este é um <b>guia de cadastro e operação</b>, não um pedido para "
            "implementar código agora. A recomendação é padronizar o que as pessoas "
            "registram; só então retomar o Gantt, a previsão viva e a fila entre setores.",
            st["body"],
        )
    )
    story.append(
        callout(
            "<b>Gargalo atual:</b> situação + setor + data/hora corretos em cada "
            "movimento. Sem isso, qualquer Gantt ou fila inteligente continua "
            "desenhando o roteiro, não o chão de fábrica. Não é necessário GPS, "
            "sensor de máquina nem apontamento minuto a minuto neste momento.",
            st,
        )
    )

    story.append(Paragraph("O que o fluxo precisa entregar", st["h1"]))
    story.append(
        bullets(
            [
                "<b>Previsão de conclusão</b> da OS (reprojetada quando o chão atrasa, adianta ou para).",
                "<b>Etapa atual</b> verdadeira (setor + passo em execução, ou “aguardando cliente”).",
                "<b>Recálculo ao retorno do cliente</b> (prova aprovada, arquivo devolvido ou fim de pendência).",
                "<b>Fila organizada por setor</b> (SEFOC, Gravação, SIELT/SEIMP, SEPAC, Expedição), "
                "para decidir o que fazer a seguir com o menor atraso global — um passo além do Gantt de uma OS.",
            ],
            st,
        )
    )
    story.append(
        Paragraph(
            "Hoje o protótipo deriva quase tudo de <b>andamentos</b> + <b>roteiro do produto</b>. "
            "Sem disciplina no lançamento, barras e horários ficam iguais, “estimados” ou "
            "desalinhados do histórico real.",
            st["body"],
        )
    )

    story.append(Paragraph("Cadeia de informação", st["h2"]))
    chain = [
        ["Entrada", "Resultado"],
        ["Cadastro da OS e roteiro", "Baseline de durações (previsto)"],
        ["Andamentos padronizados (Recebido / Saída p/)", "Início e fim reais por setor"],
        ["Pausa e retorno do cliente", "Reprojeção do término (ETA)"],
        ["ETA + realizado", "Gantt da OS"],
        ["Realizado + prazo + capacidade", "Fila por setor"],
    ]
    story.append(
        table_block(
            chain[0],
            chain[1:],
            st,
            [8.2 * cm, 8.2 * cm],
        )
    )

    story.append(Paragraph("O que o sistema já usa (não precisa reinventar)", st["h1"]))
    story.append(Paragraph("Já existe e deve ser <b>usado com rigor</b>:", st["body"]))
    story.append(
        bullets(
            [
                "<b>Produto, tiragem, páginas, formato, acabamento, máquina e prazo (EntregData)</b> na OS — alimentam a duração prevista.",
                "<b>Roteiro por produto</b> (passos: ordem, setor, setup, minutos por unidade/página/folha).",
                "<b>Andamentos</b> com data/hora, situação, setor e observação.",
                "Pares canônicos: <b>Recebido = início</b> da etapa no setor; <b>Saída p/ = fim</b> e passagem adiante.",
                "Pausa do cliente: <b>Aguard. Aprovação</b> e <b>Pendência Usuário</b> — esse tempo <b>não</b> conta como produção; ao voltar ao setor produtivo a previsão deve ser recalculada.",
                "<b>Calendário de expediente</b> (modelo 6h–22h, fim de semana e tabela de dias não úteis).",
                "<b>Aprendizado</b> só com OS a partir de <b>2024</b>.",
            ],
            st,
        )
    )
    story.append(
        Paragraph(
            "O que <b>ainda não existe</b> e a fila eficiente vai exigir depois: ocupação real "
            "da máquina/pessoa, apontamento “iniciei / pausei / concluí este passo”, e regras "
            "de prioridade da fila (prazo, setup, agrupamento).",
            st["body"],
        )
    )

    story.append(Paragraph("1. No cadastro da OS (antes de produzir)", st["h1"]))
    story.append(
        Paragraph(
            "Informações que tornam a <b>previsão inicial</b> confiável:",
            st["body"],
        )
    )
    story.append(
        table_block(
            ["Dado", "Por que importa", "Quem informa"],
            [
                ["Tipo de publicação (produto)", "Escolhe o roteiro de passos", "Atendimento / Gerência"],
                ["Tiragem, páginas, formato", "Fórmula de tempo (setup + volume)", "Atendimento"],
                [
                    "Acabamento explícito (refile, dobra, cola, etc.)",
                    "Cria etapas extras no Gantt",
                    "Atendimento",
                ],
                [
                    "Máquina / tecnologia (digital vs offset)",
                    "Roteiro SIELT vs SEIMP + gravação",
                    "PCP / Pré",
                ],
                [
                    "Prazo de entrega (EntregData) e prioridade",
                    "Comparar previsão × compromisso; ordenar fila",
                    "Atendimento",
                ],
                [
                    "Se haverá prova com o cliente",
                    "Insere etapa de espera e pausa previsível",
                    "Atendimento",
                ],
                [
                    "Se o produto não tem roteiro",
                    "Sistema cai em marcos genéricos; o correto é cadastrar passos no orçamento",
                    "Admin / PCP",
                ],
            ],
            st,
            [5.4 * cm, 6.4 * cm, 4.6 * cm],
        )
    )
    story.append(Spacer(1, 3 * mm))
    story.append(
        Paragraph(
            "<b>Função a acrescentar (cadastro):</b> garantir roteiro para todo produto ativo; "
            "avisar na OS “sem roteiro — previsão fraca”.",
            st["body"],
        )
    )

    story.append(Paragraph("2. Protocolo de andamento no chão", st["h1"]))
    story.append(
        Paragraph(
            "Obrigatório para o Gantt bater com a realidade. Sem este protocolo, início/fim "
            "nas colunas <b>não são os andamentos</b> — viram horários <i>previstos</i> concatenados.",
            st["body"],
        )
    )
    story.append(
        Paragraph(
            "Para <b>cada passagem</b> por um setor produtivo (SEFOC, SIELT, SEIMP, SEPAC, "
            "Gravação/SEGEP, Encadernação, SEDIR/Expedição):",
            st["body"],
        )
    )
    story.append(
        bullets(
            [
                "<b>Recebido</b> no setor, com <b>data e hora reais</b> (não só o dia). "
                "A hora na observação no padrão já usado (ex.: 16h40) deve coincidir com o fato.",
                "Trabalho interno (Em Execução, problemas técnicos, etc.) <b>entre</b> Recebido e Saída — o cronômetro da etapa continua.",
                "<b>Saída p/</b> no <b>setor de origem</b> quando o material sai, com data e hora reais.",
            ],
            st,
        )
    )
    story.append(Paragraph("Regras que evitam o gráfico “tudo igual / tudo estimado”:", st["h2"]))
    story.append(
        bullets(
            [
                "Não pular Recebido/Saída p/ “porque já foi para o próximo”. O sistema até infere etapas puladas como concluídas, mas <b>inventa horário</b> a partir do previsto.",
                "Um setor, um par aberto por vez. Retrabalho = novo Recebido depois do Saída p/ anterior.",
                "<b>Entregue</b> só no fim; fecha o que ainda estiver aberto. Não substitui os pares dos setores.",
                "Setores administrativos (SECOG, etc.) <b>fora</b> do eixo do Gantt — não misturar com início de produção.",
                "<b>Horário de Brasília</b> no lançamento: o fluxo trata os timestamps como horário local da gráfica.",
            ],
            st,
        )
    )
    story.append(
        Paragraph(
            "<b>Função a acrescentar (operação):</b> validar no lançamento “Saída sem Recebido neste setor” "
            "/ “Recebido duplicado aberto”; tela de setor com os dois botões canônicos (menos erro humano).",
            st["body"],
        )
    )

    story.append(Paragraph("3. Cliente: pausa e retorno", st["h1"]))
    story.append(
        Paragraph(
            "Para <b>congelar</b> a previsão e <b>reabrir</b> o relógio quando o arquivo volta para a gráfica:",
            st["body"],
        )
    )
    story.append(
        table_block(
            ["Evento", "Situação a lançar", "Efeito no fluxo"],
            [
                [
                    "Enviou prova / espera aprovação",
                    "Aguard. Aprovação",
                    "Pausa produtiva; Gantt hachurado; ETA adiada pelo tempo parado",
                ],
                [
                    "Falta arquivo, dúvida, correção do gabinete",
                    "Pendência Usuário",
                    "Idem",
                ],
                [
                    "Cliente devolveu arquivo / aprovou",
                    "<b>Recebido</b> de volta no setor produtivo (em geral SEFOC)",
                    "Fim da pausa; previsão = agora + restante das etapas",
                ],
            ],
            st,
            [5.2 * cm, 5.4 * cm, 5.8 * cm],
        )
    )
    story.append(Spacer(1, 3 * mm))
    story.append(
        Paragraph(
            "O que <b>não basta</b>: só mudar observação ou e-mail, sem andamento. O motor só vê a tabela de andamentos.",
            st["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>Função a acrescentar:</b> ao retomar, gravar “pausa durou X minutos úteis” e mostrar a nova previsão no cabeçalho.",
            st["body"],
        )
    )

    story.append(Paragraph("4. Etapa atual", st["h1"]))
    story.append(Paragraph("A etapa atual só é confiável se:", st["body"]))
    story.append(
        bullets(
            [
                "Existe <b>intervalo aberto</b>: último Recebido da OS em setor de produção <b>sem</b> Saída p/ correspondente; ou",
                "A última situação é pausa do cliente (etapa atual = a produtiva interrompida); ou",
                "Entregue → nenhuma etapa atual; status concluída.",
            ],
            st,
        )
    )
    story.append(
        Paragraph(
            "Se o último andamento for genérico (Em Execução sem Recebido) ou um salto de setor, "
            "o sistema chuta a etapa pelo roteiro.",
            st["body"],
        )
    )

    story.append(Paragraph("5. Calendário e capacidade (previsão + fila)", st["h1"]))
    story.append(Paragraph("Mínimo para previsão ao longo dos dias:", st["body"]))
    story.append(
        bullets(
            [
                "Manter <b>feriados e recessos</b> na tabela de calendário não útil.",
                "Confirmar expediente real (hoje 6h–22h no modelo). Se um setor fecha mais cedo, isso precisa ser cadastrado <b>por setor</b> — hoje é global.",
            ],
            st,
        )
    )
    story.append(
        Paragraph(
            "Para <b>fila eficiente entre todos os setores</b> (objetivo seguinte ao Gantt da OS):",
            st["body"],
        )
    )
    story.append(
        table_block(
            ["Dado", "Uso"],
            [
                [
                    "Quem está na fila de cada setor (Recebido sem Saída p/)",
                    "Lista “o que está na mesa agora”",
                ],
                ["Prazo e prioridade da OS", "Ordenar a fila"],
                ["Duração restante prevista do passo", "Saber se cabe no dia"],
                [
                    "Máquina / operador disponível (ainda não há apontamento)",
                    "Evitar duas OS na mesma impressora",
                ],
                ["Setup compartilhado (mesmo formato/papel)", "Agrupar para menos troca"],
                ["Retrabalho / volta de setor", "Recolocar na fila sem perder o histórico"],
            ],
            st,
            [8.2 * cm, 8.2 * cm],
        )
    )
    story.append(Spacer(1, 3 * mm))
    story.append(
        Paragraph(
            "<b>Função a acrescentar (fila):</b> painel por setor com ordenação (prazo, FIFO, agrupamento) "
            "e trava “só puxar a próxima da fila”. O Gantt de uma OS não substitui isso.",
            st["body"],
        )
    )

    story.append(Paragraph("6. Apontamento fino (opcional)", st["h1"]))
    story.append(
        Paragraph(
            "Enquanto só houver Recebido/Saída <b>por setor</b>, várias etapas do roteiro no mesmo "
            "setor (ex.: dois passos no SEPAC) <b>compartilham um único intervalo</b>. Por isso barras "
            "iguais e horários que não batem com “cada passo”.",
            st["body"],
        )
    )
    story.append(
        Paragraph(
            "Quando a operação estiver estável nos pares por setor, o passo seguinte é "
            "<b>apontamento por etapa</b>: Iniciar / Pausar / Concluir no passo (corte, refile, empacote…). "
            "Aí duração e posição no Gantt passam a ser medidas, não estimadas.",
            st["body"],
        )
    )

    story.append(Paragraph("7. Ordem sugerida", st["h1"]))
    story.append(
        Paragraph(
            "Primeiro a gráfica (e o uso do sistema); o software fino vem depois que os dados existirem.",
            st["body"],
        )
    )
    story.append(
        numbered_steps(
            [
                (
                    "Disciplina de andamento",
                    "Recebido / Saída p/ + pausas de cliente em todas as OS novas (o recorte de treino ≥ 2024 já está no código).",
                ),
                (
                    "Completar roteiros",
                    "Produto e acabamento; preencher feriados.",
                ),
                (
                    "Conferir 10–20 OS no Gantt",
                    "Se o rótulo “(est.)” sumir e início/fim baterem com o histórico, os dados estão maduros.",
                ),
                (
                    "Retomar o gráfico",
                    "Barras proporcionais ao tempo real; colunas Início/Fim = andamento, não só o previsto.",
                ),
                (
                    "Fila por setor",
                    "Com as OS que já seguem o protocolo.",
                ),
                (
                    "Apontamento por passo",
                    "Só se a fila e o Gantt ainda forem grossos demais.",
                ),
            ],
            st,
        )
    )

    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("O que não pedir agora", st["h1"]))
    story.append(
        Paragraph(
            "Não é necessário, neste momento, GPS, sensor de máquina ou apontamento minuto a minuto. "
            "O gargalo atual é <b>situação + setor + data/hora corretos</b> em cada movimento. "
            "Sem isso, qualquer Gantt ou fila inteligente continua desenhando o roteiro, não o chão.",
            st["body"],
        )
    )

    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=18 * mm,
        title="Dados ideais para o fluxo de produção — SAGRA",
        author="SAGRA Web / SEFOC",
        subject="Guia de cadastro e operação do fluxo de produção",
    )
    doc.build(story, onFirstPage=cover_header_footer, onLaterPages=header_footer)
    return OUT


if __name__ == "__main__":
    path = build()
    print(path)
