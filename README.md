# web-anno

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/asano69/web-anno)

<img src="frontend/public/favicon.svg" width="100" align="right" />

- 任意のWebサイトにシンプルな付箋を貼るための、ブラウザ拡張機能とGoサーバ。
- 付箋データは、バックエンドのPocketBaseに保存されます、

## Purpose

## Useage
- 専用のフロントエンドは実装していないのでPocketBase管理画面からユーザを作成する。
- 拡張機能において、ユーザ（メールアドレス）とパスワードを設定する。（PocketBase SDKに使用）
- 拡張機能ボタンをおすと、新規付箋の作成画面が開く。URLと本文を作成して保存するとDBに登録される。
- Webページを開くたびに、そのURLがDBに保存されたルールに合致するか判断し、合致すれば関連する本文を表示する。

### Tech Stack
- backend: Go+PocketBase v0.39+
- frontend: solid.js + tailwind v4

