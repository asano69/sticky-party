package main

import (
	"os"

	"github.com/pocketbase/pocketbase"
	pbcmd "github.com/pocketbase/pocketbase/cmd"

	_ "github.com/asano69/sticky-party/migrations"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"

	"github.com/asano69/sticky-party/internal/gc"
	"github.com/asano69/sticky-party/internal/history"
	"github.com/asano69/sticky-party/internal/render"
	"github.com/asano69/sticky-party/internal/version"
)

// dataDirEnvVar lets the data directory be set via environment variable
// instead of always requiring the "--dir" flag. If unset, PocketBase
// falls back to its own default (a "pb_data" folder next to the binary).
const dataDirEnvVar = "STICKYPARTY_DATA_DIR"

func main() {
	app := pocketbase.NewWithConfig(pocketbase.Config{
		HideStartBanner: true,
		// Sets the "--dir" flag's default value. An explicit "--dir"
		// still overrides this, so the flag keeps working as before.
		DefaultDataDir: os.Getenv(dataDirEnvVar),
	})

	// Registers "sticky-party migrate up/down/create/collections/history-sync"
	// for manual or CI-driven schema management. Automigrate is off because
	// the schema is defined purely in Go migration files (internal/migrations),
	// not edited through the PocketBase dashboard.
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: false,
	})

	// Writes an audit trail into "histories" for every annotation
	// create/update/delete -- see internal/history for the merge rule.
	history.Register(app)

	// Daily sweep that deletes attachments no longer referenced by their
	// annotation's body -- see internal/gc.
	gc.Register(app)

	// Pre-renders fenced code blocks into "renders" so clients can
	// display syntax highlighting without shipping a highlighter of
	// their own -- see internal/render.
	render.Register(app)

	root := app.RootCmd
	root.Use = "sticky-party"
	root.Short = "sticky-party"
	root.SilenceUsage = true
	root.Version = version.Version

	root.AddCommand(

		serveCmd(app),
		pbcmd.NewSuperuserCommand(app),
		userUpsertCmd(app),
	)

	if err := app.Execute(); err != nil {
		os.Exit(1)
	}
}
