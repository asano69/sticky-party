// Package serve implements the "serve" command, which runs a single HTTP server
// that hosts the index page and all drill sessions defined in the config file.
//
// The package is split across three files:
//   - serve.go:   route registration and server startup (this file)
//   - handler.go: HTTP handlers
package serve

import (
	"fmt"

	"log/slog"

	"github.com/asano69/sticky-party/internal/config"
	"github.com/asano69/sticky-party/internal/static"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Run opens the database and collection once, registers all drill routes, then
// starts listening. The database and collection are shared across all sessions.
func Run(app *pocketbase.PocketBase, cfg *config.Config) error {
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {

		e.Router.GET("/{path...}", apis.Static(static.FS, true))

		// See internal/serve/handler.go's embedHandler for why this exists.
		e.Router.GET("/embed", embedHandler())

		return e.Next()
	})

	slog.Info("listening", "addr", addr)
	return apis.Serve(app, apis.ServeConfig{
		HttpAddr:        addr,
		ShowStartBanner: false,
	})
}
