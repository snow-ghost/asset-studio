// Package api is the asset studio's HTTP surface: CRUD over assets, their raw payloads, and the wowd
// integration manifest.
package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/snow-ghost/asset-studio/server/internal/store"
)

// Handler serves the studio API from a store.
type Handler struct {
	store *store.Store
	// allowOrigin is echoed as Access-Control-Allow-Origin so the Vite dev server (a different port) can
	// call the API. In production the frontend is served from the same origin and this is unused.
	allowOrigin string
}

// New builds the handler. allowOrigin "*" is fine for local development.
func New(s *store.Store, allowOrigin string) *Handler {
	return &Handler{store: s, allowOrigin: allowOrigin}
}

// Register mounts the API routes on a mux.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/assets", h.list)
	mux.HandleFunc("POST /api/assets", h.save)
	mux.HandleFunc("GET /api/assets/{id}", h.get)
	mux.HandleFunc("PUT /api/assets/{id}", h.update)
	mux.HandleFunc("DELETE /api/assets/{id}", h.remove)
	mux.HandleFunc("GET /api/assets/{id}/payload", h.payload)
	mux.HandleFunc("GET /api/manifest", h.manifest)
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	// Preflight for the dev cross-origin calls.
	mux.HandleFunc("OPTIONS /api/", func(w http.ResponseWriter, r *http.Request) { h.cors(w); w.WriteHeader(http.StatusNoContent) })
}

type saveRequest struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Kind    string   `json:"kind"`
	Format  string   `json:"format"`
	Tags    []string `json:"tags"`
	WowdRef string   `json:"wowdRef"`
	// Data is the base64-encoded payload (a glb/gltf model or a png texture). Empty means a metadata-only
	// update of an existing asset.
	Data string `json:"data"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	h.cors(w)
	assets, err := h.store.List()
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, assets)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	h.cors(w)
	a, err := h.store.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (h *Handler) save(w http.ResponseWriter, r *http.Request) {
	h.cors(w)
	h.write(w, r, "")
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	h.cors(w)
	h.write(w, r, r.PathValue("id"))
}

// write handles both create (POST, id from the body or minted) and update (PUT, id from the path).
func (h *Handler) write(w http.ResponseWriter, r *http.Request, pathID string) {
	var req saveRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{"invalid JSON body"})
		return
	}
	if pathID != "" {
		req.ID = pathID
	}
	var payload []byte
	if req.Data != "" {
		raw, err := base64.StdEncoding.DecodeString(req.Data)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody{"data is not valid base64"})
			return
		}
		payload = raw
	}
	saved, err := h.store.Save(store.Asset{
		ID:      req.ID,
		Name:    req.Name,
		Kind:    store.Kind(req.Kind),
		Format:  req.Format,
		Tags:    req.Tags,
		WowdRef: req.WowdRef,
	}, payload)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (h *Handler) remove(w http.ResponseWriter, r *http.Request) {
	h.cors(w)
	if err := h.store.Delete(r.PathValue("id")); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) payload(w http.ResponseWriter, r *http.Request) {
	h.cors(w)
	raw, a, err := h.store.Payload(r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", contentTypeFor(a.Format))
	w.Write(raw)
}

// Manifest is the bridge to wowd: the list of assets that name a wowd content id, with a URL the game client
// can fetch. See docs/integration-with-wowd.md.
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

func (h *Handler) manifest(w http.ResponseWriter, r *http.Request) {
	h.cors(w)
	assets, err := h.store.List()
	if err != nil {
		writeErr(w, err)
		return
	}
	m := Manifest{Version: 1, Generated: time.Now().UTC()}
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
			URL:     "/api/assets/" + a.ID + "/payload",
		})
	}
	writeJSON(w, http.StatusOK, m)
}

func (h *Handler) cors(w http.ResponseWriter) {
	if h.allowOrigin == "" {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", h.allowOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func contentTypeFor(format string) string {
	switch format {
	case "glb":
		return "model/gltf-binary"
	case "gltf":
		return "model/gltf+json"
	case "png":
		return "image/png"
	default:
		return "application/octet-stream"
	}
}

type errorBody struct {
	Error string `json:"error"`
}

func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorBody{err.Error()})
	case errors.Is(err, store.ErrInvalid):
		writeJSON(w, http.StatusBadRequest, errorBody{err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, errorBody{err.Error()})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
