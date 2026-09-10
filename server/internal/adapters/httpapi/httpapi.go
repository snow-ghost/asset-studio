// Package httpapi is the studio's HTTP surface: CRUD over assets, their raw payloads, and the wowd
// integration manifest. A handler here decodes a request, calls one use case and encodes the answer; any
// rule about what an asset is belongs in domain, any sequence of steps in app.
package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/snow-ghost/asset-studio/server/internal/app"
	"github.com/snow-ghost/asset-studio/server/internal/domain"
)

// maxBody bounds a save request. Models are large but not that large; anything bigger is a mistake or an
// attack, and reading it into memory first would be the wrong way to find out.
const maxBody = 64 << 20

// Handler serves the studio API.
type Handler struct {
	studio *app.Studio
	// allowOrigin is echoed as Access-Control-Allow-Origin so the Vite dev server (a different port) can
	// call the API. In production the frontend is served from the same origin and this is empty.
	allowOrigin string
}

// New builds the handler. allowOrigin "*" is fine for local development; "" disables CORS.
func New(studio *app.Studio, allowOrigin string) *Handler {
	return &Handler{studio: studio, allowOrigin: allowOrigin}
}

// Register mounts the API routes on a mux.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/assets", h.list)
	mux.HandleFunc("POST /api/assets", h.create)
	mux.HandleFunc("GET /api/assets/{id}", h.get)
	mux.HandleFunc("PUT /api/assets/{id}", h.update)
	mux.HandleFunc("DELETE /api/assets/{id}", h.remove)
	mux.HandleFunc("GET /api/assets/{id}/payload", h.payload)
	mux.HandleFunc("GET /api/manifest", h.manifest)
	mux.HandleFunc("GET /api/healthz", h.healthz)
	// Preflight for the dev cross-origin calls.
	mux.HandleFunc("OPTIONS /api/", func(w http.ResponseWriter, _ *http.Request) {
		h.cors(w)
		w.WriteHeader(http.StatusNoContent)
	})
}

// saveRequest is what the frontend sends. It is a transport shape, not the asset: the payload travels as
// base64 inside JSON because a single JSON body is the simplest thing a browser can send and a curl can
// reproduce, and 64 MB of base64 is still fine for a local tool.
type saveRequest struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Kind    string   `json:"kind"`
	Format  string   `json:"format"`
	Tags    []string `json:"tags"`
	WowdRef string   `json:"wowdRef"`
	// Data is the base64-encoded payload. Empty means a metadata-only update of an existing asset.
	Data string `json:"data"`
}

func (h *Handler) list(w http.ResponseWriter, _ *http.Request) {
	h.cors(w)
	assets, err := h.studio.List()
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, assets)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	h.cors(w)
	a, err := h.studio.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) { h.save(w, r, "") }

func (h *Handler) update(w http.ResponseWriter, r *http.Request) { h.save(w, r, r.PathValue("id")) }

// save handles both create (POST, id from the body or minted) and update (PUT, id from the path).
func (h *Handler) save(w http.ResponseWriter, r *http.Request, pathID string) {
	h.cors(w)
	var req saveRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&req); err != nil {
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
	saved, err := h.studio.Save(domain.Asset{
		ID:      req.ID,
		Name:    req.Name,
		Kind:    domain.Kind(req.Kind),
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
	if err := h.studio.Delete(r.PathValue("id")); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) payload(w http.ResponseWriter, r *http.Request) {
	h.cors(w)
	raw, a, err := h.studio.Payload(r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", domain.ContentType(a.Format))
	_, _ = w.Write(raw)
}

func (h *Handler) manifest(w http.ResponseWriter, _ *http.Request) {
	h.cors(w)
	m, err := h.studio.Manifest()
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (h *Handler) healthz(w http.ResponseWriter, _ *http.Request) {
	h.cors(w)
	_, _ = w.Write([]byte("ok"))
}

func (h *Handler) cors(w http.ResponseWriter) {
	if h.allowOrigin == "" {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", h.allowOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

type errorBody struct {
	Error string `json:"error"`
}

// writeErr is the one place the domain's errors become status codes.
func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorBody{err.Error()})
	case errors.Is(err, domain.ErrInvalid):
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
