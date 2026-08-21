---
layout: default
title: Architecture
---

# 付箋データの同期アーキテクチャ

## 前提

- `content script` が付箋ルールを表示するたびに PocketBase へ問い合わせるのは避ける
  （ネットワーク遅延・オフライン耐性・結合度の観点）。
- ただし全レコード（本文・位置情報含む）をローカルにミラーする必要はない。
  URL 判定に使う `target` の一覧だけをローカルにキャッシュし、マッチしたページでのみ
  DB に本文を問い合わせる、という中間的な設計を採る。
- MV3 を前提とする（MV2 の persistent background page は使わない）。MV3 の service
  worker はイベントが来ない状態が続くと終了し、内部状態や長時間接続（SSE など）は
  すべて失われる。この制約と相性の悪い仕組み（realtime subscribe 常時接続など）は
  採用しない。
- `content script`（`entrypoints/content/index.ts`、note のマウント処理本体）は
  「ほぼ全ページで動作する」設計ではない。`registration: "runtime"` で宣言され、
  マニフェストの静的 `content_scripts` には載らない。`background.ts` が
  `browser.tabs.onUpdated` でナビゲーションを直接検知し、キャッシュ済み `target`
  一覧とのローカル一致判定（`isTargetMatch`）で実際にマッチしたページに対して
  だけ `browser.scripting.executeScript` でこの本体スクリプトを注入する
  （詳細は後述の「content script の動的注入」節を参照）。

## 原則: DB is source of truth / local storage は「target 一覧」のみの読み取り専用ミラー

```
[popup: 新規付箋作成]
        │
        ├─▶ ① DBへ保存（annotations: target + body、positions: 座標）
        │
        └─▶ ② 保存成功後、保存した target をそのまま local storage の URL 一覧に追加
              （write-through）

[background script（起動時 / alarms interval）]
        └─▶ 前回同期時刻以降に更新された target のみ取得してマージ（差分同期。初回はフル同期）

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
- local storage への書き込みは以下の3箇所だけが行う。
  1. popup: 自分がいま DB に書いた `target` を、そのまま local storage の一覧に追加する
     （write-through）。DB とローカルの内容が一致する操作なので、競合解決や
     マージロジックは発生しない。
  2. background script: 起動時・定期的な差分同期（前回同期時刻以降に更新された
     target のみ取得してマージ。初回はフル同期）。
  3. background script: マッチしたページで本文を取得して0件だった場合、その
     target を一覧から除去（差分同期では検知できない削除の後始末）。
- local storage → DB という経路は存在しない（3の削除のみ例外）。

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

## 同期方式: write-through（保存時）+ 差分同期（target 一覧のみ）

| トリガー | 処理 | 目的 |
|---|---|---|
| popup での保存成功 | 保存した target を local storage の一覧に追加（write-through） | 自分の操作の即時反映。ネットワーク往復を待たずに反映される |
| 拡張機能 / service worker 起動時 | 前回同期時刻以降に更新された target のみ取得してマージ（初回はフル同期） | service worker 再起動・拡張機能再読み込み時の最新化 |
| 定期 interval（`browser.alarms`） | 起動時と同じ差分同期 | popup 以外からの変更の取り込み、ズレの自己修復 |
| ページが target 一覧にマッチしたが本文が0件 | その target を local storage の一覧から削除 | 差分同期では検知できない削除の後始末（下記参照） |

### timestamp ベースの差分同期と削除の扱い

`updated` フィールドを使った `filter=(updated>X)` で作成・更新分のみを取得する差分同期を
採用している。ただし **削除されたレコードは検知できない**（存在しないレコードは検索結果に
出てこないため）。

これに対処するため、削除の検知自体にソフトデリートのような追加ロジックは持たせず、
**マッチしたページで実際に本文を取得しに行ったときに0件だった場合、その場でキャッシュから
除去する**という遅延方式を採る（`entrypoints/background.ts` の `checkTab`）。削除済みの
target がキャッシュに残っていても、実害は「マッチしたページで無駄な問い合わせが1回発生する
（本文が無いので付箋は表示されない）」だけであり、そのタイミングで自己修復される。

同期時刻はフェッチ開始前のタイムスタンプ（UTC, ISO 8601）を保存する。フェッチ完了後の
時刻を保存すると、フェッチ中に更新されたレコードを次回取りこぼすため。

## content script の動的注入

### なぜ静的な `content_scripts` 登録ではないのか

`entrypoints/content/index.ts`（note のマウント処理本体）を全ページへ
静的注入すると、付箋が存在しない大多数のページでも note のマウント/
ドラッグ/リサイズ用のイベントリスナー一式が無駄に走ることになる。
これを避けるため、この本体は `registration: "runtime"` で宣言され、
マニフェストには載らない。

### 経緯: `registerContentScripts`/`updateContentScripts` を採用しなかった理由

以前は `lib/dynamicContentScript.ts` が `browser.scripting.registerContentScripts`/
`updateContentScripts` で、キャッシュ済み `target` 一覧から生成した match
pattern を動的に登録・更新する方式を取っていたが、これは以下の理由により
撤回した。

- これらのAPIは1つの `id` に対して1組の `matches` 配列しか持てず、
  メタデータ（「このパターンはどの target 由来か」）を一切保持できない。
  そのため、`target` 一覧を書き換えるすべての経路
  （popup の write-through、`fullSyncTargets`/`syncTargets`、削除）から
  漏れなく同期呼び出しを行うことでしか正しさを保てず、1箇所でも
  呼び忘れるとサイレントにバグる。
- 登録・更新は「今後のナビゲーション」にしか効かず、すでに開いている
  タブには遡って適用されない。この穴を埋めるためだけに
  `injectIntoOpenTabs()`（開いている全タブへ `browser.scripting.executeScript`
  で直接実行する別経路）を持つ必要があり、仕組みが二重になっていた。

### 現在の方式: `tabs.onUpdated` を起点にマッチ時のみ本体を注入

```
browser.tabs.onUpdated（実際のナビゲーション、SPA遷移含む）
        ▼
