# 付箋のサイズ・位置計算仕様

## 前提: 責務の分担

付箋のUIは2つのドキュメントにまたがって描画される（理由は
`docs/architecture.md` および `entrypoints/content/index.ts` 冒頭のコメント
参照）。

- **`entrypoints/content/mountNote.ts`（wrapper）**: ホストページのDOMに
  挿入される要素。位置・サイズ・ドラッグヘッダー・Dismissボタンのみを持つ。
  付箋の本文コンテンツは一切持たない。
- **`entrypoints/annotation-iframe/NoteContent.tsx`（iframe内部）**: 拡張機能
  自身のオリジンを持つiframe内で描画される、タイトル・本文・編集/削除UI。

2つは別ドキュメントなのでJSの状態を共有できず、`window.postMessage` でやり
取りする（プロトコルは `lib/iframe-messages.ts`）。**サイズの実際の計算・
保持はすべて `mountNote.ts` 側（wrapper）が行い、iframe側は「今の本文コン
テンツの高さ」を報告するだけ**、という役割分担になっている。

## 設計の変遷: なぜ2つの高さフィールドに分かれているか

以前は「編集モードでもプレビューモードでも同じ1つの `contentHeightPx`
を使い回し、モード切り替え時にどちらの実測値を優先するか」を
`editingFloorPx`（編集開始時に閲覧時の高さをキャプチャしておくフロア）と
`restoredFloorPx`（マウント後最初の非編集時レポート1回だけ効くフロア）の
優先順位チェーンで捌く設計だった。1つの状態に「編集中の高さ」と「閲覧中の
高さ」という2つの異なる意味を持たせていたため、画像やコードブロックのよう
に非同期に確定するコンテンツの高さ変化が「どちらのモードのフロアを汚染す
るか」を毎回気にする必要があり、バグの温床になっていた。

現在は素直に、**プレビュー用と編集用で別々の状態を持つ**設計に変更した。
クロスモードの調整ロジック（フロアのキャプチャ・優先順位判定）はまるごと
不要になっている。

## 用語・定数

- `TITLE_ROW_HEIGHT_PX = 32`（`lib/iframe-messages.ts`）
  タイトル行（ヘッダー）の高さ。footerの高さも同じ値を流用している
  （フッターはヘッダーと同じ見た目の1行ボタン列のため）。iframe内の
  `<header>`（`NoteHeader.tsx`）と、`mountNote.ts` がホストページ側に重ねる
  透明なドラッグヘッダーの両方がこの値を共有する。
- `MAX_AUTO_PREVIEW_HEIGHT_PX = 500`（`entrypoints/content/noteIframeProtocol.ts`）
  プレビュー高さを**自動計算**する場合の上限（ソフトリミット）。手動リサイ
  ズには適用されない。
- `note.previewHeightPx`（`mountNote.ts` の solid.js store `note` のフィー
  ルド）
  「編集していない状態（プレビュー/閲覧モード）でのmain（本文表示エリア）
  の高さ」。footerを含まない。
- `note.editorHeightPx`（同上）
  「編集モードでのmain＋footerの高さ」。**footerの高さを最初から含んだ
  値**として保持する（後述）。previewHeightPxとは完全に独立しており、
  互いに派生・変換されることはない。
- `note.autoHeight`（同上、`positions.autoHeight` として永続化）
  `previewHeightPx` がコンテンツ量から自動計算され続けるかどうかを表す
  フラグ。`editorHeightPx` はこのフラグと無関係に常にtextareaへ追従する。
- `note.editing`（同上）
  今この付箋が編集モードかどうか。どちらの高さフィールドを表示に使うかの
  判定に使う。

wrapperの高さは常に次の式で決まる:

```
wrapper.height = TITLE_ROW_HEIGHT_PX
                + (note.editing ? note.editorHeightPx : note.previewHeightPx)
```

`editorHeightPx` は最初からfooter分を含んでいるため、旧設計にあった
「編集中だけfooter分を追加で足す」処理は不要になっている。

