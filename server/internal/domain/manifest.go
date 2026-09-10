package domain

import "time"

// ManifestVersion is bumped, with an ADR, whenever the shape below changes: the reader lives in another
// repository (wowd's client) and must be able to tell what it is looking at (invariant 7).
const ManifestVersion = 1

// Manifest is the bridge to wowd: the assets that name a wowd content id, each with the path the game
// client fetches. It is the only thing the game ever asks the studio for (docs/integration-with-wowd.md).
type Manifest struct {
	Version   int             `json:"version"`
	Generated time.Time       `json:"generated"`
	Assets    []ManifestEntry `json:"assets"`
}

// ManifestEntry maps one wowd content id to one asset payload.
type ManifestEntry struct {
	WowdRef string `json:"wowdRef"`
	Kind    string `json:"kind"`
	Format  string `json:"format"`
	AssetID string `json:"assetId"`
	Name    string `json:"name"`
	URL     string `json:"url"`
}

// PayloadPath is the URL path under which an asset's payload is served. It belongs to the domain rather
// than to the HTTP adapter because it is part of the bridge contract: the game stores nothing about the
// studio but this path, so it cannot be a routing detail free to change.
func PayloadPath(id string) string { return "/api/assets/" + id + "/payload" }

// BuildManifest selects the assets bound to a wowd id. Assets is never nil — with nothing bound the game
// receives an empty list, because a client that does manifest.assets.find(...) would crash on null.
func BuildManifest(assets []Asset, generated time.Time) Manifest {
	m := Manifest{Version: ManifestVersion, Generated: generated, Assets: []ManifestEntry{}}
	for _, a := range assets {
		if a.WowdRef == "" {
			continue // only bound assets belong in the bridge
		}
		m.Assets = append(m.Assets, ManifestEntry{
			WowdRef: a.WowdRef,
			Kind:    string(a.Kind),
			Format:  a.Format,
			AssetID: a.ID,
			Name:    a.Name,
			URL:     PayloadPath(a.ID),
		})
	}
	return m
}
