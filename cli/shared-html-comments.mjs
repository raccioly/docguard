/**
 * HTML comments in Markdown, read one line at a time, for the readers that
 * must skip commented-out text: the requirement parser and the instruction-
 * pointer reader. `<!--` and `-->` inside an inline code span are text, as in
 * CommonMark, so a spec that quotes `<!--` does not lose every line after it.
 *
 * @implements docguard.quoted-comment-openers#FR-001
 * @implements docguard.quoted-comment-openers#FR-003
 * @implements docguard.quoted-comment-openers#FR-004
 */

/**
 * The line with every inline code span blanked to spaces (same length). A run
 * of backticks opens a span only when a run of the same length closes it on
 * this line; an unclosed run stays as literal backticks.
 */
function maskCodeSpans(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') { out += line[i++]; continue; }
    let j = i;
    while (line[j] === '`') j++;
    const run = j - i;
    let close = -1;
    for (let k = j; k < line.length;) {
      if (line[k] !== '`') { k++; continue; }
      let m = k;
      while (line[m] === '`') m++;
      if (m - k === run) { close = k; break; }
      k = m;
    }
    if (close < 0) { out += line.slice(i, j); i = j; continue; }
    out += ' '.repeat(close + run - i);
    i = close + run;
  }
  return out;
}

/**
 * The text of one line outside HTML comments, and whether a comment is still
 * open at its end. A comment ends at its first `-->`; outside a comment,
 * `<!--` opens one only when it is not inside an inline code span.
 * @param {string} line
 * @param {boolean} inComment  whether a comment was open before this line
 * @returns {{ text: string, inComment: boolean }}
 */
export function stripHtmlComments(line, inComment) {
  let text = '';
  let rest = line;
  for (;;) {
    if (inComment) {
      const close = rest.indexOf('-->');
      if (close < 0) return { text, inComment: true };
      rest = rest.slice(close + 3);
      inComment = false;
      continue;
    }
    const open = maskCodeSpans(rest).indexOf('<!--');
    if (open < 0) return { text: text + rest, inComment: false };
    text += rest.slice(0, open);
    rest = rest.slice(open + 4);
    inComment = true;
  }
}
