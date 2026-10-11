//! Library for billing.
//! @implements acme.billing#FR-001

/// @implements acme.billing#FR-002
pub fn total<'a>(xs: &'a [i32]) -> i32 {
    let brace = '{';
    xs.iter().sum::<i32>() + (brace as i32) * 0
}

pub struct Id(u32);

impl From<u8> for Id {
    // @implements acme.billing#FR-003
    fn from(v: u8) -> Self { Id(v as u32) }
}

const S: &str = r#"// @implements acme.billing#FR-009"#;
