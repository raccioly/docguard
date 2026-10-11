pub const A: &str = r#"// @implements "quoted" x#FR-001"#;
pub const B: &str = "/* @implements x#FR-001 */";
pub const C: &[u8] = br"// @implements x#FR-001";
pub const D: char = '{';
pub const E: u8 = b'/';

pub fn e<'a>(x: &'a str) -> &'a str {
    x
}
