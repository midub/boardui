//! Shapes, descriptors, paths and placement.

use std::io::BufRead;

use super::{Parser, missing_element};
use crate::{
    Arc, ButterflyShape, Contour, Corners, DiagnosticKind, Error, ErrorKind, FillDesc, FillStyle,
    Line, LineDesc, LineStyle, Outline, Path, Point, PolyStep, Position, Polygon, Polyline, PrimitiveKind,
    RefKind, Shape, StandardPrimitive, Xform,
};

/// Deepest `UserSpecial` nesting accepted.
const MAX_NESTING: usize = 32;

/// Elements read as standard primitives.
const PRIMITIVES: [&str; 14] = [
    "Butterfly",
    "Circle",
    "Contour",
    "Diamond",
    "Donut",
    "Ellipse",
    "Octagon",
    "Oval",
    "RectCenter",
    "RectCham",
    "RectCorner",
    "RectRound",
    "Thermal",
    "Triangle",
];

/// A path being read.
#[derive(Default)]
pub(super) struct PathBuilder {
    start: Option<Point>,
    steps: Vec<PolyStep>,
}

/// The stroke an element requires.
fn required_line(
    element: &str,
    line: Option<LineStyle>,
    position: Position,
) -> Result<LineStyle, Error> {
    line.ok_or_else(|| missing_element(element, "`LineDesc` or `LineDescRef`", position))
}

impl PathBuilder {
    fn finish(self, element: &str, position: Position) -> Result<Path, Error> {
        let start = self
            .start
            .ok_or_else(|| missing_element(element, "`PolyBegin`", position))?;
        Ok(Path {
            start,
            steps: self.steps,
        })
    }
}

impl<R: BufRead> Parser<R> {
    /// Reads the current element as a shape. Elements that are not shapes the reader knows
    /// become [`Shape::Unsupported`].
    pub(super) fn read_shape(&mut self) -> Result<Shape, Error> {
        Ok(match self.tag.name() {
            "StandardPrimitiveRef" => Shape::StandardRef(self.read_ref(
                "StandardPrimitiveRef",
                "id",
                RefKind::StandardPrimitive,
            )?),
            "UserPrimitiveRef" => Shape::UserRef(self.read_ref(
                "UserPrimitiveRef",
                "id",
                RefKind::UserPrimitive,
            )?),
            "Line" => Shape::Line(self.read_line()?),
            "Arc" => Shape::Arc(self.read_arc()?),
            "Polyline" => Shape::Polyline(self.read_polyline()?),
            "Polygon" => Shape::Polygon(self.read_polygon()?),
            "Outline" => Shape::Outline(self.read_outline()?),
            "UserSpecial" => Shape::UserSpecial(self.read_user_special()?),
            name if PRIMITIVES.contains(&name) => Shape::Standard(self.read_standard_primitive()?),
            _ => Shape::Unsupported {
                element: self.unsupported()?,
            },
        })
    }

    /// Reports the current element as an unsupported shape, skips it and returns its name.
    fn unsupported(&mut self) -> Result<String, Error> {
        let element = self.tag.name().to_owned();
        self.warn(DiagnosticKind::UnsupportedShape {
            element: element.clone(),
        });
        self.skip()?;
        Ok(element)
    }

    fn read_user_special(&mut self) -> Result<Vec<Shape>, Error> {
        if self.nesting == MAX_NESTING {
            return Err(Error::new(
                ErrorKind::NestingTooDeep {
                    element: "UserSpecial".to_owned(),
                    limit: MAX_NESTING,
                },
                self.tag.position,
            ));
        }
        self.nesting += 1;
        let mut shapes = Vec::new();
        let result = self.children("UserSpecial", |p| {
            shapes.push(p.read_shape()?);
            Ok(())
        });
        self.nesting -= 1;
        result.map(|()| shapes)
    }

