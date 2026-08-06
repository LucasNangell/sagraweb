"""
Funções auxiliares para formatação de observações de andamentos
"""
from datetime import datetime

def format_andamento_obs(obs_text: str) -> str:
    """
    Formata observação de andamento no padrão: HHhMM\nTexto
    Preserva quebras de linha do texto original
    
    Args:
        obs_text: Texto da observação fornecido pelo usuário
        
    Returns:
        String formatada: "HHhMM\n<texto_com_quebras_de_linha>"
    """
    if not obs_text:
        obs_text = ""
    
    # Obter hora atual
    now = datetime.now()
    hora_formatada = f"{now.hour:02d}h{now.minute:02d}"
    
    # Retornar com quebra de linha após hora
    # Importante: preservar quebras de linha do texto original
    return f"{hora_formatada}\n{obs_text}"


def format_ponto(ponto: str) -> str:
    """
    Formata número de ponto no padrão #.#00 (pontos a cada 3 dígitos da direita para esquerda)
    
    Exemplos:
        918713 -> 918.713
        12345 -> 12.345
        123 -> 123
        1234567 -> 1.234.567
    
    Args:
        ponto: String ou número do ponto (pode conter ou não pontos)
        
    Returns:
        String formatada com pontos a cada 3 dígitos
    """
    if not ponto:
        return ""
    
    # Converter para string e remover caracteres não numéricos
    ponto_str = str(ponto).strip()
    ponto_limpo = ''.join(filter(str.isdigit, ponto_str))
    
    if not ponto_limpo:
        return ""
    
    # Aplicar formatação: pontos a cada 3 dígitos da direita para esquerda
    # Reverter string, adicionar pontos, reverter novamente
    reversed_ponto = ponto_limpo[::-1]
    chunks = [reversed_ponto[i:i+3] for i in range(0, len(reversed_ponto), 3)]
    formatted_reversed = '.'.join(chunks)
    formatted_ponto = formatted_reversed[::-1]
    
    return formatted_ponto


def preserve_line_breaks(text: str) -> str:
    """
    Garante que quebras de linha sejam preservadas
    Converte \r\n para \n se necessário
    
    Args:
        text: Texto que pode conter diferentes tipos de quebra de linha
        
    Returns:
        Texto normalizado com \n
    """
    if not text:
        return ""
    
    # Normalizar quebras de linha
    return text.replace('\r\n', '\n').replace('\r', '\n')


def format_gravacao_pendente_obs(
    chapas: list[dict],
    user_obs: str = "",
) -> str:
    """Monta bloco estruturado para observação de Gravação Pendente."""
    lines: list[str] = ["Chapas por máquina:"]
    if chapas:
        for ch in chapas:
            maquina = str(ch.get("maquina") or "").strip()
            qty = ch.get("quantidade", ch.get("quantidade_chapas", 0))
            lines.append(f"- {maquina}: {qty}")
    else:
        lines.append("- (não informado)")
    extra = preserve_line_breaks(str(user_obs or "").strip())
    if extra:
        lines.append("")
        lines.append(extra)
    return "\n".join(lines)


def format_gravacao_concluida_obs(chapas: list[dict]) -> str:
    """Monta bloco de observação para andamento Aguard. Retirada após concluir gravação."""
    lines: list[str] = [
        "Gravação concluída. Aguardando retirada de:",
        "",
        "Chapas por máquina:",
    ]
    for ch in chapas:
        maquina = str(ch.get("maquina") or "").strip()
        qty = ch.get("quantidade", ch.get("quantidade_chapas", 0))
        lines.append(f"- {maquina}: {qty}")
    if not chapas:
        lines.append("- (não informado)")
    return "\n".join(lines)


def format_gravacao_entrega_obs(chapas: list[dict]) -> str:
    """Monta bloco de observação para andamento Recebido ao lançar entrega de chapas."""
    lines: list[str] = ["Entrega de chapas.", "", "Chapas por máquina:"]
    for ch in chapas:
        maquina = str(ch.get("maquina") or "").strip()
        qty = ch.get("quantidade", ch.get("quantidade_chapas", 0))
        lines.append(f"- {maquina}: {qty}")
    if not chapas:
        lines.append("- (não informado)")
    return "\n".join(lines)
