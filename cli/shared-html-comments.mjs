/**
 * HTML comments in Markdown, read one line at a time, for the readers that
 * must skip commented-out text: the requirement parser, the instruction-
 * pointer reader and Docs-Sync. `<!--` and `-->` inside an inline code span
 * are text, as in CommonMark, so a spec that quotes `<!--` does not lose every
 * line after it.
 *
 * @implements docguard.quoted-comment-openers#FR-001
 * @implements docguard.quoted-comment-openers#FR-003
 * @implements docguard.quoted-comment-openers#FR-004
 */

/**
 * The line with every inline code span blanked to `fill` (same length). A run
 * of backticks opens a span only when a run of the same length closes it on
 * this line; an unclosed run stays as literal backticks. TODO tracking blanks
 * with a non-space character, so a quoted keyword disappears while an
 * annotation whose text is all code keeps its text
 * (docguard.todo-quoted-forms#FR-001).
 */
export function maskCodeSpans(line, fill = ' ') {
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
    out += fill.repeat(close + run - i);
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

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * A whole document as a reader sees it: every HTML comment removed, line
 * breaks kept. A fenced code block is text, comments in it included, as in
 * CommonMark; a fence that opens inside a comment is part of the comment.
 * @implements docguard.docs-sync-specific-evidence#FR-001
 * @param {string} content
 * @returns {string}
 */
export function visibleMarkdown(content) {
  const out = [];
  let fence = null;
  let inComment = false;
  for (const line of String(content).split('\n')) {
    if (fence) {
      out.push(line);
      const close = line.match(FENCE);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length
        && line.slice(close[0].length).trim() === '') fence = null;
      continue;
    }
    const open = inComment ? null : line.match(FENCE);
    if (open) { fence = open[1]; out.push(line); continue; }
    let text;
    ({ text, inComment } = stripHtmlComments(line, inComment));
    out.push(text);
  }
  return out.join('\n');
}
