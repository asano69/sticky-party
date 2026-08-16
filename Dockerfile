# syntax=docker/dockerfile:1

# ==========================================
# Stage 0: Go Builder
# ==========================================
FROM golang:1.26-alpine AS go-builder
WORKDIR /build
# Copy and download Go dependencies first
COPY go.mod go.sum* ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
# Copy Go source files last, as they change most frequently
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY migrations/ ./migrations/
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o sticky-party ./cmd/sticky-party

# ==========================================
# Stage 1: Runtime
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

