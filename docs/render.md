## 設計: `renders` コレクション

### スキーマ

| フィールド | 型 | 説明 |
|---|---|---|
| `annotation` | relation → `annotations` | cascadeDelete: true。付箋が消えたらキャッシュも消える |
| `kind` | select | `"code"` / `"mermaid"` / `"latex"` など、レンダラーの種類 |
| `sourceHash` | text | ソース文字列（+ langなど）のハッシュ。再レンダー要否の判定キー |
| `html` | text | レンダリング結果（SVGやハイライト済みHTMLなど） |

`sourceHash` をキーにするのがポイントです。**本文中の該当ブロックが1文字も変わっていなければ、同じannotationの他のブロックが変わって再保存されても、この行は再レンダーしない**という判定ができます（`internal/history/history.go` のマージ判定と似た考え方）。

### 処理フロー

```
[本文保存 (create/update)]
        │
        ▼
[internal/render フック]
        │ 本文をパースして「レンダリング対象ブロック」を列挙
        │ (```lang〜``` / ```mermaid〜``` / $$...$$ など)
        │
        ▼
  各ブロックについて:
    sourceHash = hash(kind + source)
    │
    ├─ renders に同じ annotation + sourceHash が既にある？
    │     Yes → 何もしない（結果は既にキャッシュ済み）
    │     No  → レンダラーを実行して結果をrendersに保存/更新
    │
    ▼
[閲覧時: AnnotationBody.tsx]
    本文パース → 各ブロックの sourceHash を計算
    → 対応する renders レコードの html を innerHTML として挿入
    （fetchAnnotations と一緒に返ってくるので追加リクエスト不要、
      もしくは1annotationにつき1回 renders をfetch）
```

### Go側: レンダラーをプラガブルにする

```go
// internal/render/render.go
package render

import "github.com/pocketbase/pocketbase/core"

// Renderer converts a single fenced block's source into HTML for one
// kind (e.g. "code", "mermaid", "latex"). Each renderer is registered
// once at startup -- see registerBuiltins below -- so adding a new
// kind never touches the block-detection or caching logic here.
type Renderer interface {
	Kind() string
	Render(lang, source string) (string, error)
}

var renderers = map[string]Renderer{}

func RegisterRenderer(r Renderer) {
	renderers[r.Kind()] = r
}

// Register wires the create/update hooks on "annotations" that keep
// the "renders" collection in sync with each annotation's body.
func Register(app core.App) {
	app.OnRecordCreateRequest("annotations").BindFunc(syncHook)
	app.OnRecordUpdateRequest("annotations").BindFunc(syncHook)
}
```

`mermaid` だけ事情が違う点に注意が必要です。`chroma`（コード）や `latex`（例: `github.com/wacul/ptex` 系か、外部CLI呼び出し）はGoネイティブで完結しやすいですが、**mermaidは本質的にJS実装（ブラウザのCanvas/SVG描画）**なので、サーバ側でレンダリングするには以下のどちらかが要ります。

- `mermaid-cli`（Node + Puppeteer/Chromium）をサーバに同梱・呼び出す → Dockerイメージが重くなる、`CLAUDE.md` の「シンプルさ優先」からは離れる
- サーバ側は諦めて、mermaidだけクライアント側で動的import（コードハイライトと違い、mermaid図は1付箋あたり高々数個で、しかも「図として明示的に書いた」ときだけ発生するので、動的importの再取得コストも許容範囲）

なので、**`renders` コレクション自体は汎用に保ちつつ、renderer登録の可否は種類ごとに現実的な方を選ぶ**のが良さそうです。

| kind | 実行場所 | 理由 |
|---|---|---|
| `code` | サーバ（chroma） | Goネイティブ、依存が軽い |
| `latex` | サーバ or クライアント | 数式ならKaTeXがクライアントでも十分軽量（MathJaxより遥かに小さい）。サーバ側で完結させたければMathML/SVG出力するGo/CLIラッパーが要る |
| `mermaid` | クライアント（動的import） | サーバ側はブラウザエンジンが要り重すぎる |

つまり `renders` コレクションと `internal/render` フックの仕組み自体は `code` と（望むなら）`latex` に使い、**mermaidだけは既存の「動的importで使う時だけロード」パターンのままにする**、というハイブリッドが現実的な落としどころだと思います。それでも「コードブロックとLaTeXについては閲覧コストゼロ」を実現できるので、当初の悩みの大半は解消されます。


