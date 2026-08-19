// Package history hooks into "annotations" CRUD requests and writes an
// audit trail into the "histories" collection.
//
// Rapid consecutive edits by the same person on the same annotation
// would otherwise flood the history with noise, so this collapses them:
// before inserting a new "update" row, it looks at the single most
// recently touched history row for that annotation (regardless of
// which user wrote it). If that row is also an "update", belongs to
// the same person, AND was touched less than mergeWindow ago, it is
// overwritten in place instead of inserting a new row -- its `updated`
// autodate field naturally refreshes, sliding the merge window forward
// on every further edit.
//
// Because the lookup is keyed on the *most recent row for the
// annotation* (not "the most recent row for this user"), an edit by a
// different user in between breaks the chain: for an A, B, A sequence
// of edits, A's second edit sees B's row as the most recent one, so it
// always creates a fresh row even if it lands within mergeWindow of A's
// first edit.
//
// "create" and "delete" are never merge targets and never merged into:
// each is a significant one-time event (an annotation coming into or
// going out of existence) that must always leave its own permanent
// row, even if it happens to follow another action by the same person
// within mergeWindow.
package history

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const mergeWindow = 10 * time.Minute

const historiesCollection = "histories"

// Register wires up the create/update/delete hooks on "annotations".
func Register(app core.App) {
	app.OnRecordCreateRequest("annotations").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return record(e.App, e.Record, e.Auth, "create")
	})

	app.OnRecordUpdateRequest("annotations").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return record(e.App, e.Record, e.Auth, "update")
	})

	app.OnRecordDeleteRequest("annotations").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		// e.Record is still a valid in-memory struct after deletion --
		// only the DB row is gone -- so its Id is still readable here.
		return record(e.App, e.Record, e.Auth, "delete")
	})
}

// record writes one history row for `action` on `annotation`, merging
// into the most recent row for this annotation when it was written by
// the same person within mergeWindow (see the package doc for why
// deletes are excluded from this).
//
// The actor's display name is snapshotted into the row at write time
// (rather than resolved later via a "user" relation) so the history
// list never needs to read the "users" collection. That collection's
// viewRule only allows a user to see their own record, so any other
// approach (e.g. expanding a relation) would silently show other
// users as unknown to anyone but themselves.
func record(app core.App, annotation *core.Record, actor *core.Record, action string) error {
	if actor == nil {
		// Annotations require auth to write, so this should not happen
		// in practice; skip rather than fail the request over a
		// missing audit entry.
		return nil
	}

	collection, err := app.FindCachedCollectionByNameOrId(historiesCollection)
	if err != nil {
		return err
	}

	// Only consecutive "update" actions are ever collapsed into one
	// row. A "create" always gets its own permanent row (so the fact
	// that an annotation was created is never silently absorbed by a
	// later edit), and so does a "delete" (see the package doc).
	if action == "update" {
		latest, err := app.FindRecordsByFilter(
			historiesCollection,
			"annotationId = {:annotationId}",
			"-updated",
			1,
			0,
			map[string]any{"annotationId": annotation.Id},
		)
		if err == nil && len(latest) > 0 {
			row := latest[0]
			if row.GetString("action") == "update" &&
				row.GetString("user") == actor.Id &&
				time.Since(row.GetDateTime("updated").Time()) < mergeWindow {
				row.Set("action", action)
				return app.Save(row)
			}
		}
	}

	row := core.NewRecord(collection)
	// Plain text, not a relation: a relation field would be
	// auto-cleared by PocketBase once the referenced annotation is
	// deleted (cascadeDelete: false just nullifies the reference
	// instead of deleting this row), which would destroy exactly the
	// information a "delete" history row exists to preserve.
	row.Set("annotationId", annotation.Id)
	row.Set("user", actor.Id)
	// Snapshotted at write time -- see the func comment above. Falls
	// back to the user's id if they have no display name set, so the
	// row is never blank.
	name := actor.GetString("name")
	if name == "" {
		name = actor.Id
	}
	row.Set("userName", name)
	row.Set("action", action)
	return app.Save(row)
}
