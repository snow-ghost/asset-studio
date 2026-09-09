// Package store is the asset studio's disk-backed asset store.
//
// An asset is two files under the data directory: a metadata JSON (<id>.json) and a payload (<id>.<ext>,
// e.g. a glb model or a png texture). Keeping the payload as an ordinary file — not a blob inside the JSON —
// is deliberate: a glTF model or a texture is exactly the file wowd's three.js client will load, so it can
// be served byte-for-byte and, later, copied straight into the game's asset directory without a conversion
// step. The metadata is small and human-readable so a designer (or a diff) can see what an id means.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Kind is what an asset represents. It decides which studio workflow edits it and, on the wowd side, which
// content table its WowdRef points into (creature_templates.csv, content/items, content/zones, …).
type Kind string

const (
	KindCharacter Kind = "character" // a player character model
	KindCreature  Kind = "creature"  // an NPC or monster model (creature_templates.csv)
	KindItem      Kind = "item"      // an equippable or world item model
	KindLandscape Kind = "landscape" // terrain features, props, vegetation
	KindTexture   Kind = "texture"   // a texture image, referenced by the models above
)

// KnownKind reports whether k is one the studio understands. Unknown kinds are refused at save so a typo
// cannot create an asset no workflow can open.
func KnownKind(k Kind) bool {
	switch k {
	case KindCharacter, KindCreature, KindItem, KindLandscape, KindTexture:
		return true
	default:
		return false
	}
}

// Asset is the metadata for one stored asset. The payload (model or texture bytes) lives beside it.
type Asset struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind Kind   `json:"kind"`
	// Format is the payload's file format: "glb" or "gltf" for models, "png" for textures.
	Format string   `json:"format"`
	Tags   []string `json:"tags,omitempty"`
	// WowdRef ties this asset to a wowd content id — a creature_id, an item id, a zone or subzone id. It is
	// the whole point of the bridge: the studio makes the picture, the game already owns the id, and the
	// manifest maps one to the other so nothing on the game side has to invent an asset name (see
	// docs/integration-with-wowd.md).
	WowdRef   string    `json:"wowdRef,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Store reads and writes assets under a single directory.
type Store struct {
	dir string
}

// New opens (creating if needed) a store rooted at dir.
func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("store: create %s: %w", dir, err)
	}
	return &Store{dir: dir}, nil
}

func (s *Store) metaPath(id string) string { return filepath.Join(s.dir, id+".json") }

func (s *Store) payloadPath(a Asset) string { return filepath.Join(s.dir, a.ID+"."+a.Format) }

// List returns every asset's metadata, newest first.
func (s *Store) List() ([]Asset, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, fmt.Errorf("store: list: %w", err)
	}
	out := make([]Asset, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".json")
		a, err := s.Get(id)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

// Get returns one asset's metadata.
func (s *Store) Get(id string) (Asset, error) {
	if !validID(id) {
		return Asset{}, fmt.Errorf("store: %w: bad id %q", ErrNotFound, id)
	}
	raw, err := os.ReadFile(s.metaPath(id))
	if err != nil {
		if os.IsNotExist(err) {
			return Asset{}, fmt.Errorf("store: %w: %s", ErrNotFound, id)
		}
		return Asset{}, fmt.Errorf("store: read %s: %w", id, err)
	}
	var a Asset
	if err := json.Unmarshal(raw, &a); err != nil {
		return Asset{}, fmt.Errorf("store: parse %s: %w", id, err)
	}
	return a, nil
}

// Payload returns the raw model or texture bytes for an asset.
func (s *Store) Payload(id string) ([]byte, Asset, error) {
	a, err := s.Get(id)
	if err != nil {
		return nil, Asset{}, err
	}
	raw, err := os.ReadFile(s.payloadPath(a))
	if err != nil {
		return nil, Asset{}, fmt.Errorf("store: read payload %s: %w", id, err)
	}
	return raw, a, nil
}

// Save writes an asset. A blank ID mints a new one; a set ID overwrites, so the same call creates and
// updates. payload may be nil to change only the metadata of an existing asset.
func (s *Store) Save(a Asset, payload []byte) (Asset, error) {
	if strings.TrimSpace(a.Name) == "" {
		return Asset{}, fmt.Errorf("store: %w: name is required", ErrInvalid)
	}
	if !KnownKind(a.Kind) {
		return Asset{}, fmt.Errorf("store: %w: unknown kind %q", ErrInvalid, a.Kind)
	}
	if a.Format == "" {
		return Asset{}, fmt.Errorf("store: %w: format is required", ErrInvalid)
	}
	now := time.Now().UTC()
	if a.ID == "" {
		a.ID = newID()
		a.CreatedAt = now
	} else if !validID(a.ID) {
		return Asset{}, fmt.Errorf("store: %w: bad id %q", ErrInvalid, a.ID)
	} else if existing, err := s.Get(a.ID); err == nil {
		a.CreatedAt = existing.CreatedAt
		if payload == nil {
			// Metadata-only update: keep the old payload, but if the format changed the old file would be
			// orphaned. Refuse rather than silently leave two payloads for one id.
			if existing.Format != a.Format {
				return Asset{}, fmt.Errorf("store: %w: cannot change format without a new payload", ErrInvalid)
			}
		} else if existing.Format != a.Format {
			_ = os.Remove(s.payloadPath(existing))
		}
	}
	a.UpdatedAt = now

	if payload != nil {
		if err := os.WriteFile(s.payloadPath(a), payload, 0o644); err != nil {
			return Asset{}, fmt.Errorf("store: write payload %s: %w", a.ID, err)
		}
	}
	meta, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return Asset{}, fmt.Errorf("store: marshal %s: %w", a.ID, err)
	}
	if err := os.WriteFile(s.metaPath(a.ID), meta, 0o644); err != nil {
		return Asset{}, fmt.Errorf("store: write meta %s: %w", a.ID, err)
	}
	return a, nil
}

// Delete removes an asset and its payload.
func (s *Store) Delete(id string) error {
	a, err := s.Get(id)
	if err != nil {
		return err
	}
	_ = os.Remove(s.payloadPath(a))
	if err := os.Remove(s.metaPath(id)); err != nil {
		return fmt.Errorf("store: delete %s: %w", id, err)
	}
	return nil
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// validID keeps ids to what makes a safe filename: no path separators, no dots, so an id can never escape
// the data directory or collide with the ".json" suffix.
func validID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return false
		}
	}
	return true
}
