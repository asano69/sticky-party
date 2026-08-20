# 付箋削除時のhistory取り扱い方針

## 前提

`internal/history/history.go`は、`annotations`のcreate/update/deleteの
たびに`histories`コレクションへ監査ログ行を書き込む（10分以内の同一ユーザー
連続updateはマージされる -- マージ規則の詳細はファイル冒頭のコメント参照）。

付箋（annotation）自体が削除されると、その付箋に対するcreate/update行は
「もう存在しない付箋の編集履歴」でしかなくなるため、from以前から
`purgeCreateUpdateHistory`によって削除時に一緒にパージされていた。
ただし**delete行だけは常に残す**設計になっていた -- 「誰が・いつ削除したか」
を示す唯一の記録だからである。

## 課題: 単独ユーザーの付箋にもdelete行が残ってしまう

上記の設計は、複数人が触った付箋（例: AさんがcreateしてBさんがdeleteした）
には妥当だが、**最初から最後まで1人のユーザーしか触っていない付箋**でも
同じルールが適用され、delete行だけが`histories`に永久に残ってしまう。

この場合、delete行が記録している「誰が削除したか」という情報は、他の
誰かと共有された履歴ではなく、その人自身の行動記録でしかない。本人が
自分の付箋を作って自分で消したという事実だけが、本人の知らないところで
DBに残り続けるのは、プライバシーの観点で望ましくない。

## 方針: 全行が同一ユーザーならdelete行も含めて全削除

付箋が削除された時点で、その付箋に紐づく`histories`の全行
（create 1行 + マージ済みのupdate 0〜1行 + delete 1行）を取得し、
**`user`フィールドがすべて同一かどうか**を判定する。

- **全員同じユーザー**: create/update/deleteのすべての行を削除する。
  この付箋は誰とも共有されていない個人の行動記録であり、本人のプライバシーを
  尊重して痕跡を残さない。
- **異なるユーザーが混在**: 従来通り、create/update行のみ削除し、
  delete行だけを残す。この付箋は他の誰か（例: create したAさん）にとっての
  「いつ・誰に消されたか」を知る唯一の手段であり、delete行を消してしまうと
  その人が知る権利を奪うことになるため、この場合はdelete行の保持を優先する。

判定は`user`フィールド（PocketBaseの`users`レコードID）の一致で行う。
displayName（`userName`）ではなくIDで比較するのは、表示名は本人が
いつでも変更できる可変値であり、同一性の判定には使えないため。

## 実装

`internal/history/history.go`の`purgeCreateUpdateHistory`を
`purgeHistory`に置き換える形で実装する。

```go
func purgeHistory(app core.App, annotationId string) error {
    rows, err := app.FindRecordsByFilter(
        historiesCollection,
        "annotationId = {:annotationId}",
        "", 0, 0,
        map[string]any{"annotationId": annotationId},
    )
    if err != nil {
        return err
    }
    if len(rows) == 0 {
        return nil
    }

    sameUser := true
    for _, row := range rows[1:] {
        if row.GetString("user") != rows[0].GetString("user") {
            sameUser = false
            break
        }
    }

    for _, row := range rows {
        if !sameUser && row.GetString("action") == "delete" {
            continue // kept as the sole record of who deleted a shared annotation
        }
        if err := app.Delete(row); err != nil {
            return err
        }
    }
    return nil
}
```

呼び出し側（`OnRecordDeleteRequest`ハンドラ）は、delete行自体を`record()`で
書き込んだ**あとに**`purgeHistory`を呼ぶ。delete行自身も判定対象・削除対象に
含める必要があるため、書き込みとパージの順序が重要。

## この設計を選んだ理由 / トレードオフ

- **判定基準はシンプルに「全行同一ユーザーか」の一点のみ**。
  merge窓（10分）やアクション種別ごとの重み付けなど複雑な条件は導入しない
  -- `CLAUDE.md`のsimplicity-first方針に沿う。
- 全行取得は`annotationId`単位のフィルタ1回のクエリで済み、
  対象行数もその付箋の編集回数程度（多くても数件〜数十件）なので、
  パフォーマンス上の懸念はない。
- 「途中まで1人で編集していたが、削除の直前に別ユーザーが1回でも
  触っていた」場合はdelete行が残る。これは意図的な挙動で、
  他ユーザーが一度でも関与した時点でその付箋はもう「完全に個人的」
  ではなくなる、という単純な二値判定を採用している。
