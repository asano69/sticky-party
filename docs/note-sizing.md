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

## 用語・定数

- `TITLE_ROW_HEIGHT_PX = 32`（`lib/iframe-messages.ts`）
  タイトル行の高さ。iframe内の `<header>`（`NoteHeader.tsx`）と、
  `mountNote.ts` がホストページ側に重ねる透明なドラッグヘッダーの両方が
  この値を共有する。1つでもズレるとヘッダーとタイトル行がピクセル単位で
  ズレるため、両側で同じ定数を参照することが必須。
- `note.contentHeightPx`（`mountNote.ts` の solid.js store `note` のフィー
  ルド）
  「編集していない状態でのmain（本文表示エリア）の高さ」を表す、この
  付箋のサイズ計算における唯一の信頼できる状態（source of truth）。footer
  の有無に関わらず、常に「本文だけ」の高さを表す。
- `note.editing`（同上）
  今この付箋が編集モードかどうか。footer分の高さを足すかどうかの判定に
  使う。

wrapperの高さは常に次の式で決まる:

```
wrapper.height = TITLE_ROW_HEIGHT_PX
                + note.contentHeightPx
                + (note.editing ? TITLE_ROW_HEIGHT_PX : 0)  // footer
```

`note` は `top`/`left`/`pinned`/`contentHeightPx`/`editing`/`z` を1つに
まとめた solid.js の `createStore` であり、wrapperの `position`/`top`/
`left`/`height`/`zIndex` を導出する式は `onMount` 内でただ1つの
`createEffect` として実装されている。エフェクトは生成時に一度実行され、
以降はストアのどのフィールドが変化しても自動で再実行されるため、「値が
変わったら明示的に高さ再計算関数を呼び直す」という手続きが呼び出し側から
消えている（後述の更新経路は、すべて対応する `setNote(...)` を呼ぶだけで、
DOM更新はこのエフェクトが自動的に追従する）。位置・サイズ・pin・スタッ
キング順という5つのCSSプロパティを1つのストアと1つのエフェクトにまとめた
のは、これらが別々の場所から個別に `wrapper.style` を書き換えると互いに
ズレる（drift）のを防ぐため。

エフェクトはコンポーネントツリーの外（プレーンなTS関数の中）で使われて
いるため、`createRoot`で明示的にownerを作り、返り値の`dispose`関数を
ノート削除時（`onRemove`）に呼んで購読を解放している。

## `note.contentHeightPx` の更新経路

`contentHeightPx` を書き換える箇所は3つあり、それぞれ用途が異なる。

### 1. マウント時（初期値）

```ts
savedHeightPx = remToPx(saved.height);
...
const restoredFloorPx = savedHeightPx
  ? Math.max(0, savedHeightPx - TITLE_ROW_HEIGHT_PX)
  : undefined;

const [note, setNote] = createStore({
  ...
  contentHeightPx: restoredFloorPx ?? 0,
  ...
});
```

保存済みの位置情報（`positions` コレクション）があれば、そこから
`TITLE_ROW_HEIGHT_PX` を引いた値を初期値にする。保存された `height` は
「footerを含まない、その時点のcontentHeightPx」（後述）なので、この
引き算で正しく復元できる。保存情報が無ければ `0` からスタートし、後述の
`NOTE_CONTENT_RESIZE_MESSAGE` で実測値に更新されるのを待つ。

`restoredFloorPx` はここで一度だけ計算され、以後書き換えられない
（`const`）。単なる初期値としてだけでなく、次節の②で「実測値の下限」
としても使われる。

### 2. iframeからの実測報告（`NOTE_CONTENT_RESIZE_MESSAGE`）

iframe側（`useContentHeight.ts`）の `reportContentHeight()` が、本文の
実際の必要高さを計算して `window.parent.postMessage` で送ってくる。
`mountNote.ts` の `onMessage` はこれを受けて、**フロア値と実測値の大きい
方**を採用する:

```ts
} else if (e.data?.type === NOTE_CONTENT_RESIZE_MESSAGE) {
  setNote(
    "contentHeightPx",
    Math.max(e.data.height, editingFloorPx ?? restoredFloorPx ?? 0),
  );
  loadingOverlay?.remove();
  loadingOverlay = undefined;
}
```

