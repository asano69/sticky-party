# syntax=docker/dockerfile:1

# ==========================================
# Stage 0: Node (vendor frontend assets via npm)
# ==========================================
FROM node:22-alpine AS node-builder
WORKDIR /build/frontend
# Copy only dependency manifests first to leverage Docker layer caching
COPY frontend/package.json frontend/pnpm-lock.yaml* frontend/pnpm-workspace.yaml* ./
RUN corepack enable
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install
# Copy the rest of the frontend source code and build
COPY frontend/ ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm run build

# ==========================================
# Stage 1: Go Builder
# ==========================================
FROM golang:1.26-alpine AS go-builder
WORKDIR /build
# Copy and download Go dependencies first
COPY go.mod go.sum* ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
# Copy frontend build artifacts just before the Go compilation step
COPY --from=node-builder /build/internal/static/dist ./internal/static/dist
# Copy Go source files last, as they change most frequently
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY migrations/ ./migrations/
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o sticky-party ./cmd/sticky-party

# ==========================================
# Stage 2: Runtime
# ==========================================
FROM alpine:3.23
WORKDIR /sticky-party

RUN apk add --no-cache \
    ca-certificates \
    su-exec \
    busybox-extras \
    tzdata \
    bash \
    curl \
    sqlite
 
RUN addgroup -g 1000 sticky-party && \
    adduser -D -u 1000 -G sticky-party sticky-party

COPY --from=go-builder /build/sticky-party /usr/local/bin/sticky-party

RUN mkdir -p /certs /sticky-party/data
RUN chown -R sticky-party:sticky-party /sticky-party

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sticky-party", "serve", "--dir=data"]

