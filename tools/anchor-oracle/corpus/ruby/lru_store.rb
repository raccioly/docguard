# frozen_string_literal: true

require "monitor"

module Caching
  class LruStore
    include MonitorMixin

    Entry = Struct.new(:key, :value, :expires_at, :prev, :next) do
      def expired?(now) = !expires_at.nil? && now >= expires_at

      def inspect
        "#<Entry #{key.inspect} expires=#{expires_at || "never"}>"
      end
    end

    class << self
      attr_writer :instrumenter

      def build(capacity: 1_000, ttl: nil, clock: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) })
        new(capacity, default_ttl: ttl, clock: clock)
      end

      def instrumenter
        @instrumenter ||= ->(_event, _payload) {}
      end
    end

    attr_reader :capacity
    attr_accessor :on_evict

    def initialize(capacity, default_ttl: nil, clock: -> { Time.now.to_f })
      raise ArgumentError, "capacity must be positive, got #{capacity}" unless capacity.positive?

      super()
      @capacity = capacity
      @default_ttl = default_ttl
      @clock = clock
      @index = {}
      @head = Entry.new(:__head__)
      @tail = Entry.new(:__tail__)
      @head.next = @tail
      @tail.prev = @head
      @hits = @misses = 0
    end

    def fetch(key, ttl: @default_ttl)
      synchronize do
        entry = @index[key]
        if entry && !entry.expired?(now)
          @hits += 1
          promote(entry)
          return entry.value
        end

        @misses += 1
        remove(entry) if entry
        return nil unless block_given?

        value = yield(key)
        store(key, value, ttl)
        value
      end
    end

    def [](key) = fetch(key)

    def []=(key, value)
      synchronize { store(key, value, @default_ttl) }
    end

    def delete(key)
      synchronize do
        entry = @index[key] or return
        remove(entry)
        entry.value
      end
    end

    def size = synchronize { @index.size }

    def stats
      total = @hits + @misses
      { hits: @hits, misses: @misses, size: size, hit_rate: total.zero? ? 0.0 : (@hits.to_f / total).round(4) }
    end

    def sweep!
      removed = 0
      synchronize do
        node = @tail.prev
        while node && !node.equal?(@head)
          previous = node.prev
          if node.expired?(now)
            remove(node)
            removed += 1
          end
          node = previous
        end
      end
      removed
    ensure
      self.class.instrumenter.call(:sweep, { removed: removed })
    end

    protected

    def now = @clock.call

    private

    def store(key, value, ttl)
      if (existing = @index[key])
        existing.value = value
        existing.expires_at = ttl && now + ttl
        promote(existing)
        return value
      end

      entry = Entry.new(key, value, ttl && now + ttl)
      @index[key] = entry
      link_front(entry)
      evict while @index.size > capacity
      value
    end

    def evict
      victim = @tail.prev
      return if victim.equal?(@head)

      remove(victim)
      on_evict&.call(victim.key, victim.value)
      self.class.instrumenter.call(:evict, { key: victim.key })
    end

    def promote(entry)
      unlink(entry)
      link_front(entry)
    end

    def link_front(entry)
      entry.prev = @head
      entry.next = @head.next
      @head.next.prev = entry
      @head.next = entry
    end

    def unlink(entry)
      entry.prev.next = entry.next
      entry.next.prev = entry.prev
      entry.prev = entry.next = nil
    end

    def remove(entry)
      unlink(entry)
      @index.delete(entry.key)
    end
  end

  module Memoize
    def self.included(base)
      base.extend(ClassMethods)
    end

    module ClassMethods
      def memoize(*names, ttl: nil, capacity: 256)
        names.each do |name|
          original = instance_method(name)
          ivar = :"@__memo_#{name.to_s.delete_suffix("?").delete_suffix("!")}"
          define_method(name) do |*args, **kwargs, &block|
            cache = instance_variable_get(ivar) ||
                    instance_variable_set(ivar, LruStore.build(capacity: capacity, ttl: ttl))
            cache.fetch([args, kwargs]) { original.bind_call(self, *args, **kwargs, &block) }
          end
        end
      end
    end
  end
end
