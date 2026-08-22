// Package render pre-renders fenced code blocks found in an
// annotation's body and caches the result in the "renders" collection,
// so clients never need to ship a syntax highlighter (or a mermaid/
// latex renderer) of their own -- see docs/ for the design discussion.
//
// Only the "code" kind is implemented for now (see code.go). Other
// fence tags (mermaid, latex) are mapped to their own kind by
// kindForLang below, but since no renderer is registered for them yet,
// syncRenders simply skips those blocks -- clients fall back to plain
// text until a renderer for that kind exists.
package render

import (
	"hash/fnv"
	"regexp"
	"strconv"

	"github.com/pocketbase/pocketbase/core"
)

const rendersCollection = "renders"

// fencePattern matches a fenced code block (```lang\ncode```). The
// language tag is optional; an empty tag still renders via the "code"
// kind's plain-text fallback (see code.go).
var fencePattern = regexp.MustCompile("(?s)```([a-zA-Z0-9_+-]*)\\n(.*?)```")

// Renderer converts a single fenced block's source into cacheable HTML
// for one kind. Each kind is registered once (see RegisterRenderer),
// so adding a new kind (e.g. mermaid) never touches the block-
// detection or caching logic below.
type Renderer interface {
	Kind() string
	Render(lang, source string) (string, error)
}

var renderers = map[string]Renderer{}

// RegisterRenderer adds a renderer for one kind. Call from an init()
// in the file that implements it (see code.go).
func RegisterRenderer(r Renderer) {
	renderers[r.Kind()] = r
}

// kindForLang maps a fence's language tag to the renderer kind that
// should handle it. Most tags are ordinary code and use "code"; a
// handful of special tags select a different renderer entirely.
// Unmapped/empty tags default to "code" so a plain ``` fence, or an
// unrecognized language, still gets highlighted rather than skipped.
func kindForLang(lang string) string {
	switch lang {
	case "mermaid":
		return "mermaid"
	case "latex", "tex":
		return "latex"
	default:
		return "code"
	}
}

// Register wires the create/update hooks on "annotations" that keep
// the "renders" collection in sync with each annotation's body.
func Register(app core.App) {
	app.OnRecordCreateRequest("annotations").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return syncRenders(e.App, e.Record)
	})
	app.OnRecordUpdateRequest("annotations").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return syncRenders(e.App, e.Record)
	})
}

// syncRenders scans annotation's body for fenced code blocks and
// ensures each one recognized by a registered renderer has a matching
// "renders" row. A block whose hash already has a row is left
// untouched -- its source hasn't changed, so the existing render is
// still valid and doesn't need re-rendering.
func syncRenders(app core.App, annotation *core.Record) error {
	body := annotation.GetString("body")
	matches := fencePattern.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return nil
	}

	collection, err := app.FindCachedCollectionByNameOrId(rendersCollection)
	if err != nil {
		return err
	}

	for _, m := range matches {
		lang, source := m[1], m[2]
		kind := kindForLang(lang)
		renderer, ok := renderers[kind]
		if !ok {
			continue // no renderer registered for this kind yet
		}
		hash := sourceHash(kind, lang, source)

		existing, err := app.FindFirstRecordByFilter(
			rendersCollection,
			"annotation = {:annotation} && sourceHash = {:hash}",
			map[string]any{"annotation": annotation.Id, "hash": hash},
		)
		if err == nil && existing != nil {
			continue // already rendered and cached
		}

		html, err := renderer.Render(lang, source)
		if err != nil {
			continue // skip a block the renderer can't handle rather than failing the whole save
		}

		row := core.NewRecord(collection)
		row.Set("annotation", annotation.Id)
		row.Set("kind", kind)
		row.Set("sourceHash", hash)
		row.Set("html", html)
		if err := app.Save(row); err != nil {
			return err
		}
	}

	return nil
}

// sourceHash is a cache key, not a security boundary, so a plain
// non-cryptographic hash (FNV-1a) is enough -- and it's what lets the
// client (extension/lib/markup/codeblocks.ts) compute the same key
// synchronously in plain JS, without needing Web Crypto.
func sourceHash(kind, lang, source string) string {
	h := fnv.New64a()
	h.Write([]byte(kind))
	h.Write([]byte{0})
	h.Write([]byte(lang))
	h.Write([]byte{0})
	h.Write([]byte(source))
	return strconv.FormatUint(h.Sum64(), 16)
}

// ValidSourceHashes returns every sourceHash that annotation's current
// body would still produce, recomputed the same way syncRenders does.
// Used by internal/gc to tell which "renders" rows for an annotation
// are still referenced by its body and which are orphaned (the block
// was edited or removed since that row was cached).
func ValidSourceHashes(body string) map[string]bool {
	hashes := make(map[string]bool)
	for _, m := range fencePattern.FindAllStringSubmatch(body, -1) {
		lang, source := m[1], m[2]
		kind := kindForLang(lang)
		if _, ok := renderers[kind]; !ok {
			continue // no renderer registered for this kind -- never cached, so never orphaned either
		}
		hashes[sourceHash(kind, lang, source)] = true
	}
	return hashes
}
