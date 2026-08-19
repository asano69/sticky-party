# 付箋への画像貼り付け（attachment embed）設計

## 課題

iframe付箋のエディタで、クリップボードの画像を貼り付けたら、画像をサーバに
アップロードし、本文中に埋め込んで表示したい。

## 設計方針

### 1. 保存先: 別コレクション `attachments`

`annotations` にファイルフィールドを直接足すのではなく、`annotation`
（relation）と `image`（file）を持つ別コレクション `attachments` を新設する。

- 1つの付箋に複数枚貼れる
- 付箋本体のレコードサイズと画像バイナリを分離できる
- `annotation` の cascadeDelete を PocketBase 側の設定だけで表現できる
  （付箋が消えたら添付も消える）

### 2. 本文中の埋め込み記法: `![[id]]`（URLではなくIDを埋め込む）

既存の `![alt](url)`（`lib/markup/inline.ts`）とは別に、`![[attachmentId]]`
という専用構文を追加した。ポイントは、**本文に保存するのはURLではなく
`attachments` レコードのIDだけ**という点。

理由はセキュリティ要件から来ている。当初は「アップロード後にファイルURLを
`![](url)` として本文に埋め込む」案だったが、それだと `attachments` の
`viewRule` を「誰でも閲覧可（空ルール）」にしないと `<img src="...">` から
画像を読み込めない（後述）。`viewRule` を `@request.auth.id != ''` の
まま厳格に保ちたいので、URLではなくIDだけを本文に持たせ、**表示時に
毎回そのIDを使って認証済みで画像を取りに行く**方式にした。

`![alt](url)` と `![[id]]` は構文上競合しない
（画像記法は `](` が必須だが `![[id]]` には無い）ので、
パーサー（`lib/markup/inline.ts`）は両方を別トークン種別として
共存させている。

### 3. 貼り付け〜アップロード（`NoteContent.tsx`）

編集用 `<textarea>` の `onPaste` で `clipboardData.items` に `image/*` が
あれば `preventDefault()` し、通常のテキスト貼り付けを止めてアップロード
処理に回す。

```ts
const attachmentId = await uploadAttachment(current.id, blob);
// カーソル位置に埋め込み記法を挿入（URLではなくID）
insertAtCursor(`![[${attachmentId}]]`);
```

挿入後は `resizeTextarea()` / `reportContentHeight()` を呼び、
`docs/note-sizing.md` の高さ計算経路にそのまま乗せている。

### 4. 表示時の取得（`AnnotationBody.tsx` の `AttachmentImage`）

`![[id]]` トークンをレンダリングする際、そのIDを使って画像バイトを
**閲覧者自身の認証情報で**取得し、Blob URLとして `<img>` に渡す。

```ts
function AttachmentImage(props: { attachmentId: string }) {
  const [blobUrl] = createResource(
    () => props.attachmentId,
    fetchAttachmentBlobUrl,
  );
  onCleanup(() => {
    const url = blobUrl();
    if (url) URL.revokeObjectURL(url);
  });
  // ... <img src={blobUrl()} />
}
```

コンポーネントのアンマウント時（例: blur切り替えでの再マウント含む）に
`URL.revokeObjectURL` で解放し、メモリリークを防ぐ。

## つまずいたポイント: PocketBaseのファイル配信は `Authorization` ヘッダーを見ない

最初、`fetchAttachmentBlobUrl` を次のように実装した。

```ts
// NG: 404 になる
const res = await fetch(fileUrl, {
  headers: { Authorization: pb.authStore.token },
});
```

`pb.collection("attachments").getOne(...)`（通常のAPI呼び出し）は
`Authorization` ヘッダーで認証されるので成功するが、**ファイルの
ダウンロード自体は別ルートの、素の静的配信エンドポイント**であり、
`Authorization` ヘッダーを一切見ない。`viewRule` が設定された保護対象の
ファイルは、代わりに `?token=...` というクエリパラメータで渡す
**短命のファイル用トークン**が必要になる。認証されていない扱いになり
`viewRule` に弾かれるが、PocketBaseは存在の有無を漏らさないよう
403ではなく **404** を返す。これが `Failed to fetch attachment: 404`
の正体だった。

対処は `pb.files.getToken()` で発行したトークンをURLに付与すること。

```ts
const record = await pb.collection("attachments").getOne(attachmentId);
const token = await pb.files.getToken();
const fileUrl = pb.files.getURL(record, record.image as string, { token });
const res = await fetch(fileUrl); // Authorizationヘッダーは不要
```

- **レコード自体の権限チェック**: `getOne()` が通常のSDK呼び出しとして
  `Authorization` ヘッダー経由で行う。
- **ファイルバイナリ自体の権限チェック**: `getToken()` + `?token=` の
  組み合わせで行う。

この2段階の認証が両方通って初めて画像が表示される。

## 検討した代替案（不採用）

| 案 | 内容 | 不採用の理由 |
|---|---|---|
| A: `viewRule` を空にする | `attachments` を誰でも閲覧可にし、`![](url)` で直接埋め込む | セキュリティ要件により、認証済みユーザー以外に画像URLが漏れると閲覧されてしまう。URLはレコードIDベースで推測困難だが、認証必須という要件そのものを満たさない |
| Authorizationヘッダーを画像fetchに手動付与 | `fetch(fileUrl, { headers: { Authorization } })` | PocketBaseのファイル配信エンドポイントはAuthorizationヘッダーを見ないため機能しない（404になる） |

## まとめ図

```
[編集中の textarea]
  onPaste で image/* を検知
    │
    ▼
  uploadAttachment(annotationId, blob)
    → pb.collection("attachments").create({ annotation, image })
    → attachmentId を返す
    │
    ▼
  本文に ![[attachmentId]] を挿入（URLではなくIDのみ）


[表示時]
  lib/markup/inline.ts が ![[id]] を "attachment" トークンとしてパース
    │
    ▼
  AnnotationBody.tsx の AttachmentImage(attachmentId)
    │
    ▼
  fetchAttachmentBlobUrl(attachmentId)
    ① pb.collection("attachments").getOne(id)      -- Authorizationヘッダーで認証
    ② pb.files.getToken()                           -- 短命ファイルトークン発行
    ③ pb.files.getURL(record, file, { token })      -- token付きURL組み立て
    ④ fetch(fileUrl)                                 -- token付きなので認証不要
    ⑤ blob → URL.createObjectURL(blob)
    │
    ▼
  <img src={blobUrl}>  （onCleanupでrevokeObjectURL）
```

## 前提: PocketBase側の設定（Web UI）

- `attachments` コレクションを新規作成
  - `annotation`: relation → `annotations`, single, **cascadeDelete: true**
  - `image`: file, `maxSize` を明示的に設定
- `createRule` / `listRule` / `viewRule`: いずれも `@request.auth.id != ''`
  のまま（`viewRule` を緩める必要はない）

## 既知のトレードオフ

- 編集中に貼った画像は即座にアップロードされるため、Escでキャンセルしたり
  保存せず閉じたりすると、本文には現れないのに `attachments` レコードだけ
  残る（孤立ファイル）。定期クリーンアップは未実装で、現状は許容している。
- `AttachmentImage` は `createResource` でマウントのたびに毎回fetchし直す
  （キャッシュ層は無い）。付箋は表示のたびにiframeごと再マウントされる
  既存構造と一貫しているが、頻繁な再表示でネットワーク負荷が気になる場合は
  別途検討が必要。
