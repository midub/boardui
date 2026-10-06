# Bundled stroke font

`newstroke.txt` is the font the converter draws IPC-2581 `Text` with when the file has no
embedded glyph for a character (spec §6.1).

## Source and licence

The glyphs are a subset of **Newstroke**, the stroke font of KiCad, by Vladimir Uryvaev
(<http://vovanium.ru/sledy/newstroke>). Newstroke was released under **CC0 1.0** ("Released
under CC0 licence.", `tools/newstroke/obsolete/README-old.txt` in the KiCad source). KiCad
later added CJK glyphs under MIT and SIL OFL 1.1 terms; none of those are included here.

Only U+0020–U+007E (ASCII) and U+00A0–U+00FF (Latin-1) are included: 191 glyphs, about 6 KB.

## Regenerating

```sh
python3 extract_newstroke.py <kicad-source>/common/newstroke_font.cpp > newstroke.txt
```

## Format

One glyph per line: the code point in hex, a space, and the glyph string as written in KiCad's
`newstroke_font.cpp`. Each pair of characters is one value pair, each character encoding the
number `c - 'R'`:

- the first pair is the glyph's left and right bound; the advance is their difference;
- `" R"` lifts the pen, starting a new stroke;
- every other pair is a point `x, y` of the current stroke, with Y pointing down.

The baseline is at `y = 9`, capitals are 21 units tall (`y = -12` to `9`) and descenders reach
`y = 16`.