`note` は `top`/`left`/`pinned`/`previewHeightPx`/`editorHeightPx`/
`autoHeight`/`editing`/`z` を1つにまとめた solid.js の `createStore` であり、
wrapperの `position`/`top`/`left`/`height`/`zIndex` を導出する式は `onMount`
内でただ1つの `createEffect` として実装されている（`mountNote.ts`）。エフェ
クトは生成時に一度実行され、以降はストアのどのフィールドが変化しても自動
で再実行されるため、更新経路はすべて対応する `setNote(...)` を呼ぶだけで
よい。

エフェクトはコンポーネントツリーの外（プレーンなTS関数の中）で使われて
いるため、`createRoot`で明示的にownerを作り、返り値の`dispose`関数を
ノート削除時（`onRemove`）に呼んで購読を解放している。

## `previewHeightPx`（プレビュー高さ）

閲覧モード（非編集）で表示される、本文の「休止時」の高さ。

### 初期値（マウント時）

保存済みの位置情報（`positions` コレクション）があれば、そこから
`TITLE_ROW_HEIGHT_PX` を引いた値を初期値にする。無ければ `0` からスタート
し、最初の実測レポートで実際の値に更新されるのを待つ（この点は旧設計から
変わっていない）。

```ts
previewHeightPx: saved.height
  ? Math.max(0, remToPx(saved.height) - TITLE_ROW_HEIGHT_PX)
  : 0
```

### 更新経路（2つ、旧設計の3つから単純化）

#### 1. iframeからの実測報告（`NOTE_CONTENT_RESIZE_MESSAGE`、非編集時かつ`autoHeight`のときのみ）

`entrypoints/content/noteIframeProtocol.ts`:

```ts
} else if (note.autoHeight) {
  // Auto-sizing is only ever capped, never floored -- a note
  // that's genuinely short is allowed to stay short.
  setNote({
    previewHeightPx: Math.min(e.data.height, MAX_AUTO_PREVIEW_HEIGHT_PX),
  });
}
```

`autoHeight` が `false`（後述: 一度でも手動リサイズされた付箋）の場合、こ
の分岐は素通りされ、`previewHeightPx` は書き換わらない ―― 本文の編集や、
画像・コードブロックの非同期な高さ変化があっても、以後は無視される。

`500px` のキャップは自動計算の場合にのみ効き、下限（フロア）は設けていな
い ―― 短い本文はそのまま短く表示される。

#### 2. ユーザーによる手動リサイズ（`ResizeObserver`、`noteResizing.ts`）

ネイティブCSSの `resize: both` ハンドルでドラッグされたときに発火する。

```ts
const contentPx = Math.max(0, wrapper.offsetHeight - TITLE_ROW_HEIGHT_PX);
if (note.editing) {
  setNote({ editorHeightPx: contentPx, autoHeight: false });
} else {
  setNote({ previewHeightPx: contentPx, autoHeight: false });
}
```

**重要:** 編集モード中にリサイズされた場合でも `autoHeight` は `false` に
される。つまり「編集モード中のリサイズ」は `editorHeightPx` を直接更新し
つつ、副作用として**将来のプレビューモードの自動計算も無効化する**。これ
は「一度でも手動でサイズをいじった」という意思表示を、モードを問わず尊重
するための単純化であり、`previewHeightPx` と `editorHeightPx` を別々に
「自動/手動」で管理する複雑さを避けている。

## `editorHeightPx`（編集時の高さ）

編集モードで表示される、textarea＋footer分の高さ。素直に「今のtextareaの
実際の高さ」を反映するだけで、`previewHeightPx` とは完全に独立している。

### 初期値（そのノートを初めて編集する時）

`editorHeightPx` はDBに永続化しない。textareaの実測値でほぼ即座に上書き
される値であり、復元して得られるメリットは「編集開始直後の一瞬のチラつき
防止」程度でしかなく、そのためにDBスキーマ・保存/復元ロジックを持つコス
トには見合わないと判断した。常に `0` からスタートする。

編集を開始した瞬間、iframe側のtextareaがその時点の本文をそのまま流し込ん
だ自然な高さ（`resizeTextarea()` の `scrollHeight`）を計測し、それが最初
の実測報告として反映される。復元値が無いことで、編集ボタンを押した瞬間に
一瞬タイトル行だけの高さに潰れてから本来のサイズへジャンプする、という軽
微なチラつきが起こり得るが、これは許容している。

