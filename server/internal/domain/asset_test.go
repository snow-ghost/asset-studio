package domain

import (
	"errors"
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	ok := Asset{Name: "moss_boar", Kind: KindCreature, Format: "glb"}
	cases := []struct {
		name   string
		mutate func(*Asset)
		reason string // "" means the asset is valid
	}{
		{"valid", func(*Asset) {}, ""},
		{"valid with a safe id", func(a *Asset) { a.ID = "a1B2-c3_d4" }, ""},
		{"blank name", func(a *Asset) { a.Name = "  " }, "name is required"},
		{"unknown kind", func(a *Asset) { a.Kind = "dragon" }, `unknown kind "dragon"`},
		{"missing format", func(a *Asset) { a.Format = "" }, "format is required"},
		{"unknown format", func(a *Asset) { a.Format = "exe" }, `unknown format "exe"`},
		{"format carrying a path", func(a *Asset) { a.Format = "glb/../../x" }, "unknown format"},
		{"format that is the metadata suffix", func(a *Asset) { a.Format = "json" }, "unknown format"},
		{"id with a separator", func(a *Asset) { a.ID = "../escape" }, `bad id "../escape"`},
		{"id with a dot", func(a *Asset) { a.ID = "moss.boar" }, "bad id"},
		{"id too long", func(a *Asset) { a.ID = strings.Repeat("a", 65) }, "bad id"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := ok
			tc.mutate(&a)
			err := a.Validate()
			if tc.reason == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("error %v is not ErrInvalid", err)
			}
			if !strings.Contains(err.Error(), tc.reason) {
				t.Fatalf("error %q does not mention %q", err, tc.reason)
			}
		})
	}
}

func TestFormats(t *testing.T) {
	cases := []struct {
		format      string
		known       bool
		contentType string
	}{
		{"glb", true, "model/gltf-binary"},
		{"gltf", true, "model/gltf+json"},
		{"png", true, "image/png"},
		{"jpg", false, "application/octet-stream"},
		{"", false, "application/octet-stream"},
	}
	for _, tc := range cases {
		if got := KnownFormat(tc.format); got != tc.known {
			t.Errorf("KnownFormat(%q) = %v, want %v", tc.format, got, tc.known)
		}
		if got := ContentType(tc.format); got != tc.contentType {
			t.Errorf("ContentType(%q) = %q, want %q", tc.format, got, tc.contentType)
		}
	}
}

func TestKnownKind(t *testing.T) {
	for _, k := range Kinds {
		if !KnownKind(k) {
			t.Errorf("%q is listed in Kinds but not known", k)
		}
	}
	for _, k := range []Kind{"", "dragon", "Creature"} {
		if KnownKind(k) {
			t.Errorf("%q should not be a known kind", k)
		}
	}
}