`editingFloorPx ?? restoredFloorPx ?? 0` は「今どちらのフロアが有効か」を
選ぶ優先順位チェーンであり、if文による分岐ではない:

- 編集中は `editingFloorPx`（後述「編集モードの切り替え時」参照）が優先
  される。
- 編集中でなければ `restoredFloorPx` が使われる。ただし `restoredFloorPx`
  が意味を持つのは**マウント後、最初の非編集時レポート1回だけ**である
  （下記「なぜ `restoredFloorPx` は手動でクリアしなくてよいか」参照）。
  2回目以降の非編集時レポートでは実質 `0` にフォールバックし、実測値
  がそのまま採用される。
- どちらも無ければ `0` にフォールバックし、実測値がそのまま採用される。

`reportContentHeight()` の中身は編集中/非編集中で計算方法が違う（詳細は
下記「編集中の高さ計算」節）。この経路が呼ばれるのは:

- 付箋がマウントされた直後（`useContentHeight.ts` の `setContentRef` が
  ref callbackとして呼ばれた時点で `queueMicrotask(reportContentHeight)`
  を実行する。ref callbackはSolidではマウント時に一度しか呼ばれない）
- 編集中、テキスト（タイトル or 本文）が変化するたび
  （`createEffect` が `draft`/`draftTitle` を購読している）

つまり「本文の内容が変わって必要な高さが変わったとき」に呼ばれる経路。

#### なぜ `restoredFloorPx` は手動でクリアしなくてよいか

上記の通り、非編集時の `reportContentHeight()` 呼び出しは
`setContentRef` のref callback一箇所からしか発生せず、それはマウントに
つき厳密に1回しか呼ばれない。つまり「マウント後最初の非編集時レポート」
は構造的に一度きりのイベントであり、`restoredFloorPx` を参照する機会も
その一度しか存在しない。

したがって「初回だけ効かせて、以降は明示的にフラグを倒す」という手続き
的な後始末は不要で、`const restoredFloorPx = ...` として一度だけ計算し、
`??` チェーンに委ねておけば、2回目以降の非編集時レポートが存在しない
以上、自動的に「以降は無視される」状態になる。これにより「クリアし忘れ
たら壊れる」というクラスのバグを構造的に排除している。

### 3. ユーザーによる手動リサイズ（ResizeObserver）

wrapperには `resize: both`（ネイティブCSSのリサイズハンドル）が付いて
おり、ユーザーがドラッグしてサイズを変えられる。これはJSのイベントを
発火しないため、`ResizeObserver` で検知する:

```ts
resizeObserver = new ResizeObserver(() => {
  if (skipNextResizeSave) { skipNextResizeSave = false; return; }
  const footer = note.editing ? TITLE_ROW_HEIGHT_PX : 0;
  setNote(
    "contentHeightPx",
    Math.max(0, wrapper.offsetHeight - TITLE_ROW_HEIGHT_PX - footer),
  );
  // ... pointerup/pointercancel、またはフォールバックタイマーで
  //     resizeが終わったと判定してから persistPosition() を呼ぶ
});
```

- 初回の観測（マウント時に必ず1回発火する）は「リサイズではない」ので
  `skipNextResizeSave` フラグでスキップする。
- wrapperの実測 `offsetHeight` から逆算して `contentHeightPx` を再計算
  する（store effectの逆演算）。footer分を引くのは、編集中にリサイズ
  された場合でも保存対象がfooterを含まない値になるようにするため。
- ネイティブの `resize: both` ハンドルは resize-start/resize-end イベント
  を持たないため、実際に「ドラッグが終わった」タイミングは
  window の `pointerup`/`pointercancel`、またはそれが届かない場合の
  フォールバックタイマー（`RESIZE_END_FALLBACK_MS`）で判定してから
  `persistPosition()` を呼ぶ（ドラッグ中に大量の書き込みが走らないよう
  にするため）。

## 編集中の高さ計算（iframe側: `reportContentHeight`）

`useContentHeight.ts` の `reportContentHeight()` は、編集中/非編集中で
別の計算方法をとる:

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
  できない（テキストを減らしてもmain自体の箱は大きいまま）。そのため、
  代わりに `textareaRef.offsetHeight`（`resizeTextarea()` が毎キー入力で
  正確に追従させている）を直接読む。これで1行に減らせば1行分まで縮む。
  `contentRef` の上下パディング（Tailwindの `py-1.5`）はtextarea自身の
  boxには含まれないので加算し直す。