background.ts の checkTab/runCheckTab
        │ isTargetMatch(url, cachedTargets) でローカル判定（通信なし）
        │
   ┌────┴────┐
  no match   match
    │          │
  何もしない   ensureContentScriptInjected(tabId)
              → browser.scripting.executeScript で
                entrypoints/content/index.ts のビルド成果物を注入
              │
              ▼
            以降は従来通り fetchAnnotations → SHOW_ANNOTATION_MESSAGE
```

`content script`（`entrypoints/content/index.ts`）を全ページに静的登録する
代わりに、`browser.tabs.onUpdated` だけを起点にすることで、非対象ページでの
実行コストは一切発生しない（メッセージ送信すら不要）。かつてはこの起点として
全ページに静的登録した軽量な `entrypoints/bootstrap.ts` を挟んでいたが、
`tabs.onUpdated` 自体が content script の実行に依存しないブラウザ組み込みの
イベントであり、単独でナビゲーション検知に十分だったため撤去した。

`ensureContentScriptInjected` は `checkTab` を経由するすべての呼び出し元
（`tabs.onUpdated`、popup からの `CHECK_ANNOTATION_MESSAGE`、
`RECHECK_ALL_TABS_MESSAGE` 経由の `recheckAllTabs`）で共通して通るため、
「target 一覧が変わるたびに開いている全タブへ注入を試みる」という
以前の `injectIntoOpenTabs()` が担っていた保証は、専用の別経路を持たずに
自然に成立する。

二重注入の心配もない: 同じタブへ `executeScript` を重ねて呼んでも、
`entrypoints/content/index.ts` 冒頭の `__stickyPartyContentLoaded` ガード
により二重マウントは起きず、単なる no-op で済む（この点は旧方式の
`injectIntoOpenTabs()` から変わっていない）。

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
