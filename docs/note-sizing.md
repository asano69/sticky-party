# 付箋のサイズ・位置計算仕様

## 前提: 責務の分担

付箋のUIは2つのドキュメントにまたがって描画される（理由は
`docs/architecture.md` および `entrypoints/content.ts` 冒頭のコメント参照）。

- **`entrypoints/content.ts`（wrapper）**: ホストページのDOMに挿入される要素。
  位置・サイズ・ドラッグヘッダー・Dismissボタンのみを持つ。付箋の本文コンテンツは
  一切持たない。
- **`entrypoints/annotation-iframe/NoteContent.tsx`（iframe内部）**: 拡張機能自身の
  オリジンを持つiframe内で描画される、タイトル・本文・編集/削除UI。

2つは別ドキュメントなのでJSの状態を共有できず、`window.postMessage` でやり取り
する（プロトコルは `lib/iframe-messages.ts`）。**サイズの実際の計算・保持は
すべて `content.ts` 側（wrapper）が行い、iframe側は「今の本文コンテンツの高さ」を
報告するだけ**、という役割分担になっている。

## 用語・定数

- `TITLE_ROW_HEIGHT_PX = 32`（`lib/iframe-messages.ts`）
  タイトル行の高さ。iframe内の `<header>` と、`content.ts` がホストページ側に
  重ねる透明なドラッグヘッダーの両方がこの値を共有する。1つでもズレると
  ヘッダーとタイトル行がピクセル単位でズレるため、両側で同じ定数を参照する
  ことが必須。
- `contentHeight`（`content.ts` の `mountNote` 内のローカル変数）
  「編集していない状態でのmain（本文表示エリア）の高さ」を表す、この付箋の
  サイズ計算における唯一の信頼できる状態（source of truth）。footerの有無に
  関わらず、常に「本文だけ」の高さを表す。
- `isEditingNote`（同上）
  今この付箋が編集モードかどうか。footer分の高さを足すかどうかの判定に使う。

wrapperの高さは常に次の式で決まる:

```
wrapper.height = TITLE_ROW_HEIGHT_PX
                + contentHeight
                + (isEditingNote ? TITLE_ROW_HEIGHT_PX : 0)  // footer
```

この式を実装しているのが `content.ts` の `applyWrapperHeight()`。
`contentHeight` あるいは `isEditingNote` が変化するたびにこれを呼び直すことで
wrapperの高さを更新する。

## `contentHeight` の更新経路

`contentHeight` を書き換える箇所は3つあり、それぞれ用途が異なる。

### 1. マウント時（初期値）

```ts
let contentHeight = savedHeight ? savedHeight - TITLE_ROW_HEIGHT_PX : 0;
```

保存済みの位置情報（`positions` コレクション）があれば、そこから
`TITLE_ROW_HEIGHT_PX` を引いた値を初期値にする。保存された `height` は
「footerを含まない、その時点のcontentHeight」（後述）なので、この引き算で
正しく復元できる。保存情報が無ければ `0` からスタートし、後述の
`NOTE_CONTENT_RESIZE_MESSAGE` で実測値に更新されるのを待つ。

### 2. iframeからの実測報告（`NOTE_CONTENT_RESIZE_MESSAGE`）

iframe側（`NoteContent.tsx`）の `reportContentHeight()` が、本文の実際の
必要高さを計算して `window.parent.postMessage` で送ってくる。`content.ts` の
`onMessage` はこれを受けて単純に上書きする:

```ts
} else if (e.data?.type === NOTE_CONTENT_RESIZE_MESSAGE) {
  contentHeight = e.data.height;
  applyWrapperHeight();
}
```

`reportContentHeight()` の中身は編集中/非編集中で計算方法が違う（詳細は
下記「編集中の高さ計算」節）。この経路が呼ばれるのは:

- 付箋がinitされた直後（iframe側の `INIT_NOTE_MESSAGE` 受信時に暗黙的に
  render→エフェクトが走る）
- 編集中、テキスト（タイトル or 本文）が変化するたび
  （`createEffect` が `draft`/`draftTitle` を購読している）

つまり「本文の内容が変わって必要な高さが変わったとき」に呼ばれる経路。

### 3. ユーザーによる手動リサイズ（ResizeObserver）

