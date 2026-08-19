package serve

import (
	"html/template"
	"net/http"
	"net/url"

	"github.com/pocketbase/pocketbase/core"
)

// embedTemplate renders a minimal HTML page whose only content is a
// single iframe pointing at Src. Kept intentionally bare (no CSS
// framework, no other assets) since this page exists purely as an
// origin wrapper, not as a UI.
// html/body need an explicit height:100% chain -- height:100% on the
// iframe alone has nothing to size against otherwise (a block with no
// explicit height sizes to its content, not its parent), so the iframe
// silently falls back to its default intrinsic height (~150px) while
// width:100% still applies, producing a short, wide player.
var embedTemplate = template.Must(template.New("embed").Parse(`<!doctype html>
<html style="height:100%">
<head><meta charset="utf-8"></head>
<body style="margin:0;height:100%">
<iframe src="{{.Src}}" style="width:100%;height:100%;border:0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
</body>
</html>`))

// embedHandler serves a page that embeds a single iframe at the URL
// given by the "src" query parameter.
//
// Annotation bodies can contain iframe embeds (e.g. a YouTube video --
// see lib/markup/inline.ts on the extension side). Rendering that
// iframe directly inside the annotation-iframe would make its direct
// parent the extension's own origin (chrome-extension://...), which
// some embed providers (YouTube in particular) refuse to serve into,
// regardless of the target video's own embed settings. Nesting the
// target iframe inside this Go-served https page instead gives it a
// normal https origin as its direct parent, which those providers
// accept -- the same reason a plain http://localhost test page can
// play a video that a file:// page cannot.
//
// src is required to be an absolute https URL; nothing else is
// validated (see isAllowedIframeSrc in lib/markup/inline.ts, which
// already restricts what the extension will ever send here). This
// handler never fetches src itself -- it only ever emits it as an
// iframe's src attribute for the browser to load directly -- so there
// is no server-side request-forgery surface here.
func embedHandler() func(re *core.RequestEvent) error {
	return func(re *core.RequestEvent) error {
		raw := re.Request.URL.Query().Get("src")
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Host == "" {
			http.Error(re.Response, "invalid src", http.StatusBadRequest)
			return nil
		}

		// PocketBase's default response headers deny framing (X-Frame-Options /
		// frame-ancestors 'self'), which would defeat the whole point of this
		// route -- it exists specifically to be embedded inside the extension's
		// annotation-iframe (chrome-extension://...). This page carries no
		// session/cookie data of its own (src is just echoed into an iframe
		// attribute), so relaxing framing here doesn't expose anything.
		re.Response.Header().Del("X-Frame-Options")
		re.Response.Header().Set("Content-Security-Policy", "frame-ancestors *")
		re.Response.Header().Set("Content-Type", "text/html; charset=utf-8")
		return embedTemplate.Execute(re.Response, struct{ Src string }{Src: u.String()})
	}
}
