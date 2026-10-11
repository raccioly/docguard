<?php

declare(strict_types=1);

namespace App\Http\Routing;

use Attribute;
use Closure;
use ReflectionClass;
use ReflectionMethod;

#[Attribute(Attribute::TARGET_METHOD | Attribute::IS_REPEATABLE)]
final class Route
{
    public function __construct(
        public readonly string $path,
        public readonly array $methods = ['GET'],
        public readonly ?string $name = null,
    ) {
    }
}

interface Middleware
{
    public function process(Request $request, Closure $next): Response;
}

final class Request
{
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $headers = [],
    ) {
    }
}

final class Response
{
    public function __construct(
        public readonly int $status = 200,
        public readonly string $body = '',
        public readonly array $headers = ['Content-Type' => 'text/plain; charset=utf-8'],
    ) {
    }

    public static function json(mixed $data, int $status = 200): self
    {
        return new self($status, json_encode($data, JSON_THROW_ON_ERROR), ['Content-Type' => 'application/json']);
    }
}

final class CompiledRoute
{
    private const PARAM_PATTERN = '#\{(\w+)(?::([^{}]+))?\}#';

    public readonly string $regex;
    public readonly array $parameterNames;

    public function __construct(
        public readonly string $template,
        public readonly array $methods,
        public readonly Closure $handler,
        public readonly ?string $name = null,
    ) {
        $names = [];
        $pattern = preg_replace_callback(
            self::PARAM_PATTERN,
            static function (array $match) use (&$names): string {
                $names[] = $match[1];
                $constraint = $match[2] ?? '[^/]+';

                return "(?P<{$match[1]}>{$constraint})";
            },
            $template,
        );

        $this->regex = '#^' . $pattern . '$#';
        $this->parameterNames = $names;
    }

    public function match(string $path): ?array
    {
        if (preg_match($this->regex, $path, $matches) !== 1) {
            return null;
        }

        return array_intersect_key($matches, array_flip($this->parameterNames));
    }
}

final class Router
{
    private array $routes = [];
    private string $prefix = '';

    public function __construct(private array $middleware = [])
    {
    }

    public function add(
        array|string $methods,
        string $path,
        Closure|array $handler,
        ?string $name = null,
    ): CompiledRoute {
        $route = new CompiledRoute(
            $this->prefix . $path,
            array_map('strtoupper', (array) $methods),
            $handler instanceof Closure ? $handler : Closure::fromCallable($handler),
            $name,
        );
        $this->routes[] = $route;

        return $route;
    }

    public function group(string $prefix, Closure $define): void
    {
        $previous = $this->prefix;
        $this->prefix = rtrim($previous . $prefix, '/');
        try {
            $define($this);
        } finally {
            $this->prefix = $previous;
        }
    }

    public function resource(string $name, object $controller): void
    {
        $bind = function (string $action) use ($controller): Closure {
            return function (Request $request, string ...$args) use ($controller, $action): Response {
                return $controller->{$action}($request, ...$args);
            };
        };

        $this->group("/{$name}", function (self $router) use ($bind, $name): void {
            $router->add('GET', '', $bind('index'), "{$name}.index");
            $router->add('GET', '/{id:\d+}', $bind('show'), "{$name}.show");
            $router->add(['PUT', 'PATCH'], '/{id:\d+}', $bind('update'));
        });
    }

    public function registerController(object $controller): int
    {
        $count = 0;
        foreach ((new ReflectionClass($controller))->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
            foreach ($method->getAttributes(Route::class) as $attribute) {
                $route = $attribute->newInstance();
                $this->add($route->methods, $route->path, $method->getClosure($controller), $route->name);
                $count++;
            }
        }

        return $count;
    }

    public function dispatch(Request $request): Response
    {
        $core = function (Request $request): Response {
            $allowed = [];
            foreach ($this->routes as $route) {
                $params = $route->match($request->path);
                if ($params === null) {
                    continue;
                }
                if (!in_array($request->method, $route->methods, true)) {
                    $allowed = [...$allowed, ...$route->methods];
                    continue;
                }

                return ($route->handler)($request, ...array_values($params));
            }

            return $allowed === []
                ? new Response(404, "No route for {$request->method} \"{$request->path}\"")
                : new Response(405, 'Method Not Allowed', ['Allow' => implode(', ', array_unique($allowed))]);
        };

        $pipeline = array_reduce(
            array_reverse($this->middleware),
            static fn (Closure $next, Middleware $mw): Closure =>
                static fn (Request $r): Response => $mw->process($r, $next),
            $core,
        );

        return $pipeline($request);
    }
}

final class ItemController
{
    public function __construct(private readonly \ArrayAccess $items)
    {
    }

    #[Route('/items/{id:\d+}', methods: ['GET'], name: 'items.show')]
    public function show(Request $request, string $id): Response
    {
        return isset($this->items[$id])
            ? Response::json($this->items[$id])
            : new Response(404, "Item {$id} not found");
    }

    #[Route('/items/{id:\d+}', methods: ['PUT', 'PATCH'])]
    #[Route(
        path: '/items/{id:\d+}/restore',
        methods: ['POST'],
        name: 'items.restore',
    )]
    public function save(Request $request, string $id): Response
    {
        $this->items[$id] = ['id' => (int) $id, 'updated' => true];

        return Response::json($this->items[$id], 202);
    }
}

function timing_middleware(Closure $clock): Middleware
{
    return new class ($clock) implements Middleware {
        public function __construct(private readonly Closure $clock)
        {
        }

        public function process(Request $request, Closure $next): Response
        {
            $started = ($this->clock)();
            $response = $next($request);
            $elapsed = sprintf('%.3f', (($this->clock)() - $started) * 1000);

            return new Response(
                $response->status,
                $response->body,
                $response->headers + ['Server-Timing' => "app;dur={$elapsed}"],
            );
        }
    };
}
