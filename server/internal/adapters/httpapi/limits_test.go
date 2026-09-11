package httpapi

import (
	"encoding/json"
	"os"
	"testing"
)

// The payload limit is one number read by two codebases: this handler refuses above it, the frontend
// refuses before uploading. testdata/limits.json is the fixture both tests compare against, so a change on
// one side without the other fails here instead of in a designer's browser.
func TestDefaultMaxPayloadMatchesFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../testdata/limits.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		MaxPayloadBytes int64 `json:"maxPayloadBytes"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.MaxPayloadBytes != DefaultMaxPayload {
		t.Fatalf("testdata/limits.json says %d bytes, DefaultMaxPayload is %d", fixture.MaxPayloadBytes, DefaultMaxPayload)
	}
}

func TestFormatMiB(t *testing.T) {
	cases := []struct {
		bytes int64
		want  string
	}{
		{64 << 20, "64 MiB"},
		{1 << 20, "1 MiB"},
		{1 << 19, "0.5 MiB"},
		{3 << 20, "3 MiB"},
	}
	for _, tc := range cases {
		if got := formatMiB(tc.bytes); got != tc.want {
			t.Errorf("formatMiB(%d) = %q, want %q", tc.bytes, got, tc.want)
		}
	}
}
