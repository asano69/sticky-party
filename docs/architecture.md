# 付箋データの同期アーキテクチャ

## 前提

- 拡張機能はほぼ全ページで動作するため、`content script` が付箋ルールを表示するたびに
  PocketBase へ問い合わせるのは避ける（ネットワーク遅延・オフライン耐性・結合度の観点）。
- 代わりに、DB のデータを `browser.storage.local` にミラーし、`content script` は
  ローカルの読み取りのみで動作させる。
- MV3 を前提とする（MV2 の persistent background page は使わない）。MV3 の service
  worker はイベントが来ない状態が続くと終了し、内部状態や長時間接続（SSE など）は
  すべて失われる。この制約と相性の悪い仕組み（realtime subscribe 常時接続など）は
  採用しない。

## 原則: DB is source of truth / local storage は読み取り専用ミラー

```
[popup: 新規付箋作成]
        │
        ├─▶ ① DBへ保存
        │
        └─▶ ② 保存成功後、同じレコードをそのまま local storage にも書く（write-through）

[background script（起動時 / alarms interval）]
        └─▶ DBから全件取得して local storage を丸ごと上書き（フル同期）

[content script]
        └─▶ local storage を read-only で参照し、URL判定・表示のみ行う
```

- DB への書き込み経路は popup → PocketBase の一本のみ。
- local storage への書き込みは以下の2箇所だけが行う。
  1. popup: 自分がいま DB に書いた内容を、そのまま同じ値で local storage にも書く
     （write-through）。DB とローカルの内容が完全に一致する操作なので、新しい真実を
     作っているわけではなく、競合解決やマージロジックは発生しない。
  2. background script: 定期的なフル同期。
- local storage → DB という経路は存在しない。

## realtime subscribe を採用しない理由

- リアルタイム反映が欲しかった主な動機は「popup で保存した内容を即座に local
  storage へ反映したい」という点だったが、これは popup 自身が write-through で
  書けば realtime 購読なしで解決できる。
- MV3 の service worker は非アクティブ化されると終了し、SSE 接続や `subscribe()`
  のコールバックはすべて消える。再購読するには `browser.alarms` で定期的に
  service worker を起こし、起動のたびに `subscribe()` を呼び直す実装が必要になり、
  複雑さの割に得られるものが小さい。
- 結果として、popup 以外の経路（PocketBase 管理画面からの直接編集など）による
  変更の反映は多少遅れるが、これはフル同期の頻度で許容範囲に調整すればよい。

## 同期方式: write-through（保存時）+ 定期フル同期

| トリガー | 処理 | 目的 |
|---|---|---|
| popup での保存成功 | 保存したレコードをそのまま local storage に書く（write-through） | 自分の操作の即時反映。ネットワーク往復を待たずに反映される |
| 拡張機能 / service worker 起動時 | DB から全件取得して local storage を上書き | service worker 再起動・拡張機能再読み込み時の最新化 |
| 定期 interval（`browser.alarms`） | DB から全件取得して local storage を上書き | popup 以外からの変更の取り込み、ズレの自己修復 |

### なぜ timestamp ベースの差分ポーリングを採用しないか

`updated` フィールドを使った `filter=(updated>X)` は作成・更新の差分取得はできるが、
**削除されたレコードは検知できない**（存在しないレコードは検索結果に出てこないため）。

これに対処するにはソフトデリート方式（`deleted` フラグを立てて論理削除）などの追加ロジックが
必要になり、複雑さが増す。個人用途でレコード数が少ない前提なら、差分計算はせず
**フル同期（全件取得して丸ごと置き換え）** で十分であり、削除の見落としも起きない。

削除操作についても、popup 側で DB から物理削除し、同じ ID を local storage からも
消せば済むため、ソフトデリートのような追加ロジックは不要。

## background script（service worker）の実装イメージ

```ts
// entrypoints/background.ts
export default defineBackground(() => {
  const fullSync = async () => {
    // Fetch all annotations/positions from PocketBase and overwrite
    // browser.storage.local wholesale. Simpler and more correct than
    // timestamp-based diffing since it naturally handles deletions.
  };

  // Runs once whenever the service worker starts (extension install,
  // browser restart, or SW waking up after being killed).
  fullSync();

  // browser.alarms wakes the service worker on a schedule even after
  // MV3 kills it for inactivity, so this is what makes periodic full
  // sync actually happen in MV3.
  browser.alarms.create('full-sync', { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'full-sync') fullSync();
  });
});
```

## 未確定事項（次に詰めるべきこと）

- フル同期の interval（`periodInMinutes` の具体的な値）
- `annotations` と `positions` の2コレクションを local storage 上でどう1つのキャッシュに
  まとめるか（データ構造）
- popup の write-through 実装（保存レスポンスをどう local storage の形式に変換するか）