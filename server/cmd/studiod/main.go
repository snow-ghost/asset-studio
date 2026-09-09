// Command studiod is the asset studio backend: it stores and serves assets (models, textures) and the wowd
// integration manifest, and in production also serves the built three.js frontend.
//
// Two ways to run it:
//
//   - Development: `go run ./cmd/studiod` serves only the API (with permissive CORS) while the frontend runs
//     under the Vite dev server on another port and calls the API across origins.
//   - Production: build the frontend to web/dist, point -web at it, and studiod serves both the app and the
//     API from one origin.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/snow-ghost/asset-studio/server/internal/api"
	"github.com/snow-ghost/asset-studio/server/internal/store"
)

func main() {
	addr := flag.String("addr", envOr("STUDIO_ADDR", ":8099"), "listen address")
	dataDir := flag.String("data", envOr("STUDIO_DATA", "../data/assets"), "directory holding the assets")
	webDir := flag.String("web", envOr("STUDIO_WEB", ""), "directory of the built frontend to serve; empty serves API only")
	cors := flag.String("cors", envOr("STUDIO_CORS", "*"), "Access-Control-Allow-Origin for the dev frontend; empty disables CORS")
	flag.Parse()

	s, err := store.New(*dataDir)
	if err != nil {
		log.Fatalf("studiod: %v", err)
	}

	mux := http.NewServeMux()
	api.New(s, *cors).Register(mux)

	if *webDir != "" {
		serveFrontend(mux, *webDir)
		log.Printf("studiod: serving frontend from %s", *webDir)
	} else {
		mux.HandleFunc("GET /", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write([]byte("asset-studio API is up. Run the frontend with `npm run dev` in ../web, " +
				"or build it and pass -web ../web/dist.\n"))
		})
	}

	log.Printf("studiod: listening on %s, assets in %s", *addr, absOrRaw(*dataDir))
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatalf("studiod: %v", err)
	}
}

// serveFrontend serves a built single-page app: real files where they exist, index.html otherwise, so a
// client-side route still loads the app.
func serveFrontend(mux *http.ServeMux, dir string) {
	fs := http.FileServer(http.Dir(dir))
	index := filepath.Join(dir, "index.html")
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(filepath.Join(dir, filepath.Clean(r.URL.Path))); err == nil && r.URL.Path != "/" {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, index)
	})
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func absOrRaw(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		return abs
	}
	return p
}
