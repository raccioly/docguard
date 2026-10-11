# frozen_string_literal: true

require "json"
require "securerandom"
require "uri"

module Http
  class Router
    VERBS = %w[GET POST PUT PATCH DELETE].freeze
    SEGMENT = /:(\w+)|\{(\w+)\}/

    Route = Struct.new(:verb, :pattern, :keys, :handler, :name) do
      def match(path)
        m = pattern.match(path) or return nil
        keys.zip(m.captures).to_h
      end
    end

    Response = Data.define(:status, :headers, :body) do
      def self.text(body, status: 200) = new(status: status, headers: { "content-type" => "text/plain" }, body: [body])

      def self.json(payload, status: 200)
        new(status: status, headers: { "content-type" => "application/json" }, body: [JSON.generate(payload)])
      end

      def to_a = [status, headers, body]
    end

    attr_reader :routes

    def initialize(&definition)
      @routes = Hash.new { |hash, verb| hash[verb] = [] }
      @named = {}
      @middleware = []
      @scope = []
      instance_eval(&definition) if definition
    end

    VERBS.each do |verb|
      define_method(verb.downcase) do |path, to: nil, as: nil, &block|
        add(verb, path, to || block, as: as)
      end
    end

    def scope(prefix)
      @scope.push(prefix.chomp("/"))
      yield self
    ensure
      @scope.pop
    end

    def use(middleware, *args, **opts) = @middleware << [middleware, args, opts]

    def add(verb, path, handler, as: nil)
      keys = []
      source = (@scope + [path]).join.gsub(SEGMENT) do
        keys << ($1 || $2).to_sym
        "([^/]+)"
      end
      route = Route.new(verb, Regexp.new("\\A#{source}/?\\z"), keys, handler, as)
      @routes[verb] << route
      @named[as] = route if as
      route
    end

    def path_for(name, **params)
      route = @named.fetch(name) { raise KeyError, "no route named #{name.inspect}" }
      template = route.pattern.source.delete_prefix("\\A").delete_suffix("/?\\z")
      route.keys.reduce(template) do |acc, key|
        value = params.fetch(key) { raise ArgumentError, "missing :#{key} for route #{name}" }
        acc.sub("([^/]+)", URI.encode_www_form_component(value.to_s))
      end
    end

    def call(env)
      verb = env.fetch("REQUEST_METHOD", "GET")
      path = URI.decode_www_form_component(env.fetch("PATH_INFO", "/"))
      app = @middleware.reverse.reduce(method(:dispatch)) do |inner, (klass, args, opts)|
        klass.new(inner, *args, **opts)
      end
      app.call(env.merge("router.verb" => verb, "router.path" => path)).to_a
    end

    private

    def dispatch(env)
      verb, path = env.values_at("router.verb", "router.path")

      @routes[verb == "HEAD" ? "GET" : verb].each do |route|
        params = route.match(path)
        next unless params

        return normalize(route.handler.call(env.merge("router.params" => params), **params))
      end

      allowed = @routes.select { |_verb, list| list.any? { |r| r.match(path) } }.keys
      return Response.text("Not Found", status: 404) if allowed.empty?

      Response.new(status: 405, headers: { "allow" => allowed.join(", ") }, body: [])
    end

    def normalize(result)
      case result
      in Response then result
      in String => body then Response.text(body)
      in [Integer => status, Hash => headers, body] then Response.new(status:, headers:, body:)
      in { error: String => message, **rest }
        Response.json({ error: message, details: rest }, status: rest.fetch(:status, 422))
      in Hash | Array then Response.json(result)
      in nil then Response.new(status: 204, headers: {}, body: [])
      else
        raise TypeError, "cannot turn #{result.class} into a response"
      end
    end
  end

  module Middleware
    class RequestId
      HEADER = "x-request-id"

      def initialize(app, generator: -> { SecureRandom.hex(8) })
        @app = app
        @generator = generator
      end

      def call(env)
        id = env.fetch("HTTP_X_REQUEST_ID") { @generator.call }
        response = @app.call(env.merge("request.id" => id))
        response.with(headers: response.headers.merge(HEADER => id))
      end
    end
  end
end