### 更新経路

#### 1. iframeからの実測報告（`NOTE_CONTENT_RESIZE_MESSAGE`、編集時は常に）

```ts
if (note.editing) {
  setNote({ editorHeightPx: e.data.height + TITLE_ROW_HEIGHT_PX });
}
```

`autoHeight` フラグに一切ゲートされていない ―― 手動リサイズ済みの付箋
でも、編集を始めればtextareaの実サイズにそのまま追従する。`e.data.height`
はiframe側が計測した「main（footerを含まない）」の高さなので、footer分
として `TITLE_ROW_HEIGHT_PX` を足したものが `editorHeightPx` になる。

#### 2. ユーザーによる手動リサイズ（編集モード中、`noteResizing.ts`）

前節の通り、編集モード中に `resize: both` ハンドルでリサイズされた場合は
`editorHeightPx` がその場の `wrapper.offsetHeight - TITLE_ROW_HEIGHT_PX`
（＝main＋footer分）に更新される。

## `autoHeight` フラグ

`positions.autoHeight` としてDBに永続化される真偽値。

- デフォルトは `true`（新規付箋、あるいはこのフィールドが存在しなかった
  頃に保存された付箋 ―― `saved.autoHeight ?? true`）。
- ネイティブの `resize: both` ハンドルでドラッグされた**瞬間に**、編集
  中/閲覧中を問わず永久に `false` になる。
- 一度 `false` になったら二度と `true` には戻らない。「自動調整に戻す」
  ようなUIは現時点では用意していない。
- `previewHeightPx` の自動計算（実測レポートの反映、`500px`キャップ）だけ
  を制御し、`editorHeightPx` には一切影響しない。
- リアルタイム同期（`positions` コレクションのsubscribe）で他の閲覧者にも
  伝播する ―― `mountNote.ts` の `applyRemotePosition` を参照。

## 編集モードの切り替え時の処理

`NOTE_EDITING_MESSAGE` を受けたときの `mountNote.ts` 側の処理:

```ts
} else if (e.data?.type === NOTE_EDITING_MESSAGE) {
  setNote({ editing: e.data.editing });
  header.style.pointerEvents = e.data.editing ? "none" : "auto";
}
```

旧設計にあった「編集開始時にその時点の `previewHeightPx` をフロアとして
キャプチャしておく」処理（`editingFloorPx`）は完全に撤去された。
`editorHeightPx` は `previewHeightPx` から一切派生しないので、そもそも
キャプチャする対象がない。`setNote("editing", ...)` を呼ぶだけで高さ用の
エフェクトが自動的に再実行され、表示する高さフィールドが切り替わる。

`header.style.pointerEvents` の切り替えは、編集中はクリックがiframe内の
inputに届くようにするため（ヘッダーのドラッグオーバーレイが編集中はクリ
ックを奪わないようにする）。サイズ計算とは無関係。

## iframe側の計測（`useContentHeight.ts`）

`reportContentHeight()` は、編集中/非編集中で計算方法が違う（旧設計から
変更なし）:

```ts
if (editing() && textareaRef && contentRef) {
  const { paddingTop, paddingBottom } = getComputedStyle(contentRef);
  height = textareaRef.offsetHeight + parseFloat(paddingTop) + parseFloat(paddingBottom);
} else {
  height = contentRef?.scrollHeight ?? 0;
}
```

- **編集中**: `contentRef`（`<main>`）は `flex-1` で親の高さに引き伸ば
  されてしまうため、`contentRef.scrollHeight` を見ても縮んだことを検知
  できない。代わりに `textareaRef.offsetHeight`（`resizeTextarea()` が毎
  キー入力で正確に追従させている）を直接読み、`contentRef` の上下パディ
  ング分を足し戻す。
- **非編集中**: シンプルに `contentRef.scrollHeight` を読む。

これが呼ばれるのは:

1. マウント時（`setContentRef` のref callback、`queueMicrotask` 経由）
2. 編集中、テキスト（タイトル or 本文）が変化するたび（`draft`/`draftTitle`
   を購読する `createEffect`）
