// Package memrepo is the in-memory Repository. It exists for tests: the application layer's own unit tests
// run against it in microseconds, and it is the second implementation that makes the Repository port worth
// having at all (AGENTS.md, section 5: a port with one implementation and no fake is a port too many).
package memrepo

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/snow-ghost/asset-studio/server/internal/domain"
)

// Repo keeps assets in maps. It is safe for concurrent use so a test may drive it from several goroutines.
type Repo struct {
	mu       sync.Mutex
	assets   map[string]domain.Asset
	payloads map[string][]byte
}

// New returns an empty repository.
func New() *Repo {
	return &Repo{assets: map[string]domain.Asset{}, payloads: map[string][]byte{}}
}

func (r *Repo) List() ([]domain.Asset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.Asset, 0, len(r.assets))
	for _, a := range r.assets {
		out = append(out, a)
	}
	return out, nil
}

func (r *Repo) Get(id string) (domain.Asset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, ok := r.assets[id]
	if !ok {
		return domain.Asset{}, fmt.Errorf("memrepo: %w: %s", domain.ErrNotFound, id)
	}
	return a, nil
}

func (r *Repo) Payload(id string) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.assets[id]; !ok {
		return nil, fmt.Errorf("memrepo: %w: %s", domain.ErrNotFound, id)
	}
	raw, ok := r.payloads[id]
	if !ok {
		return nil, fmt.Errorf("memrepo: asset %s has no payload", id)
	}
	return append([]byte(nil), raw...), nil
}

func (r *Repo) Put(a domain.Asset, payload []byte) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	// The asset's only reference-typed fields are copied so a caller mutating its own value afterwards
	// cannot reach into the store — the disk repository has that property for free, this one must earn it.
	a.Tags = append([]string(nil), a.Tags...)
	a.Procedural = append(json.RawMessage(nil), a.Procedural...)
	r.assets[a.ID] = a
	if payload != nil {
		r.payloads[a.ID] = append([]byte(nil), payload...)
	}
	return nil
}

func (r *Repo) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.assets[id]; !ok {
		return fmt.Errorf("memrepo: %w: %s", domain.ErrNotFound, id)
	}
	delete(r.assets, id)
	delete(r.payloads, id)
	return nil
}
