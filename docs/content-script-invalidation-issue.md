# content script再注入によるcontext invalidation問題

## 現状の設計（docs/architecture.md 見直し後）

### 2種類のcontent script
| スクリプト | 登録方式 | 役割 |
|---|---|---|
| `entrypoints/content/index.ts` | 動的（`registration: "runtime"`） | 付箋のマウント処理本体。ローカルのtarget一覧にマッチしたタブにのみ、`background.ts` が `browser.scripting.executeScript` で注入する |

### 注入の呼び出し経路

`ensureContentScriptInjected(tabId)`（`entrypoints/background.ts`）が
`browser.scripting.executeScript` を呼ぶ箇所は `runCheckTab` の中の1箇所だが、
`runCheckTab` 自体は複数の経路から呼ばれる（`checkTab` 経由）。

- `browser.tabs.onUpdated`（実際のナビゲーション、SPA遷移含む）
- `CHECK_ANNOTATION_MESSAGE`（popupの保存後ping）
- `RECHECK_ALL_TABS_MESSAGE` → `recheckAllTabs()` → 開いている**全タブ**に対して `checkTab`
  - popupの `App.tsx` の `checkConfigured`（popup起動のたび）
  - popupの `handleSync`（手動フルシンク）

現状の `ensureContentScriptInjected` の実装:

```ts
async function ensureContentScriptInjected(tabId: number): Promise<void> {
  await browser.scripting
    .executeScript({ target: { tabId }, files: MAIN_CONTENT_SCRIPT_JS })
    .catch(() => {});
}
```

**「すでにこのタブでcontent scriptが動いているかどうか」を一切見ずに、
マッチするたびに無条件で `executeScript` を呼んでいる。**

これは「同じタブへの再注入は安全なno-opである」という前提に立っている。
その根拠として `entrypoints/content/index.ts` 冒頭に以下のガードがある:

```ts
const w = window as typeof window & {
  __stickyPartyContentLoaded?: boolean;
};
if (w.__stickyPartyContentLoaded) return;
w.__stickyPartyContentLoaded = true;
```

## 発生している問題

**前提**: targetにマッチするWebサイトを開いていて、付箋が正常にマウントされている状態。

**手順**: この状態でpopup（拡張機能アイコン）を開く。

**症状**:
- 開いているタブの付箋（NoteContent iframe）と、そのページのrealtime orchestrator iframeが、
  何の操作もしていないのに消失する。
- そのタブのdevtoolsコンソールに以下のログが出る:
  ```
  Content script "content" context invalidated content.js:32:4
  ```

## 原因の分析

popupを開く → `App.tsx` の `checkConfigured` が `syncTargets()` 成功後に
`RECHECK_ALL_TABS_MESSAGE` を送信 → `background.ts` の `recheckAllTabs()` が
**開いている全タブ**（すでにマッチ済みで付箋が表示されているタブも含む）に対して
`checkTab()` → `runCheckTab` → `ensureContentScriptInjected(tabId)` が
無条件に再度呼ばれる、という経路になっている。

ここで問題になるのは、`__stickyPartyContentLoaded` ガードは
「**同じ実行コンテキストの中で** `main()` が二重に走ること」だけを防ぐものであり、
**WXTの `ContentScriptContext`（`main(ctx)` の `ctx` そのもの）のライフサイクルは
別に管理されている**、という点。

WXTは同じタブ・同じcontent scriptへの新しい `executeScript` 呼び出しを検知すると、
**古い方の `ctx` を invalidated 状態にする**。`entrypoints/content/mountNote.ts` や
`entrypoints/content/mountOrchestrator.ts` の `createIframeUi(ctx, {...})` は、
このinvalidationに対して自動的にクリーンアップ（`onRemove` の実行、つまり付箋・
orchestratorのiframeのアンマウント）を行う実装になっている。

つまり実際に起きているのは:

```
1回目の実行 (ctx1): content.ts が起動 → __stickyPartyContentLoaded = true
                    → mountNote/mountOrchestrator が ctx1 に紐づく形で
                      付箋・orchestratorのiframeをマウント

RECHECK_ALL_TABS_MESSAGE → 同じタブへ executeScript を再度呼ぶ

2回目の実行 (ctx2) が開始される
  → WXTがこれを検知し、ctx1 を invalidated としてマークする
  → ctx1 に紐づいていた createIframeUi の onRemove がすべて発火
    → 既存の付箋・orchestratorのiframeがすべて消える
    → コンソールに "context invalidated" ログが出る

  → 2回目の実行のトップレベルガード
    if (window.__stickyPartyContentLoaded) return;
    がすでに true（同じisolated world、windowはページと共有なので
    フラグは残っている）なので即座に return
    → 2回目の実行は何もマウントし直さない
    → メッセージリスナーの再登録も行われない
```

