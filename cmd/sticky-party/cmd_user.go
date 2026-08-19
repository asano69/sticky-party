package main

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"
)

// userUpsertCmd defines the "sticky-party user-upsert <email> <password>"
// cobra command. PocketBase only ships a built-in upsert command for
// superusers, so this mirrors that for the regular "users" auth
// collection: create a new record if the email doesn't exist yet, or
// just update the password if it does.
func userUpsertCmd(app *pocketbase.PocketBase) *cobra.Command {
	return &cobra.Command{
		Use:   "user-upsert <email> <password>",
		Short: "Create or update a users record",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			email, password := args[0], args[1]

			collection, err := app.FindCollectionByNameOrId("users")
			if err != nil {
				return fmt.Errorf("find users collection: %w", err)
			}

			record, err := app.FindAuthRecordByEmail(collection, email)
			if err != nil {
				record = core.NewRecord(collection)
				record.SetEmail(email)
			}
			record.SetPassword(password)
			// Bypasses the email-confirmation flow so the account can
			// log in immediately after being created via this command.
			record.Set("verified", true)
			// Derive the display name from the email's local part
			// (everything before "@"), so a name is always set without
			// requiring a separate flag.
			record.Set("name", strings.SplitN(email, "@", 2)[0])

			if err := app.Save(record); err != nil {
				return fmt.Errorf("save user %q: %w", email, err)
			}

			fmt.Printf("user upserted: %s\n", email)
			return nil
		},
	}
}
