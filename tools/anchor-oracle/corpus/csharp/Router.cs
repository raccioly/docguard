using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Http.Routing.Tests")]

namespace Http.Routing;

[Flags]
public enum HttpVerb
{
    None = 0,
    Get = 1 << 0,
    Head = 1 << 1,
    Post = 1 << 2,
    Put = 1 << 3,
    Delete = 1 << 4,
    Read = Get | Head,
}

[AttributeUsage(AttributeTargets.Method, AllowMultiple = true, Inherited = false)]
public sealed class RouteAttribute(string template) : Attribute
{
    public string Template { get; } = template;

    public HttpVerb Verbs { get; set; } = HttpVerb.Read;

    public string[] Tags { get; set; } = [];

    public int Order { get; set; }
}

public sealed record HttpResult(int Status, string Body, string ContentType = "text/plain; charset=utf-8")
{
    internal const string NotFoundPage = """
        <!doctype html>
        <html>
          <body>
            <h1>404</h1>
            <p>No route matches "{path}". Try <code>GET /health</code> or {"see": "docs"}.</p>
          </body>
        </html>
        """;

    public static HttpResult Ok(string body) => new(200, body);

    public static HttpResult NoContent() => new(204, string.Empty);

    public static HttpResult Problem(HttpStatusCode status, string message) =>
        new((int)status, $$"""{"status":{{(int)status}},"error":"{{Escape(message)}}"}""", "application/problem+json");

    private static string Escape(string s) => s.Replace(@"\", @"\\").Replace("\"", "\\\"");
}

public readonly struct RouteContext(HttpVerb verb, string path, Dictionary<string, string> values)
{
    public HttpVerb Verb { get; } = verb;

    public string Path { get; } = path;

    public string this[string name] => values.TryGetValue(name, out var v) ? v : throw new KeyNotFoundException(name);

    public bool TryGetInt(string name, out int value)
    {
        value = 0;
        return values.TryGetValue(name, out var raw) && int.TryParse(raw, out value);
    }
}

public interface IRouteHandler
{
    Task<HttpResult> HandleAsync(RouteContext context, CancellationToken cancellationToken);

    string Describe() => GetType().Name;

    static IRouteHandler From(Func<RouteContext, CancellationToken, Task<HttpResult>> func) => new DelegateHandler(func);

    private sealed class DelegateHandler(Func<RouteContext, CancellationToken, Task<HttpResult>> func) : IRouteHandler
    {
        public Task<HttpResult> HandleAsync(RouteContext context, CancellationToken cancellationToken) =>
            func(context, cancellationToken);

        public string Describe() => $"delegate:{func.Method.Name}";
    }
}

public sealed partial class Router
{
    private readonly List<CompiledRoute> _routes = new();

    [GeneratedRegex(@"\{(?<name>[a-zA-Z_]\w*)(?::(?<constraint>[^{}]+))?\}", RegexOptions.CultureInvariant)]
    private static partial Regex PlaceholderPattern();

    public Router Map(string template, HttpVerb verbs, IRouteHandler handler, int order = 0)
    {
        _routes.Add(Compile(template, verbs, handler, order));
        _routes.Sort(static (a, b) => a.Order != b.Order ? a.Order.CompareTo(b.Order) : b.Literal.CompareTo(a.Literal));
        return this;
    }

    public int MapController(object controller)
    {
        var count = 0;
        foreach (var method in controller.GetType().GetMethods(BindingFlags.Instance | BindingFlags.Public))
        {
            foreach (var route in method.GetCustomAttributes<RouteAttribute>())
            {
                var handler = IRouteHandler.From(async (ctx, ct) =>
                {
                    var result = method.Invoke(controller, [ctx, ct]);
                    return result switch
                    {
                        Task<HttpResult> pending => await pending.ConfigureAwait(false),
                        HttpResult done => done,
                        null => HttpResult.NoContent(),
                        _ => throw new InvalidOperationException(
                            $"{method.DeclaringType?.Name}.{method.Name} returned {result.GetType().Name}"),
                    };
                });
                Map(route.Template, route.Verbs, handler, route.Order);
                count++;
            }
        }

        return count;
    }

