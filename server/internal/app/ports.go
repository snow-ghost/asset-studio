// Package app holds the studio's use cases: what happens when a designer saves, opens, lists or deletes an
// asset, and what the game gets when it asks for the manifest. It knows the rules (domain) and the ports it
// needs from the world — a repository, a clock, a source of ids — but no concrete adapter, so the same code
// runs against the disk in production, against memory in a unit test, and against whatever storage comes
// next without a line changing here.
package app

import (
	"time"

	"github.com/snow-ghost/asset-studio/server/internal/domain"
)

// Repository is where assets live. Implementations: adapters/fsrepo (disk, production) and
// adapters/memrepo (memory, tests).
type Repository interface {
	// List returns every asset's metadata in no particular order; the use case decides the ordering.
	List() ([]domain.Asset, error)
	// Get returns an error wrapping domain.ErrNotFound for an id that names nothing.
	Get(id string) (domain.Asset, error)
	// Payload returns the raw model or texture bytes of an asset that Get would find.
	Payload(id string) ([]byte, error)
	// Put writes the metadata and, when payload is not nil, the payload. A nil payload keeps the stored one.
	// A payload of another format left over from an earlier save of the same id is removed, so an asset
	// never has two payloads.
	Put(a domain.Asset, payload []byte) error
	// Delete removes the asset and its payload; an unknown id is domain.ErrNotFound.
	Delete(id string) error
}

// Clock is the only way the use cases learn the time (AGENTS.md, invariant 4). Production hands in the
// system clock; the acceptance suite hands in one it controls, so "newest first" and "updated later than
// created" are asserted against a known time rather than against however fast the machine happens to be.
type Clock interface {
	Now() time.Time
}

// IDs mints asset ids. Production uses random bytes; a test may use a counter so ids are predictable.
type IDs interface {
	New() string
}
