# target一覧のリアルタイム更新設計

## 目的

`lib/targets.ts`のローカルキャッシュ（`cachedTargets`）は、現状 popup の
write-through と background.ts の5分間隔ポーリング（`docs/architecture.md`）
だけで更新される。ユーザーが1つの付箋付きページに長時間滞在するユースケースでは、
その間に他の場所で新しく付箋が貼られても最大5分反映が遅れる。

この遅延を、**すでにマウントされているper-pageオーケストレータ**
（`docs/realtime-sync.md`）を経由して縮めたい。オーケストレータを
「今開いているページのtarget専用の通知チャンネル」から、
「target一覧全体の増減を拾うリレー役」にも流用する。

## 前提: 既存の同期経路（変更なし）

| 経路 | 対象 | 頻度 |
|---|---|---|
| popup write-through | 自分が保存したtarget | 保存の都度、即時 |
| background.ts 定期sync | 差分（`updated`基準） | 5分間隔 |
| 遅延削除（`checkTab`） | マッチしたページで0件だったtarget | ページ訪問時のみ |

この3経路は今回の変更でも一切変えない。今回追加するのは、これらを補完する
**第4の経路**（オーケストレータ経由のリアルタイム通知）のみ。

## 新設経路: `histories`コレクション経由

### なぜ`annotations`の直接subscribeではないか

オーケストレータは現在すでに`annotations`を`filter: target = {:target}`で
subscribeしているが、これは**現在のページのtargetに限定**されており、
他ページのtargetの増減を拾えない。filterを外して`annotations`全体を
subscribeする案もあるが、`annotations`の全件（title/body含む）を
無関係なページのオーケストレータにまで配送することになり、ペイロードが無駄に大きい。

### `histories`を選ぶ理由

`internal/history/history.go`は、create/deleteを**常に個別行**として残す
設計になっている（updateのみ10分以内の同一ユーザー連続編集をマージ）。
つまりtarget単位のCRUDイベントを、本文データを含まない軽量な形で
すでに提供している。

### 変更点

`internal/history/history.go`の`record()`に1行追加する:

```go
row.Set("target", annotation.GetString("target"))
```

targetはannotation作成後に変更されない（popupのHome.tsx以外に書き込み経路がない）ため、
updateのマージパスで`target`を再設定し直す必要はない。

## オーケストレータ側の変更

### subscribeのfilterを外す

現在ページのtargetに限定したfilterではなく、`histories`コレクション全体を
subscribeする（無関係な他ユーザー・他サイトのイベントも受け取ることになるが、
`docs/architecture.md`が想定する規模なら許容範囲）。

```ts
await pb.collection("histories").subscribe<HistoryRecord>(
  "*",
  handleHistoryEvent,
);
```

### create/deleteの非対称な扱い

| action | 扱い |
|---|---|
| create | 対象targetをローカルキャッシュに追加（`addCachedTarget`相当）。同じtargetへの2件目以降のcreateも冪等なので無害。 |
| delete | **無視する。** 同一targetに複数annotationが紐づき得るため、1件のdeleteイベントだけでは「そのtargetが完全に消えたか」を判定できない。既存の遅延削除（`checkTab`がマッチしたページで実際に0件だったときにキャッシュから外す）がすでにこのケースをカバーしているので、リアルタイム性を持たせる価値が薄い。 |
| update | 無視する（マージされる可能性があり、target一覧の増減とは無関係）。 |

これにより実装スコープは「create検知時にtargetをキャッシュへ即時追加する」
だけに絞られる。

## 配送経路

既存の`docs/realtime-sync.md`の配送表に、以下の1行が追加される形になる。

```
[PocketBase realtime: histories コレクション]
        │ action === "create" のみ
        ▼
[realtime-orchestrator iframe]
        │ postMessage (window.parent)
        ▼
[content.ts]
        │ browser.runtime.sendMessage
        ▼
[background.ts]
        │ addCachedTarget(target, updated)
        ▼
[browser.storage.local: cachedTargets]
```

既存の`ANNOTATION_CREATED_MESSAGE`等（`lib/realtime-messages.ts`）と同様の
パターンで、新しいメッセージ型を1つ追加することになる。content.ts自身は
このイベントに対して何もする必要がない（現在ページの表示には無関係）ので、
background.tsへそのまま転送するだけでよい。

## スコープ外・既知の制約

- **付箋が1件もないページではオーケストレータがマウントされない**
  （`docs/realtime-sync.md`のマウント条件）ため、この経路の恩恵を受けられるのは
  「今まさに付箋付きページを開いているユーザー」に限られる。一度もそういう
  ページを開いていないブラウザには効かないが、background.tsの定期syncが
  引き続きカバーするので致命的ではない。
- delete系のリアルタイム反映（targetが完全に消えたことを即座に知る）は
  今回のスコープに含めない。既存の遅延削除方式のまま。
- `histories`全体を無条件でsubscribeするため、他ユーザー・他サイトのイベントも
  含めて配送量が増える。規模が大きくなった場合は`action`によるサーバー側
  filteringの追加を検討する。
