docs/realtime-sync.md
# 別ユーザーによるCRUDのリアルタイム反映

## スコープ

このドキュメントが扱うのは「**閲覧中のページで、別ユーザーが同じtargetの付箋を
CRUDしたら、リロードなしで自動反映される**」ための基盤のみ。

**スコープ外（別途検討）**:
- 同一付箋を複数人が同時編集したときの競合解決（last-write-winsのまま。
  `docs/architecture.md`のsync方式と同様、今回はここまで踏み込まない）
- notesが0件のページに新規付箋が作られたときの自動出現（後述「マウント条件」参照）

## 前提: なぜrealtime subscribeを今回は採用できるのか

`docs/architecture.md`は「realtime subscribeを採用しない理由」として、MV3の
service workerが非アクティブ時にkillされ、SSE接続や`subscribe()`のコールバックが
すべて失われる点を挙げ、代わりにtarget一覧のみの差分同期方式を採用した。

今回の設計はこの結論を覆すものではない。**realtime購読をservice worker
(`background.ts`) ではなく、拡張機能オリジンを持つiframe内で行う**ことで、
service workerのライフサイクル制約を回避する。iframeはタブが開いている間・
そのページに1件以上の付箋が表示されている間だけ生存すればよく、
「ページを離れたら購読も自然に終わる」という寿命で十分要件を満たせる。

## 検討した代替案と却下理由

### iframe間の直接通信（Comlink等のRPC）

Comlinkは1対1のエンドポイント間RPCに向いた道具だが、今回必要なのは
「Orchestrator（1つ）→ NoteContent（N個、動的に増減）へのブロードキャスト配信」
であり、RPC的な双方向呼び出しは発生しない。加えてiframe同士は直接
postMessageできないため、実際にはcontent.ts（親ドキュメント）を経由する
星型トポロジーになり、Comlinkのリンク管理をNoteContentのmount/unmountの
たびに作り直す必要が生じる。素のpostMessage + 既存のプロトコル定義パターン
（`lib/messages.ts`・`lib/iframe-messages.ts`）で十分であり、シンプルさを
優先してComlinkは不採用とした。

### SharedWorkerによる購読の一本化

同一サイトを複数タブで開いた場合にSSE接続をタブ横断で1本にまとめられる点は
魅力的だったが、PocketBase JS SDKの`RealtimeService`はネイティブの
`EventSource`を直接使用しており、これはWorkerグローバルスコープ
（DedicatedWorker/SharedWorker共通）で標準的にサポートされていない。
SDKを使わず自前でSSEを実装する案も検討したが、認証トークンのリフレッシュや
再接続ロジックをSDKの外で持つことになり保守コストに見合わないため却下した。

結果として、**複数タブで同じサイトを開いている場合はタブごとに独立した
SSE接続が張られる**ことを許容する。実害は接続数がやや増える程度で、
将来必要になればリーダー選出等での一本化を検討する余地として残す。

## 全体構成

```
[content.ts: ホストページ側オリジン]
  │
  ├─ NoteContent iframe × N   (chrome-extension://...)
  │     各付箋の本文を表示。BroadcastChannelで直接update受信。
  │
  └─ Orchestrator iframe × 1  (chrome-extension://...)
        このページのtargetに対してPocketBase realtimeをsubscribe。
        create/delete は content.ts へ postMessage relay。
        update は target スコープの BroadcastChannel で直接配信。
```

Orchestratorと各NoteContentは同一オリジン（拡張機能オリジン）なので、
update系イベントはBroadcastChannelで直接やり取りできる。一方、
content.tsはホストページ側オリジンであり、`chrome-extension://...`の
BroadcastChannelには参加できないため、**wrapper要素のmount/unmount権限を
持つcontent.tsに対してだけは、従来通りpostMessageで届ける**必要がある
（`docs/communication-architecture.md`が説明する、content.tsが直接
PocketBaseを叩けない制約と同根）。

## マウント条件とライフサイクル

### Orchestratorをマウントする条件

`content.ts`が現在1件以上の付箋を表示しているページでのみOrchestratorを
マウントする。既存の`showAnnotations()`が呼ばれる条件（cachedTargetsに
マッチし、かつDB問い合わせで1件以上ヒット）と同一。

**「今0件のページに新規付箋が貼られたら自動出現する」は今回のスコープに
含めない**。これを含めるには全ページでSSE購読することになり、
`docs/architecture.md`が明確に避けた「ほぼ全ページで通信が発生する」
設計に戻ってしまうため。

### note再マウントから独立させる

