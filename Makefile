.PHONY: lint

include sticky-party.env
export

BINARY := sticky-party

# Ports used by the dev servers (frontend, backend, and PocketBase-style API)
PORTS := 3000 3001

.PHONY: all
all: kill-ports frontend## (*) Build frontend assets and start the server
	go run ./cmd/$(BINARY) superuser upsert admin@mail.internal password --dir=pb_data
	go run ./cmd/$(BINARY) serve


init:
	fastmod --hidden sticky-party $(notdir $(CURDIR)) --glob '!Makefile'
	fastmod --hidden MYAPP $(shell echo '$(notdir $(CURDIR))' | tr '[:lower:]' '[:upper:]') --glob '!Makefile'
	find . -depth \( -type f -o -type d \) -name '*sticky-party*' | while read -r f; do \
		mv -- "$$f" "$$(dirname "$$f")/$$(basename "$$f" | sed 's/sticky-party/$(notdir $(CURDIR))/g')"; \
	done
	fastmod sticky-party $(notdir $(CURDIR))


.PHONY: frontend-deps
frontend-deps:
	cd frontend && pnpm install

.PHONY: build-frontend
build-frontend: frontend-deps
	cd frontend && pnpm run build

.PHONY: build
build: build-frontend
	go build -o $(BINARY) ./cmd/$(BINARY)

.PHONY: extension-deps
extension-deps:
	cd extension && pnpm install

# MV3 build, unpacked (for loading via chrome://extensions "Load unpacked").
.PHONY: build-extension
build-extension: extension-deps
	cd extension && pnpm run build

# MV3 build packaged as a distributable .zip (dist-zip: extension/.output).
.PHONY: zip-extension
zip-extension: extension-deps
	cd extension && pnpm run zip

# Firefox defaults to MV2 (see extension/README.md); this project's
# background.ts relies on MV3 service-worker semantics (browser.alarms
# waking it after inactivity kill), so build Firefox as MV3 too to match.
.PHONY: zip-extension-firefox
zip-extension-firefox: extension-deps
	cd extension && pnpm exec wxt zip -b firefox --mv3

.PHONY: kill-ports
kill-ports:
	@for port in $(PORTS); do \
		pid=$$(lsof -ti tcp:$$port); \
		if [ -n "$$pid" ]; then \
			echo "Killing process on port $$port (pid $$pid)"; \
			kill -9 $$pid; \
		fi \
	done


.PHONY: server
server:
	#./sticky-party migrate up --dir=pb_data
	./$(BINARY) superuser upsert admin@mail.internal password --dir=pb_data
	./$(BINARY) serve --dev

# --------------
.PHONY: clean
	rm -fr ./tmp/ # air

# port: 3001
.PHONY: dev-front
dev-front: clean
	npx concurrently -n "frontend,backend" -c "blue,green" "cd frontend && pnpm dev" "go run ./cmd/$(BINARY) serve --dev"

# port: 3000
.PHONY: dev-back
dev-back: clean
	npx concurrently -n "frontend,backend" -c "blue,green" "cd frontend && pnpm watch" "air"

dev-ext:
	cd extension && pnpm dev:firefox

icons:
	cd extension && pnpm run icons

.PHONY: test
test:
	#cd frontend && pnpm test
	go test ./...

lint:
	golangci-lint run
	cd extension && pnpm run lint



format:
	cd extension && pnpm exec prettier --write "src/**/*.{js,jsx,css}"

# 本番では、後方互換性のために残しておいたほうが良いかも。
migrate-collections:
	ls -1 migrations/*.go | sort | head -n -1 | xargs rm -f
	yes | go run ./cmd/sticky-party migrate collections
	ls -1 migrations/*.go | sort | head -n -1 | xargs rm -f