    /// Reads the current element as a standard primitive. Unknown elements become
    /// [`PrimitiveKind::Unsupported`].
    pub(super) fn read_standard_primitive(&mut self) -> Result<StandardPrimitive, Error> {
        let (element, kind) = match self.tag.name() {
            "Circle" => (
                "Circle",
                PrimitiveKind::Circle {
                    diameter: self.req_len("diameter")?,
                },
            ),
            "RectCenter" => (
                "RectCenter",
                PrimitiveKind::RectCenter {
                    width: self.req_len("width")?,
                    height: self.req_len("height")?,
                },
            ),
            "RectCorner" => (
                "RectCorner",
                PrimitiveKind::RectCorner {
                    lower_left: self.point("lowerLeftX", "lowerLeftY")?,
                    upper_right: self.point("upperRightX", "upperRightY")?,
                },
            ),
            "RectRound" => (
                "RectRound",
                PrimitiveKind::RectRound {
                    width: self.req_len("width")?,
                    height: self.req_len("height")?,
                    radius: self.req_len("radius")?,
                    corners: self.corners()?,
                },
            ),
            "RectCham" => (
                "RectCham",
                PrimitiveKind::RectCham {
                    width: self.req_len("width")?,
                    height: self.req_len("height")?,
                    chamfer: self.req_len("chamfer")?,
                    corners: self.corners()?,
                },
            ),
            "Oval" => (
                "Oval",
                PrimitiveKind::Oval {
                    width: self.req_len("width")?,
                    height: self.req_len("height")?,
                },
            ),
            "Ellipse" => (
                "Ellipse",
                PrimitiveKind::Ellipse {
                    width: self.req_len("width")?,
                    height: self.req_len("height")?,
                },
            ),
            "Diamond" => (
                "Diamond",
                PrimitiveKind::Diamond {
                    width: self.req_len("width")?,
                    height: self.req_len("height")?,
                },
            ),
            "Octagon" => (
                "Octagon",
                PrimitiveKind::Octagon {
                    length: self.req_len("length")?,
                },
            ),
            "Triangle" => (
                "Triangle",
                PrimitiveKind::Triangle {
                    base: self.req_len("base")?,
                    height: self.req_len("height")?,
                },
            ),
            "Donut" => (
                "Donut",
                PrimitiveKind::Donut {
                    shape: self.req_enum("shape")?,
                    outer_diameter: self.req_len("outerDiameter")?,
                    inner_diameter: self.req_len("innerDiameter")?,
                },
            ),
            "Thermal" => (
                "Thermal",
                PrimitiveKind::Thermal {
                    shape: self.req_enum("shape")?,
                    outer_diameter: self.req_len("outerDiameter")?,
                    inner_diameter: self.req_len("innerDiameter")?,
                    spoke_count: self.opt_u32("spokeCount")?,
                    gap: self.opt_len("gap")?,
                    spoke_start_angle: self.opt_f64("spokeStartAngle")?,
                },
            ),
            "Butterfly" => {
                let shape = self.req_enum("shape")?;
                let size = match shape {
                    ButterflyShape::Round => self.req_len("diameter")?,
                    ButterflyShape::Square => self.req_len("side")?,
                };
                ("Butterfly", PrimitiveKind::Butterfly { shape, size })
            }
            "Contour" => {
                return Ok(StandardPrimitive {
                    kind: PrimitiveKind::Contour(self.read_contour("Contour")?),
                    line: None,
                    fill: None,
                });
            }
            _ => {
                return Ok(StandardPrimitive {
                    kind: PrimitiveKind::Unsupported {
                        element: self.unsupported()?,
                    },
                    line: None,
                    fill: None,
                });
            }
        };
        let (mut line, mut fill) = (None, None);
        self.children(element, |p| {
            if p.line_style(element, &mut line)? || p.fill_style(element, &mut fill)? {
                Ok(())
            } else {
                p.unknown(element)
            }
        })?;
        Ok(StandardPrimitive { kind, line, fill })
    }

    /// Corner flags of `RectRound` and `RectCham`; absent flags are `true`.
    fn corners(&mut self) -> Result<Corners, Error> {
        Ok(Corners {
            upper_right: self.opt_bool("upperRight")?.unwrap_or(true),
            upper_left: self.opt_bool("upperLeft")?.unwrap_or(true),
            lower_right: self.opt_bool("lowerRight")?.unwrap_or(true),
            lower_left: self.opt_bool("lowerLeft")?.unwrap_or(true),
        })
    }

    /// A point from two required length attributes.
    pub(super) fn point(&mut self, x: &str, y: &str) -> Result<Point, Error> {
        Ok(Point {
            x: self.req_len(x)?,
            y: self.req_len(y)?,
        })
    }

    /// Reads an element whose only content is an `x`, `y` point, such as `Location`.
    pub(super) fn read_point(&mut self, element: &'static str) -> Result<Point, Error> {
        let point = self.point("x", "y")?;
        self.leaf(element)?;
        Ok(point)
    }

    fn read_xform(&mut self) -> Result<Xform, Error> {
        let xform = Xform {
            offset: Point {
                x: self.opt_len("xOffset")?.unwrap_or(0.0),
                y: self.opt_len("yOffset")?.unwrap_or(0.0),
            },
            rotation: self.opt_f64("rotation")?.unwrap_or(0.0),
            mirror: self.opt_bool("mirror")?.unwrap_or(false),
            scale: self.opt_f64("scale")?.unwrap_or(1.0),
        };
        self.leaf("Xform")?;
        Ok(xform)
    }

