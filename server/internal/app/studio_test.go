package app

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/snow-ghost/asset-studio/server/internal/adapters/memrepo"
	"github.com/snow-ghost/asset-studio/server/internal/domain"
)

// A clock that moves one second per call and ids that count up: every timestamp and id in a test is a
// value the test can predict, which is the point of the ports.
type tickingClock struct{ now time.Time }

func (c *tickingClock) Now() time.Time {
	c.now = c.now.Add(time.Second)
	return c.now
}

type countingIDs struct{ n int }

func (c *countingIDs) New() string {
	c.n++
	return fmt.Sprintf("id%d", c.n)
}

func newStudio() (*Studio, *tickingClock) {
	clock := &tickingClock{now: time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)}
	return New(memrepo.New(), clock, &countingIDs{}), clock
}

func creature(name string) domain.Asset {
	return domain.Asset{Name: name, Kind: domain.KindCreature, Format: "glb"}
}

func texture(name string) domain.Asset {
	return domain.Asset{Name: name, Kind: domain.KindTexture, Format: "png"}
}

// Payloads that pass the format sniff (domain.ValidatePayload) and differ by a tag, so a test can tell
// which one came back. The bytes are the smallest thing each format's check accepts; the studio stores
// them as they are and never parses further.
func glb(tag string) []byte {
	b := make([]byte, 12, 12+len(tag))
	binary.LittleEndian.PutUint32(b, 0x46546C67) // "glTF"
	binary.LittleEndian.PutUint32(b[4:], 2)
	binary.LittleEndian.PutUint32(b[8:], uint32(12+len(tag)))
	return append(b, tag...)
}

func gltf(tag string) []byte {
	return []byte(fmt.Sprintf(`{"asset":{"version":"2.0"},"extras":{"tag":%q}}`, tag))
}

func png(tag string) []byte {
	return append([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, tag...)
}

func TestSaveCreatesWithMintedIDAndTimestamps(t *testing.T) {
	s, _ := newStudio()
	saved, err := s.Save(creature("moss_boar"), glb("first"))
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID != "id1" || saved.CreatedAt.IsZero() || !saved.CreatedAt.Equal(saved.UpdatedAt) {
		t.Fatalf("saved %+v", saved)
	}
	raw, a, err := s.Payload("id1")
	if err != nil || !bytes.Equal(raw, glb("first")) || a.Name != "moss_boar" {
		t.Fatalf("payload %q %+v %v", raw, a, err)
	}
}

func TestSaveUpdatesInPlace(t *testing.T) {
	s, _ := newStudio()
	first, _ := s.Save(creature("moss_boar"), glb("v1"))

	cases := []struct {
		name    string
		change  func(a *domain.Asset)
		payload []byte
		reason  string // "" means accepted
		wantRaw []byte
	}{
		{"new payload keeps id and creation time", func(*domain.Asset) {}, glb("v2"), "", glb("v2")},
		{"metadata only keeps the payload", func(a *domain.Asset) { a.Name = "mossy_boar" }, nil, "", glb("v2")},
		{"format change needs a payload", func(a *domain.Asset) { a.Format = "gltf" }, nil, "cannot change format", glb("v2")},
		{"format change with a payload", func(a *domain.Asset) { a.Format = "gltf" }, gltf("v3"), "", gltf("v3")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := creature("moss_boar")
			a.ID = first.ID
			tc.change(&a)
			saved, err := s.Save(a, tc.payload)
			if tc.reason != "" {
				if !errors.Is(err, domain.ErrInvalid) {
					t.Fatalf("got %v, want ErrInvalid mentioning %q", err, tc.reason)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if saved.ID != first.ID || !saved.CreatedAt.Equal(first.CreatedAt) {
					t.Fatalf("identity changed: %+v vs %+v", saved, first)
				}
				if !saved.UpdatedAt.After(first.UpdatedAt) {
					t.Fatalf("updated %v not after %v", saved.UpdatedAt, first.UpdatedAt)
				}
			}
			raw, _, err := s.Payload(first.ID)
			if err != nil || !bytes.Equal(raw, tc.wantRaw) {
				t.Fatalf("payload %q %v, want %q", raw, err, tc.wantRaw)
			}
		})
	}
}

func TestSaveRefusesANewAssetWithoutAPayload(t *testing.T) {
	s, _ := newStudio()
	if _, err := s.Save(creature("moss_boar"), nil); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("got %v, want ErrInvalid", err)
	}
	if list, _ := s.List(); len(list) != 0 {
		t.Fatalf("a refused save left %d assets behind", len(list))
	}
}