`showAnnotations()`は呼ばれるたびに`hideOverlay()`で表示中の全note
iframeを作り直す設計になっているが、Orchestratorをこれに巻き込むと
SPAのクライアントサイド遷移（同一target内での再描画）のたびにSSE接続が
切断・再接続されることになり無駄が大きい。

そのため、Orchestratorは**マッチしているtargetが変わらない限り
iframeを再マウントしない**。target変化時もiframeを作り直さず、
postMessageで新しいtargetを送って`subscribe`を張り替えるだけにする。
notesが0件になった（`hideOverlay`の非マッチケース）ときだけ
Orchestrator自体を破棄する。

### 購読条件のサーバーサイドfiltering

Orchestratorはコレクション全体（`"*"`）を購読しつつ、PocketBase SDKの
`filter`オプションでサーバー側にこのページのtargetに関係するレコードだけを
絞り込ませる。`lib/annotations.ts`の`fetchAnnotations`が使っている
`pb.filter()`と同じ書き方でよい。

クライアント側で全件受けてから`target`を見て捨てるのではなく、サーバー側で
弾いてからpushさせることで、無関係なサイトを開いている他のタブ・他の
Orchestratorへの配送自体が発生しない。

### re-subscribeの扱い

PocketBase JS SDKの`RealtimeService`はSSE切断時に自動再接続し、その際
`authStore`から最新トークンを読んで再送する。`browser.storage.local`
ベースの`AsyncAuthStore`は全コンテキスト共有（`docs/pocketbase-auth.md`）
のため、Orchestrator自身がトークン切れで再接続に失敗しても、他のどこか
（popup操作や`background.ts`の定期差分sync）が再認証すれば、次の
自動再接続時にその更新済みトークンを拾って復帰する。

よってOrchestrator側で自前実装すべきは「**最初の`subscribe()`呼び出し
自体が失敗したとき**」の簡単なリトライのみで、恒久的なbackoffの
ステートマシンは持たない。

## イベント種別ごとの配送経路

| action | 配送先 | 経路 | 理由 |
|---|---|---|---|
| update | 対象annotationIdを持つNoteContent | target-scoped BroadcastChannel（直接） | 同一オリジンのiframe同士なのでcontent.tsを経由する必要がない |
| create | content.ts | postMessage (`window.parent`) | wrapper要素のmountはcontent.tsしかできない |
| delete | content.ts | postMessage (`window.parent`) | wrapper要素のunmountはcontent.tsしかできない |

### update: target-scoped BroadcastChannel

チャンネル名は`sticky-party:realtime:<normalizeTarget(target)>`のように
target単位で分ける。固定の1チャンネルにすると、拡張機能を使っている
全タブ・全サイトのiframeが同じチャンネルに乗ってしまい、無関係なサイトの
更新まで全NoteContentが受信してフィルタする無駄が生じるため。

Orchestratorは受信したレコードをそのままチャンネルにpostMessageし、
各NoteContentは自分の`annotation().id`と一致するものだけを拾って
signalを更新する（idでの絞り込みはNoteContent側の責務。target側の
絞り込みで既に対象は十分小さいので、Orchestrator側でid別に振り分ける
仕組みは設けない）。

### create / delete: content.tsへのrelay

Orchestratorはcreate/deleteイベントを`window.parent.postMessage`で
content.tsへ送る。content.tsはcreateなら`mountNote()`を呼んで新規
iframeを追加し、deleteなら該当iframeを`ui.remove()`する。

deleteの実現には、`content.ts`の`mountedNotes`をannotation idから
引けるマッピング（現状は配列のみ）に変更する必要がある。

## 編集中への配慮（衝突解決ではなく最低限のガードとして）

同時編集の競合解決自体は本ドキュメントのスコープ外だが、
NoteContentが`editing()`中にupdateイベントを受けてsignalを無条件に
上書きすると、保存時に他人の変更を問答無用で消してしまう。これは
「リアルタイム反映機能を入れたことでデータ消失リスクが増える」
という本末転倒な結果になるため、最低限のガードとして
**編集中はupdateイベントを無視し、保存完了後の次の反映で追いつく**
方針とする。

## 未確定事項（次に詰めるべきこと）

- `content.ts`の`mountedNotes`を`Map<annotationId, ui>`へ変更する
  具体的な設計
- `background.ts`の`SHOW_ANNOTATION_MESSAGE`送信箇所に、Orchestratorへ
  渡すための`target`（normalize済み）を含める
- 複数タブでの重複購読を将来一本化する場合の具体的な方式
  （現時点では実害が小さいとして許容し、対応しない）
