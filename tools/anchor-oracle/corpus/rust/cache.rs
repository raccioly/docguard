//! In-memory caches for catalogue and price lookups.
//!
//! [`LruCache`] keeps a fixed number of entries in a slab-backed doubly linked
//! list, so neither lookups nor evictions allocate once the cache is warm.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hash};
use std::num::NonZeroUsize;
use std::time::{Duration, Instant};

const NIL: usize = usize::MAX;

/// Common interface over cache implementations.
pub trait Store {
    type Key;
    type Value;

    fn get(&mut self, key: &Self::Key) -> Option<&Self::Value>;

    fn put(&mut self, key: Self::Key, value: Self::Value) -> Option<Self::Value>;

    fn len(&self) -> usize;

    /// Returns the cached value, computing and inserting it on a miss.
    fn get_or_insert_with<F>(&mut self, key: Self::Key, make: F) -> &Self::Value
    where
        Self::Key: Clone,
        F: FnOnce() -> Self::Value,
    {
        if self.get(&key).is_none() {
            self.put(key.clone(), make());
        }
        self.get(&key).expect("value was inserted above")
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Stats {
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
}

impl Stats {
    pub const fn lookups(&self) -> u64 {
        self.hits + self.misses
    }
}

struct Node<K, V> {
    key: K,
    value: V,
    prev: usize,
    next: usize,
}

pub struct LruCache<K, V, S = RandomState> {
    map: HashMap<K, usize, S>,
    nodes: Vec<Node<K, V>>,
    head: usize,
    tail: usize,
    capacity: NonZeroUsize,
    stats: Stats,
}

impl<K: Hash + Eq + Clone, V> LruCache<K, V> {
    pub fn new(capacity: NonZeroUsize) -> Self {
        Self::with_hasher(capacity, RandomState::new())
    }
}

impl<K, V, S> LruCache<K, V, S>
where
    K: Hash + Eq + Clone,
    S: BuildHasher,
{
    pub fn with_hasher(capacity: NonZeroUsize, hasher: S) -> Self {
        LruCache {
            map: HashMap::with_capacity_and_hasher(capacity.get(), hasher),
            nodes: Vec::with_capacity(capacity.get()),
            head: NIL,
            tail: NIL,
            capacity,
            stats: Stats::default(),
        }
    }

    pub fn stats(&self) -> Stats {
        self.stats
    }

    /// Looks up a value without touching recency or statistics.
    pub fn peek(&self, key: &K) -> Option<&V> {
        let &idx = self.map.get(key)?;
        // SAFETY: every index stored in `map` points into `nodes`; slots are
        // overwritten on eviction but `nodes` itself never shrinks.
        Some(unsafe { &self.nodes.get_unchecked(idx).value })
    }

    /// Iterates from most to least recently used.
    pub fn iter(&self) -> Iter<'_, K, V> {
        Iter { nodes: &self.nodes, cursor: self.head }
    }

    fn unlink(&mut self, idx: usize) {
        let (prev, next) = (self.nodes[idx].prev, self.nodes[idx].next);
        match prev {
            NIL => self.head = next,
            p => self.nodes[p].next = next,
        }
        match next {
            NIL => self.tail = prev,
            n => self.nodes[n].prev = prev,
        }
    }

    fn push_front(&mut self, idx: usize) {
        self.nodes[idx].prev = NIL;
        self.nodes[idx].next = self.head;
        if let Some(old) = self.nodes.get_mut(self.head) {
            old.prev = idx;
        }
        self.head = idx;
        if self.tail == NIL {
            self.tail = idx;
        }
    }

    fn touch(&mut self, idx: usize) {
        if self.head != idx {
            self.unlink(idx);
            self.push_front(idx);
        }
    }
}

impl<K, V, S> Store for LruCache<K, V, S>
where
    K: Hash + Eq + Clone,
    S: BuildHasher,
{
    type Key = K;
    type Value = V;

    fn get(&mut self, key: &K) -> Option<&V> {
        let Some(&idx) = self.map.get(key) else {
            self.stats.misses += 1;
            return None;
        };
        self.stats.hits += 1;
        self.touch(idx);
        Some(&self.nodes[idx].value)
    }

    fn put(&mut self, key: K, value: V) -> Option<V> {
        if let Some(&idx) = self.map.get(&key) {
            self.touch(idx);
            return Some(std::mem::replace(&mut self.nodes[idx].value, value));
        }
        let node = Node { key: key.clone(), value, prev: NIL, next: NIL };
        let idx = if self.nodes.len() < self.capacity.get() {
            self.nodes.push(node);
            self.nodes.len() - 1
        } else {
            let victim = self.tail;
            self.unlink(victim);
            let evicted = std::mem::replace(&mut self.nodes[victim], node);
            self.map.remove(&evicted.key);
            self.stats.evictions += 1;
            victim
        };
        self.map.insert(key, idx);
        self.push_front(idx);
        None
    }

    fn len(&self) -> usize {
        self.map.len()
    }
}

pub struct Iter<'a, K, V> {
    nodes: &'a [Node<K, V>],
    cursor: usize,
}

impl<'a, K, V> Iterator for Iter<'a, K, V> {
    type Item = (&'a K, &'a V);

    fn next(&mut self) -> Option<Self::Item> {
        let node = self.nodes.get(self.cursor)?;
        self.cursor = node.next;
        Some((&node.key, &node.value))
    }
}

/// Wraps any [`Store`] so entries expire `ttl` after they were written.
pub struct Expiring<C> {
    inner: C,
    ttl: Duration,
}

impl<C, T> Expiring<C>
where
    C: Store<Value = (Instant, T)>,
{
    pub const fn new(inner: C, ttl: Duration) -> Self {
        Expiring { inner, ttl }
    }

    pub fn get(&mut self, key: &C::Key, now: Instant) -> Option<&T> {
        let ttl = self.ttl;
        match self.inner.get(key) {
            Some((written, value)) if now.duration_since(*written) < ttl => Some(value),
            _ => None,
        }
    }

    pub fn put(&mut self, key: C::Key, value: T, now: Instant) {
        self.inner.put(key, (now, value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cap(n: usize) -> NonZeroUsize {
        NonZeroUsize::new(n).expect("capacity must be non-zero")
    }

    #[test]
    fn evicts_least_recently_used() {
        let mut cache: LruCache<&str, i32> = LruCache::new(cap(2));
        cache.put("a", 1);
        cache.put("b", 2);
        assert_eq!(cache.get(&"a"), Some(&1));
        cache.put("c", 3);
        assert_eq!(cache.peek(&"b"), None);
        let order: Vec<&str> = cache.iter().map(|(k, _)| *k).collect();
        assert_eq!(order, ["c", "a"]);
        assert_eq!(cache.stats(), Stats { hits: 1, misses: 0, evictions: 1 });
    }

    #[test]
    fn expiring_entries_age_out() {
        let start = Instant::now();
        let inner: LruCache<&str, (Instant, u32)> = LruCache::new(cap(4));
        let mut cache = Expiring::new(inner, Duration::from_secs(30));
        cache.put("TOOL-0042", 1999, start);
        assert_eq!(cache.get(&"TOOL-0042", start + Duration::from_secs(10)), Some(&1999));
        assert_eq!(cache.get(&"TOOL-0042", start + Duration::from_secs(31)), None);
    }
}
