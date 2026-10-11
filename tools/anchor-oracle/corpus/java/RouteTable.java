package http.routing;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Repeatable;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class RouteTable {

    public enum Verb { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS }

    @Documented
    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    @Repeatable(Routes.class)
    public @interface Route {
        String value();

        Verb[] verbs() default {Verb.GET};

        Param[] params() default {};
    }

    @Documented
    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    public @interface Routes {
        Route[] value();
    }

    @Retention(RetentionPolicy.RUNTIME)
    @Target({})
    public @interface Param {
        String name();

        String pattern() default "[^/]+";

        boolean optional() default false;
    }

    @FunctionalInterface
    public interface Handler {
        Response handle(Request request) throws Exception;
    }

    public record Request(
            Verb verb,
            String path,
            Map<String, String> pathParams) {
    }

    public record Response(int status, String contentType, byte[] body) {
        static Response text(int status, String body) {
            return new Response(status, "text/plain; charset=utf-8", body.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static final Pattern PLACEHOLDER = Pattern.compile("\\{(\\w+)(?::([^}]+))?\\}");

    private final List<Entry> entries = new ArrayList<>();
    private Handler fallback = new Handler() {
        @Override
        public Response handle(Request request) {
            return Response.text(404, "no route for " + request.verb() + " " + request.path());
        }
    };

    /** One compiled route, in registration order. */
    final class Entry {
        final Set<Verb> verbs;
        final Pattern regex;
        final List<String> names = new ArrayList<>();
        final Handler handler;

        Entry(Set<Verb> verbs, String template, Map<String, String> constraints, Handler handler) {
            this.verbs = verbs;
            this.handler = handler;
            StringBuilder sb = new StringBuilder("^");
            Matcher m = PLACEHOLDER.matcher(template);
            int last = 0;
            while (m.find()) {
                sb.append(Pattern.quote(template.substring(last, m.start())));
                String name = m.group(1);
                String inline = m.group(2);
                sb.append('(').append(inline != null ? inline : constraints.getOrDefault(name, "[^/]+")).append(')');
                names.add(name);
                last = m.end();
            }
            this.regex = Pattern.compile(sb.append(Pattern.quote(template.substring(last))).append("/?$").toString());
        }
    }

    public RouteTable add(String template, Handler handler, Verb first, Verb... rest) {
        entries.add(new Entry(EnumSet.of(first, rest), template, Map.of(), handler));
        return this;
    }

    public int register(Object controller) {
        int count = 0;
        for (Method method : controller.getClass().getDeclaredMethods()) {
            for (Route route : method.getAnnotationsByType(Route.class)) {
                Map<String, String> constraints = new LinkedHashMap<>();
                for (Param p : route.params()) {
                    constraints.put(p.name(), p.optional() ? "[^/]*" : p.pattern());
                }
                method.setAccessible(true);
                Handler h = request -> {
                    try {
                        return (Response) method.invoke(controller, request);
                    } catch (InvocationTargetException e) {
                        if (e.getCause() instanceof Exception cause) {
                            throw cause;
                        }
                        throw e;
                    }
                };
                entries.add(new Entry(EnumSet.copyOf(Arrays.asList(route.verbs())), route.value(), constraints, h));
                count++;
            }
        }
        return count;
    }

    public Response dispatch(Verb verb, String path) throws Exception {
        boolean pathMatched = false;
        for (Entry e : entries) {
            Matcher m = e.regex.matcher(path);
            if (!m.matches()) {
                continue;
            }
            pathMatched = true;
            if (!e.verbs.contains(verb) && !(verb == Verb.HEAD && e.verbs.contains(Verb.GET))) {
                continue;
            }
            Map<String, String> params = new LinkedHashMap<>();
            for (int i = 0; i < e.names.size(); i++) {
                params.put(e.names.get(i), URLDecoder.decode(m.group(i + 1), StandardCharsets.UTF_8));
            }
            return e.handler.handle(new Request(verb, path, params));
        }
        return pathMatched
                ? Response.text(405, statusLine(405))
                : fallback.handle(new Request(verb, path, Map.of()));
    }

    public static String statusLine(int status) {
        String reason = switch (status / 100) {
            case 2 -> "OK";
            case 3 -> "Redirection";
            case 4 -> {
                String generic = status == 404 ? "Not Found" : "Client Error";
                yield status == 418 ? "I'm a teapot" : generic;
            }
            default -> "Server Error";
        };
        return "HTTP/1.1 " + status + " " + reason;
    }

    static final class SampleController {

        @Route(value = "/items/{id}", verbs = {Verb.GET, Verb.HEAD},
                params = @Param(name = "id", pattern = "[0-9]{1,9}"))
        Response item(Request request) {
            return Response.text(200, "item " + request.pathParams().get("id"));
        }

        @Route(value = "/items/{id}/notes/{slug:[a-z-]+}", verbs = Verb.PUT)
        @Route(value = "/items/{id}/notes", verbs = {Verb.POST},
                params = {
                    @Param(name = "id", pattern = "\\d+"),
                    @Param(name = "draft", optional = true)
                })
        Response upsertNote(Request request) {
            return new Response(204, "", new byte[0]);
        }
    }
}