- **非編集中**: シンプルに `contentRef.scrollHeight` を読む。

`textarea` 自体は `rows={1}` を持つため、`resizeTextarea()` が
`scrollHeight` を計算する際の下限（フロア）は「1行分」になる
（`textarea` の `rows` 属性が空でもCSS `height` を指定していない限り
最低保証する高さを決めるため）。したがって編集中は最低1行までしか
縮まない。

## 編集モードの切り替え時

`editing` シグナルが変化すると、`NoteContent.tsx` の別の `createEffect`
（`useParentMessaging.ts` 内）が `NOTE_EDITING_MESSAGE` を送る:

```ts
createEffect(() => {
  const nowEditing = editing();
  window.parent.postMessage({ type: NOTE_EDITING_MESSAGE, editing: nowEditing }, "*");
});
```

`mountNote.ts` 側の処理:

```ts
} else if (e.data?.type === NOTE_EDITING_MESSAGE) {
  // Capture (or release) the editing floor right as edit mode
  // toggles -- before this note's own contentHeightPx has any
  // chance to change, so the captured value is always the resting
  // (view-mode) height, never an already-shrunk one.
  editingFloorPx = e.data.editing ? note.contentHeightPx : undefined;
  setNote("editing", e.data.editing);
  header.style.pointerEvents = e.data.editing ? "none" : "auto";
}
```

- 編集開始時、その瞬間の `note.contentHeightPx`（＝resting/view-modeの
  高さ）を `editingFloorPx` にキャプチャする。これにより、②の
  `NOTE_CONTENT_RESIZE_MESSAGE` ハンドラが「編集中の実測値がこのフロア
  を下回らない」ことを保証でき、編集モードに入った瞬間にtextareaの中身
  だけで縮んでしまう事故を防ぐ。
- `setNote("editing", ...)` を呼ぶだけで高さ用のエフェクトが自動的に
  再実行され、**`contentHeightPx` 自体は変更しない**。つまり編集モード
  のON/OFFはfooter分（`TITLE_ROW_HEIGHT_PX`）の増減だけをもたらし、本文
  の表示に使われる高さ（`contentHeightPx`）はそのまま保持される。
- 編集を終了してもreadingモードの高さへ再計算し直さない
  （`NoteContent.tsx` 側のコメントに明記されている意図）。理由は、
  編集中は「1行フロア付きのtextarea基準」で決まった高さを、そのまま
  保存対象のサイズとして使いたいため。ここでreading表示（`contentRef`）
  を基準に再計測してしまうと、textareaのフロアより小さく縮んでしまう
  ケースがあり、意図しない縮小が起きる。
- `header.style.pointerEvents` の切り替えは、編集中はクリックが
  iframe内のinputに届くようにするため（ヘッダーのドラッグオーバーレイ
  が編集中はクリックを奪わないようにする）。サイズ計算とは無関係。

## 永続化される値（`positions` コレクション）

`persistPosition()` が保存する値:

```ts
savePosition(
  annotation.id,
  {
    pin: note.pinned,
    x: xRatio,
    y: yRatio,
    width: pxToRem(wrapper.offsetWidth),
    // Use contentHeightPx (the resting/non-editing size), not
    // wrapper.offsetHeight -- the wrapper is temporarily taller than
    // that while editing.
    height: pxToRem(TITLE_ROW_HEIGHT_PX + note.contentHeightPx),
    z: note.z,
  },
  positionRecordId,
)
```

- **`height` には常にfooterを含めない**。これにより、編集モードで保存
  が走っても、また非編集モードで保存が走っても、常に同じ「素の付箋の
  高さ」が記録される。編集トグルそのものがサイズを恒久的に変えること
  はない。
- `width` は `wrapper.offsetWidth` を直接読む（横方向にはfooterのような
  可変要素がないため、素直に実測値でよい）。
- 座標（`x`/`y`）は `lib/positions.ts` が定義するratio（ドキュメントまた
  はビューポートに対する比率）として保存される（デバイスごとのウィン
  ドウサイズ差を吸収するため）。width/height/zは生の値（widthはrem、z
  はスタッキング順そのもの）としてそのまま保存される。

## 復元時の初期表示

