# 付箋内iframe埋め込みの配信方式

## 課題

付箋の本文にYouTube動画などの`<iframe>`埋め込みを書けるようにしたい
（`lib/markup/inline.ts`が本文からiframeタグを検出し、`AnnotationBody.tsx`が
レンダリングする）。しかし検出した`<iframe src="...">`をそのまま
`AnnotationBody.tsx`側でレンダリングすると、YouTubeの動画だけ
**「Video player configuration error（153等）」**になり再生できない。
Googleマップの埋め込みは同じ構造で問題なく表示できる。

## 原因: 直接の親iframeのorigin

`AnnotationBody.tsx`は付箋のiframe（`entrypoints/annotation-iframe.html`、
`chrome-extension://...`オリジン）の中で描画される（詳細は
`entrypoints/content.ts`冒頭のコメント参照）。つまり埋め込みiframeを
そのまま置くと、その直接の親documentのoriginは`chrome-extension://...`に
なる。

YouTubeの埋め込みプレーヤーは、直接の親documentのorigin/refererを検証しており、
`chrome-extension://`のような通常のWebサイトでないスキームは、動画自体の
埋め込み許可設定に関わらず拒否される。これは`file://`でローカルHTMLを開いて
同じiframeを試したときも再現することから確認した
（`file://`もorigin/refererが存在しない特殊なケースとして同様に拒否される）。
Googleマップは埋め込み元のoriginをほとんど検証しないため、たまたま
`chrome-extension://`からでも動いていただけで、根本原因の傍証にはなるが
対策ではない。

## 対策: バックエンド(Go)を経由した1段プロキシ

`chrome-extension://`と埋め込み先（YouTube等）の間に、Goサーバが配信する
「iframeを1つだけ持つ最小限のhttpsページ」を挟む。

```
annotation-iframe (chrome-extension://...)      ← ここは変更しない
  └─ <iframe src="https://<backendUrl>/embed?src=<元のiframe src>">
       └─ <iframe src="https://www.youtube.com/embed/...">
            ↑ 直接の親が https://<backendUrl> という正規originになる
```

`http://localhost`から同じHTMLを開くと再生できたことから着想を得ている。
「拡張機能オリジンだから拒否される」のであれば、直接の親を通常のhttps
オリジンに差し替えれば通るはずだという推測が当たった。

### なぜ「annotationのcontent全体」をGo側で配信しないのか

代替案として「annotation-iframeの中身（title/body/編集UI）を丸ごとGoの
`gotmpl`で配信する」も検討したが、以下の理由で見送った。

- 本文のmarkup解析（bullet/task/link/image/iframe判定、
  `lib/markup/blocks.ts`・`inline.ts`）をGo側にも実装する必要が生じ、
  ロジックが二重管理になる。
- task行のチェックボックス（`handleToggleTask`）のような、solid.js側の
  インタラクティブな編集機能が、認証情報を持たない静的HTMLでは動かなくなる。

今回の課題は「iframeタグの直接の親originがYouTube側の検証に引っかかる」
ことだけなので、**iframeトークンの描画先だけ**をGo経由に差し替えるスコープに
留めている。本文の解析・レンダリングは引き続きTypeScript側（`AnnotationBody.tsx`）
が担う。

## 実装

### バックエンド: `GET /embed?src=<url>`

`internal/serve/handler.go`の`embedHandler`が、`src`クエリパラメータ
（絶対https URLであることのみ検証）を1つのiframeとして埋め込むだけの
最小HTMLを返す。

```go
var embedTemplate = template.Must(template.New("embed").Parse(`<!doctype html>
<html style="height:100%">
<head><meta charset="utf-8"></head>
<body style="margin:0;height:100%">
<iframe src="{{.Src}}" style="width:100%;height:100%;border:0" allow="..." allowfullscreen></iframe>
</body>
</html>`))
```

htmlとbodyに明示的に`height:100%`を連鎖させているのがポイント。
`iframe`の`height:100%`は親（body/html）に高さの指定がないと反映されず、
`width:100%`だけが効いて縦横比が崩れた横長表示になる
（実際にこの問題が起きたので追記した）。

このハンドラでは、PocketBaseがデフォルトで付与するフレーミング拒否ヘッダー
（`X-Frame-Options`等）を明示的に上書きしている。このページ自体は
`src`をそのままiframe属性に埋め込むだけのステートレスなページで、
認証情報やCookieを一切扱わないため、埋め込み元を制限する意味がなく、
むしろ拡張機能のiframeに埋め込まれることこそがこのルートの目的なので、
`frame-ancestors *`まで緩めている。

`src`自体をサーバー側でfetchすることは一切なく、あくまでブラウザに
「このURLをiframeのsrc属性として読み込め」と指示するHTMLを返しているだけ
なので、SSRF（サーバー側からの不正リクエスト）のリスクはない。

### 拡張機能側: iframeトークンの描画先を差し替え

`lib/markup/inline.ts`の`isAllowedIframeSrc`はhttps限定に絞っている
（Goサーバ側もhttps限定のため、無効なsrcを早期に弾ける）。

`AnnotationBody.tsx`は、iframeトークンを検出した場合、`settings.ts`から
`backendUrl`を取得し、`${backendUrl}/embed?src=${encodeURIComponent(token.value)}`
経由でレンダリングする。

外側（`AnnotationBody.tsx`側）のiframeには
`sandbox="allow-scripts allow-same-origin allow-presentation"`を指定している。
`allow-scripts`と`allow-same-origin`の併用は一般に「サンドボックス回避の
アンチパターン」として避けるべきだが、それが問題になるのは
**信頼できない（ユーザー入力由来の）コンテンツをiframe化する場合**であり、
今回のiframeの中身はGoサーバの`embedTemplate`が生成する固定HTML
（サーバー自身が生成する信頼済みコンテンツ、`src`はhttps検証済み）なので
問題にならない。

`allow-same-origin`が必要な理由: `sandbox`属性はネストしたiframeにも
継承される。外側のiframeに`allow-same-origin`がないと、Goサーバ配信ページの
中のYouTube iframeにもその制限が継承され、YouTubeプレーヤーが自身のoriginを
正しく扱えず、UI（再生ボタン等）が構築されない黒画面になる
（実際にこの症状が起きたので追記した）。

## まとめ図

```
[annotation-iframe: chrome-extension://...]
  AnnotationBody.tsx
    token.type === "iframe" の場合のみ:
      <iframe sandbox="allow-scripts allow-same-origin allow-presentation"
              src="https://<backendUrl>/embed?src=<元のsrc>">
        │
        ▼
[Go server: GET /embed?src=...]  (internal/serve/handler.go)
  - src が絶対https URLか検証
  - X-Frame-Options除去 + frame-ancestors *
  - html/body に height:100% を連鎖させた最小HTMLを返す
        │
        ▼
      <iframe src="<元のsrc>">   ← 直接の親が https://<backendUrl> になる
```

