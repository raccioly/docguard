import Foundation

// @implements acme.golden#FR-001
func total(_ items: [Int], _ rate: Double) -> Double {
    var sum = 0
    for item in items {
        sum += item
    }
    return Double(sum) * (1 - rate)
}

class Cart {
    // @implements acme.golden#FR-002
    func add(_ item: Int) {
        print("item \(item)")
    }
}
