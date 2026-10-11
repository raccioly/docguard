package text.template;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.BiFunction;
import java.util.function.UnaryOperator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Minimal mustache-style renderer: {@code {{name}}} substitutes and escapes,
 * {@code {{name|upper}}} applies a filter, {@code {{{raw}}}} skips escaping.
 */
public class TemplateRenderer {

    public static final String DEFAULT_LAYOUT = """
            <!doctype html>
            <html lang="en">
              <head><title>{{title}}</title></head>
              <body class="receipt">
                <h1>{{title|upper}}</h1>
                <pre>{"total": "{{total}}", "items": {{count}}}</pre>
                {{{body}}}
              </body>
            </html>
            """;

    static final String JSON_SAMPLE = """
            {
              "template": "receipt",
              "escape": "\\"quoted\\" and \\u007B braces }",
              "nested": { "a": [1, 2, { "b": "}" }] }
            }""";

    private static final char OPEN = '{';

    @FunctionalInterface
    public interface Filter extends UnaryOperator<String> {

        static Filter named(String name) {
            return switch (name) {
                case "upper" -> s -> s.toUpperCase(Locale.ROOT);
                case "lower" -> s -> s.toLowerCase(Locale.ROOT);
                case "trim" -> String::strip;
                default -> throw new IllegalArgumentException("no filter \"" + name + "\"");
            };
        }
    }

    public interface Scope {
        Object lookup(String key);

        default Scope child(Map<String, ?> values) {
            Scope parent = this;
            return new Scope() {
                @Override
                public Object lookup(String key) {
                    return values.containsKey(key) ? values.get(key) : parent.lookup(key);
                }

                @Override
                public String toString() {
                    return "Scope{" + values.keySet() + " -> " + parent + "}";
                }
            };
        }

        static Scope of(Map<String, ?> values) {
            return values::get;
        }
    }

    private final Map<String, Filter> filters = new LinkedHashMap<>();
    private final BiFunction<String, Scope, String> missingHandler;

    public TemplateRenderer() {
        this((key, scope) -> {
            // Keep the placeholder so the gap is visible in the output,
            // e.g. "{{customer.name}}" instead of an empty string.
            return "{{" + key + "}}";
        });
    }

    public TemplateRenderer(BiFunction<String, Scope, String> missingHandler) {
        this.missingHandler = missingHandler;
    }

    public String render(String template, Scope scope) {
        StringBuilder out = new StringBuilder(template.length() + 64);
        int i = 0;
        while (i < template.length()) {
            char c = template.charAt(i);
            if (c != OPEN || i + 1 >= template.length() || template.charAt(i + 1) != OPEN) {
                out.append(c);
                i++;
                continue;
            }
            boolean raw = i + 2 < template.length() && template.charAt(i + 2) == '{';
            int start = i + (raw ? 3 : 2);
            String terminator = raw ? "}}}" : "}}";
            int end = template.indexOf(terminator, start);
            if (end < 0) {
                throw new IllegalStateException("unterminated tag at offset " + i);
            }
            String value = evaluate(template.substring(start, end).strip(), scope);
            out.append(raw ? value : escapeHtml(value));
            i = end + terminator.length();
        }
        return out.toString();
    }

    private String evaluate(String expr, Scope scope) {
        String[] parts = expr.split("\\|");
        Object value = scope.lookup(parts[0].strip());
        if (value == null) {
            return missingHandler.apply(parts[0], scope);
        }
        String text = String.valueOf(value);
        for (int p = 1; p < parts.length; p++) {
            text = filters.computeIfAbsent(parts[p].strip(), Filter::named).apply(text);
        }
        return text;
    }

    static String escapeHtml(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (char ch : s.toCharArray()) {
            switch (ch) {
                case '<' -> sb.append("&lt;");
                case '>' -> sb.append("&gt;");
                case '&' -> sb.append("&amp;");
                case '"' -> sb.append("&quot;");
                case '\'' -> sb.append("&#39;");
                case '{', '}' -> sb.append("&#").append((int) ch).append(';');
                default -> sb.append(ch);
            }
        }
        return sb.toString();
    }

    public List<String> placeholders(String template) {
        record Tag(int offset, String name) { }

        List<Tag> tags = new ArrayList<>();
        Matcher m = Pattern.compile("\\{\\{\\{?\\s*([\\w.]+)").matcher(template);
        while (m.find()) {
            tags.add(new Tag(m.start(), m.group(1)));
        }
        List<String> names = new ArrayList<>();
        tags.stream()
                .sorted((a, b) -> {
                    int byName = a.name().compareTo(b.name());
                    return byName != 0 ? byName : Integer.compare(a.offset(), b.offset());
                })
                .map(Tag::name)
                .distinct()
                .forEach(names::add);
        return names;
    }
}
