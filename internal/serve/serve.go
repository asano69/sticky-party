// Package serve implements the "serve" command, which runs a single HTTP server
// that hosts the index page and all drill sessions defined in the config file.
//
// The package is split across three files:
//   - serve.go:   route registration and server startup (this file)
//   - handler.go: HTTP handlers
package serve

import (
	"fmt"
	"net/http"

	"log/slog"

	"github.com/asano69/sticky-party/internal/config"
	"github.com/asano69/sticky-party/internal/static"
	"github.com/asano69/sticky-party/internal/version"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Run opens the database and collection once, registers all drill routes, then
// starts listening. The database and collection are shared across all sessions.
func Run(app *pocketbase.PocketBase, cfg *config.Config) error {
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {

		staticHandler := apis.Static(static.FS, true)

		// TEMPORARY: the web frontend isn't finished yet, so send root-path
		// visitors straight to PocketBase's own admin UI instead of the
		// incomplete static site. Every other path still falls through to
		// the normal static handler. Can't register a separate "GET /"
		// route for this: net/http's ServeMux treats "GET /{path...}" as
		// already matching "/" too, so a second explicit route for it
		// panics as a duplicate registration. Remove this branch once web/
		// is ready to be the real root.
		e.Router.GET("/{path...}", func(re *core.RequestEvent) error {
			if re.Request.URL.Path == "/" {
				http.Redirect(re.Response, re.Request, "/_/", http.StatusFound)
				return nil
			}
			return staticHandler(re)
		})

		// See internal/serve/handler.go's embedHandler for why this exists.
		e.Router.GET("/embed", embedHandler())

		e.Router.GET("/api/version", func(re *core.RequestEvent) error {
			return re.JSON(http.StatusOK, map[string]string{"version": version.Version})
		})

		return e.Next()
	})

	slog.Info("listening", "addr", addr)
	return apis.Serve(app, apis.ServeConfig{
		HttpAddr:        addr,
		ShowStartBanner: false,
	})
}