3. **`setBodyRef`（プレビュー時に`AnnotationBody`を包む素のブロックdiv）
   を監視する `ResizeObserver`** ―― そのdiv自身の箱のサイズが、テキスト
   入力とは無関係に変わったとき（貼り付けた画像の非同期ロード完了、サー
   バー側でハイライトされたコードブロックのHTMLが届く（`lib/renders.ts`）
   など）に発火する。`contentRef`（`<main>` 自身）ではなく、あえてその
   内側のdivを監視対象にしている理由は後述の「既知の落とし穴」を参照。
   編集中はこの`ResizeObserver`に頼らず、上記2番目（`draft`/`draftTitle`
   を購読する`createEffect`）が直接 `reportContentHeight()` を呼ぶことで
   追従している。

この3番目（`ResizeObserver`）が、画像やコードブロックの高さがコンテンツ側
の都合で非同期に確定するケースへの追従を可能にしている変更点であり、
`previewHeightPx`/`editorHeightPx` どちらのフィールドに反映されるかは、
送信されたメッセージを受け取った `noteIframeProtocol.ts` 側が `note.editing`
だけを見て振り分ける ―― iframe側は自分がどちらのフィールドに書き込まれる
かを一切意識しない。

## 既知の落とし穴: `ResizeObserver` の監視対象を `<main>` 自身にしない

`<main>`（`NoteMain.tsx`、`flex-1 overflow-auto`）を直接 `ResizeObserver`
で監視すると、**添付画像の非同期ロード完了やコードブロックのシンタックス
ハイライトHTML到着（`lib/renders.ts`）で内容が増えても、高さの変化が検知
できない**という不具合が過去に発生した。

原因は `<main>` 自身のボックスサイズが、コンテンツの量ではなく **flexレイ
アウトによって wrapper（ホスト側）から与えられたスペース** で決まっている
ため。`ResizeObserver` は「要素自身のボックスサイズの変化」だけを検知する
ので、`overflow-auto` の中身がどれだけ増えても `<main>` 自身の
`offsetHeight` が変わらない限り一切発火しない。

### 修正

`useContentHeight.ts` の `contentResizeObserver` の監視対象に、`<main>`
ではなく **プレビューモード時に `AnnotationBody` を包む素のブロック
`<div>`**（`NoteMain.tsx`、`setBodyRef` 経由）を追加した。このdivは
flex/overflow制約を持たないため、コンテンツの実際のサイズに応じて自然に
伸縮し、`ResizeObserver` が正しく発火する。

```ts
// useContentHeight.ts
const setBodyRef = (el: HTMLElement) => {
  contentResizeObserver.observe(el);
};
```

このdivはプレビュー/編集モードの切り替え（`NoteMain.tsx` の `<Show>`）の
たびに再生成されるため、`setBodyRef` はその都度呼ばれ、新しいインスタンス
を再監視する。`contentResizeObserver` インスタンス自体は使い回しでよい
（`ResizeObserver` は複数要素を同時に監視できる）。

### 教訓: 汎用的な再発防止策

**`ResizeObserver` で「コンテンツの量に応じた高さ変化」を検知したい場合、
監視対象は必ず「自身のボックスがコンテンツに応じて伸縮する要素」でなけれ
ばならない。** `flex-1`・`overflow-auto`・固定 `height` など、親から与え
られたスペースいっぱいに広がる・収まるよう制約された要素を監視対象にする
と、中身がどれだけ変化しても外側のボックス自体は変化しないため、
`ResizeObserver` は永遠に発火しない。

同じ罠を踏まないためのチェックリスト:

- 監視したい要素に `flex: 1`（`flex-1`）や `overflow: auto/hidden` が付い
  ていないか確認する。付いている場合、その要素は「親の都合でサイズが決ま
  る」側であり、監視対象としては不適切。
- 監視対象は、devtoolsで実際にコンテンツを増減させたとき、要素自身の
  `offsetHeight`/`scrollHeight` が実際に変化するかを確認してから選ぶ。
