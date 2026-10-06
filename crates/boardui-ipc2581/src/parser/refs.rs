//! Reference checks.
//!
//! A reference is checked when it is read. In a schema-ordered document its target is
//! already known, so the check is a lookup. Otherwise the reference is deferred and checked
//! again at the end of its scope (the step for packages, components, padstacks and pins, the
//! document for everything else); if it still does not resolve, a warning is recorded.

use std::io::BufRead;

use super::Parser;
use crate::{DiagnosticKind, Position, RefKind};

pub(super) struct Deferred {
    kind: RefKind,
    /// The component whose package must have pin `key`, for [`RefKind::Pin`].
    owner: Option<String>,
    key: String,
    position: Position,
}

fn step_scoped(kind: RefKind) -> bool {
    matches!(
        kind,
        RefKind::PadstackDef | RefKind::Package | RefKind::Component | RefKind::Pin
    )
}

impl<R: BufRead> Parser<R> {
    /// Checks a reference to a definition of `kind` from the current element.
    pub(super) fn check_ref(&mut self, kind: RefKind, key: &str) {
        self.check(kind, None, key);
    }

    /// Checks that the package of `component` has pin `pin`. Missing components or packages
    /// are reported by their own reference checks.
    pub(super) fn check_pin(&mut self, component: &str, pin: &str) {
        self.check(RefKind::Pin, Some(component), pin);
    }

    fn check(&mut self, kind: RefKind, owner: Option<&str>, key: &str) {
        if self.resolves(kind, owner, key) {
            return;
        }
        let deferred = Deferred {
            kind,
            owner: owner.map(str::to_owned),
            key: key.to_owned(),
            position: self.tag.position,
        };
        if step_scoped(kind) {
            self.step_refs.push(deferred);
        } else {
            self.global_refs.push(deferred);
        }
    }

    fn resolves(&self, kind: RefKind, owner: Option<&str>, key: &str) -> bool {
        let content = &self.content;
        match kind {
            RefKind::StandardPrimitive => content.standard_primitives.get(key).is_some(),
            RefKind::UserPrimitive => content.user_primitives.get(key).is_some(),
            RefKind::LineDesc => content.line_descs.get(key).is_some(),
            RefKind::FillDesc => content.fill_descs.get(key).is_some(),
            RefKind::Color => content.colors.get(key).is_some(),
            RefKind::Font => content.fonts.get(key).is_some(),
            RefKind::Layer => self.layers.get(key).is_some(),
            RefKind::LayerOrGroup => {
                self.layers.get(key).is_some()
                    || self
                        .stackups
                        .iter()
                        .flat_map(|s| &s.groups)
                        .any(|g| g.name == key)
            }
            RefKind::Step => self.steps.get(key).is_some(),
            RefKind::Spec => self.specs.get(key).is_some(),
            RefKind::PadstackDef => self.step.padstack_defs.get(key).is_some(),
            RefKind::Package => self.step.packages.get(key).is_some(),
            RefKind::Component => self.step.components.get(key).is_some(),
            RefKind::Pin => owner.is_none_or(|component| {
                let package = self
                    .step
                    .components
                    .get(component)
                    .and_then(|c| self.step.packages.get(&c.package_ref));
                package.is_none_or(|p| p.pins.get(key).is_some())
            }),
        }
    }

    /// Checks deferred references again and reports those that still do not resolve.
    ///
    /// Padstack references of a step without any `PadStackDef` are not reported: exports in
    /// `ASSEMBLY` mode name padstacks without defining them.
    pub(super) fn resolve_deferred(&mut self, deferred: Vec<Deferred>) {
        for d in deferred {
            let undefined_padstacks =
                d.kind == RefKind::PadstackDef && self.step.padstack_defs.is_empty();
            if undefined_padstacks || self.resolves(d.kind, d.owner.as_deref(), &d.key) {
                continue;
            }
            let key = match d.owner {
                Some(owner) => format!("{owner}/{}", d.key),
                None => d.key,
            };
            self.diagnostics.warn(
                DiagnosticKind::DanglingReference { kind: d.kind, key },
                d.position,
            );
        }
    }
}
