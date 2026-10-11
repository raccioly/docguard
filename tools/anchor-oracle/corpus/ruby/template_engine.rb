# frozen_string_literal: true

require "cgi"
require "strscan"

module TextKit
  module Templates
    PLACEHOLDER = /\{(\w+)\}/
    BLOCK_TAG = /\{%\s*(?<keyword>each|if|end)\s*(?<arg>[\w.]*)\s*%\}/
    FILTERS = {
      upcase: :upcase.to_proc,
      downcase: ->(value) { value.to_s.downcase },
      escape: ->(value) { CGI.escapeHTML(value.to_s) },
      truncate: proc { |value, length = 20| value.to_s.length > length ? "#{value.to_s[0, length - 3]}..." : value.to_s }
    }.freeze

    class RenderError < StandardError
      attr_reader :line

      def initialize(message, line: nil)
        super(line ? "#{message} (line #{line})" : message)
        @line = line
      end
    end

    class Context
      def initialize(values = {}, parent: nil)
        @values = values.transform_keys(&:to_s)
        @parent = parent
      end

      def child(values) = Context.new(values, parent: self)

      def fetch(path)
        head, *rest = path.to_s.split(".")
        value = @values.fetch(head) { return @parent&.fetch(path) }
        rest.reduce(value) do |current, key|
          case current
          when Hash then current[key] || current[key.to_sym]
          when nil then break nil
          else current.respond_to?(key) ? current.public_send(key) : nil
          end
        end
      end

      def method_missing(name, *args, &block)
        key = name.to_s
        if key.end_with?("?")
          !fetch(key.chomp("?")).nil?
        elsif args.empty? && block.nil? && (@values.key?(key) || @parent)
          fetch(key)
        else
          super
        end
      end

      def respond_to_missing?(name, include_private = false)
        @values.key?(name.to_s.chomp("?")) || super
      end
    end

    class Engine
      attr_reader :source

      def self.render(source, values = {}, **options)
        new(source, **options).render(values)
      end

      def initialize(source, strict: false, filters: FILTERS, trim: true)
        @source = trim ? source.gsub(/^[ \t]+(?=\{%)/, "") : source
        @strict = strict
        @filters = filters
      end

      def render(values = {})
        context = values.is_a?(Context) ? values : Context.new(values)
        render_tokens(tokenize, context)
      end

      def placeholders = source.scan(PLACEHOLDER).flatten.uniq

      private

      def tokenize
        scanner = StringScanner.new(source)
        tokens = []
        until scanner.eos?
          if (tag = scanner.scan(BLOCK_TAG))
            m = tag.match(BLOCK_TAG)
            tokens << [m[:keyword].to_sym, m[:arg]]
          elsif (text = scanner.scan_until(/(?=\{%)/)) && !text.empty?
            tokens << [:text, text]
          else
            tokens << [:text, scanner.rest]
            scanner.terminate
          end
        end
        tokens
      end

      def render_tokens(tokens, context)
        output = +""
        index = 0
        while index < tokens.length
          kind, value = tokens[index]
          case kind
          when :text
            output << interpolate(value, context)
          when :each, :if
            body, index = extract_block(tokens, index + 1)
            output << (kind == :each ? render_each(value, body, context) : render_if(value, body, context))
          when :end
            raise RenderError, "unexpected {% end %} without an opening tag"
          end
          index += 1
        end
        output
      end

      def extract_block(tokens, start)
        depth = 1
        cursor = start
        loop do
          raise RenderError, "unclosed block starting at token #{start}" if cursor >= tokens.length

          case tokens[cursor].first
          when :each, :if then depth += 1
          when :end
            depth -= 1
            return [tokens[start...cursor], cursor] if depth.zero?
          end
          cursor += 1
        end
      end

      def render_each(path, body, context)
        Array(context.fetch(path)).each_with_index.map do |item, i|
          render_tokens(body, context.child("item" => item, "index" => i, "first" => i.zero?))
        end.join
      end

      def render_if(path, body, context)
        value = context.fetch(path)
        blank = value.nil? || value == false || (value.respond_to?(:empty?) && value.empty?)
        blank ? "" : render_tokens(body, context)
      end

      def interpolate(text, context)
        text.gsub(/\{(\w+(?:\.\w+)*)(?:\|(\w+)(?::(\d+))?)?\}/) do
          path, filter, arg = Regexp.last_match.captures
          value = context.fetch(path)
          raise RenderError, "missing value for {#{path}}" if value.nil? && @strict

          apply_filter(value, filter, arg)
        end
      end

      def apply_filter(value, name, arg)
        return value.to_s if name.nil?

        filter = @filters.fetch(name.to_sym) { raise RenderError, "unknown filter #{name.inspect}" }
        arg ? filter.call(value, Integer(arg)) : filter.call(value)
      end
    end
  end

  module Formatting
    BOX_CHARS = %w[+ - |].freeze

    module_function

    def boxed(title, body)
      corner, horizontal, vertical = BOX_CHARS
      width = [title.length, *body.lines.map { |l| l.chomp.length }].max + 2
      rule = "#{corner}#{horizontal * width}#{corner}"
      <<~TEXT
        #{rule}
        #{vertical} #{title.ljust(width - 1)}#{vertical}
        #{rule}
        #{body.lines.map { |l| "#{vertical} #{l.chomp.ljust(width - 1)}#{vertical}" }.join("\n")}
        #{rule}
      TEXT
    end

    def slugify(text) = text.downcase.strip.gsub(/[^a-z0-9]+/, "-").gsub(/\A-|-\z/, "")

    def summary(words, limit: 3)
      return %q(no "items" given) if words.empty?

      head = words.first(limit).join(", ")
      words.size > limit ? "#{head}, and #{words.size - limit} more" : head
    end

    def usage
      <<~'USAGE'
        Usage: render [options] TEMPLATE
          Placeholders look like {name} or {user.email|escape}.
          Blocks: {% each items %} ... {% end %}
          Text such as #{this} is printed as-is; nothing here is evaluated.
      USAGE
    end
  end
end
