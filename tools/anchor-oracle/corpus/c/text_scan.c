/*
 * Tokenizer for notification templates: Hello {{ user.name | "friend" }}!
 * A quoted fallback after '|' may escape characters with \" \' and \\.
 */
#include <ctype.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

enum char_class { CC_OTHER = 0, CC_SPACE, CC_CLOSE, CC_QUOTE, CC_ESCAPE, CC_PIPE };

static const unsigned char char_class_table[256] = {
    [' '] = CC_SPACE,
    ['\t'] = CC_SPACE,
    ['\n'] = CC_SPACE,
    ['}'] = CC_CLOSE,
    ['"'] = CC_QUOTE,
    ['\''] = CC_QUOTE,
    ['\\'] = CC_ESCAPE,
    ['|'] = CC_PIPE,
};

#define CLASS_OF(c) ((enum char_class)char_class_table[(unsigned char)(c)])
#define IS_IDENT_CHAR(c) \
    (isalnum((unsigned char)(c)) || (c) == '_' || (c) == '.')

enum token_kind {
    TOK_TEXT,
    TOK_OPEN,
    TOK_CLOSE,
    TOK_IDENT,
    TOK_PIPE,
    TOK_STRING,
    TOK_END,
    TOK_ERROR
};

struct token {
    enum token_kind kind;
    const char *start;
    size_t length;
    unsigned line;
};

typedef void (*token_sink)(const struct token *tok, void *user);

struct scanner {
    const char *cursor;
    const char *end;
    unsigned line;
    bool in_placeholder;
};

static inline char peek(const struct scanner *s, size_t ahead)
{
    return (s->cursor + ahead < s->end) ? s->cursor[ahead] : '\0';
}

static void advance(struct scanner *s, size_t n)
{
    while (n-- > 0 && s->cursor < s->end) {
        if (*s->cursor++ == '\n') {
            s->line++;
        }
    }
}

static struct token
make_token(const struct scanner *s,
           enum token_kind kind,
           const char *start)
{
    return (struct token){
        .kind = kind,
        .start = start,
        .length = (size_t)(s->cursor - start),
        .line = s->line,
    };
}

static struct token scan_string(struct scanner *s)
{
    const char quote = peek(s, 0);
    const char *start = s->cursor;

    advance(s, 1);
    while (s->cursor < s->end && peek(s, 0) != quote) {
        advance(s, CLASS_OF(peek(s, 0)) == CC_ESCAPE ? 2 : 1);
    }
    if (s->cursor >= s->end) {
        return make_token(s, TOK_ERROR, start);
    }
    advance(s, 1);
    return make_token(s, TOK_STRING, start);
}

static struct token scan_placeholder(struct scanner *s)
{
    while (CLASS_OF(peek(s, 0)) == CC_SPACE) {
        advance(s, 1);
    }

    const char *start = s->cursor;
    switch (CLASS_OF(peek(s, 0))) {
    case CC_CLOSE:
        if (peek(s, 1) != '}') {
            advance(s, 1);
            return make_token(s, TOK_ERROR, start);
        }
        advance(s, 2);
        s->in_placeholder = false;
        return make_token(s, TOK_CLOSE, start);
    case CC_PIPE:
        advance(s, 1);
        return make_token(s, TOK_PIPE, start);
    case CC_QUOTE:
        return scan_string(s);
    default:
        break;
    }

    while (s->cursor < s->end && IS_IDENT_CHAR(peek(s, 0))) {
        advance(s, 1);
    }
    if (s->cursor == start) {
        advance(s, 1);
        return make_token(s, TOK_ERROR, start);
    }
    return make_token(s, TOK_IDENT, start);
}

extern struct token scanner_next(struct scanner *s)
{
    const char *start = s->cursor;

    if (s->cursor >= s->end) {
        return make_token(s, TOK_END, start);
    }
    if (s->in_placeholder) {
        return scan_placeholder(s);
    }
    if (peek(s, 0) == '{' && peek(s, 1) == '{') {
        advance(s, 2);
        s->in_placeholder = true;
        return make_token(s, TOK_OPEN, start);
    }
    while (s->cursor < s->end && !(peek(s, 0) == '{' && peek(s, 1) == '{')) {
        advance(s, 1);
    }
    return make_token(s, TOK_TEXT, start);
}

size_t scan_all(const char *text, size_t len, token_sink sink, void *user)
{
    struct scanner s = { .cursor = text, .end = text + len, .line = 1 };
    size_t count = 0;

    for (;;) {
        struct token tok = scanner_next(&s);
        sink(&tok, user);
        count++;
        if (tok.kind == TOK_END || tok.kind == TOK_ERROR) {
            return count;
        }
    }
}

struct lint_state {
    size_t placeholders;
    size_t fallbacks;
    size_t errors;
    char first_error[96];
};

static void lint_token(const struct token *tok, void *user)
{
    struct lint_state *st = user;

    switch (tok->kind) {
    case TOK_OPEN:
        st->placeholders++;
        break;
    case TOK_STRING:
        st->fallbacks++;
        break;
    case TOK_ERROR:
        if (st->errors++ == 0) {
            snprintf(st->first_error, sizeof st->first_error,
                     "line %u: unexpected '%c' inside \"{{ }}\"",
                     tok->line, tok->length ? *tok->start : '?');
        }
        break;
    default:
        break;
    }
}

int template_lint(const char *tmpl, FILE *report)
{
    struct lint_state st = { 0 };

    scan_all(tmpl, strlen(tmpl), lint_token, &st);
    fprintf(report, "{\"placeholders\":%zu,\"fallbacks\":%zu,\"errors\":%zu}\n",
            st.placeholders, st.fallbacks, st.errors);
    if (st.errors != 0) {
        fprintf(report, "first error: %s\n", st.first_error);
        return -1;
    }
    return 0;
}
