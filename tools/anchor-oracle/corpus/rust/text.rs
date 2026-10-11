//! Text utilities for outbound notifications: a `{placeholder}` template
//! tokenizer, a renderer and a few quoting and decoding helpers.
//!
//! Literal braces are written `{{` and `}}`, mirroring `format!`.

use std::borrow::{Borrow, Cow};
use std::collections::HashMap;
use std::fmt;
use std::hash::Hash;

/// Builds a `HashMap<&str, String>` of template values from `key => value` pairs.
#[macro_export]
macro_rules! values {
    () => {
        ::std::collections::HashMap::<&str, String>::new()
    };
    ($($key:expr => $value:expr),+ $(,)?) => {{
        let mut map = ::std::collections::HashMap::<&str, String>::new();
        $( map.insert($key, ($value).to_string()); )+
        map
    }};
}

pub const SAMPLE: &str = r#"Hello {name},
order {order:quoted} ships {{soon}}; we'll send "{carrier:upper}" tracking."#;

pub const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token<'a> {
    Text(&'a str),
    Placeholder { name: &'a str, format: Option<&'a str> },
    Escaped(char),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TemplateError {
    Unclosed { offset: usize },
    Unexpected { offset: usize, found: char },
    EmptyName { offset: usize },
    BadFormat { format: String },
}

impl fmt::Display for TemplateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TemplateError::Unclosed { offset } => write!(f, "unclosed '{{' at byte {offset}"),
            TemplateError::Unexpected { offset, found } => {
                write!(f, "unexpected {found:?} at byte {offset}")
            }
            TemplateError::EmptyName { offset } => write!(f, "empty placeholder at byte {offset}"),
            TemplateError::BadFormat { format } => write!(f, "unknown format \"{format}\""),
        }
    }
}

impl std::error::Error for TemplateError {}

/// Splits a template into tokens without allocating.
pub struct Tokenizer<'a> {
    src: &'a str,
    pos: usize,
}

impl<'a> Tokenizer<'a> {
    pub const fn new(src: &'a str) -> Self {
        Tokenizer { src, pos: 0 }
    }
}

impl<'a> Iterator for Tokenizer<'a> {
    type Item = Result<Token<'a>, TemplateError>;

    fn next(&mut self) -> Option<Self::Item> {
        let src: &'a str = self.src;
        let rest = &src[self.pos..];
        let start = self.pos;
        match rest.chars().next()? {
            '{' if rest.starts_with("{{") => {
                self.pos += 2;
                Some(Ok(Token::Escaped('{')))
            }
            '}' if rest.starts_with("}}") => {
                self.pos += 2;
                Some(Ok(Token::Escaped('}')))
            }
            '}' => {
                self.pos += 1;
                Some(Err(TemplateError::Unexpected { offset: start, found: '}' }))
            }
            '{' => {
                let Some(end) = rest.find('}') else {
                    self.pos = src.len();
                    return Some(Err(TemplateError::Unclosed { offset: start }));
                };
                self.pos += end + 1;
                let inner = &rest[1..end];
                let (name, format) = match inner.split_once(':') {
                    Some((name, format)) => (name.trim(), Some(format.trim())),
                    None => (inner.trim(), None),
                };
                if name.is_empty() {
                    Some(Err(TemplateError::EmptyName { offset: start }))
                } else {
                    Some(Ok(Token::Placeholder { name, format }))
                }
            }
            _ => {
                let end = rest.find(|c: char| c == '{' || c == '}').unwrap_or(rest.len());
                self.pos += end;
                Some(Ok(Token::Text(&rest[..end])))
            }
        }
    }
}

/// Renders `template`, substituting each placeholder from `values`. Missing
/// keys render as empty strings; unknown formats are an error.
pub fn render<K, V>(template: &str, values: &HashMap<K, V>) -> Result<String, TemplateError>
where
    K: Borrow<str> + Hash + Eq,
    V: fmt::Display,
{
    let mut out = String::with_capacity(template.len());
    for token in Tokenizer::new(template) {
        match token? {
            Token::Text(text) => out.push_str(text),
            Token::Escaped(c) => out.push(c),
            Token::Placeholder { name, format } => {
                let value = values.get(name).map(ToString::to_string).unwrap_or_default();
                match format {
                    None => out.push_str(&value),
                    Some("upper") => out.push_str(&value.to_uppercase()),
                    Some("quoted") => {
                        out.push('"');
                        out.push_str(&escape_quotes(&value));
                        out.push('"');
                    }
                    Some(spec) => {
                        let width = spec.strip_prefix('>').and_then(|w| w.parse::<usize>().ok());
                        let width = width
                            .ok_or_else(|| TemplateError::BadFormat { format: spec.to_owned() })?;
                        out.push_str(&format!("{value:>width$}"));
                    }
                }
            }
        }
    }
    Ok(out)
}

/// Backslash-escapes quotes, borrowing the input when nothing needs escaping.
pub fn escape_quotes(input: &str) -> Cow<'_, str> {
    if !input.contains(|c: char| matches!(c, '"' | '\'' | '\\')) {
        return Cow::Borrowed(input);
    }
    let mut out = String::with_capacity(input.len() + 8);
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\'' => out.push_str(r"\'"),
            '\\' => out.push_str(r"\\"),
            other => out.push(other),
        }
    }
    Cow::Owned(out)
}

/// Decodes bytes as UTF-8, dropping a leading byte-order mark.
pub fn decode_lossy(bytes: &[u8]) -> Cow<'_, str> {
    String::from_utf8_lossy(bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes))
}

/// Converts Windows-style separators so attachment paths compare equal.
pub fn to_unix_path(path: &str) -> String {
    path.replace(r"\", "/")
}

/// Returns the 1-based (line, column) of the first unbalanced brace, ignoring
/// text after a `#` and anything inside "double quotes".
pub fn first_unbalanced(src: &str) -> Option<(usize, usize)> {
    let mut open: Vec<(usize, usize)> = Vec::new();
    'lines: for (row, line) in src.lines().enumerate() {
        let mut quoted = false;
        for (col, ch) in line.chars().enumerate() {
            match ch {
                '"' => quoted = !quoted,
                '#' if !quoted => continue 'lines,
                '{' if !quoted => open.push((row + 1, col + 1)),
                '}' if !quoted => {
                    if open.pop().is_none() {
                        return Some((row + 1, col + 1));
                    }
                }
                _ => {}
            }
        }
    }
    open.first().copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_sample_template() {
        let vals = values! { "name" => "team", "order" => r#"A-17 "rush""#, "carrier" => "ground" };
        assert_eq!(
            render(SAMPLE, &vals).unwrap(),
            "Hello team,\norder \"A-17 \\\"rush\\\"\" ships {soon}; we'll send \"GROUND\" tracking."
        );
    }

    #[test]
    fn reports_unclosed_and_unbalanced_braces() {
        assert_eq!(
            Tokenizer::new("x {").collect::<Vec<_>>(),
            vec![Ok(Token::Text("x ")), Err(TemplateError::Unclosed { offset: 2 })]
        );
        assert_eq!(first_unbalanced("a { b }\n# ignored {\nc \"{\" }"), Some((3, 7)));
        assert_eq!(decode_lossy(b"\xEF\xBB\xBFok"), "ok");
        assert_eq!(to_unix_path(r"exports\daily\"), "exports/daily/");
    }
}
