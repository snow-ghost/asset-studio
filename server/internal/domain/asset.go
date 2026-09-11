// Package domain holds what the studio knows about an asset independently of where it is stored or how it
// is served: the kinds and formats it understands, the shape of an id, the rules a save must satisfy, and
// the manifest that bridges assets to wowd content ids.
//
// It imports only the standard library (AGENTS.md, invariant 3) and never asks for the time or a random
// number (invariant 4): both are handed in by the application layer, so every rule here is a pure function
// a table test can pin down.
package domain

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
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

// formatSpec is everything the studio knows about one payload format: how it is served, and how to tell
// from the first bytes whether a payload really is one. The check is a sniff, not a parse — the studio
// stores exactly the file the game will load (invariant 5), so the question is only whether this can be
// that file at all, not whether it is a good one.
type formatSpec struct {
	contentType string
	looksLike   func(payload []byte) bool
}

// formats is the closed set of payload formats: exactly what wowd's three.js client loads natively, and
// part of the payload's file name, so nothing outside the set may ever reach the disk. One table rather
// than several switches, so the list, the media types and the sniffers cannot drift apart.
var formats = map[string]formatSpec{
	"glb":  {"model/gltf-binary", looksLikeGLB},
	"gltf": {"model/gltf+json", looksLikeGltfJSON},
	"png":  {"image/png", looksLikePNG},
}

// modelFormats and textureFormats are the formats that make sense for a kind: a texture is a picture, a
// model is a scene, and a file of the wrong shape under a kind would be stored faithfully and fail only in
// the game. FormatsFor is the table the frontend mirrors.
var (
	modelFormats   = []string{"glb", "gltf"}
	textureFormats = []string{"png"}

	formatsByKind = map[Kind][]string{
		KindCharacter: modelFormats,
		KindCreature:  modelFormats,
		KindItem:      modelFormats,
		KindLandscape: modelFormats,
		KindTexture:   textureFormats,
	}
)

// FormatsFor lists the payload formats valid for a kind, as a copy the caller may keep.
func FormatsFor(kind Kind) []string {
	return append([]string(nil), formatsByKind[kind]...)
}

func formatFits(kind Kind, format string) bool {
	for _, f := range formatsByKind[kind] {
		if f == format {
			return true
		}
	}
	return false
}

// KnownFormat reports whether f is a payload format the studio stores and serves.
func KnownFormat(f string) bool {
	_, ok := formats[f]
	return ok
}

// ContentType is the media type a payload of format f is served with. Unknown formats are refused at save,
// so the fallback is only ever reached for a file written before that check existed.
func ContentType(f string) string {
	if spec, ok := formats[f]; ok {
		return spec.contentType
	}
	return "application/octet-stream"
}

// ValidatePayload refuses bytes that cannot be a file of the given format: a "png" without the PNG
// signature, a "glb" without the glTF header, a "gltf" that is not JSON with an asset version. It is
// called only when a save carries a payload.
func ValidatePayload(format string, payload []byte) error {
	spec, ok := formats[format]
	if !ok {
		return fmt.Errorf("%w: unknown format %q", ErrInvalid, format)
	}
	if !spec.looksLike(payload) {
		return fmt.Errorf("%w: payload does not look like %s", ErrInvalid, format)
	}
	return nil
}

var pngSignature = []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}

func looksLikePNG(payload []byte) bool { return bytes.HasPrefix(payload, pngSignature) }

// glbMagic is "glTF" as the little-endian uint32 the GLB header starts with; the header is 12 bytes.
const (
	glbMagic       = 0x46546C67
	glbHeaderBytes = 12
)

func looksLikeGLB(payload []byte) bool {
	return len(payload) >= glbHeaderBytes && binary.LittleEndian.Uint32(payload) == glbMagic
}

func looksLikeGltfJSON(payload []byte) bool {
	var doc struct {
		Asset struct {
			Version any `json:"version"`
		} `json:"asset"`
	}
	if err := json.Unmarshal(payload, &doc); err != nil {
		return false
	}
	_, ok := doc.Asset.Version.(string)
	return ok
}

// MaxProceduralBytes bounds a procedural recipe. A recipe is a handful of numbers and colours; anything
// larger is not a recipe, and the metadata file is meant to stay small enough to read in a diff.
const MaxProceduralBytes = 4096

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
	WowdRef string `json:"wowdRef,omitempty"`
	// Procedural is the recipe of a procedurally generated texture: the parameters the studio's generator
	// needs to draw the same pixels again, so an opened texture can be edited by its knobs rather than only
	// replaced. The server keeps it opaque — the schema belongs to the frontend's generator and changes with
	// it; here it is a JSON object of bounded size, allowed only on a texture. It lives in the metadata and
	// not inside the PNG (a tEXt chunk) on purpose: a designer may open the PNG in an outside editor and
	// save it back, and most editors drop chunks they do not know — <id>.json is untouched by that.
	Procedural json.RawMessage `json:"procedural,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
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
	case !formatFits(a.Kind, a.Format):
		return fmt.Errorf("%w: format %q is not valid for kind %q (expected %s)",
			ErrInvalid, a.Format, a.Kind, strings.Join(formatsByKind[a.Kind], " or "))
	case a.ID != "" && !ValidID(a.ID):
		return fmt.Errorf("%w: bad id %q", ErrInvalid, a.ID)
	case len(a.Procedural) > 0 && a.Kind != KindTexture:
		return fmt.Errorf("%w: procedural parameters belong to a texture, not to a %s", ErrInvalid, a.Kind)
	case len(a.Procedural) > MaxProceduralBytes:
		return fmt.Errorf("%w: procedural parameters exceed %d bytes", ErrInvalid, MaxProceduralBytes)
	case len(a.Procedural) > 0 && !isJSONObject(a.Procedural):
		return fmt.Errorf("%w: procedural parameters must be a JSON object", ErrInvalid)
	}
	return nil
}

func isJSONObject(raw []byte) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && trimmed[0] == '{' && json.Valid(trimmed)
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