    /// Handles a `Location` or `Xform` child. Returns `false` for other elements.
    pub(super) fn placement(
        &mut self,
        parent: &'static str,
        location: &mut Option<Point>,
        xform: &mut Option<Xform>,
    ) -> Result<bool, Error> {
        match self.tag.name() {
            "Location" if location.is_some() => self.duplicate(parent)?,
            "Location" => *location = Some(self.read_point("Location")?),
            "Xform" if xform.is_some() => self.duplicate(parent)?,
            "Xform" => *xform = Some(self.read_xform()?),
            _ => return Ok(false),
        }
        Ok(true)
    }

    /// Reads the current element into a shape slot. A known shape replaces an unsupported one;
    /// any other repetition is reported and skipped.
    pub(super) fn shape_slot(
        &mut self,
        parent: &'static str,
        slot: &mut Option<Shape>,
    ) -> Result<(), Error> {
        if slot
            .as_ref()
            .is_some_and(|s| !matches!(s, Shape::Unsupported { .. }))
        {
            return self.duplicate(parent);
        }
        let shape = self.read_shape()?;
        if slot.is_none() || !matches!(shape, Shape::Unsupported { .. }) {
            *slot = Some(shape);
        }
        Ok(())
    }

    /// Handles a `LineDesc` or `LineDescRef` child. Returns `false` for other elements.
    fn line_style(
        &mut self,
        parent: &'static str,
        slot: &mut Option<LineStyle>,
    ) -> Result<bool, Error> {
        match self.tag.name() {
            "LineDesc" | "LineDescRef" if slot.is_some() => self.duplicate(parent)?,
            "LineDesc" => *slot = Some(LineStyle::Desc(self.read_line_desc()?)),
            "LineDescRef" => {
                *slot = Some(LineStyle::Ref(self.read_ref(
                    "LineDescRef",
                    "id",
                    RefKind::LineDesc,
                )?));
            }
            _ => return Ok(false),
        }
        Ok(true)
    }

    /// Handles a `FillDesc` or `FillDescRef` child. Returns `false` for other elements.
    fn fill_style(
        &mut self,
        parent: &'static str,
        slot: &mut Option<FillStyle>,
    ) -> Result<bool, Error> {
        match self.tag.name() {
            "FillDesc" | "FillDescRef" if slot.is_some() => self.duplicate(parent)?,
            "FillDesc" => *slot = Some(FillStyle::Desc(self.read_fill_desc()?)),
            "FillDescRef" => {
                *slot = Some(FillStyle::Ref(self.read_ref(
                    "FillDescRef",
                    "id",
                    RefKind::FillDesc,
                )?));
            }
            _ => return Ok(false),
        }
        Ok(true)
    }

    pub(super) fn read_line_desc(&mut self) -> Result<LineDesc, Error> {
        let desc = LineDesc {
            width: self.req_len("lineWidth")?,
            end: self.req_enum("lineEnd")?,
        };
        self.leaf("LineDesc")?;
        Ok(desc)
    }

    pub(super) fn read_fill_desc(&mut self) -> Result<FillDesc, Error> {
        let desc = FillDesc {
            property: self.req_enum("fillProperty")?,
            line_width: self.opt_len("lineWidth")?,
            pitch1: self.opt_len("pitch1")?,
            pitch2: self.opt_len("pitch2")?,
            angle1: self.opt_f64("angle1")?,
            angle2: self.opt_f64("angle2")?,
        };
        self.leaf("FillDesc")?;
        Ok(desc)
    }

    fn read_line(&mut self) -> Result<Line, Error> {
        let position = self.tag.position;
        let start = self.point("startX", "startY")?;
        let end = self.point("endX", "endY")?;
        let mut line = None;
        self.children("Line", |p| {
            if p.line_style("Line", &mut line)? {
                Ok(())
            } else {
                p.unknown("Line")
            }
        })?;
        Ok(Line {
            start,
            end,
            line: required_line("Line", line, position)?,
        })
    }

    fn read_arc(&mut self) -> Result<Arc, Error> {
        let position = self.tag.position;
        let start = self.point("startX", "startY")?;
        let end = self.point("endX", "endY")?;
        let center = self.point("centerX", "centerY")?;
        let clockwise = self.req_bool("clockwise")?;
        let mut line = None;
        self.children("Arc", |p| {
            if p.line_style("Arc", &mut line)? {
                Ok(())
            } else {
                p.unknown("Arc")
            }
        })?;
        Ok(Arc {
            start,
            end,
            center,
            clockwise,
            line: required_line("Arc", line, position)?,
        })
    }