結果として「既存の付箋が消える」かつ「新しい付箋の再表示も一切起きない」
という、今回観測された症状に一致する。

## この設計における暗黙の前提とのズレ

`ensureContentScriptInjected` のコメントは
「`__stickyPartyContentLoaded` があるので再注入はno-opで安全」としているが、
実際には:

- **`__stickyPartyContentLoaded` ガードが防いでいるのは「2回目の実行が何かを
  マウントし直すこと」だけ**であり、「1回目の実行が破棄されること」は防げない。
- content scriptの再注入という操作そのものが、
  「既存のcontext(ctx)を破棄する」という副作用を持ってしまっている。

`docs/architecture.md` に書かれている以前の設計
（`registerContentScripts`/`updateContentScripts` ベース）から
現在の「bootstrap.ts + 動的executeScript」方式に切り替えた際、
**「マッチ済みタブへの繰り返し呼び出しをどう扱うか」が明示的に設計されていなかった**
ことが、今回の再発の背景にある。

## 現状の呼び出し頻度（再発しやすさの要因）

`ensureContentScriptInjected` が「マッチ済みタブに対しても毎回呼ばれてしまう」
経路は複数あり、いずれもユーザー操作として頻繁に起こりうる:

- popupを開くたび（`checkConfigured` 内の `syncTargets` が成功した場合、
  ほぼ毎回 `RECHECK_ALL_TABS_MESSAGE` が飛ぶ）
- popupの手動フルシンクボタンを押すたび
- 同一タブでのSPA遷移（`browser.tabs.onUpdated` の `changeInfo.url` 更新）が
  同じtargetに留まる場合

いずれも「そのタブは既にcontent scriptが動いていて付箋も表示できている」
状態であるにもかかわらず、`runCheckTab` → `ensureContentScriptInjected` の
経路を通ると無条件に再注入が起きる、という共通点がある。

## 解決: pingによる生存確認への切り替え

前節「考えるべき論点」で挙がっていた3つの選択肢のうち、
`browser.tabs.sendMessage` の成否で判定する方式を採用した。

`lib/messages.ts` に `PING_MESSAGE` を追加し、`content/index.ts` はこれに
応答するだけの軽量なリスナーを登録する:

```ts
browser.runtime.onMessage.addListener((message: PingMessage) => {
  if (message?.type === PING_MESSAGE) return Promise.resolve(true);
});
```

`background.ts` 側は、タブごとの記録（`injectedTabs`のような `Set<number>`）を
一切持たず、注入前に毎回このpingを送って生存を直接確認する:

```ts
async function isContentScriptAlive(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, { type: PING_MESSAGE });
    return true;
  } catch {
    return false;
  }
}

async function ensureContentScriptInjected(tabId: number): Promise<void> {
  if (await isContentScriptAlive(tabId)) return;
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: MAIN_CONTENT_SCRIPT_JS,
    });
  } catch {
    // Restricted page, or the tab closed mid-call.
  }
}
```

`browser.tabs.sendMessage` は、受信側のリスナーが存在しなければ必ず reject
される。存在しない理由が「そもそも注入されていない」でも「実際のナビゲーション
でcontextが破棄された」でも「拡張機能自体がreloadされた」でも、どのケースでも
一貫して「今この瞬間、生きていない」という事実をそのまま返す。

これにより、前節で挙がっていた論点はすべて解消された。

- **「生きているか」の判定**: background.ts側で状態を持たず、都度実タブに
  聞きに行くので、記録とタブの実際の状態がズレるという問題がそもそも起きない。
- **記録の破棄タイミング**: 記録自体を持たないので、`tabs.onUpdated`
  （`status === "loading"`）や `tabs.onRemoved` を使ったクリア処理が丸ごと
  不要になった。
- **拡張機能の再読み込み・ブラウザ再起動でタブは残るがcontent scriptは失われる
  ケース**: pingが単に失敗するので、フォールバックを別途用意する必要がない。

コスト面では、`isTargetMatch` でマッチしたページに限られるレアパスに
`sendMessage` の1往復が追加されるだけであり、許容範囲内と判断した。

SPA遷移時に content script 自体の再注入が本当に必要かどうか（`showAnnotations()`
の差分再マウントで足りるのでは、という論点）は、今回のスコープ外のまま残っている。