wrapperには `resize: both`（ネイティブCSSのリサイズハンドル）が付いており、
ユーザーがドラッグしてサイズを変えられる。これはJSのイベントを発火しない
ため、`ResizeObserver` で検知する:

```ts
resizeObserver = new ResizeObserver(() => {
  if (skipNextResizeSave) { skipNextResizeSave = false; return; }
  const footer = isEditingNote ? TITLE_ROW_HEIGHT_PX : 0;
  contentHeight = Math.max(0, wrapper.offsetHeight - TITLE_ROW_HEIGHT_PX - footer);
  clearTimeout(resizeSaveTimer);
  resizeSaveTimer = setTimeout(persistPosition, 300);
});
```

- 初回の観測（マウント時に必ず1回発火する）は「リサイズではない」ので
  `skipNextResizeSave` フラグでスキップする。
- wrapperの実測 `offsetHeight` から逆算して `contentHeight` を再計算する
  （`applyWrapperHeight()` の逆演算）。footer分を引くのは、編集中に
  リサイズされた場合でも保存対象がfooterを含まない値になるようにするため。
- 300msデバウンスしてから `persistPosition()` を呼ぶ（ドラッグ中に大量の
  書き込みが走らないようにするため）。

## 編集中の高さ計算（iframe側: `reportContentHeight`）

`NoteContent.tsx` の `reportContentHeight()` は、編集中/非編集中で
別の計算方法をとる:

```ts
if (editing() && textareaRef && contentRef) {
  const { paddingTop, paddingBottom } = getComputedStyle(contentRef);
  height = textareaRef.offsetHeight + parseFloat(paddingTop) + parseFloat(paddingBottom);
} else {
  height = contentRef?.scrollHeight ?? 0;
}
```

- **編集中**: `contentRef`（`<main>`）は `flex-1` で親の高さに引き伸ばされて
  しまうため、`contentRef.scrollHeight` を見ても縮んだことを検知できない
  （テキストを減らしてもmain自体の箱は大きいまま）。そのため、代わりに
  `textareaRef.offsetHeight`（`resizeTextarea()` が毎キー入力で正確に
  追従させている）を直接読む。これで1行に減らせば1行分まで縮む。
  `contentRef` の上下パディング（Tailwindの `py-1.5`）はtextarea自身の
  boxには含まれないので加算し直す。
- **非編集中**: シンプルに `contentRef.scrollHeight` を読む。

`textarea` 自体は `rows={1}` を持つため、`resizeTextarea()` が
`scrollHeight` を計算する際の下限（フロア）は「1行分」になる
（`textarea` の `rows` 属性が空でもCSS `height` を指定していない限り
最低保証する高さを決めるため）。したがって編集中は最低1行までしか
縮まない。

## 編集モードの切り替え時

`editing` シグナルが変化すると、`NoteContent.tsx` の別の `createEffect` が
`NOTE_EDITING_MESSAGE` を送る:

```ts
createEffect(() => {
  const nowEditing = editing();
  window.parent.postMessage({ type: NOTE_EDITING_MESSAGE, editing: nowEditing }, "*");
});
```

`content.ts` 側の処理:

```ts
} else if (e.data?.type === NOTE_EDITING_MESSAGE) {
  isEditingNote = e.data.editing;
  applyWrapperHeight();
  header.style.pointerEvents = e.data.editing ? "none" : "auto";
}
```

- `isEditingNote` を更新して `applyWrapperHeight()` を呼ぶだけで、
  **`contentHeight` 自体は変更しない**。つまり編集モードのON/OFFは
  footer分（`TITLE_ROW_HEIGHT_PX`）の増減だけをもたらし、本文の表示に
  使われる高さ（`contentHeight`）はそのまま保持される。
- 編集を終了してもreadingモードの高さへ再計算し直さない
  （`NoteContent.tsx` 側のコメントに明記されている意図）。理由は、
  編集中は「1行フロア付きのtextarea基準」で決まった高さを、そのまま
  保存対象のサイズとして使いたいため。ここでreading表示（`contentRef`）を
  基準に再計測してしまうと、textareaのフロアより小さく縮んでしまう
  ケースがあり、意図しない縮小が起きる。
