# 付箋データの同期アーキテクチャ

## 前提

- 拡張機能はほぼ全ページで動作するため、`content script` が付箋ルールを表示するたびに
  PocketBase へ問い合わせるのは避ける（ネットワーク遅延・オフライン耐性・結合度の観点）。
- ただし全レコード（本文・位置情報含む）をローカルにミラーする必要はない。
  URL 判定に使う `target` の一覧だけをローカルにキャッシュし、マッチしたページでのみ
  DB に本文を問い合わせる、という中間的な設計を採る。
- MV3 を前提とする（MV2 の persistent background page は使わない）。MV3 の service
  worker はイベントが来ない状態が続くと終了し、内部状態や長時間接続（SSE など）は
  すべて失われる。この制約と相性の悪い仕組み（realtime subscribe 常時接続など）は
  採用しない。

## 原則: DB is source of truth / local storage は「target 一覧」のみの読み取り専用ミラー

```
[popup: 新規付箋作成]
        │
        ├─▶ ① DBへ保存（annotations: target + body、positions: 座標）
        │
        └─▶ ② 保存成功後、保存した target をそのまま local storage の URL 一覧に追加
              （write-through）

[background script（起動時 / alarms interval）]
        └─▶ DBから target 一覧のみ取得して local storage を丸ごと上書き（フル同期）

[content script]
        │
        ▼ ① 現在のURLが、ローカルの target 一覧に含まれるか判定
           （ネットワーク通信なし、配列/Setの検索なのでほぼゼロコスト）
        │
        ├─ 含まれない場合 → 何もしない（DB問い合わせ不要）
        │
        └─ 含まれる場合   → その場でDBに問い合わせ、本文・位置情報を取得して表示
```

- DB への書き込み経路は popup → PocketBase の一本のみ。
- local storage には `target`（URL マッチ用の文字列）の一覧のみを保持する。
  本文（body）や位置情報（positions）はローカルに持たない。
- local storage への書き込みは以下の2箇所だけが行う。
  1. popup: 自分がいま DB に書いた `target` を、そのまま local storage の一覧に追加する
     （write-through）。DB とローカルの内容が一致する操作なので、競合解決や
     マージロジックは発生しない。
  2. background script: 定期的なフル同期（target 一覧のみ取得して上書き）。
- local storage → DB という経路は存在しない。

## この設計を選んだ理由

- 「毎回 DB に問い合わせる」設計は、ほぼ全ページで通信が発生し重い。
- 「全レコードを丸ごとミラーする」設計は、通信は減るがローカルの本文が古くなる懸念や
  同期対象のデータ量が大きくなる問題がある。
- 折衷案として、**判定に必要な target だけをローカルにキャッシュし、実際に付箋が
  貼られているページ（レアケース）でのみ DB に問い合わせる**ことで、通信頻度を
  「ほぼ全ページ」から「マッチしたページのみ」に大きく減らしつつ、本文の鮮度は
  常に DB 由来で保証できる。

### トレードオフ

- マッチしたページでは結局 DB 通信が発生するため、「一切通信しない」設計ではない。
  個人が数十〜数百件程度の付箋を運用する前提なら通信頻度は十分許容範囲。
- オフライン時、target 一覧はローカルにあるので「マッチした」ことまでは分かるが、
  本文は DB に繋がらないと表示できない。
- 本文をローカルに持たないため、削除時に「古い本文がローカルに残る」心配がそもそも
  ない。削除は DB から削除し、ローカルの target 一覧から該当値を除去するだけでよい。

## realtime subscribe を採用しない理由

- リアルタイム反映が欲しかった主な動機は「popup で保存した内容を即座に local
  storage へ反映したい」という点だったが、これは popup 自身が write-through で
  target を書けば realtime 購読なしで解決できる。
- MV3 の service worker は非アクティブ化されると終了し、SSE 接続や `subscribe()`
  のコールバックはすべて消える。再購読するには `browser.alarms` で定期的に
  service worker を起こし、起動のたびに `subscribe()` を呼び直す実装が必要になり、
  複雑さの割に得られるものが小さい。
- 結果として、popup 以外の経路（PocketBase 管理画面からの直接編集など）による
  変更の反映は多少遅れるが、これはフル同期の頻度で許容範囲に調整すればよい。

## 同期方式: write-through（保存時）+ 定期フル同期（target 一覧のみ）

| トリガー | 処理 | 目的 |
|---|---|---|
| popup での保存成功 | 保存した target を local storage の一覧に追加（write-through） | 自分の操作の即時反映。ネットワーク往復を待たずに反映される |
| 拡張機能 / service worker 起動時 | DB から target 一覧のみ取得して local storage を上書き | service worker 再起動・拡張機能再読み込み時の最新化 |
| 定期 interval（`browser.alarms`） | DB から target 一覧のみ取得して local storage を上書き | popup 以外からの変更の取り込み、ズレの自己修復 |

### なぜ timestamp ベースの差分ポーリングを採用しないか

`updated` フィールドを使った `filter=(updated>X)` は作成・更新の差分取得はできるが、
**削除されたレコードは検知できない**（存在しないレコードは検索結果に出てこないため）。

これに対処するにはソフトデリート方式（`deleted` フラグを立てて論理削除）などの追加ロジックが
必要になり、複雑さが増す。個人用途でレコード数が少ない前提なら、差分計算はせず
**フル同期（全件取得して丸ごと置き換え）** で十分であり、削除の見落としも起きない。
同期対象が target 一覧のみに絞られているため、フル同期のコスト自体も小さい。

## background script（service worker）の実装イメージ

```ts
// entrypoints/background.ts
export default defineBackground(() => {
  const fullSync = async () => {
    // Fetch only the `target` field from all annotations and overwrite
    // browser.storage.local wholesale. Body/position data is fetched
    // on demand by the content script when a page actually matches, so
    // this sync stays cheap regardless of annotation count.
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

## content script の実装イメージ

```ts
// entrypoints/content.ts
export default defineContentScript({
  matches: ['*://*/*'],
  async main() {
    // Cheap, no network: just a lookup against the cached target list.
    const targets = await getCachedTargets();
    if (!isTargetMatch(location.href, targets)) return;

    // Only reached for the rare page that actually has an annotation,
    // so a network round trip here is acceptable.
    const annotation = await fetchAnnotationFor(location.href);
    renderAnnotation(annotation);
  },
});
```

## 未確定事項（次に詰めるべきこと）

- フル同期の interval（`periodInMinutes` の具体的な値）
- `target` のマッチング方式（完全一致 / prefix / パターンマッチなど）
- マッチしたページで DB から取得する際のエラーハンドリング（オフライン時など）