# Sticky Party

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/asano69/sticky-party)

<img src="frontend/public/favicon.svg" width="100" align="right" />

- 個人またはチームで使用することのできるシンプルな付箋アプリです。
- 任意のWebサイトにシンプルな付箋を貼ることができます。
- バックエンドはGoサーバで、フロントエンドはブラウザ拡張機能として実装されています。

## Purpose
- Webサイト／アプリを訪れたときに表示したい覚書き
- Web上のドキュメントの注釈

## Features
- 付箋内のURLの自動認識
- ユーザのデバイスごとに、付箋の位置とサイズを記憶
- セキュリティ: 付箋はExtension page iframeとしてマウントされるため、Webサイトの管理者からも付箋の内容を読むことができません。[^1]
- 付箋のアクセスコントロールなし。登録済みユーザのみ、すべの付箋を自由に作成・編集・削除できます。
- 管理機能：管理者ユーザは、SQLiteに保存された付箋データをWebUIから操作できます。(PocketBase)
- 付箋の位置・サイズ・ドラッグ用ヘッダーだけがWebページのDOMに存在し、タイトル・本文などの実際の内容は拡張機能自身のオリジンを持つiframe内にのみ存在します。

## Useage
- 専用のフロントエンドは実装していないのでPocketBase管理画面からユーザを作成する。
- 拡張機能において、ユーザ（メールアドレス）とパスワードを設定する。（PocketBase SDKに使用）
- 拡張機能ボタンをおすと、新規付箋を作成するためのポップアップが開く。
- 付箋を貼りたいURLと本文を作成して保存ボタンを押すと、バックエンドサーバに付箋データが送信される。
- 付箋データをサーバに保存したあと、付箋を表示するURLのルールのみがローカルストレージにキャッシュされる。
- 任意のWebページを開くたびに、そのURLがルール集合に含まれている評価され、含まれる場合はDBから付箋データがロードされる。

## Tech Stack

### backend
- Go
- PocketBase v0.39+

### frontend
- wxt v0.21+
- solid.js v1.9
- kobalte v0.13+
- tailwind v4

[^1]: We use an extension page iframe because it runs in the extension's own origin (for example, `chrome-extension://...` in Chromium-based browsers and `moz-extension://...` in Firefox), which is isolated from the web page by the Same-Origin Policy. The page cannot directly access the iframe's DOM, JavaScript context, or extension data.