- `header.style.pointerEvents` の切り替えは、編集中はクリックが
  iframe内のinputに届くようにするため（ヘッダーのドラッグオーバーレイが
  編集中はクリックを奪わないようにする）。サイズ計算とは無関係。

## 永続化される値（`positions` コレクション）

`persistPosition()` が保存する値:

```ts
savePosition(
  annotation.id,
  {
    top, left,
    width: wrapper.offsetWidth,
    height: TITLE_ROW_HEIGHT_PX + contentHeight,  // footerを含まない
    z,
  },
  positionRecordId,
)
```

- **`height` には常にfooterを含めない**。これにより、編集モードで保存が
  走っても、また非編集モードで保存が走っても、常に同じ「素の付箋の高さ」が
  記録される。編集トグルそのものがサイズを恒久的に変えることはない。
- `width` は `wrapper.offsetWidth` を直接読む（横方向にはfooterのような
  可変要素がないため、素直に実測値でよい）。
- 座標（`top`/`left`）と `width`/`height` は `lib/positions.ts` の
  `toRatio`/`fromRatio` を通じて、x/yのみウィンドウサイズに対する比率
  として保存される（デバイスごとのウィンドウサイズ差を吸収するため）。
  width/height/zは生のpx値（zはスタッキング順そのもの）としてそのまま
  保存される。

## 復元時の初期表示

`mountNote()` の冒頭、`fetchPosition()` で保存済みpositionを取得できた
場合:

```ts
top = saved.top; left = saved.left; z = saved.z;
savedWidth = saved.width; savedHeight = saved.height;
contentHeight = savedHeight ? savedHeight - TITLE_ROW_HEIGHT_PX : 0;
```

wrapperのマウント時に `width: savedWidth ? ... : "260px"` として即座に
反映されるため、保存済みの付箋は「デフォルト位置に一瞬表示されてから
ジャンプする」ことなく、最初から正しい位置・サイズで描画される。

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

この `min-height` は **`applyWrapperHeight()` が計算する `height` とは
独立したCSSの制約**であり、`contentHeight` から逆算される値ではない。
つまり、本文が実際には1行しかなく `applyWrapperHeight()` が64px未満の
高さを指示しても、CSSの `min-height` がそれを上書きしてより大きく
表示させてしまう。

`main` は `flex-1` なので、`min-height` によってwrapperが余分に
引き伸ばされた分は、そのままmainの空白として現れる
（＝本文が1行だけなのに空行があるように見える）。

`MIN_CONTENT_HEIGHT_PX`（1行ぶんのcontent領域）は、`main` の縦パディング
（`py-1.5` = 12px）とだいたい1行分のテキスト高さ（`14px * line-height 1.4`
≈ 20px）を足した値を目安にしている。2行以上の本文では必要な高さが
64pxを自然に超えるため、この `min-height` は効かず、
`applyWrapperHeight()` が計算したとおりの高さにちょうど縮む。

（旧アーキテクチャの `extension/old-arch/AnnotationBoard.tsx` にも同種の
`min-height: "66px"` が個別にチューニングされてコメント付きで存在して
おり、考え方は同じ。）

## まとめ図

```
[wrapper (content.ts, ホストページ側)]
  height = TITLE_ROW_HEIGHT_PX + contentHeight + (editing ? TITLE_ROW_HEIGHT_PX : 0)
  ただし CSS min-height = TITLE_ROW_HEIGHT_PX + MIN_CONTENT_HEIGHT_PX が下限として効く

  contentHeight の更新源:
    ① マウント時: savedHeight - TITLE_ROW_HEIGHT_PX (positionsテーブルから復元)
    ② NOTE_CONTENT_RESIZE_MESSAGE (iframeが本文サイズ変化を報告)
    ③ ResizeObserver (ユーザーのドラッグリサイズ、footer分を引いて逆算)

  永続化: height = TITLE_ROW_HEIGHT_PX + contentHeight (footerを含めない)

[iframe (NoteContent.tsx, 拡張機能オリジン)]
  reportContentHeight():
    編集中    -> textareaRef.offsetHeight + contentRef の上下padding
    非編集中  -> contentRef.scrollHeight
  → postMessage(NOTE_CONTENT_RESIZE_MESSAGE) で wrapper 側へ通知
```
