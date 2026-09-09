.PHONY: server web build run check tidy

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
