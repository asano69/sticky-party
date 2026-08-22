package render

import (
	"strings"

	"github.com/alecthomas/chroma/v2"
	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
)

// codeRenderer renders ordinary fenced code blocks (```lang ... ```)
// to syntax-highlighted HTML via chroma. Registered as the "code" kind
// -- see render.go's kindForLang for which fence tags route here.
type codeRenderer struct{}

func (codeRenderer) Kind() string { return "code" }

func (codeRenderer) Render(lang, source string) (string, error) {
	lexer := lexers.Get(lang)
	if lexer == nil {
		lexer = lexers.Fallback // plain text if the language tag is unknown or empty
	}
	lexer = chroma.Coalesce(lexer)

	style := styles.Get("github")
	if style == nil {
		style = styles.Fallback
	}

	// WithClasses(true): emits CSS classes (e.g. class="kn") instead of
	// hardcoded inline colors. Token-type-to-class names are fixed
	// regardless of which style is passed to Format below, so the client
	// can theme the result for both light and dark mode via a static
	// stylesheet (extension/assets/chroma.css) instead of being stuck
	// with whichever colors got baked into the cached HTML.
	formatter := chromahtml.New(chromahtml.WithClasses(true))

	iterator, err := lexer.Tokenise(nil, source)
	if err != nil {
		return "", err
	}

	var buf strings.Builder
	if err := formatter.Format(&buf, style, iterator); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func init() {
	RegisterRenderer(codeRenderer{})
}
