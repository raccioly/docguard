use std::fmt;

/// @implements acme.golden#FR-001
pub fn total(items: &[i32], rate: f64) -> f64 {
    let sum: i32 = items.iter().sum();
    f64::from(sum) * (1.0 - rate)
}

pub struct Cart { items: Vec<i32> }

impl Cart {
    /// @implements acme.golden#FR-002
    pub fn add(&mut self, item: i32) { self.items.push(item); }
}
