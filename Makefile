.PHONY: server web build run check test bdd test-web e2e lint lint-go lint-web trace tidy

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

test-web: ## Frontend unit tests (Vitest, Node, no browser)
	cd web && npm run test

e2e: ## Browser scenarios (Playwright): builds web/dist, starts studiod on :8199 with an empty data dir, runs @e2e
	cd web && npx playwright test --project=chromium

lint: lint-go lint-web ## All linters

lint-go: ## gofmt, go vet, golangci-lint (depguard enforces the layer boundaries, forbidigo the determinism)
	cd server && gofmt -l . | (! grep .) && go vet ./...
	@command -v golangci-lint >/dev/null 2>&1 \
		&& (cd server && golangci-lint run) \
		|| echo "golangci-lint is not installed — skipped (gofmt and go vet ran)"

lint-web: ## Typecheck the frontend
	cd web && npm run typecheck

trace: ## Regenerate docs/traceability.md from specs/, features/ and web/tests/; fails on a hole
	cd tools/trace-gen && go run . -root ../..