`mountNote()` の冒頭、`fetchPosition()` で保存済みpositionを取得できた
場合:

```ts
initialTop = saved.y * basis.height;
initialLeft = saved.x * basis.width;
initialZ = saved.z;
savedWidthPx = remToPx(saved.width);
savedHeightPx = remToPx(saved.height);
```

これらを使って `note` store が初期化され（`contentHeightPx` は上述の
`restoredFloorPx` から）、wrapperのマウント時に
`width: savedWidthPx ? ... : "260px"` として即座に反映される。これにより
保存済みの付箋は「デフォルト位置に一瞬表示されてからジャンプする」こと
なく、最初から正しい位置・サイズで描画される。

さらに `restoredFloorPx` が①の初期値だけでなく②の実測値レポートに対する
一度きりのフロアとしても働くため、**保存されていたサイズが、iframeから
届く最初の実測レポートによって不用意に縮められることもない**。以前は
このフロアが存在せず、リロードのたびに「復元された高さ」が直後の実測
レポートで即座に上書きされ、手動で本文より広く取っていた付箋がテキスト
ぴったりのサイズに毎回戻ってしまう不具合があった。

## `min-height` / `min-width` によるフロア（CSS制約）

wrapperには `resize: both` のハンドルで自由に縮められないよう、CSSの
下限を設定している:

```ts
Object.assign(wrapper.style, {
  ...
  minWidth: "160px",
  minHeight: `${TITLE_ROW_HEIGHT_PX + MIN_CONTENT_HEIGHT_PX}px`, // 32 + 32 = 64px
  ...
});
```

この `min-height` は **store effectが計算する `height` とは独立した
CSSの制約**であり、`contentHeightPx` から逆算される値ではない。つまり、
本文が実際には1行しかなく計算上64px未満の高さになっても、CSSの
`min-height` がそれを上書きしてより大きく表示させる。

`main` は `flex-1` なので、`min-height` によってwrapperが余分に
引き伸ばされた分は、そのままmainの空白として現れる
（＝本文が1行だけなのに空行があるように見える）。

`MIN_CONTENT_HEIGHT_PX`（1行ぶんのcontent領域）は、`main` の縦パディング
（`py-1.5` = 12px）とだいたい1行分のテキスト高さ（`14px * line-height 1.4`
≈ 20px）を足した値を目安にしている。2行以上の本文では必要な高さが
64pxを自然に超えるため、この `min-height` は効かず、計算通りの高さに
ちょうど縮む。

## まとめ図

```
[wrapper (mountNote.ts, ホストページ側)]
  height = TITLE_ROW_HEIGHT_PX + note.contentHeightPx + (note.editing ? TITLE_ROW_HEIGHT_PX : 0)
  ただし CSS min-height = TITLE_ROW_HEIGHT_PX + MIN_CONTENT_HEIGHT_PX が下限として効く
  上記の式は createEffect として実装されており、note store のいずれかの
  フィールドが変化するたびに自動で再適用される
  （呼び出し側は setNote(...) を呼ぶだけでよい）

  note.contentHeightPx の更新源:
    ① マウント時: restoredFloorPx = savedHeightPx - TITLE_ROW_HEIGHT_PX
                  (positionsテーブルから復元、初期値であり②のフロアでもある)
    ② NOTE_CONTENT_RESIZE_MESSAGE:
         Math.max(実測値, editingFloorPx ?? restoredFloorPx ?? 0)
         - editingFloorPx: 編集開始時にキャプチャした resting height
         - restoredFloorPx: マウント後、非編集時レポートは構造的に一度
           しか届かないため、手動クリア不要でそのまま「初回だけ効く
           フロア」として機能する
    ③ ResizeObserver: ユーザーのドラッグリサイズ、footer分を引いて逆算

  永続化: height = TITLE_ROW_HEIGHT_PX + note.contentHeightPx (footerを含めない)

[iframe (NoteContent.tsx / useContentHeight.ts, 拡張機能オリジン)]
  reportContentHeight():
    編集中    -> textareaRef.offsetHeight + contentRef の上下padding
    非編集中  -> contentRef.scrollHeight (ref callbackにより厳密に1回のみ発火)
  → postMessage(NOTE_CONTENT_RESIZE_MESSAGE) で wrapper 側へ通知
```
