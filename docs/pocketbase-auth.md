# PocketBase認証の設計

## 前提: 3つの実行コンテキスト

拡張機能は3つの独立した実行コンテキストからPocketBaseへアクセスする。

- **popup**（`entrypoints/popup/`）: ツールバーアイコンをクリックして開く画面。
  外側をクリックする、Escを押す、フォーカスが外れる等で**即座に破棄される**。
  次に開いた時は完全に新しいドキュメントとして再生成される。
- **background script**（`entrypoints/background.ts`）: MV3のservice worker。
  イベントが来ない状態が続くと終了し、内部状態はすべて失われる（`docs/architecture.md`参照）。
  `browser.alarms`で定期的に叩き起こされて処理を行う。
- **annotation-iframe**（`entrypoints/annotation-iframe/`）: 拡張機能自身の
  originを持つ、付箋が画面に表示されている間だけ生きるページ。

いずれも同じPocketBaseアカウントとして認証するが、**popup/background.tsは短命**、
**annotation-iframeは付箋の表示中ずっと生存する**という寿命の違いがある。

## 問題: 素朴な実装の無駄

素朴には「操作のたびに`new PocketBase()` + `authWithPassword()`」で済ませられる。
実際、最初の実装はそうなっていた。

```ts
// 各操作のたびにこれが走っていた
const pb = new PocketBase(settings.backendUrl);
await pb.collection("users").authWithPassword(settings.email, settings.password);
```

これには2つの問題がある。

1. **無駄なネットワークラウンドトリップ**: 色を変える・タイトルを保存する・削除するなど
   PATCH/DELETE 1本で済むはずの操作のたびに、認証リクエストが余分に1本増える。
   パスワード認証はハッシュ比較を伴う軽くない処理で、体感レイテンシに直結する。
2. **`localStorage`が使えない**: PocketBase SDKのデフォルト`authStore`
   （`LocalAuthStore`）は`localStorage`を使うが、拡張機能では
   popup/background/content script/iframeがそれぞれ別のorigin扱いになり、
   素の`localStorage`は共有されない。

## 解決策: `AsyncAuthStore` + `browser.storage.local`

`lib/pb.ts`で、認証状態の保存先を`browser.storage.local`にカスタムした
`AsyncAuthStore`を使う。

```ts
const AUTH_STORAGE_KEY = "pb_auth";

async function createAuthStore(): Promise<AsyncAuthStore> {
  const stored = await browser.storage.local.get(AUTH_STORAGE_KEY);
  return new AsyncAuthStore({
    save: async (serialized) =>
      browser.storage.local.set({ [AUTH_STORAGE_KEY]: serialized }),
    clear: async () => browser.storage.local.remove(AUTH_STORAGE_KEY),
    initial: stored[AUTH_STORAGE_KEY] as string | undefined,
  });
}
```

`browser.storage.local`は`localStorage`と違い、**拡張機能自身のorigin
（`chrome-extension://<id>`）に紐づく専用ストレージ**で、popup・background・
すべてのannotation-iframeから読み書きできる。ホストページのJSからは
Same-Origin Policyにより一切アクセスできない。

`initial`は`AsyncAuthStore`の内部読み込みを待たず、あらかじめ
`await`で読み込んだ値をそのまま渡している。これは「構築直後に`isValid`を見たら
まだ非同期読み込みが終わっておらず古い/空の状態を見てしまう」という競合を
避けるための単純化。

## `getAuthedPb()`: 呼び出しは安価になった

```ts
export async function getAuthedPb(): Promise<PocketBase> {
  const settings = await getSettings();
  if (!settings?.backendUrl || !settings.email || !settings.password) {
    throw new Error("Set backend URL, email and password in Settings first.");
  }

  const pb = new PocketBase(settings.backendUrl, await createAuthStore());
  if (!pb.authStore.isValid) {
    await pb
      .collection("users")
      .authWithPassword(settings.email, settings.password);
  }
  return pb;
}
```

