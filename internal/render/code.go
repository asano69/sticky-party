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

	// WithClasses(false): inline styles, so the client never needs to
	// ship a matching CSS stylesheet for chroma's class names.
	formatter := chromahtml.New(chromahtml.WithClasses(false))

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
