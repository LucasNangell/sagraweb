import { Bold, Eraser, Italic, Strikethrough, Underline } from "lucide-react";

interface AnaliseFormattingToolbarProps {
  visible?: boolean;
}

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function AnaliseFormattingToolbar({ visible = true }: AnaliseFormattingToolbarProps) {
  if (!visible) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 rounded border border-slate-200 bg-slate-100 p-1.5">
      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200"
        title="Negrito"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec("bold")}
      >
        <Bold className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200"
        title="Itálico"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec("italic")}
      >
        <Italic className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200"
        title="Sublinhado"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec("underline")}
      >
        <Underline className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200"
        title="Tachado"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec("strikeThrough")}
      >
        <Strikethrough className="size-3.5" aria-hidden />
      </button>
      <span className="mx-1 h-5 w-px bg-slate-300" />
      <select
        className="h-7 rounded border border-slate-300 bg-white px-1 text-xs"
        defaultValue="Arial"
        title="Fonte"
        onChange={(e) => exec("fontName", e.target.value)}
      >
        <option value="Arial">Arial</option>
        <option value="Verdana">Verdana</option>
        <option value="Times New Roman">Times</option>
        <option value="Courier New">Courier</option>
      </select>
      <select
        className="h-7 rounded border border-slate-300 bg-white px-1 text-xs"
        defaultValue="3"
        title="Tamanho"
        onChange={(e) => exec("fontSize", e.target.value)}
      >
        {["1", "2", "3", "4", "5", "6", "7"].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <input
        type="color"
        defaultValue="#000000"
        className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
        title="Cor do texto"
        onChange={(e) => exec("foreColor", e.target.value)}
      />
      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200"
        title="Limpar formatação"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec("removeFormat")}
      >
        <Eraser className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
