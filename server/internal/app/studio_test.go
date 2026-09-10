package app

import (
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

func TestSaveCreatesWithMintedIDAndTimestamps(t *testing.T) {
	s, _ := newStudio()
	saved, err := s.Save(creature("moss_boar"), []byte("glb"))
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID != "id1" || saved.CreatedAt.IsZero() || !saved.CreatedAt.Equal(saved.UpdatedAt) {
		t.Fatalf("saved %+v", saved)
	}
	raw, a, err := s.Payload("id1")
	if err != nil || string(raw) != "glb" || a.Name != "moss_boar" {
		t.Fatalf("payload %q %+v %v", raw, a, err)
	}
}

func TestSaveUpdatesInPlace(t *testing.T) {
	s, _ := newStudio()
	first, _ := s.Save(creature("moss_boar"), []byte("v1"))

	cases := []struct {
		name    string
		change  func(a *domain.Asset)
		payload []byte
		reason  string // "" means accepted
		wantRaw string
	}{
		{"new payload keeps id and creation time", func(*domain.Asset) {}, []byte("v2"), "", "v2"},
		{"metadata only keeps the payload", func(a *domain.Asset) { a.Name = "mossy_boar" }, nil, "", "v2"},
		{"format change needs a payload", func(a *domain.Asset) { a.Format = "gltf" }, nil, "cannot change format", "v2"},
		{"format change with a payload", func(a *domain.Asset) { a.Format = "gltf" }, []byte("v3"), "", "v3"},
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
			if err != nil || string(raw) != tc.wantRaw {
				t.Fatalf("payload %q %v, want %q", raw, err, tc.wantRaw)
			}
		})
	}
}

func TestSaveUnderAChosenID(t *testing.T) {
	s, _ := newStudio()
	a := creature("moss_boar")
	a.ID = "chosen-1"
	saved, err := s.Save(a, []byte("glb"))
	if err != nil || saved.ID != "chosen-1" || saved.CreatedAt.IsZero() {
		t.Fatalf("saved %+v %v", saved, err)
	}
	a.ID = "../escape"
	if _, err := s.Save(a, []byte("glb")); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("bad id accepted: %v", err)
	}
}

func TestListIsNewestFirst(t *testing.T) {
	s, _ := newStudio()
	for _, n := range []string{"first", "second", "third"} {
		if _, err := s.Save(creature(n), []byte("x")); err != nil {
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
	saved, _ := s.Save(creature("moss_boar"), []byte("x"))
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
	if _, err := s.Save(bound, []byte("x")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Save(creature("sketch"), []byte("x")); err != nil {
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
