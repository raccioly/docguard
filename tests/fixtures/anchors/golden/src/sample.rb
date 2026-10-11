require 'json'

# @implements acme.golden#FR-001
def total(items, rate)
  sum = 0
  items.each do |item|
    sum += item
  end
  sum * (1 - rate)
end

class Cart
  # @implements acme.golden#FR-002
  def add(item)
    puts "item #{item}"
  end
end
