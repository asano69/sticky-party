package main

import (
	"os"

	"github.com/pocketbase/pocketbase"
	pbcmd "github.com/pocketbase/pocketbase/cmd"

	_ "github.com/asano69/sticky-party/migrations"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"

	"github.com/asano69/sticky-party/internal/history"
)

func main() {
	app := pocketbase.NewWithConfig(pocketbase.Config{HideStartBanner: true})

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

	root := app.RootCmd
	root.Use = "sticky-party"
	root.Short = "sticky-party"
	root.SilenceUsage = true
	root.Version = "0.0.1"

	root.AddCommand(

		serveCmd(app),
		pbcmd.NewSuperuserCommand(app),
		userUpsertCmd(app),
	)

	if err := app.Execute(); err != nil {
		os.Exit(1)
	}
}