    /// Handles a `PolyBegin`, `PolyStepSegment` or `PolyStepCurve` child. Returns `false` for
    /// other elements.
    fn path_step(&mut self, parent: &'static str, path: &mut PathBuilder) -> Result<bool, Error> {
        match self.tag.name() {
            "PolyBegin" if path.start.is_some() => self.duplicate(parent)?,
            "PolyBegin" => path.start = Some(self.read_point("PolyBegin")?),
            "PolyStepSegment" | "PolyStepCurve" if path.start.is_none() => {
                return Err(missing_element(
                    parent,
                    "`PolyBegin` before its first step",
                    self.tag.position,
                ));
            }
            "PolyStepSegment" => {
                let to = self.read_point("PolyStepSegment")?;
                path.steps.push(PolyStep::Segment { to });
            }
            "PolyStepCurve" => {
                let to = self.point("x", "y")?;
                let center = self.point("centerX", "centerY")?;
                let clockwise = self.req_bool("clockwise")?;
                self.leaf("PolyStepCurve")?;
                path.steps.push(PolyStep::Curve {
                    to,
                    center,
                    clockwise,
                });
            }
            _ => return Ok(false),
        }
        Ok(true)
    }

    /// Reads an element that holds only a path, such as `Cutout`.
    fn read_path(&mut self, element: &'static str) -> Result<Path, Error> {
        let position = self.tag.position;
        let mut path = PathBuilder::default();
        self.children(element, |p| {
            if p.path_step(element, &mut path)? {
                Ok(())
            } else {
                p.unknown(element)
            }
        })?;
        path.finish(element, position)
    }

    fn read_polyline(&mut self) -> Result<Polyline, Error> {
        let position = self.tag.position;
        let mut path = PathBuilder::default();
        let mut line = None;
        self.children("Polyline", |p| {
            if p.path_step("Polyline", &mut path)? || p.line_style("Polyline", &mut line)? {
                Ok(())
            } else {
                p.unknown("Polyline")
            }
        })?;
        Ok(Polyline {
            path: path.finish("Polyline", position)?,
            line: required_line("Polyline", line, position)?,
        })
    }

    fn read_polygon(&mut self) -> Result<Polygon, Error> {
        let position = self.tag.position;
        let mut path = PathBuilder::default();
        let (mut line, mut fill) = (None, None);
        self.children("Polygon", |p| {
            if p.path_step("Polygon", &mut path)?
                || p.line_style("Polygon", &mut line)?
                || p.fill_style("Polygon", &mut fill)?
            {
                Ok(())
            } else {
                p.unknown("Polygon")
            }
        })?;
        Ok(Polygon {
            path: path.finish("Polygon", position)?,
            line,
            fill,
        })
    }

    pub(super) fn read_outline(&mut self) -> Result<Outline, Error> {
        let position = self.tag.position;
        let (mut polygon, mut line) = (None, None);
        self.children("Outline", |p| {
            if p.line_style("Outline", &mut line)? {
                return Ok(());
            }
            match p.tag.name() {
                "Polygon" if polygon.is_some() => p.duplicate("Outline"),
                "Polygon" => {
                    polygon = Some(p.read_polygon()?);
                    Ok(())
                }
                _ => p.unknown("Outline"),
            }
        })?;
        Ok(Outline {
            polygon: polygon.ok_or_else(|| missing_element("Outline", "`Polygon`", position))?,
            line: required_line("Outline", line, position)?,
        })
    }

    /// Reads a `Contour` or a step `Profile`: a `Polygon` and `Cutout`s.
    pub(super) fn read_contour(&mut self, element: &'static str) -> Result<Contour, Error> {
        let position = self.tag.position;
        let mut polygon = None;
        let mut cutouts = Vec::new();
        self.children(element, |p| match p.tag.name() {
            "Polygon" if polygon.is_some() => p.duplicate(element),
            "Polygon" => {
                polygon = Some(p.read_polygon()?);
                Ok(())
            }
            "Cutout" => {
                cutouts.push(p.read_path("Cutout")?);
                Ok(())
            }
            _ => p.unknown(element),
        })?;
        Ok(Contour {
            polygon: polygon.ok_or_else(|| missing_element(element, "`Polygon`", position))?,
            cutouts,
        })
    }
}