`new PocketBase()`のインスタンス生成自体は毎回行うが、`authStore`が
`browser.storage.local`から前回のトークンを読み込んでいるため、
**すでに有効なトークンがあれば`authWithPassword`はスキップされる**。
これにより、popup・background.tsのように「毎回`getAuthedPb()`を呼ぶ」
既存の呼び出しパターンをそのまま維持しつつ、無駄な再認証を防げる。

## トークンの有効期限と自動リカバリ

`users`コレクションの認証トークンは5日で失効する
（`migrations/1787131502_collections_snapshot.go`の`authToken.duration: 432000`）。
PocketBase SDKは期限切れトークンを自動でリフレッシュしないため、
何もしなければ5日後に最初のAPI呼び出しが`401`で失敗する。

これに対処するのが`withReauth()`。

```ts
export async function withReauth<T>(
  pb: PocketBase,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ClientResponseError) || err.status !== 401) throw err;

    const settings = await getSettings();
    if (!settings) throw err;
    await pb
      .collection("users")
      .authWithPassword(settings.email, settings.password);
    return await fn();
  }
}
```

`401`を検知したら1回だけ`authWithPassword`をやり直し、同じ操作をリトライする。
`lib/syncBadge.ts`の`withSyncErrorBadge`（1回リトライしてから諦める）と
同じ設計思想。

再認証に成功すると`authStore.save()`が発火し、`browser.storage.local`の
トークンが更新される。他のコンテキストは次に`getAuthedPb()`を呼んだ時、
その更新済みトークンをそのまま使える——**どこか1箇所で再認証が起きれば、
残り全部が自動的にその恩恵を受ける**という構図になる。

同時に複数コンテキストが`401`を踏んだ場合、それぞれが独立して
`authWithPassword`を叩く可能性はあるが、正しさには影響しない
（最後に書き込まれたトークンが有効なまま残るだけ）。無駄なリクエストが
数本増える程度なので、現状は許容している。

## コンテキストごとの使い分け

| コンテキスト | パターン | 理由 |
|---|---|---|
| popup | 操作のたびに`getAuthedPb()` | 短命。閉じるとJSコンテキストごと消えるため、インスタンスを持ち越す方法がそもそもない |
| background.ts | 操作のたびに`getAuthedPb()` | service workerがアイドルでkillされるため、メモリ上にインスタンスを保持し続ける意味がない |
| annotation-iframe | マウント時に1回だけ`getAuthedPb()`し、アンマウントまで使い回す（`useAuthedPb.ts`） | 付箋が表示されている間ずっと生存するコンテキストなので、使い回すことでインスタンス生成のオーバーヘッドを避けられる |

`lib/annotations.ts`の各関数（`updateAnnotation`・`setAnnotationColor`等）は
内部で`getAuthedPb()`を呼ばず、**呼び出し側から`pb`を受け取る**形にしてある。
これにより「誰が呼ぶか」に関わらず同じ関数を使い回しつつ、
どのコンテキストがどの寿命でpbを管理するかは呼び出し側の責務として分離できる。

```ts
// popup / background.ts: 呼び出しのたびに取得
const pb = await getAuthedPb();
await updateAnnotation(pb, id, data);

// annotation-iframe: マウント時に取得したものを使い回す
const pb = useAuthedPb(); // Signal<PocketBase | undefined>
await updateAnnotation(pb(), id, data);
```

## セキュリティ上の位置づけ

- `browser.storage.local`は`localStorage`と違いホストページのJSから
  到達できない。XSSされたWebサイトからトークンが盗まれる典型的なリスクは
  この設計では直接該当しない。
- 保存されるのは**5日で失効するトークン**であり、以前からある
  `lib/settings.ts`での**無期限に有効なパスワードそのもの**の平文保存と
  比べれば、漏洩時の被害時間枠はむしろ縮小している。
- 拡張機能のコード自体（依存パッケージ含む）が信頼できることが前提になるが、
  これは今回の変更の有無に関わらず既存のパスワード保存にもすでに
  当てはまるリスクであり、新たに増えるものではない。
- デバイス自体への物理アクセスや依存パッケージのサプライチェーン攻撃といった
  より強い脅威モデルへの対策（OSキーチェーン連携等）は、ブラウザ拡張機能の
  標準APIの範囲を超えるため、このプロジェクトの規模ではスコープ外とする。
