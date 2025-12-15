from fpdf import FPDF
import io

def generate_pdf():
    print("Starting PDF generation...")
    try:
        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()
        print("Page added.")
        
        # Cabeçalho
        pdf.set_font("Arial", "B", 16)
        pdf.cell(0, 10, f"Relatório Técnico - OS 6548/2025", ln=True, align="C")
        pdf.set_font("Arial", "", 12)
        pdf.cell(0, 10, "Titulo Exemplo", ln=True, align="C")
        pdf.line(10, 30, 200, 30)
        pdf.ln(10)
        
        # Mock Items
        items = [
            {
                "titulo": "Item 1",
                "html": "<p>Test paragraph.</p><b>Bold text</b>",
                "desconsiderado": False,
                "resolver": False,
                "obs": "Observation",
                "componenteOrigem": "Comp"
            }
        ]
        
        # Itens
        for idx, item in enumerate(items, start=1):
            # Título
            pdf.set_font("Arial", "B", 14)
            pdf.cell(0, 10, f"{idx}. {item['titulo']}", ln=True)
            
            # HTML Evidence
            if item.get('html'):
                try:
                    print(f"Writing HTML: {item['html']}")
                    pdf.write_html(item['html'])
                    print("HTML written.")
                except Exception as e:
                    print(f"Error writing HTML: {e}")
                    raise e

        # Output
        buffer = io.BytesIO()
        pdf.output(buffer)
        print("PDF Output successful.")

    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    generate_pdf()
