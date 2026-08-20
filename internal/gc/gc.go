// Package gc implements a daily cron job that deletes orphaned attachment
// records. An attachment is orphaned when its id no longer appears as an
// ![[id]] embed (see extension/lib/markup/inline.ts) in the body of the
// single annotation it belongs to -- attachments are not shared across
// multiple annotations, so checking just that one annotation is enough.
package gc

import (
	"fmt"
	"regexp"

	"github.com/pocketbase/pocketbase/core"
)

const attachmentsCollection = "attachments"
const annotationsCollection = "annotations"

// attachmentIdPattern matches an attachment id in ![[id]] syntax, mirroring
// extension/lib/markup/inline.ts's TOKEN_PATTERN attachment case.
var attachmentIdPattern = regexp.MustCompile(`!\[\[([a-zA-Z0-9]+)\]\]`)

// Register schedules the daily orphaned-attachment sweep.
func Register(app core.App) {
	app.Cron().MustAdd("gc-attachments", "0 0 * * *", func() {
		if err := sweep(app); err != nil {
			app.Logger().Error("attachment gc failed", "error", err)
		}
	})
}

// sweep deletes every attachment that is no longer referenced by its
// annotation's body.
func sweep(app core.App) error {
	attachments, err := app.FindAllRecords(attachmentsCollection)
	if err != nil {
		return fmt.Errorf("find attachments: %w", err)
	}

	for _, attachment := range attachments {
		if isOrphaned(app, attachment) {
			if err := app.Delete(attachment); err != nil {
				app.Logger().Error(
					"delete orphaned attachment",
					"id", attachment.Id,
					"error", err,
				)
			}
		}
	}

	return nil
}

// isOrphaned reports whether attachment should be garbage-collected: it has
// no linked annotation, the linked annotation no longer exists, or that
// annotation's body no longer embeds this attachment's id.
func isOrphaned(app core.App, attachment *core.Record) bool {
	annotationIds := attachment.GetStringSlice("annotation")
	if len(annotationIds) == 0 {
		return true
	}

	annotation, err := app.FindRecordById(annotationsCollection, annotationIds[0])
	if err != nil {
		// Annotation is gone. cascadeDelete should already have removed
		// this attachment along with it, but treat it as orphaned just
		// in case it slipped through.
		return true
	}

	return !referencesAttachment(annotation.GetString("body"), attachment.Id)
}

func referencesAttachment(body, attachmentId string) bool {
	for _, match := range attachmentIdPattern.FindAllStringSubmatch(body, -1) {
		if match[1] == attachmentId {
			return true
		}
	}
	return false
}
