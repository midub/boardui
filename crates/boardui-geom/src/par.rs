//! Data parallelism: rayon on native targets, sequential on WebAssembly (single-threaded
//! in v1, see `docs/architecture.md`).

/// Maps `f` over `items` with their indices, in parallel where available. The result keeps
/// the order of `items`.
#[cfg(not(target_arch = "wasm32"))]
pub fn map<T, R>(items: &[T], f: impl Fn(usize, &T) -> R + Sync + Send) -> Vec<R>
where
    T: Sync,
    R: Send,
{
    use rayon::prelude::*;
    items.par_iter().enumerate().map(|(i, t)| f(i, t)).collect()
}

/// Maps `f` over `items` with their indices, in parallel where available. The result keeps
/// the order of `items`.
#[cfg(target_arch = "wasm32")]
pub fn map<T, R>(items: &[T], f: impl Fn(usize, &T) -> R + Sync + Send) -> Vec<R>
where
    T: Sync,
    R: Send,
{
    items.iter().enumerate().map(|(i, t)| f(i, t)).collect()
}
