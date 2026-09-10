// Package domain holds what the studio knows about an asset independently of where it is stored or how it
// is served: the kinds and formats it understands, the shape of an id, the rules a save must satisfy, and
// the manifest that bridges assets to wowd content ids.
//
// It imports only the standard library (AGENTS.md, invariant 3) and never asks for the time or a random
// number (invariant 4): both are handed in by the application layer, so every rule here is a pure function
// a table test can pin down.
package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrNotFound is returned when an id names nothing. ErrInvalid is returned when a save is refused for a bad
// field. Adapters translate them at the edge — the HTTP layer to 404 and 400 — and nothing else about an
// error is part of the contract.
var (
	ErrNotFound = errors.New("asset not found")
	ErrInvalid  = errors.New("invalid asset")
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

// Kinds lists every kind in the order the UI shows them. It is a table so that the frontend, the docs and
// the validation cannot disagree about the set.
var Kinds = []Kind{KindCharacter, KindCreature, KindItem, KindLandscape, KindTexture}

// KnownKind reports whether k is one the studio understands. Unknown kinds are refused at save so a typo
// cannot create an asset no workflow can open.
func KnownKind(k Kind) bool {
	for _, known := range Kinds {
		if k == known {
			return true
		}
	}
	return false
}

// formats maps each payload format to the media type it is served with. The set is closed on purpose: it
// is exactly what wowd's three.js client loads natively (invariant 5), and the format is part of the
// payload's file name, so nothing outside the set may ever reach the disk. One table rather than two
// switches, so the list of formats and their content types cannot drift apart.
var formats = map[string]string{
	"glb":  "model/gltf-binary",
	"gltf": "model/gltf+json",
	"png":  "image/png",
}

// KnownFormat reports whether f is a payload format the studio stores and serves.
func KnownFormat(f string) bool {
	_, ok := formats[f]
	return ok
}

// ContentType is the media type a payload of format f is served with. Unknown formats are refused at save,
// so the fallback is only ever reached for a file written before that check existed.
func ContentType(f string) string {
	if ct, ok := formats[f]; ok {
		return ct
	}
	return "application/octet-stream"
}

// Asset is the metadata of one stored asset. The payload (model or texture bytes) lives beside it under
// the repository's care. The JSON names are the asset's exchange format: the same object is what the
// repository writes to <id>.json and what the API answers, and both are documented in docs/architecture.md.
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

// Validate is what every save must satisfy before anything touches the disk. It checks each field on its
// own; whether the id names an existing asset is the repository's knowledge, not a rule.
func (a Asset) Validate() error {
	switch {
	case strings.TrimSpace(a.Name) == "":
		return fmt.Errorf("%w: name is required", ErrInvalid)
	case !KnownKind(a.Kind):
		return fmt.Errorf("%w: unknown kind %q", ErrInvalid, a.Kind)
	case a.Format == "":
		return fmt.Errorf("%w: format is required", ErrInvalid)
	case !KnownFormat(a.Format):
		return fmt.Errorf("%w: unknown format %q", ErrInvalid, a.Format)
	case a.ID != "" && !ValidID(a.ID):
		return fmt.Errorf("%w: bad id %q", ErrInvalid, a.ID)
	}
	return nil
}

// ValidID keeps ids to what makes a safe file name: letters, digits, '-' and '_', at most 64 of them. No
// path separators, so an id can never leave the data directory; no dots, so it can never collide with the
// ".json" metadata suffix or masquerade as a payload of another format.
func ValidID(id string) bool {
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
