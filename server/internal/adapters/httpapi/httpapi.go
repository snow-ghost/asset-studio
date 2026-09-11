// Package httpapi is the studio's HTTP surface: CRUD over assets, their raw payloads, and the wowd
// integration manifest. A handler here decodes a request, calls one use case and encodes the answer; any
// rule about what an asset is belongs in domain, any sequence of steps in app.
package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/snow-ghost/asset-studio/server/internal/app"
	"github.com/snow-ghost/asset-studio/server/internal/domain"
)

// DefaultMaxPayload is the largest model or texture the studio accepts, in bytes. Models are large but
// not that large; anything bigger is a mistake or an attack, and reading it into memory first would be the
// wrong way to find out. The frontend checks the same number before uploading; testdata/limits.json is the
// one place both read it from in their tests, so the two cannot drift apart.
const DefaultMaxPayload int64 = 64 << 20

// Handler serves the studio API.
type Handler struct {
	studio *app.Studio
	// allowOrigin is echoed as Access-Control-Allow-Origin so the Vite dev server (a different port) can
	// call the API. In production the frontend is served from the same origin and this is empty.
	allowOrigin string
	// maxPayload bounds the decoded payload of one save (REQ-001-8). It is a transport limit — about how
	// much one request may carry, not about what an asset is — which is why it lives here and not in domain.
	maxPayload int64
}

// New builds the handler. allowOrigin "*" is fine for local development; "" disables CORS. maxPayload is
// the payload limit in bytes; DefaultMaxPayload unless a deployment has a reason to differ.
func New(studio *app.Studio, allowOrigin string, maxPayload int64) *Handler {
	return &Handler{studio: studio, allowOrigin: allowOrigin, maxPayload: maxPayload}
}

// maxBody is the request body limit that lets a payload of maxPayload bytes through: base64 inflates it by
// four thirds, and the rest of the JSON envelope (name, tags, a long wowdRef) needs some room of its own.
func (h *Handler) maxBody() int64 { return h.maxPayload*4/3 + 1<<20 }

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
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, h.maxBody())).Decode(&req); err != nil {
		// A body the reader cut off is "too large", not "invalid JSON": the designer needs to hear the
		// limit, not a parse error from wherever the truncation happened to land.
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			h.tooLarge(w, -1)
			return
		}
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
		if int64(len(raw)) > h.maxPayload {
			h.tooLarge(w, int64(len(raw)))
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

// tooLarge answers 413 naming the limit. n is the payload size when it is known, or -1 when the body was cut
// off before the payload could be decoded.
func (h *Handler) tooLarge(w http.ResponseWriter, n int64) {
	msg := "payload exceeds the limit of " + formatMiB(h.maxPayload)
	if n >= 0 {
		msg = fmt.Sprintf("payload of %d bytes exceeds the limit of %s", n, formatMiB(h.maxPayload))
	}
	writeJSON(w, http.StatusRequestEntityTooLarge, errorBody{msg})
}

// formatMiB prints a byte count the way a designer reads it: "64 MiB", or "0.5 MiB" when it is not whole.
func formatMiB(n int64) string {
	const mib = 1 << 20
	if n%mib == 0 {
		return fmt.Sprintf("%d MiB", n/mib)
	}
	return strconv.FormatFloat(float64(n)/mib, 'f', -1, 64) + " MiB"
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
