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

	"github.com/asano69/sticky-party/internal/render"
)

const attachmentsCollection = "attachments"
const rendersCollection = "renders"
const annotationsCollection = "annotations"

// attachmentIdPattern matches an attachment id in ![[id]] syntax, mirroring
// extension/lib/markup/inline.ts's TOKEN_PATTERN attachment case.
var attachmentIdPattern = regexp.MustCompile(`!\[\[([a-zA-Z0-9]+)\]\]`)

// Register schedules the daily orphaned-attachment and orphaned-render
// sweeps.
func Register(app core.App) {
	app.Cron().MustAdd("gc-attachments", "0 0 * * *", func() {
		if err := sweepAttachments(app); err != nil {
			app.Logger().Error("attachment gc failed", "error", err)
		}
		if err := sweepRenders(app); err != nil {
			app.Logger().Error("render gc failed", "error", err)
		}
	})
}

// sweepAttachments deletes every attachment that is no longer
// referenced by its annotation's body.
func sweepAttachments(app core.App) error {
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

// sweepRenders deletes every "renders" row whose annotation is gone,
// or whose annotation's current body no longer contains the fenced
// code block that produced it (see render.ValidSourceHashes). This is
// the "renders" counterpart to sweepAttachments above: a cached
// render becomes orphaned whenever its source block is edited or
// removed, not just when the whole annotation is deleted.
func sweepRenders(app core.App) error {
	renders, err := app.FindAllRecords(rendersCollection)
	if err != nil {
		return fmt.Errorf("find renders: %w", err)
	}

	for _, row := range renders {
		if isRenderOrphaned(app, row) {
			if err := app.Delete(row); err != nil {
				app.Logger().Error(
					"delete orphaned render",
					"id", row.Id,
					"error", err,
				)
			}
		}
	}

	return nil
}

// isRenderOrphaned reports whether a "renders" row should be garbage-
// collected: its annotation relation is empty, the linked annotation
// no longer exists, or that annotation's body no longer produces this
// row's sourceHash.
func isRenderOrphaned(app core.App, row *core.Record) bool {
	annotationIds := row.GetStringSlice("annotation")
	if len(annotationIds) == 0 {
		return true
	}

	annotation, err := app.FindRecordById(annotationsCollection, annotationIds[0])
	if err != nil {
		// Annotation is gone. "annotation" has cascadeDelete: false on
		// this collection (see migrations), so a deleted annotation's
		// render rows are never auto-removed and must be swept here.
		return true
	}

	return !render.ValidSourceHashes(annotation.GetString("body"))[row.GetString("sourceHash")]
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