- 非同期に確定するコンテンツ（画像ロード、サーバーレンダリング結果の到着
  など）を伴うUIでは、テキスト入力などの同期イベントだけでなく
  `ResizeObserver` のような汎用的な変化検知の仕組みが必要になりやすい
  ――個別のロード完了コールバックを都度追加する（per-source
  special-casing）よりも、こちらの方が `CLAUDE.md` のsimplicity-first
  方針に沿う。

## 永続化される値（`positions` コレクション）

`persistPosition()` が保存する値（`notePosition.ts`）:

```ts
savePosition(
  annotation.id,
  {
    pin: note.pinned,
    x: xRatio,
    y: yRatio,
    width: pxToRem(wrapper.offsetWidth),
    // Always the resting (view-mode) size, regardless of whether this
    // save happens to run while the note is being edited.
    height: pxToRem(TITLE_ROW_HEIGHT_PX + note.previewHeightPx),
    autoHeight: note.autoHeight,
    z: note.z,
  },
  positionRecordId,
)
```

- `height` には常に `previewHeightPx`（閲覧時の高さ）を使う。編集モード中
  に保存が走っても、`editorHeightPx` が `height` を汚染することはない。
- `editorHeightPx` はそもそもDBに永続化しない（前節参照）。
- `autoHeight` はそのまま渡す。

`persistPosition()` の呼び出し元は以下の4箇所のみ（旧設計から変更なし）:

- `bringToFront`（`mountNote.ts`、フォーカス時）
- ドラッグ終了（`noteDragging.ts`）
- リサイズ終了（`noteResizing.ts`）
- ピン切り替え（`mountNote.ts` の `togglePin`）

**本文を編集して保存しただけ（`saveEdit`）では `persistPosition()` は呼ば
れない。** そのため、編集直後の `editorHeightPx` が実際にDBへ届くのは、上
記のいずれかの操作（ドラッグ・リサイズ・ピン切り替え・フォーカス）が次に
起きたときになる。これは旧設計から変わっていない挙動で、今回のフィールド
分割によって新たに生じた問題ではない。

## 復元時の初期表示（`fetchInitialPosition`, `notePosition.ts`）

```ts
previewHeightPx: heightPx
  ? Math.max(0, heightPx - TITLE_ROW_HEIGHT_PX)
  : 0,
autoHeight,       // saved.autoHeight ?? true
```

これらを使って `note` store が初期化され、wrapperのマウント時に即座に反映
される。これにより保存済みの付箋は「デフォルト位置に一瞬表示されてから
ジャンプする」ことなく、最初から正しい位置・サイズで描画される。

`editorHeightPx` は `fetchInitialPosition` の返り値には含まれず、`mountNote.ts`
の `note` store 初期化時に直接 `0` を渡す（前述の通りDBに永続化しないため）。

## `min-height` / `min-width` によるフロア（CSS制約）

wrapperには `resize: both` のハンドルで自由に縮められないよう、CSSの
下限を設定している（`noteChrome.ts`、この点は旧設計から変更なし）:

```ts
Object.assign(wrapper.style, {
  ...
  minWidth: "160px",
  minHeight: `${TITLE_ROW_HEIGHT_PX + MIN_CONTENT_HEIGHT_PX}px`, // 32 + 32 = 64px
  ...
});
```

この `min-height` は store effectが計算する `height` とは独立したCSSの制約
であり、`previewHeightPx`/`editorHeightPx` から逆算される値ではない。編集/
閲覧どちらのモードでも同じ下限が働く。

## リアルタイム同期での扱い

他の閲覧者による位置・サイズ変更は `positions` コレクションのrealtime
subscribeを通じて配送される（`docs/realtime-sync.md` 参照）。
`AnnotationPositionUpdatedMessage`（`lib/realtime-messages.ts`）は
`autoHeight` を含んでおり、`mountNote.ts` の `applyRemotePosition` がこれを
そのまま反映する:

```ts
setNote({
  pinned: update.pin,
  top: nextTop,
  left: nextLeft,
  previewHeightPx: Math.max(0, heightPx - TITLE_ROW_HEIGHT_PX),
  autoHeight: update.autoHeight,
  z: Math.max(note.z, update.z),
});
```

