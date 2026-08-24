// Package version holds the application's version string. This is the
// single source of truth, used both by the CLI and by the HTTP API,
// so the two never drift out of sync.
package version

// Version is injected at build time via -ldflags (see Makefile and
// Dockerfile). Defaults to "dev" for local builds that skip that step.
var Version = "0.0.5"
