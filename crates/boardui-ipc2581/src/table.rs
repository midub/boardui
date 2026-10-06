use std::collections::HashMap;

/// An ordered collection of definitions with lookup by key (id or name).
///
/// Entries keep document order. If two entries share a key, both are kept, [`get`](Self::get)
/// returns the first, and the parser records a
/// [`DuplicateKey`](crate::DiagnosticKind::DuplicateKey) warning.
#[derive(Debug, Clone, PartialEq)]
pub struct Table<T> {
    entries: Vec<(String, T)>,
    index: HashMap<String, usize>,
}

impl<T> Default for Table<T> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            index: HashMap::new(),
        }
    }
}

impl<T> Table<T> {
    /// Returns the first entry with the given key.
    pub fn get(&self, key: &str) -> Option<&T> {
        self.index.get(key).map(|&i| &self.entries[i].1)
    }

    /// Returns the number of entries, including entries with duplicate keys.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Returns `true` if there are no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Iterates over keys and entries in document order.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = (&str, &T)> {
        self.entries.iter().map(|(k, v)| (k.as_str(), v))
    }

    /// Iterates over entries in document order.
    pub fn values(&self) -> impl ExactSizeIterator<Item = &T> {
        self.entries.iter().map(|(_, v)| v)
    }

    /// Appends an entry. If the key is already taken, the entry is kept but lookups keep
    /// returning the earlier one.
    pub(crate) fn insert(&mut self, key: String, value: T) {
        if !self.index.contains_key(&key) {
            self.index.insert(key.clone(), self.entries.len());
        }
        self.entries.push((key, value));
    }

    pub(crate) fn get_mut(&mut self, key: &str) -> Option<&mut T> {
        self.index.get(key).map(|&i| &mut self.entries[i].1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_order_and_first_duplicate() {
        let mut t = Table::default();
        t.insert("b".to_owned(), 1);
        t.insert("a".to_owned(), 2);
        t.insert("b".to_owned(), 3);
        assert_eq!(t.len(), 3);
        assert_eq!(t.get("b"), Some(&1));
        assert_eq!(t.get("a"), Some(&2));
        assert_eq!(t.get("c"), None);
        assert_eq!(t.values().copied().collect::<Vec<_>>(), [1, 2, 3]);
        assert_eq!(
            t.iter().map(|(k, _)| k).collect::<Vec<_>>(),
            ["b", "a", "b"]
        );
        *t.get_mut("a").unwrap() = 5;
        assert_eq!(t.get("a"), Some(&5));
    }
}
