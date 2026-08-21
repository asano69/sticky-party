package static

import (
	"embed"
	"io/fs"
)

//go:embed dist
var rawStatic embed.FS

var FS fs.FS

func init() {
	sub, err := fs.Sub(rawStatic, "dist")
	if err != nil {
		panic(err)
	}
	FS = sub
}
