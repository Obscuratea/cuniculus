"""Visualizer plugin discovery.

A plugin is a folder containing `plugin.json` and a GLSL fragment shader that
defines `void mainImage(out vec4 color, in vec2 fragCoord)`. See PLUGINS.md.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

BUILTIN_DIR = Path(__file__).resolve().parent.parent / "plugins"
USER_DIR = Path.home() / ".config" / "cuniculus" / "plugins"


@dataclass
class Plugin:
    id: str
    name: str
    author: str
    description: str
    shader: Path
    bloom: float = 0.8
    aberration: float = 1.0
    order: int = 100

    def source(self) -> str:
        return self.shader.read_text(encoding="utf-8")


def discover() -> list[Plugin]:
    found: dict[str, Plugin] = {}
    for root in (BUILTIN_DIR, USER_DIR):
        if not root.is_dir():
            continue
        for d in sorted(root.iterdir()):
            meta = d / "plugin.json"
            if not meta.is_file():
                continue
            try:
                m = json.loads(meta.read_text(encoding="utf-8"))
                shader = d / m.get("shader", "scene.frag")
                if not shader.is_file():
                    continue
                found[d.name] = Plugin(
                    id=d.name, name=str(m.get("name", d.name)),
                    author=str(m.get("author", "")),
                    description=str(m.get("description", "")), shader=shader,
                    bloom=float(m.get("bloom", 0.8)),
                    aberration=float(m.get("aberration", 1.0)),
                    order=int(m.get("order", 100)))
            except (OSError, ValueError) as e:
                print(f"cuniculus: skipping plugin {d}: {e}")
    return sorted(found.values(), key=lambda p: (p.order, p.name.lower()))
