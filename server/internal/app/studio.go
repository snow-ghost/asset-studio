package app

import (
	"errors"
	"fmt"
	"sort"

	"github.com/snow-ghost/asset-studio/server/internal/domain"
)

// Studio is the set of use cases, one method each.
type Studio struct {
	repo  Repository
	clock Clock
	ids   IDs
}

// New wires the use cases to their ports.
func New(repo Repository, clock Clock, ids IDs) *Studio {
	return &Studio{repo: repo, clock: clock, ids: ids}
}

// List returns every asset, newest change first — the order the sidebar shows.
func (s *Studio) List() ([]domain.Asset, error) {
	assets, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	sort.SliceStable(assets, func(i, j int) bool { return assets[i].UpdatedAt.After(assets[j].UpdatedAt) })
	return assets, nil
}

// Get returns one asset's metadata.
func (s *Studio) Get(id string) (domain.Asset, error) {
	return s.repo.Get(id)
}

// Payload returns an asset's raw bytes together with its metadata, which the caller needs for the format.
func (s *Studio) Payload(id string) ([]byte, domain.Asset, error) {
	a, err := s.repo.Get(id)
	if err != nil {
		return nil, domain.Asset{}, err
	}
	raw, err := s.repo.Payload(id)
	if err != nil {
		return nil, domain.Asset{}, err
	}
	return raw, a, nil
}

// Save creates or updates an asset. A blank ID mints a new one; a set ID updates the asset of that id, or
// creates it under that id when nothing is there, so one call serves both the studio's Save button and a
// client that chooses its own ids. payload may be nil to change only the metadata of an existing asset.
func (s *Studio) Save(a domain.Asset, payload []byte) (domain.Asset, error) {
	if err := a.Validate(); err != nil {
		return domain.Asset{}, err
	}
	now := s.clock.Now()

	var existing *domain.Asset
	if a.ID == "" {
		a.ID = s.ids.New()
	} else if found, err := s.repo.Get(a.ID); err == nil {
		existing = &found
	} else if !errors.Is(err, domain.ErrNotFound) {
		return domain.Asset{}, err
	}

	switch {
	case existing == nil && payload == nil:
		// Metadata without a file would be an asset the viewport cannot open and the game cannot load;
		// refusing it here is what keeps <id>.json from ever pointing at nothing.
		return domain.Asset{}, fmt.Errorf("%w: payload is required for a new asset", domain.ErrInvalid)
	case existing == nil:
		a.CreatedAt = now
	case payload == nil && existing.Format != a.Format:
		// A metadata-only update cannot change the format: the stored payload is of the old format, and
		// pretending otherwise would leave an asset whose file does not match its metadata.
		return domain.Asset{}, fmt.Errorf("%w: cannot change format without a new payload", domain.ErrInvalid)
	default:
		a.CreatedAt = existing.CreatedAt
	}
	a.UpdatedAt = now

	if err := s.repo.Put(a, payload); err != nil {
		return domain.Asset{}, err
	}
	return a, nil
}

// Delete removes an asset and its payload.
func (s *Studio) Delete(id string) error {
	return s.repo.Delete(id)
}

// Manifest is the bridge to wowd: every asset bound to a wowd id, stamped with the current time.
func (s *Studio) Manifest() (domain.Manifest, error) {
	assets, err := s.List()
	if err != nil {
		return domain.Manifest{}, err
	}
	return domain.BuildManifest(assets, s.clock.Now()), nil
}
