package sample

import kotlin.math.max

// @implements acme.golden#FR-001
fun total(items: List<Int>, rate: Double): Double {
    var sum = 0
    for (item in items) {
        sum += item
    }
    return sum * (1 - rate)
}

class Cart {
    // @implements acme.golden#FR-002
    fun add(item: Int) {
        println(max(item, 0))
    }
}
