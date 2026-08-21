.PHONY: all init build extension-deps build-extension zip-extension \
        zip-extension-firefox icons kill-ports server dev-back dev-ext \
        clean test lint format migrate-collections

include sticky-party.env
export

BINARY := sticky-party

# Port used by the backend dev server
PORTS := 3000


# ============================================================
# Build
# ============================================================

build:
	go build -o $(BINARY) ./cmd/$(BINARY)

extension-deps:
	cd extension && pnpm install

# MV3 build, unpacked (for loading via chrome://extensions "Load unpacked").
build-extension: extension-deps
	cd extension && pnpm run build

# MV3 build packaged as a distributable .zip (dist-zip: extension/.output).
zip-extension: extension-deps
	cd extension && pnpm run zip

# Firefox defaults to MV2 (see extension/README.md); this project's
# background.ts relies on MV3 service-worker semantics (browser.alarms
# waking it after inactivity kill), so build Firefox as MV3 too to match.
zip-extension-firefox: extension-deps
	cd extension && pnpm exec wxt zip -b firefox --mv3

icons:
	cd extension && pnpm run icons

frontend-deps:
	cd frontend && pnpm install

build-frontend: frontend-deps
	cd frontend && pnpm run build

# ============================================================
# Run / dev servers
# ============================================================

kill-ports:
	@for port in $(PORTS); do \
		pid=$$(lsof -ti tcp:$$port); \
		if [ -n "$$pid" ]; then \
			echo "Killing process on port $$port (pid $$pid)"; \
			kill -9 $$pid; \
		fi \
	done

# Runs the built binary directly, without the live-reload dev server.
all: build-frontend
	go run ./cmd/$(BINARY) superuser upsert admin@mail.internal password --dir=pb_data
	go run ./cmd/$(BINARY) serve

server:
	#./sticky-party migrate up --dir=pb_data
	./$(BINARY) superuser upsert admin@mail.internal password --dir=pb_data
	./$(BINARY) serve --dev

clean:
	rm -fr ./tmp/ # air

# port: 3000
dev-back: clean
	air

# Firefox defaults to MV2 (see extension/README.md), but this project's
# background.ts/content.ts rely on MV3 semantics (service-worker
# alarms, content-script network requests routed through the
# background script -- see lib/messages.ts), so dev matches the MV3
# build produced by zip-extension-firefox instead of pnpm's default
# dev:firefox script.
dev-ext:
	cd extension && pnpm exec wxt -b firefox --mv3

dev-front: clean
	npx concurrently -n "frontend,backend" -c "blue,green" "cd frontend && pnpm dev" "go run ./cmd/$(BINARY) serve --dev"


# ============================================================
# Test / lint / format
# ============================================================

test:
	#cd frontend && pnpm test
	go test ./...

lint:
	golangci-lint run; cd extension && pnpm run lint
	cd extension && pnpm run compile

format:
	cd extension && pnpm exec prettier --write .

# ============================================================
# Database
# ============================================================

# May be worth keeping in production, for backward compatibility.
migrate-collections:
	ls -1 migrations/*.go | sort | head -n -1 | xargs rm -f
	yes | go run ./cmd/sticky-party migrate collections
	ls -1 migrations/*.go | sort | head -n -1 | xargs rm -f
