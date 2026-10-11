# frozen_string_literal: true

require "date"
require "set"
require "time"

module Scheduling
  WEEKDAYS = %i[sunday monday tuesday wednesday thursday friday saturday].freeze
  BUSINESS_DAYS = WEEKDAYS[1..5].freeze

  class InvalidRuleError < ArgumentError; end

  Slot = Struct.new(:starts_at, :ends_at, :label, keyword_init: true) do
    include Comparable

    def duration_minutes = ((ends_at - starts_at) / 60).round

    def overlaps?(other)
      starts_at < other.ends_at && other.starts_at < ends_at
    end

    def <=>(other)
      [starts_at, ends_at] <=> [other.starts_at, other.ends_at]
    end

    def to_s
      "#{label || "slot"} #{starts_at.strftime("%H:%M")}-#{ends_at.strftime("%H:%M")}"
    end
  end

  class RecurrenceRule
    FREQUENCIES = %w[daily weekly monthly].freeze
    DAY_CODES = { "SU" => :sunday, "MO" => :monday, "TU" => :tuesday, "WE" => :wednesday,
                  "TH" => :thursday, "FR" => :friday, "SA" => :saturday }.freeze
    RULE_PATTERN = /\AFREQ=(?<freq>[A-Z]+)(?:;INTERVAL=(?<interval>\d+))?(?:;BYDAY=(?<days>[A-Z,]+))?\z/

    attr_reader :frequency, :interval, :weekdays, :until_date

    class << self
      def parse(text)
        match = RULE_PATTERN.match(text.to_s.strip.upcase)
        raise InvalidRuleError, "unparseable rule: #{text.inspect}" unless match

        days = match[:days]&.split(",")&.map do |code|
          DAY_CODES.fetch(code) { raise InvalidRuleError, "unknown day code #{code}" }
        end
        new(frequency: match[:freq].downcase, interval: Integer(match[:interval] || 1), weekdays: days || [])
      end

      def daily(every: 1) = new(frequency: :daily, interval: every)

      def business_days(until_date: nil)
        new(frequency: :weekly, weekdays: BUSINESS_DAYS, until_date: until_date)
      end
    end

    def initialize(frequency:, interval: 1, weekdays: [], until_date: nil)
      unless FREQUENCIES.include?(frequency.to_s)
        raise InvalidRuleError, "frequency must be one of #{FREQUENCIES.join(", ")}, got #{frequency.inspect}"
      end
      raise InvalidRuleError, "interval must be positive" if interval < 1

      @frequency = frequency.to_sym
      @interval = interval
      @weekdays = weekdays.map(&:to_sym).to_set
      @until_date = until_date
    end

    def occurs_on?(date, anchor:)
      return false if date < anchor
      return false if until_date && date > until_date

      case [frequency, weekdays.empty?]
      in [:daily, _]
        ((date - anchor).to_i % interval).zero?
      in [:weekly, true]
        date.wday == anchor.wday && (((date - anchor).to_i / 7) % interval).zero?
      in [:weekly, false]
        weekdays.include?(WEEKDAYS[date.wday]) && (((date - anchor).to_i / 7) % interval).zero?
      in [:monthly, _]
        months = (date.year * 12 + date.month) - (anchor.year * 12 + anchor.month)
        date.day == anchor.day && (months % interval).zero?
      end
    end

    def each_occurrence(from:, limit: 100, horizon_days: 3 * 365)
      return enum_for(:each_occurrence, from: from, limit: limit, horizon_days: horizon_days) unless block_given?

      anchor = from.to_date
      date = anchor
      emitted = 0
      until emitted >= limit || (date - anchor).to_i > horizon_days
        if occurs_on?(date, anchor: anchor)
          yield date
          emitted += 1
        end
        date = date.next_day
      end
      emitted
    end

    def to_s
      parts = ["FREQ=#{frequency.upcase}"]
      parts << "INTERVAL=#{interval}" unless interval == 1
      parts << "BYDAY=#{weekdays.map { |day| DAY_CODES.key(day) }.compact.join(",")}" if weekdays.any?
      parts.join(";")
    end

    def ==(other) = other.is_a?(self.class) && to_s == other.to_s
    alias eql? ==

    def hash = to_s.hash
  end

  class Calendar
    include Enumerable

    attr_accessor :time_zone
    attr_reader :name, :last_import_line

    def initialize(name, time_zone: "UTC", working_hours: 9..17)
      @name = name
      @time_zone = time_zone
      @working_hours = working_hours
      @slots = []
      @listeners = Hash.new { |hash, key| hash[key] = [] }
    end

    def each(&block)
      return to_enum(:each) unless block

      @slots.sort.each(&block)
      self
    end

    def on(event, &handler)
      @listeners[event] << handler
      self
    end

    def book(starts_at:, minutes: 30, label: nil)
      slot = Slot.new(starts_at: starts_at, ends_at: starts_at + minutes * 60, label: label)
      raise ArgumentError, "outside working hours: #{slot}" unless within_hours?(slot)

      if (conflict = @slots.find { |existing| existing.overlaps?(slot) })
        emit(:conflict, slot, conflict)
        return nil
      end

      @slots << slot
      emit(:booked, slot)
      slot
    end

    def import(lines)
      imported = 0
      lines.each_with_index do |line, index|
        next if line.strip.empty? || line.start_with?("#")

        begin
          starts, minutes, label = line.split("|", 3).map(&:strip)
          imported += 1 if book(starts_at: Time.parse(starts), minutes: Integer(minutes), label: label)
        rescue ArgumentError, TypeError => e
          emit(:import_error, index + 1, e.message)
        ensure
          @last_import_line = index + 1
        end
      end
      imported
    end

    protected

    attr_reader :slots

    def within_hours?(slot)
      @working_hours.cover?(slot.starts_at.hour) && slot.ends_at.hour <= @working_hours.end
    end

    private

    def emit(event, *payload)
      @listeners[event].each { |listener| listener.call(*payload) }
    end
  end
end
