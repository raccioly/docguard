package sample

import "fmt"

// @implements acme.golden#FR-001
func Total(items []int, rate float64) float64 {
	sum := 0
	for _, item := range items {
		sum += item
	}
	return float64(sum) * (1 - rate)
}

// @implements acme.golden#FR-002
func (c *Cart) Add(item int) {
	fmt.Println(item)
}
