"""Scan codebase for SQL table references."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {"node_modules", ".git", "deploy/release/python_pkgs", "__pycache__", ".venv", "dist"}

TABLE_PATTERNS = [
    re.compile(r"\b(FROM|INTO|UPDATE|JOIN|TABLE)\s+[`'\"]?([a-zA-Z_][a-zA-Z0-9_]*)[`'\"]?", re.I),
    re.compile(r"\b(tab[A-Za-z0-9_]+|ct_[a-z_]+|xpose_[a-z_]+|user_[a-z_]+|ip_permissions|monitor_[a-z_]+|log_[a-z_]+|backup_[a-z_]+|cache_[a-z_]+|deleted_[a-z_]+)\b"),
]

EXTS = {".py", ".ts", ".tsx", ".js", ".sql", ".yaml", ".yml", ".cmd", ".bat"}


def should_skip(p: Path) -> bool:
    parts = set(p.parts)
    return any(s in parts for s in SKIP)


def scan():
    refs = {}
    for fp in ROOT.rglob("*"):
        if not fp.is_file() or should_skip(fp) or fp.suffix.lower() not in EXTS:
            continue
        try:
            text = fp.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        found = set()
        for pat in TABLE_PATTERNS:
            for m in pat.finditer(text):
                name = m.group(2) if m.lastindex and m.lastindex >= 2 else m.group(1)
                if name and len(name) > 2 and name.lower() not in ("select", "where", "set", "and", "or", "not", "null", "true", "false", "inner", "left", "right", "outer", "on", "as", "by", "order", "group", "limit", "values", "exists", "case", "when", "then", "else", "end", "if", "for", "def", "class", "return", "import", "from"):
                    found.add(name)
        if found:
            rel = str(fp.relative_to(ROOT))
            for t in found:
                refs.setdefault(t, []).append(rel)
    for t in refs:
        refs[t] = sorted(set(refs[t]))
    out = ROOT / "tools" / "_audit_code_refs.json"
    out.write_text(json.dumps(dict(sorted(refs.items(), key=lambda x: x[0].lower())), indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"OK: {len(refs)} table-like refs -> {out}")


if __name__ == "__main__":
    scan()
