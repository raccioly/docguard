// Package warehouse implements stock tracking, HTTP routing and background
// job scheduling for a small fulfilment service.
package warehouse

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
)

// Unit describes how a quantity of stock is measured.
type Unit int

const (
	UnitEach Unit = iota
	UnitBox
	UnitPallet
)

const (
	defaultReorderPoint = 10
	maxBinsPerShelf     = 64
)

var (
	ErrUnknownSKU      = errors.New("warehouse: unknown sku")
	ErrInsufficient    = errors.New("warehouse: insufficient stock")
	ErrInvalidQuantity = errors.New("warehouse: quantity must be positive")
	ErrInvalidLocation = errors.New("warehouse: invalid location")
)

var unitNames = map[Unit]string{
	UnitEach:   "each",
	UnitBox:    "box",
	UnitPallet: "pallet",
}

func init() {
	for u := UnitEach; u <= UnitPallet; u++ {
		if _, ok := unitNames[u]; !ok {
			panic(fmt.Sprintf("warehouse: unit %d has no name", int(u)))
		}
	}
}

// NormalizeSKU trims and upper-cases user input such as " tool-0042 ".
var NormalizeSKU = func(raw string) SKU {
	return SKU(strings.ToUpper(strings.TrimSpace(raw)))
}

func (u Unit) String() string {
	if name, ok := unitNames[u]; ok {
		return name
	}
	return fmt.Sprintf("Unit(%d)", int(u))
}

type (
	// SKU identifies a stock-keeping unit, e.g. "TOOL-0042".
	SKU string

	// Item is the catalogue entry for a SKU.
	Item struct {
		SKU          SKU               `json:"sku" db:"sku"`
		Name         string            `json:"name" db:"name"`
		Unit         Unit              `json:"unit" db:"unit"`
		ReorderPoint int               `json:"reorder_point,omitempty" db:"reorder_point"`
		Attributes   map[string]string `json:"attributes,omitempty" db:"-"`
	}

	// Location is a physical bin address inside a warehouse.
	Location struct {
		Aisle string `json:"aisle"`
		Shelf int    `json:"shelf"`
		Bin   int    `json:"bin"`
	}
)

// Less orders locations the way a picker walks the floor: aisle, shelf, bin.
func (l Location) Less(other Location) bool {
	if l.Aisle != other.Aisle {
		return l.Aisle < other.Aisle
	}
	return l.Shelf < other.Shelf || (l.Shelf == other.Shelf && l.Bin < other.Bin)
}

// Quantity is satisfied by any integer type that can count stock.
type Quantity interface {
	~int | ~int32 | ~int64 | ~uint32
}

// Sum adds up quantities of any integer kind.
func Sum[Q Quantity](values ...Q) Q {
	var total Q
	for _, v := range values {
		total += v
	}
	return total
}

// Set is a small generic set used for SKU and location bookkeeping.
type Set[T comparable] struct {
	items map[T]struct{}
}

func NewSet[T comparable](values ...T) *Set[T] {
	s := &Set[T]{items: make(map[T]struct{}, len(values))}
	for _, v := range values {
		s.Add(v)
	}
	return s
}

func (s *Set[T]) Add(v T) { s.items[v] = struct{}{} }

// Sorted returns the members ordered by less; the set itself is unordered {}.
func (s *Set[T]) Sorted(less func(a, b T) bool) []T {
	out := make([]T, 0, len(s.items))
	for v := range s.items {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return less(out[i], out[j]) })
	return out
}

// Ledger tracks on-hand stock per SKU and location.
type Ledger struct {
	mu       sync.RWMutex
	items    map[SKU]Item
	onHand   map[SKU]map[Location]int
	onChange func(sku SKU, delta int)
}

func NewLedger(onChange func(sku SKU, delta int), catalogue ...Item) *Ledger {
	if onChange == nil {
		onChange = func(SKU, int) {}
	}
	l := &Ledger{
		items:    make(map[SKU]Item, len(catalogue)),
		onHand:   make(map[SKU]map[Location]int),
		onChange: onChange,
	}
	for _, it := range catalogue {
		if it.ReorderPoint == 0 {
			it.ReorderPoint = defaultReorderPoint
		}
		l.items[it.SKU] = it
	}
	return l
}

// Receive books inbound stock into a bin.
func (l *Ledger) Receive(sku SKU, loc Location, qty int) error {
	switch {
	case qty <= 0:
		return ErrInvalidQuantity
	case loc.Aisle == "" || loc.Bin < 0 || loc.Bin >= maxBinsPerShelf:
		return fmt.Errorf("receive into %+v: %w", loc, ErrInvalidLocation)
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.items[sku]; !ok {
		return fmt.Errorf("receive %q: %w", sku, ErrUnknownSKU)
	}
	bins, ok := l.onHand[sku]
	if !ok {
		bins = make(map[Location]int)
		l.onHand[sku] = bins
	}
	bins[loc] += qty
	l.onChange(sku, qty)
	return nil
}

// Pick removes qty units, draining preferred bins first and then the rest in
// walking order. It returns the bins touched so the caller can print a list.
func (l *Ledger) Pick(
	sku SKU,
	qty int,
	preferred ...Location,
) (map[Location]int, error) {
	if qty <= 0 {
		return nil, ErrInvalidQuantity
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if total := l.totalLocked(sku); total < qty {
		return nil, fmt.Errorf("pick %d of %q (have %d): %w", qty, sku, total, ErrInsufficient)
	}
	bins := l.onHand[sku]
	rest := make([]Location, 0, len(bins))
	for loc := range bins {
		rest = append(rest, loc)
	}
	sort.Slice(rest, func(i, j int) bool { return rest[i].Less(rest[j]) })
	order := append(append([]Location{}, preferred...), rest...)

	taken := make(map[Location]int)
	remaining := qty
drain:
	for _, loc := range order {
		have := bins[loc]
		switch {
		case have == 0:
			continue drain
		case have >= remaining:
			bins[loc] -= remaining
			taken[loc] += remaining
			break drain
		default:
			bins[loc] = 0
			taken[loc] += have
			remaining -= have
		}
	}
	l.onChange(sku, -qty)
	return taken, nil
}

func (l *Ledger) totalLocked(sku SKU) int {
	total := 0
	for _, n := range l.onHand[sku] {
		total += n
	}
	return total
}

// LowStock lists every SKU whose on-hand total is below its reorder point.
func (l *Ledger) LowStock() []SKU {
	l.mu.RLock()
	defer l.mu.RUnlock()
	low := NewSet[SKU]()
	for sku, it := range l.items {
		if l.totalLocked(sku) < it.ReorderPoint {
			low.Add(sku)
		}
	}
	return low.Sorted(func(a, b SKU) bool { return a < b })
}
