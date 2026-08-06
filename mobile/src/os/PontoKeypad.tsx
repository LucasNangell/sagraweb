import { Delete } from "lucide-react";

interface PontoKeypadProps {
  value: string;
  onChange: (digits: string) => void;
  maxLen?: number;
}

export function PontoKeypad({ value, onChange, maxLen = 8 }: PontoKeypadProps) {
  function press(digit: string) {
    if (value.length >= maxLen) return;
    onChange(value + digit);
  }

  function backspace() {
    onChange(value.slice(0, -1));
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="ponto-keypad">
      <div className="ponto-display">{value || "—"}</div>
      <div className="ponto-keys">
        {keys.map((k, i) => {
          if (k === "") return <div key={`e-${i}`} />;
          if (k === "⌫") {
            return (
              <button
                key="bk"
                type="button"
                className="ponto-key"
                onClick={backspace}
                aria-label="Apagar"
              >
                <Delete size={22} />
              </button>
            );
          }
          return (
            <button
              key={k}
              type="button"
              className="ponto-key"
              onClick={() => press(k)}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}
