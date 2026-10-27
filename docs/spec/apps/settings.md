# 設定（`apps/settings`）

[システムアプリの目次](README.md)

設定画面は、Binette のシステムアプリ `apps/settings` が持ちます（決定）。ホームの選択、ライフサイクルのデバッグ値、起動の履歴を表示します（形は案・実装済み）。

## 今の画面（実装済み）

- 見出し「設定」
- 「Binette について」の節: `Binette — 仕様の版 0.2` と書く。「詳しく」を押すと、短い説明が出る
- 「ホーム」の節: 保存済みの role home のアプリを、入手元に関係なく縦のボタンで並べる。今のものに「（使用中）」を付ける。押すと os.setHome で選び、表示も更新する
- 「デバッグ」の節: 1 行に「名前 値 − ＋」を並べる。ボタンは最小 44px。スタック数は 1 ずつ・1 以上、履歴の行数は 10 ずつ・0 以上、時間は 1 秒ずつ。Stop と Apps の時間は 0 以上、呼び出しと onDestroy の時間切れは 1 秒以上。秒は「10 秒」のように表示する。下限より下の − と i32 の上限を越える ＋ は何も変えない
- 「起動の履歴」の節: 新しい順に UTC の `YYYY-MM-DD HH:MM:SS アプリの名前` を並べる。名前が無いときは installedAppKey。日時は AS で Unix epoch ミリ秒から計算し、1970 年より前とうるう年にも対応する

```json
{
  "id": "io.github.nozomi-hiragi.binette.settings",
  "version": "0.1.0",
  "binette": "0.2",
  "name": "設定",
  "role": "settings",
  "icon": "icon.svg",
  "entry": { "html": "src/index.html", "as": "src/main.ts" }
}
```

- 入手元が `binette:system` かつ `role: "settings"` の場合だけ [os.*](../replique.md#設定アプリの-os案実装済み) を使える。role だけをまねた外部のアプリには渡さず、呼ぶとアプリを終了する
- ホームの一覧にふつうのアプリとして並び、開くと OS のホームバーが下に出る（[home.md](home.md#os-の枠との分担)）
- 通常の id と document API を使う。`Settings extends App` の onCreate でホームとデバッグ値のボタン、履歴の li を作る。click はグローバルの settings を通し、`Map<Element, i32>` と event.currentTarget でどのボタンかを区別する。<style> で行とボタンだけを整える
- トップレベルで `launch(settings)` を一回呼ぶ。id="details" の click で id="description" の p に説明を書く
- 値は Worker の写しも更新するので連続した − ＋ に反映する。変更は OS が SystemStore に保存し、[項目ごとの時点](../lifecycle.md#値を変えたときに効く所案実装済み)から使う。ホームを変えたときも設定画面は開いたままにする
- 履歴はインスタンスを作る直前の写し。ホームから戻すだけでは更新せず、閉じて開き直すと新しくなる
- 版の `0.2` は HTML に書いたもので、OS から読んではいない

## 未決のこと

- ほかにどんな設定の項目を置くか（例: テーマ、アプリごとの権限の取り消し、ストレージ、バックアップ）
- Binette の版などを OS から読む呼び出し
- ほかのアプリが設定画面に項目を差し込めるか（v0.1 の `.bina` の `settings` をどう引き継ぐか）
- 設定アプリを差し替えられるか
