package main

import (
	"fmt"

	"github.com/pocketbase/pocketbase"
	"github.com/spf13/cobra"

	"github.com/asano69/web-anno/internal/config"
	"github.com/asano69/web-anno/internal/serve"
)

// serveCmd defines the "web-anno serve" cobra command. RunE stays a thin
// wrapper: load config, then delegate to internal/serve for the actual
// server implementation.
func serveCmd(app *pocketbase.PocketBase) *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Start the web server",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}
			return serve.Run(app, cfg)
		},
	}
}