**`editorHeight` はこのメッセージに含まれておらず、リレーされない** ――
編集中の高さは、その付箋を今まさに編集している本人にしか意味を持たない
一時的な状態であり、他の閲覧者に配ることに価値がないため。

## まとめ図

```
[wrapper (mountNote.ts, ホストページ側)]
  height = TITLE_ROW_HEIGHT_PX
         + (note.editing ? note.editorHeightPx : note.previewHeightPx)
  ただし CSS min-height = TITLE_ROW_HEIGHT_PX + MIN_CONTENT_HEIGHT_PX が下限として効く
  上記の式は createEffect として実装されており、note store のいずれかの
  フィールドが変化するたびに自動で再適用される
  （呼び出し側は setNote(...) を呼ぶだけでよい）

  note.previewHeightPx の更新源:
    ① マウント時: saved.height から復元（初期値のみ）
    ② NOTE_CONTENT_RESIZE_MESSAGE（非編集時 かつ autoHeight===true のときのみ）:
         previewHeightPx = min(実測値, 500px)
    ③ ResizeObserver（ユーザーのドラッグリサイズ）:
         previewHeightPx = wrapper実測値 - TITLE_ROW_HEIGHT_PX
         同時に autoHeight を永久に false にする（編集中のリサイズでも）

  note.editorHeightPx の更新源:
    ① マウント時: 常に0からスタート（DBには永続化しない。初回編集開始時
                  の実測で上書きされる）
    ② NOTE_CONTENT_RESIZE_MESSAGE（編集時は常に、autoHeightと無関係）:
         editorHeightPx = 実測値(main) + TITLE_ROW_HEIGHT_PX(footer分)
    ③ ResizeObserver（編集中のドラッグリサイズ）:
         editorHeightPx = wrapper実測値 - TITLE_ROW_HEIGHT_PX

  note.autoHeight:
    デフォルト true。手動リサイズ（②のResizeObserver、編集/閲覧どちらの
    モードでも）で永久に false に固定される。previewHeightPx の自動計算
    のみを制御し、editorHeightPx には無関係。

  永続化: height = TITLE_ROW_HEIGHT_PX + previewHeightPx（常に閲覧時の高さ）
          autoHeight
          （editorHeightPx はDBに永続化しない ―― 常にtextareaの実測値へ
            即座に追従するため、復元する意味がない）

[iframe (NoteContent.tsx / useContentHeight.ts, 拡張機能オリジン)]
  reportContentHeight():
    編集中    -> textareaRef.offsetHeight + contentRef の上下padding
    非編集中  -> contentRef.scrollHeight
  → postMessage(NOTE_CONTENT_RESIZE_MESSAGE) で wrapper 側へ通知

  呼び出しタイミング:
    ① マウント時（1回）
    ② 編集中、本文/タイトルの変更のたび
    ③ contentRef を監視する ResizeObserver（編集/閲覧どちらでも発火 --
       画像の非同期ロード完了やコードブロックのシンタックスハイライト
       HTML到着など、テキスト入力を伴わない高さ変化を拾うための経路）
```

主な変更点だけ要約すると:
- 旧`contentHeightPx`＋`editingFloorPx`/`restoredFloorPx`の優先順位チェーンを廃止し、`previewHeightPx`/`editorHeightPx`の完全独立フィールドに分割したことを明記
- DB新フィールド`autoHeight`のスキーマ的な意味と初期値ルールを追加
- `autoHeight`が編集中のリサイズでも`false`になる（モード横断の副作用がある）点を明記
- 500pxキャップが`autoHeight===true`の自動計算のみに効く点を明記
- iframe側`ResizeObserver`（画像・コードブロックの非同期高さ変化への追従）を新設計の中心的変更として説明
- リアルタイム同期に`autoHeight`は乗るが、編集中の高さは他の閲覧者に配る価値がないため乗らない、という非対称性を明記
- `editorHeight`をDBから廃止: textareaの実測値でほぼ即座に上書きされる値であり、復元してもメリットが薄いため`editorHeightPx`は常に0スタートのインメモリ値に変更した
- `ResizeObserver`の監視対象は`<main>`自身ではなく、コンテンツに応じて伸縮する内側のdiv（`setBodyRef`）にする必要があるという既知の落とし穴を追記
