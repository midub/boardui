//! The bundled stroke font, for `Text` without embedded glyphs (spec §6.6). See `README.md`
//! for its source, licence and format.

use std::collections::HashMap;
use std::sync::OnceLock;

use boardui_geom::DVec2;

/// Height of capitals, in font units.
pub const CAP_HEIGHT: f64 = 21.0;

/// Depth of descenders below the baseline, in font units. The font's cell, which a `Text`'s
/// bounding box is fitted to, reaches from the descenders to the top of the capitals.
pub const DESCENT: f64 = 7.0;

/// Stroke width of text without a `LineDesc`, as a fraction of the cap height.
pub const STROKE_WIDTH: f64 = 0.15;

/// Baseline of the glyph strings, in their Y-down coordinates.
const BASELINE: f64 = 9.0;

/// A glyph: polylines in font units, Y up, with the baseline at `y = 0` and the glyph's left
/// bound at `x = 0`.
#[derive(Debug)]
pub struct StrokeGlyph {
    /// Distance to the next glyph.
    pub advance: f64,
    /// Strokes, each with at least two points.
    pub strokes: Vec<Vec<DVec2>>,
}

/// The bundled font: ASCII and Latin-1 of KiCad's Newstroke.
#[derive(Debug)]
pub struct StrokeFont {
    glyphs: HashMap<char, StrokeGlyph>,
    missing: StrokeGlyph,
}

impl StrokeFont {
    /// The font, decoded on first use.
    pub fn get() -> &'static Self {
        static FONT: OnceLock<StrokeFont> = OnceLock::new();
        FONT.get_or_init(|| Self::parse(include_str!("newstroke.txt")))
    }

    fn parse(data: &str) -> Self {
        let glyphs = data
            .lines()
            .filter_map(|line| {
                let (code, glyph) = line.split_once(' ')?;
                let c = char::from_u32(u32::from_str_radix(code, 16).ok()?)?;
                Some((c, decode(glyph)?))
            })
            .collect();
        // A box the size of a capital, for characters without a glyph.
        let corners = [
            (3.0, 0.0),
            (13.0, 0.0),
            (13.0, 21.0),
            (3.0, 21.0),
            (3.0, 0.0),
        ];
        let missing = StrokeGlyph {
            advance: 16.0,
            strokes: vec![corners.iter().map(|&(x, y)| DVec2::new(x, y)).collect()],
        };
        Self { glyphs, missing }
    }

    /// The glyph of a character. Whitespace has the glyph of a space.
    pub fn glyph(&self, c: char) -> Option<&StrokeGlyph> {
        self.glyphs.get(if c.is_whitespace() { &' ' } else { &c })
    }

    /// The glyph drawn for characters the font doesn't have: a box.
    pub fn missing(&self) -> &StrokeGlyph {
        &self.missing
    }
}

/// Decodes a glyph string (see `README.md`).
fn decode(glyph: &str) -> Option<StrokeGlyph> {
    let value = |c: u8| f64::from(c) - f64::from(b'R');
    let bytes = glyph.as_bytes();
    let (bounds, pairs) = bytes.split_first_chunk::<2>()?;
    let left = value(bounds[0]);
    let mut strokes: Vec<Vec<DVec2>> = vec![Vec::new()];
    for pair in pairs.chunks_exact(2) {
        if pair == b" R" {
            strokes.push(Vec::new());
        } else if let Some(stroke) = strokes.last_mut() {
            stroke.push(DVec2::new(value(pair[0]) - left, BASELINE - value(pair[1])));
        }
    }
    strokes.retain(|s| s.len() > 1);
    Some(StrokeGlyph {
        advance: value(bounds[1]) - left,
        strokes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_ascii_and_latin1() {
        let font = StrokeFont::get();
        for c in (' '..='~').chain('\u{A0}'..='\u{FF}') {
            assert!(font.glyph(c).is_some(), "{c:?}");
        }
        assert!(font.glyph('\u{7F}').is_none());
        assert!(font.glyph('Ω').is_none());
        assert_eq!(
            font.glyph('\t').unwrap().advance,
            font.glyph(' ').unwrap().advance
        );
        assert!(font.glyph(' ').unwrap().strokes.is_empty());
    }

    #[test]
    fn glyphs_sit_on_the_baseline() {
        let font = StrokeFont::get();
        let extent = |c: char| {
            let points = font.glyph(c).unwrap().strokes.concat();
            let ys = points.iter().map(|p| p.y);
            (
                ys.clone().fold(f64::MAX, f64::min),
                ys.fold(f64::MIN, f64::max),
            )
        };
        assert_eq!(extent('H'), (0.0, CAP_HEIGHT));
        assert_eq!(extent('g').0, -DESCENT);
        assert!(extent('É').1 > CAP_HEIGHT);
        // `H`: two stems and a bar, inside its advance.
        let h = font.glyph('H').unwrap();
        assert_eq!(h.strokes.len(), 3);
        assert_eq!(h.advance, 22.0);
        assert!(
            h.strokes
                .concat()
                .iter()
                .all(|p| (0.0..=22.0).contains(&p.x))
        );
    }
}
