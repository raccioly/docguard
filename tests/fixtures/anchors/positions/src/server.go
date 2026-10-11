// Package server serves billing.
// @implements acme.billing#FR-001
package server

import "fmt"

// @implements acme.billing#FR-002
func (s *Server) Run() error {
	// @implements acme.billing#FR-003
	fmt.Println("x // @implements acme.billing#FR-009")
	return nil
}

// @implements acme.billing#FR-004
type Server struct{}

var raw = `// @implements acme.billing#FR-009`
