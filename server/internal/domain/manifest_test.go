package domain

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestBuildManifest(t *testing.T) {
	at := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	bound := Asset{ID: "a1", Name: "Mossy Boar", Kind: KindCreature, Format: "glb", WowdRef: "moss_boar"}
	unbound := Asset{ID: "b2", Name: "sketch", Kind: KindItem, Format: "glb"}

	m := BuildManifest([]Asset{unbound, bound}, at)
	if m.Version != ManifestVersion || !m.Generated.Equal(at) {
		t.Fatalf("header %d @ %v", m.Version, m.Generated)
	}
	if len(m.Assets) != 1 {
		t.Fatalf("got %d entries, want 1 (only the bound asset)", len(m.Assets))
	}
	want := ManifestEntry{WowdRef: "moss_boar", Kind: "creature", Format: "glb", AssetID: "a1",
		Name: "Mossy Boar", URL: "/api/assets/a1/payload"}
	if m.Assets[0] != want {
		t.Fatalf("entry %+v, want %+v", m.Assets[0], want)
	}
}

// The game client calls .find() on the list; an empty manifest must therefore be [] on the wire, not null.
func TestEmptyManifestIsAList(t *testing.T) {
	raw, err := json.Marshal(BuildManifest(nil, time.Time{}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"assets":[]`) {
		t.Fatalf("empty manifest serialised as %s", raw)
	}
}
