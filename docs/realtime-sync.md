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
状態を更新する（idでの絞り込みはNoteContent側の責務。target側の
絞り込みで既に対象は十分小さいので、Orchestrator側でid別に振り分ける
仕組みは設けない）。実際の受信・適用ロジックは後述の
「update イベントの適用」を参照。

### create / delete: content.tsへのrelay

Orchestratorはcreate/deleteイベントを`window.parent.postMessage`で
content.tsへ送る。content.tsはcreateなら`mountNote()`を呼んで新規
iframeを追加し、deleteなら該当iframeを`ui.remove()`する。

deleteの実現には、`content.ts`の`mountedNotes`をannotation idから
引けるマッピング（`Map<annotationId, ui>`）にする必要があった。実装済み
（`entrypoints/content/index.ts`）。

## update イベントの適用（実装済み: `NoteContent.tsx`側）

### `AnnotationData`に`target`を持たせる

BroadcastChannelのチャンネル名は`target`から一意に決まる
（`realtimeChannelName(target)`）。NoteContentは自分がどのtargetの
付箋なのかを知る必要があるため、`lib/messages.ts`の`AnnotationData`に
`target`フィールドを追加した。`fetchAnnotations`（`lib/annotations.ts`）
はフィールドを絞らず全件取得しているので、バックエンド側の変更は不要
（`INIT_NOTE_MESSAGE`で渡ってくる`annotation`にそのまま`target`が
乗っている）。

`content.ts`からわざわざ`target`を別メッセージとして渡す案もあったが、
「このNoteContentがどのtargetに属するか」は本来annotationレコード自身が
持つべき情報であり、既存の型に素直に足すほうが影響範囲も小さいと判断した。

### 付箋の状態をSolid Storeにする

NoteContentの付箋状態は、`createSignal<AnnotationData>()` +
`setAnnotation({ ...current, ...patch })`から、`createStore`ベースに
変更した（`const [state, setState] = createStore<{ annotation?:
AnnotationData }>({})`）。

動機はfine-grainedな再レンダー。update受信は「他ユーザーがtitleだけ
変えた」のようにフィールド単位で届くことが多く、signal + spreadの
実装だと毎回オブジェクト全体を差し替えるため、そのフィールドに
依存しないDOMまで含めて再レンダーの対象になってしまう。Storeであれば
`setState("annotation", "title", value)`のようにフィールド単位で
更新でき、実際に変化したプロパティを参照している箇所だけが
再レンダーされる。

signal自体を捨てる必要のない`editing`/`saving`等のUIローカル状態は
従来通り`createSignal`のまま残し、realtimeの適用対象になる
`annotation`本体だけをStore化した。

### `useRealtimeUpdates.ts`: 受信・適用ロジック

`useContentHeight.ts`と同様の粒度で、専用のhookに切り出した。

```ts
export function useRealtimeUpdates(params: {
  annotation: () => AnnotationData | undefined;
  setAnnotation: SetStoreFunction<{ annotation?: AnnotationData }>;
}) {
  let channel: BroadcastChannel | undefined;

  createEffect(() => {
    const note = params.annotation();
    if (!note || channel) return;
    channel = new BroadcastChannel(realtimeChannelName(note.target));
    channel.onmessage = (e: MessageEvent<RealtimeUpdatePayload>) => {
      if (e.data.record.id !== note.id) return;
      params.setAnnotation("annotation", e.data.record);
    };
  });

  onCleanup(() => channel?.close());
}
```

- 購読は`annotation()`が最初にセットされた時点（`INIT_NOTE_MESSAGE`到着後）
  の一度きり。target/idはそれ以降変わらないので再購読は不要。
- 1つのtargetチャンネルには、同じtargetを持つ他のannotationのupdateも
  流れてくる（1ページに複数付箋があり得るため）。`e.data.record.id`で
  このNoteContent自身の付箋かどうかを判定してから適用する。
- `setAnnotation("annotation", e.data.record)`はレコード全体を
  1回のsetStore呼び出しで渡しているが、Storeの差分検知により実際に
  値が変わったフィールドのみが再レンダーされる（title/body/hide/color/pin
  等をそれぞれ個別にsetStoreする必要はない）。

### 自分自身の変更のエコーバック

PocketBase realtimeは書き込んだ本人にもイベントを送り返す。つまり
`saveEdit`/`handleToggleHide`/`handleColorChange`等でローカルの
Storeを更新した直後、Orchestrator経由で同じ内容のupdateイベントが
BroadcastChannel経由で戻ってくる。これは無条件にそのまま適用して
問題ない: 値が既にローカルと一致しているため、Storeの差分検知により
実質的な再レンダーは発生せず、実害がない。エコーバックだけを検知して
スキップするような特別なロジックは設けていない。

## 編集中への配慮（衝突解決ではなく、無条件上書きが安全という判断）

同時編集の競合解決自体は本ドキュメントのスコープ外。当初案では
「編集中はupdateイベントを無視し、保存完了後の次の反映で追いつく」
としていたが、実装時に方針を変更した。

**`editing() === true`中でもupdateイベントは無条件に適用する**
（`useRealtimeUpdates`は`editing`の状態を一切見ない）。理由:

- 編集中だけイベントを無視する実装は、「他ユーザーが加えた変更が、
  この編集者が保存ボタンを押した瞬間に問答無用で消える」という
  サイレントな上書きを防げていない。編集者はその間ずっと、他ユーザーの
  最新の変更に気づかないまま古い内容を編集し続けることになる。
- 逆に無条件に上書きするほうが、「今まさに他の人がこの付箋を書き換えて
  いる」ことが編集中の画面にすぐ反映されるため、編集者は状況に気づいた
  上で保存するかどうかを判断できる。データが本人の知らないところで
  消えるより、編集中の下書きが不意に置き換わる方が安全側に倒れている
  と判断した。
- 本格的な同時編集の競合解決（例: 編集中は他ユーザーの変更をマージ待ち
  キューに入れる等）は、依然として本ドキュメントのスコープ外のまま。

## 編集履歴パネル(`historyOpen`)は今回のスコープ外

`NoteFooter.tsx`の履歴パネルは、開くたびに`fetchHistory()`する現状の
挙動のまま変更していない。理由:

- 今回のBroadcastChannelは`annotations`コレクションの更新のみを流しており、
  `histories`コレクションの変更は含まれていない。付箋本体をStore化しても、
  履歴パネルの内容（誰がいつ編集したか）は別途`histories`への専用の
  realtime購読を追加しない限りライブ更新にはならない。
- `histories`をライブ反映する価値自体は認めつつ、これは「編集操作の
  反映」という今回のタスクとはスコープが別であり、別タスクとして
  切り出すほうがシンプルさを保てると判断した。

## 未確定事項（次に詰めるべきこと）

- `histories`コレクションへのrealtime購読を追加し、開いている履歴
  パネルをライブ更新するかどうか（上記の通り今回は見送り）
- 複数タブでの重複購読を将来一本化する場合の具体的な方式
  （現時点では実害が小さいとして許容し、対応しない）