// The format says what the bytes must look like, and the kind says which formats make sense: both are
// checked before anything is stored, so a file the game could not load never reaches the disk.
func TestSaveRefusesAPayloadOfAnotherFormatAndAFormatOfAnotherKind(t *testing.T) {
	s, _ := newStudio()
	cases := []struct {
		name    string
		asset   domain.Asset
		payload []byte
		reason  string
	}{
		{"png bytes as glb", creature("boar"), png("x"), "does not look like glb"},
		{"glb bytes as gltf", func() domain.Asset { a := creature("boar"); a.Format = "gltf"; return a }(), glb("x"), "does not look like gltf"},
		{"glb bytes as png", texture("bark"), glb("x"), "does not look like png"},
		{"texture as glb", func() domain.Asset { a := texture("bark"); a.Format = "glb"; return a }(), glb("x"), "not valid for kind"},
		{"model as png", func() domain.Asset { a := creature("boar"); a.Format = "png"; return a }(), png("x"), "not valid for kind"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := s.Save(tc.asset, tc.payload)
			if !errors.Is(err, domain.ErrInvalid) || !contains(err, tc.reason) {
				t.Fatalf("got %v, want ErrInvalid mentioning %q", err, tc.reason)
			}
		})
	}
	if list, _ := s.List(); len(list) != 0 {
		t.Fatalf("refused saves left %d assets behind", len(list))
	}
}

func TestSaveKeepsAProceduralRecipeAndDoesNotAliasIt(t *testing.T) {
	s, _ := newStudio()
	recipe := []byte(`{"type":"noise","size":256,"seed":7}`)
	a := texture("bark")
	a.Procedural = json.RawMessage(recipe)
	saved, err := s.Save(a, png("bark"))
	if err != nil {
		t.Fatal(err)
	}
	// The caller scribbles over its buffer after the save; the stored recipe must not change.
	for i := range recipe {
		recipe[i] = 'x'
	}
	got, err := s.Get(saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(got.Procedural) != `{"type":"noise","size":256,"seed":7}` {
		t.Fatalf("stored recipe is %s", got.Procedural)
	}

	// A metadata-only update replaces the recipe like any other field, and may drop it.
	got.Procedural = nil
	if _, err := s.Save(got, nil); err != nil {
		t.Fatal(err)
	}
	if again, _ := s.Get(saved.ID); len(again.Procedural) != 0 {
		t.Fatalf("recipe survived a save without one: %s", again.Procedural)
	}

	// On a model it is refused, and nothing is written.
	m := creature("boar")
	m.Procedural = json.RawMessage(`{"type":"noise"}`)
	if _, err := s.Save(m, glb("x")); !errors.Is(err, domain.ErrInvalid) || !contains(err, "procedural") {
		t.Fatalf("got %v, want ErrInvalid mentioning procedural", err)
	}
}

func TestSaveUnderAChosenID(t *testing.T) {
	s, _ := newStudio()
	a := creature("moss_boar")
	a.ID = "chosen-1"
	saved, err := s.Save(a, glb("x"))
	if err != nil || saved.ID != "chosen-1" || saved.CreatedAt.IsZero() {
		t.Fatalf("saved %+v %v", saved, err)
	}
	a.ID = "../escape"
	if _, err := s.Save(a, glb("x")); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("bad id accepted: %v", err)
	}
}

func TestListIsNewestFirst(t *testing.T) {
	s, _ := newStudio()
	for _, n := range []string{"first", "second", "third"} {
		if _, err := s.Save(creature(n), glb(n)); err != nil {
			t.Fatal(err)
		}
	}
	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if got := []string{list[0].Name, list[1].Name, list[2].Name}; got[0] != "third" || got[1] != "second" || got[2] != "first" {
		t.Fatalf("order %v", got)
	}
}

func TestDeleteAndNotFound(t *testing.T) {
	s, _ := newStudio()
	saved, _ := s.Save(creature("moss_boar"), glb("x"))
	if err := s.Delete(saved.ID); err != nil {
		t.Fatal(err)
	}
	for name, err := range map[string]error{
		"get":     func() error { _, err := s.Get(saved.ID); return err }(),
		"payload": func() error { _, _, err := s.Payload(saved.ID); return err }(),
		"delete":  s.Delete(saved.ID),
	} {
		if !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("%s after delete: %v, want ErrNotFound", name, err)
		}
	}
}

func TestManifestListsBoundAssetsOnly(t *testing.T) {
	s, clock := newStudio()
	bound := creature("Mossy Boar")
	bound.WowdRef = "moss_boar"
	if _, err := s.Save(bound, glb("x")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Save(creature("sketch"), glb("y")); err != nil {
		t.Fatal(err)
	}
	m, err := s.Manifest()
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Assets) != 1 || m.Assets[0].WowdRef != "moss_boar" || !m.Generated.Equal(clock.now) {
		t.Fatalf("manifest %+v", m)
	}
}

func contains(err error, s string) bool {
	return err != nil && bytes.Contains([]byte(err.Error()), []byte(s))
}
