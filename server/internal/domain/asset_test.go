package domain

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	ok := Asset{Name: "moss_boar", Kind: KindCreature, Format: "glb"}
	recipe := json.RawMessage(`{"type":"noise","size":256,"seed":7}`)
	cases := []struct {
		name   string
		mutate func(*Asset)
		reason string // "" means the asset is valid
	}{
		{"valid", func(*Asset) {}, ""},
		{"valid with a safe id", func(a *Asset) { a.ID = "a1B2-c3_d4" }, ""},
		{"valid gltf model", func(a *Asset) { a.Format = "gltf" }, ""},
		{"valid texture", func(a *Asset) { a.Kind = KindTexture; a.Format = "png" }, ""},
		{"valid texture with a recipe", func(a *Asset) { a.Kind = KindTexture; a.Format = "png"; a.Procedural = recipe }, ""},
		{"blank name", func(a *Asset) { a.Name = "  " }, "name is required"},
		{"unknown kind", func(a *Asset) { a.Kind = "dragon" }, `unknown kind "dragon"`},
		{"missing format", func(a *Asset) { a.Format = "" }, "format is required"},
		{"unknown format", func(a *Asset) { a.Format = "exe" }, `unknown format "exe"`},
		{"format carrying a path", func(a *Asset) { a.Format = "glb/../../x" }, "unknown format"},
		{"format that is the metadata suffix", func(a *Asset) { a.Format = "json" }, "unknown format"},
		{"model as png", func(a *Asset) { a.Format = "png" }, `format "png" is not valid for kind "creature"`},
		{"texture as glb", func(a *Asset) { a.Kind = KindTexture; a.Format = "glb" }, `not valid for kind "texture"`},
		{"texture as gltf", func(a *Asset) { a.Kind = KindTexture; a.Format = "gltf" }, "not valid for kind"},
		{"id with a separator", func(a *Asset) { a.ID = "../escape" }, `bad id "../escape"`},
		{"id with a dot", func(a *Asset) { a.ID = "moss.boar" }, "bad id"},
		{"id too long", func(a *Asset) { a.ID = strings.Repeat("a", 65) }, "bad id"},
		{"recipe on a model", func(a *Asset) { a.Procedural = recipe }, "procedural parameters belong to a texture"},
		{"recipe that is an array", func(a *Asset) { a.Kind = KindTexture; a.Format = "png"; a.Procedural = json.RawMessage(`[1,2,3]`) },
			"procedural parameters must be a JSON object"},
		{"recipe that is not JSON", func(a *Asset) { a.Kind = KindTexture; a.Format = "png"; a.Procedural = json.RawMessage(`{oops`) },
			"procedural parameters must be a JSON object"},
		{"recipe too large", func(a *Asset) {
			a.Kind = KindTexture
			a.Format = "png"
			a.Procedural = json.RawMessage(`{"pad":"` + strings.Repeat("x", MaxProceduralBytes) + `"}`)
		}, "procedural parameters exceed 4096 bytes"},
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

func TestFormatsFor(t *testing.T) {
	cases := []struct {
		kind Kind
		want []string
	}{
		{KindCharacter, []string{"glb", "gltf"}},
		{KindCreature, []string{"glb", "gltf"}},
		{KindItem, []string{"glb", "gltf"}},
		{KindLandscape, []string{"glb", "gltf"}},
		{KindTexture, []string{"png"}},
		{"dragon", nil},
	}
	for _, tc := range cases {
		got := FormatsFor(tc.kind)
		if strings.Join(got, ",") != strings.Join(tc.want, ",") {
			t.Errorf("FormatsFor(%q) = %v, want %v", tc.kind, got, tc.want)
		}
		// Every listed format must be one the studio knows, or the table lies about what can be stored.
		for _, f := range got {
			if !KnownFormat(f) {
				t.Errorf("FormatsFor(%q) lists unknown format %q", tc.kind, f)
			}
		}
	}
	// The copy is the caller's: changing it must not change the table.
	got := FormatsFor(KindTexture)
	got[0] = "jpg"
	if FormatsFor(KindTexture)[0] != "png" {
		t.Fatal("FormatsFor returned the table itself, not a copy")
	}
}

func TestValidatePayload(t *testing.T) {
	glb := make([]byte, 12)
	copy(glb, "glTF")
	glb[4] = 2
	cases := []struct {
		name    string
		format  string
		payload []byte
		reason  string // "" means accepted
	}{
		{"png with the signature", "png", append(append([]byte(nil), pngSignature...), 1, 2, 3), ""},
		{"png without the signature", "png", []byte("PNG but not really"), "does not look like png"},
		{"png that is a glb", "png", glb, "does not look like png"},
		{"glb with the header", "glb", glb, ""},
		{"glb too short", "glb", []byte("glTF"), "does not look like glb"},
		{"glb wrong magic", "glb", []byte("GLTF        "), "does not look like glb"},
		{"glb that is a png", "glb", pngSignature, "does not look like glb"},
		{"gltf with a version", "gltf", []byte(`{"asset":{"version":"2.0"}}`), ""},
		{"gltf without asset", "gltf", []byte(`{"scenes":[]}`), "does not look like gltf"},
		{"gltf with a numeric version", "gltf", []byte(`{"asset":{"version":2}}`), "does not look like gltf"},
		{"gltf that is not json", "gltf", []byte("hello"), "does not look like gltf"},
		{"gltf that is a glb", "gltf", glb, "does not look like gltf"},
		{"empty payload", "png", nil, "does not look like png"},
		{"unknown format", "exe", []byte("MZ"), `unknown format "exe"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePayload(tc.format, tc.payload)
			if tc.reason == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), tc.reason) {
				t.Fatalf("got %v, want ErrInvalid mentioning %q", err, tc.reason)
			}
		})
	}
}

func TestKnownKind(t *testing.T) {
	for _, k := range Kinds {
		if !KnownKind(k) {
			t.Errorf("%q is listed in Kinds but not known", k)
		}
		if len(FormatsFor(k)) == 0 {
			t.Errorf("%q has no valid formats", k)
		}
	}
	for _, k := range []Kind{"", "dragon", "Creature"} {
		if KnownKind(k) {
			t.Errorf("%q should not be a known kind", k)
		}
	}
}