    public async Task<HttpResult> DispatchAsync(HttpVerb verb, string path, CancellationToken cancellationToken = default)
    {
        var allowed = HttpVerb.None;
        foreach (var route in _routes)
        {
            var match = route.Pattern.Match(path);
            if (!match.Success)
            {
                continue;
            }

            if ((route.Verbs & verb) == 0)
            {
                allowed |= route.Verbs;
                continue;
            }

            var values = route.Names.ToDictionary(n => n, n => Uri.UnescapeDataString(match.Groups[n].Value));
            return await route.Handler.HandleAsync(new RouteContext(verb, path, values), cancellationToken).ConfigureAwait(false);
        }

        return allowed switch
        {
            HttpVerb.None => new HttpResult(404, HttpResult.NotFoundPage.Replace("{path}", WebUtility.HtmlEncode(path)), "text/html"),
            _ => HttpResult.Problem(HttpStatusCode.MethodNotAllowed, $"Allowed: {allowed:F}"),
        };
    }

    private static CompiledRoute Compile(string template, HttpVerb verbs, IRouteHandler handler, int order)
    {
        var names = new List<string>();
        var pattern = new StringBuilder("^");
        var literalLength = 0;
        var last = 0;
        foreach (Match m in PlaceholderPattern().Matches(template))
        {
            AppendLiteral(template[last..m.Index]);
            var name = m.Groups["name"].Value;
            pattern.Append(m.Groups["constraint"] switch
            {
                { Success: false } => @"(?<" + name + @">[^/]+)",
                { Value: "int" } => $@"(?<{name}>-?\d{{1,10}})",
                { Value: "guid" } => $@"(?<{name}>[0-9a-fA-F]{{8}}(?:-[0-9a-fA-F]{{4}}){{3}}-[0-9a-fA-F]{{12}})",
                { Value: var custom } => $"(?<{name}>{custom})",
            });
            names.Add(name);
            last = m.Index + m.Length;
        }

        AppendLiteral(template[last..]);
        pattern.Append("/?$");
        return new CompiledRoute(new Regex(pattern.ToString()), verbs, names, handler, order, literalLength);

        void AppendLiteral(string literal)
        {
            literalLength += literal.Length;
            pattern.Append(Regex.Escape(literal));
        }
    }

    private sealed record CompiledRoute(
        Regex Pattern, HttpVerb Verbs, IReadOnlyList<string> Names, IRouteHandler Handler, int Order, int Literal);
}

internal sealed class InventoryController
{
    [Route("/items/{id:int}", Verbs = HttpVerb.Get | HttpVerb.Head, Tags = new[] { "items", "read" })]
    [Route("/v1/items/{id:int}", Order = 10)]
    public Task<HttpResult> GetItem(RouteContext context, CancellationToken cancellationToken) =>
        context.TryGetInt("id", out var id) && id > 0
            ? Task.FromResult(HttpResult.Ok($"item {id}"))
            : Task.FromResult(HttpResult.Problem(HttpStatusCode.BadRequest, "id must be a positive integer"));

    [Route("/items/{sku:[A-Z]+-\\d+}/reserve", Verbs = HttpVerb.Post)]
    public async Task<HttpResult> Reserve(RouteContext context, CancellationToken cancellationToken)
    {
        await Task.Delay(TimeSpan.FromMilliseconds(5), cancellationToken).ConfigureAwait(false);
        return context.Path switch
        {
            var p when p.Contains("..", StringComparison.Ordinal) => HttpResult.Problem(HttpStatusCode.BadRequest, "invalid path"),
            _ => HttpResult.Ok($"reserved {context["sku"]}"),
        };
    }
}
