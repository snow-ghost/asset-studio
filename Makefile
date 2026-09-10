.PHONY: server web build run check test bdd tidy

# Development: two processes. `make server` in one terminal, `make web` in another.
server: ## Run the Go backend on :8099, assets in ./data/assets
	cd server && go run ./cmd/studiod

web: ## Run the Vite dev server on :5190 (installs deps on first run)
	cd web && npm install && npm run dev

build: ## Build the frontend to web/dist
	cd web && npm install && npm run build

run: build ## Build the frontend and serve everything from the backend on :8099
	cd server && go run ./cmd/studiod -web ../web/dist

check: ## Compile the backend and typecheck the frontend
	cd server && go build ./... && go vet ./...
	cd web && npm run typecheck

test: ## Backend tests, acceptance suite included
	cd server && go test ./... -count=1

bdd: ## Acceptance scenarios (godog): make bdd [F=features/assets] [T='@req-000-3']
	cd server && \
		$(if $(F),STUDIO_BDD_PATHS=../../../$(F),) \
		$(if $(T),STUDIO_BDD_TAGS='$(T)',) \
		go test ./test/bdd/ -count=1
