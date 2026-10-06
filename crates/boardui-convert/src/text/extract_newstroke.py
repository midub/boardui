#!/usr/bin/env python3
"""Extracts the bundled stroke font from KiCad's newstroke font.

Usage: extract_newstroke.py <kicad-source>/common/newstroke_font.cpp > newstroke.txt

Writes one line per glyph of U+0020-U+007E and U+00A0-U+00FF: the code point in hex, a space and
the glyph string as written in `newstroke_font.cpp` (see README.md for the format).
"""

import re
import sys

RANGES = [(0x20, 0x7E), (0xA0, 0xFF)]

source = open(sys.argv[1], encoding="utf-8").read()
start = source.index("newstroke_font[] =")
body = source[source.index("{", start) + 1 :]
body = body[: body.index("};")]
# The array is indexed by code point - 32; comments hold no string literals.
body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
glyphs = [
    s.encode("latin-1").decode("unicode_escape")
    for s in re.findall(r'"((?:[^"\\]|\\.)*)"', body)
]
for first, last in RANGES:
    for code in range(first, last + 1):
        glyph = glyphs[code - 32]
        assert len(glyph) % 2 == 0 and all(" " <= c <= "~" for c in glyph), hex(code)
        print(f"{code:04X} {glyph}")
