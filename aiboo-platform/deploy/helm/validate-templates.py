#!/usr/bin/env python3
"""
validate-templates.py — render + YAML-validate the Helm chart WITHOUT helm.

The sandbox/CI-light environment may not have helm. The chart deliberately
uses a constrained Go-template subset so this script can render it exactly:

    {{ .Values.a.b }}                     value substitution
    {{ .Values.x | quote }}               quote pipe (bools/enums)
    {{- if [not] .Values.a }} … {{- else }} … {{- end }}   conditionals

Any other construct fails validation — keeping the chart portable.

Usage: python3 validate-templates.py [chart_dir] [values_overrides...]
       overrides: dotted=path (e.g. auth.createSecret=true)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

TOKEN = re.compile(
    r"\{\{-?\s*(if\s+(not\s+)?([\w.]+)|else|end)\s*-?\}\}"
    r"|\{\{\s*([\w.]+)(\s*\|\s*quote)?\s*\}\}"
)


def lookup(ctx: dict, path: str):
    cur = ctx
    for part in path.lstrip(".").split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def render(text: str, ctx: dict) -> str:
    out, pos, stack = [], 0, []  # stack frames: [condition, emitting]
    for m in TOKEN.finditer(text):
        emitting = all(frame[1] for frame in stack)
        if emitting:
            out.append(text[pos:m.start()])
        pos = m.end()

        kw = m.group(1)
        if kw is None:  # value substitution
            if m.group(4) and not m.group(4).startswith("."):
                raise ValueError(f"non-value template call: {m.group(4)} (keep to the portable subset)")
            if not emitting:
                continue
            val = lookup(ctx, m.group(4))
            if val is None:
                raise ValueError(f"missing value path: {m.group(4)}")
            if m.group(5):  # | quote pipe
                if val is True:
                    out.append('"true"')
                elif val is False:
                    out.append('"false"')
                else:
                    out.append(f'"{val}"')
            else:
                out.append(str(val))
        elif kw.startswith("if"):
            negate = bool(m.group(2))
            val = lookup(ctx, m.group(3))
            truth = bool(val) and val not in ("", "false", "null")
            if negate:
                truth = not truth
            parent = all(f[1] for f in stack)
            stack.append([truth, truth and parent])
        elif kw == "else":
            if not stack:
                raise ValueError("{{- else }} without {{- if }}")
            stack[-1][1] = (not stack[-1][0]) and all(f[1] for f in stack[:-1])
        elif kw == "end":
            if not stack:
                raise ValueError("unbalanced {{- end }}")
            stack.pop()

    if stack:
        raise ValueError("unclosed {{- if }} block")
    out.append(text[pos:])
    return "".join(out)


def main() -> int:
    chart = Path(sys.argv[1] if len(sys.argv) > 1 else "aiboo")
    values = yaml.safe_load((chart / "values.yaml").read_text())
    for ov in sys.argv[2:]:
        key, _, raw = ov.partition("=")
        try:
            val = yaml.safe_load(raw)
        except yaml.YAMLError:
            val = raw
        tgt = values
        parts = key.split(".")
        for p in parts[:-1]:
            tgt = tgt.setdefault(p, {})
        tgt[parts[-1]] = val

    ctx = {
        "Values": values,
        "Release": {"Name": "aiboo-test", "Namespace": "default", "IsInstall": True, "IsUpgrade": False},
        "Chart": {"Name": "aiboo", "AppVersion": "1.0.0", "Version": "0.1.0"},
    }

    templates = sorted((chart / "templates").glob("*.yaml"))
    if not templates:
        print("no templates found"); return 1
    failures = 0
    for tpl in templates:
        try:
            rendered = render(tpl.read_text(), ctx)
            docs = [d for d in yaml.safe_load_all(rendered) if d is not None]
            kinds = [d.get("kind") for d in docs]
            print(f"OK   {tpl.name}: {', '.join(map(str, kinds)) or '(empty render)'}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {tpl.name}: {exc}")
    print(f"\n{len(templates) - failures}/{len(templates)} templates render + parse")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
