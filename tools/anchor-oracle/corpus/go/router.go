package warehouse

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

// HandlerFunc is the shape every route resolves to. Returning an error lets
// the router produce a consistent {"error": ...} body.
type HandlerFunc func(ctx context.Context, w http.ResponseWriter, r *Request) error

// Request wraps the standard request with the parameters captured from
// placeholders such as {sku} in the route pattern.
type Request struct {
	*http.Request
	Params map[string]string
}

type Matcher interface {
	Match(path string) (map[string]string, bool)
}

// Route combines matching, a printable description and dispatch.
type Route interface {
	Matcher
	fmt.Stringer
	Serve(ctx context.Context, w http.ResponseWriter, r *Request) error
}

const notFoundBody = `{"error": "not found", "hint": "GET /routes lists every {pattern}"}`

const routeIndexTemplate = `<ul class="routes">
{{range .}}  <li data-method="{{.Method}}"><code>{{.Pattern}}</code></li>
{{end}}</ul>`

var routeIndex = template.Must(template.New("routes").Parse(routeIndexTemplate))

type segment struct {
	literal string
	param   string
	digits  bool
}

type pattern struct {
	raw      string
	method   string
	segments []segment
	handler  HandlerFunc
}

var _ Route = (*pattern)(nil)

/*
parseSegment accepts "items", "{sku}" or "{bin:int}". Quotes are rejected so
that a pattern like /items/{"x"} fails loudly instead of never matching, and
nested braces such as {a{b}} are reported as trailing text.
*/
func parseSegment(part string) (segment, error) {
	if part == "" || part[0] != '{' {
		if strings.ContainsAny(part, "{}") {
			return segment{}, fmt.Errorf("stray brace in %q", part)
		}
		return segment{literal: part}, nil
	}
	depth := 0
	for i, r := range part {
		switch r {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 && i != len(part)-1 {
				return segment{}, fmt.Errorf("trailing text after '}' in %q", part)
			}
		case '"', '\'', '`':
			return segment{}, fmt.Errorf("quote %q not allowed in %q", r, part)
		}
	}
	if depth != 0 {
		return segment{}, fmt.Errorf("unbalanced braces in %q", part)
	}
	name, constraint, _ := strings.Cut(part[1:len(part)-1], ":")
	seg := segment{param: name}
	switch constraint {
	case "":
	case "int", "[0-9]+":
		seg.digits = true
	default:
		return segment{}, fmt.Errorf("unsupported constraint %q", constraint)
	}
	return seg, nil
}

func (p *pattern) Match(path string) (map[string]string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != len(p.segments) {
		return nil, false
	}
	params := make(map[string]string)
	for i, seg := range p.segments {
		switch {
		case seg.param == "":
			if parts[i] != seg.literal {
				return nil, false
			}
		case seg.digits && strings.TrimLeft(parts[i], "0123456789") != "":
			return nil, false
		default:
			params[seg.param] = parts[i]
		}
	}
	return params, true
}

func (p *pattern) Serve(ctx context.Context, w http.ResponseWriter, r *Request) error {
	return p.handler(ctx, w, r)
}

func (p pattern) String() string { return p.method + " " + escapeLabel(p.raw) }

// Router dispatches requests to the first matching route.
type Router struct {
	routes   []*pattern
	notFound HandlerFunc
	logf     func(format string, args ...any)
}

func NewRouter(logf func(format string, args ...any)) *Router {
	rt := &Router{logf: logf}
	rt.notFound = func(_ context.Context, w http.ResponseWriter, _ *Request) error {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, err := io.WriteString(w, notFoundBody)
		return err
	}
	return rt
}

// Handle registers h for method and a pattern such as /items/{sku}/bins/{bin:int}.
func (rt *Router) Handle(method, raw string, h HandlerFunc) {
	if !strings.HasPrefix(raw, "/") {
		panic(fmt.Sprintf("router: pattern %q must start with '/'", raw))
	}
	p := &pattern{raw: raw, method: method, handler: h}
	for _, part := range strings.Split(strings.Trim(raw, "/"), "/") {
		seg, err := parseSegment(part)
		if err != nil {
			panic(fmt.Errorf("router: %s: %w", raw, err))
		}
		p.segments = append(p.segments, seg)
	}
	rt.routes = append(rt.routes, p)
}

func (rt *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	for _, p := range rt.routes {
		if p.method != req.Method {
			continue
		}
		params, ok := p.Match(req.URL.Path)
		if !ok {
			continue
		}
		if err := p.Serve(ctx, w, &Request{Request: req, Params: params}); err != nil {
			rt.logf("route %s failed: %v", p, err)
			writeJSONError(w, http.StatusInternalServerError, err)
		}
		return
	}
	if err := rt.notFound(ctx, w, &Request{Request: req}); err != nil {
		rt.logf("not-found handler: %v", err)
	}
}

// WriteIndex renders an HTML list of routes for the /routes endpoint.
func (rt *Router) WriteIndex(w io.Writer) error {
	type row struct{ Method, Pattern string }
	rows := make([]row, 0, len(rt.routes))
	for _, p := range rt.routes {
		rows = append(rows, row{Method: p.method, Pattern: p.raw})
	}
	return routeIndex.Execute(w, rows)
}

func writeJSONError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(struct {
		Error  string `json:"error"`
		Status int    `json:"status"`
	}{Error: err.Error(), Status: status})
}

// escapeLabel makes a pattern safe to embed in a quoted log label: quotes
// and braces are backslash-escaped, invalid UTF-8 becomes U+FFFD.
func escapeLabel(s string) string {
	var b strings.Builder
	for len(s) > 0 {
		r, size := utf8.DecodeRuneInString(s)
		s = s[size:]
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '{', '}':
			b.WriteByte('\\')
			b.WriteRune(r)
		case utf8.RuneError:
			b.WriteString("\uFFFD")
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// RegisterInventoryRoutes exposes the ledger over HTTP.
func RegisterInventoryRoutes(rt *Router, ledger *Ledger) {
	rt.Handle(http.MethodPost, "/inventory/{sku}/receive", func(ctx context.Context, w http.ResponseWriter, r *Request) error {
		var body struct {
			Location Location `json:"location"`
			Quantity int      `json:"quantity"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return nil
		}
		if err := ledger.Receive(NormalizeSKU(r.Params["sku"]), body.Location, body.Quantity); err != nil {
			writeJSONError(w, http.StatusConflict, err)
			return nil
		}
		w.WriteHeader(http.StatusNoContent)
		return ctx.Err()
	})
}
