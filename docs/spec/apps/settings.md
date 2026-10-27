# 設定（`apps/settings`）

[システムアプリの目次](README.md)

設定画面は、Binette のシステムアプリ `apps/settings` が持ちます（決定）。今は骨組みで、設定の項目はまだありません。

## 今の画面（実装済み）

- 見出し「設定」
- 「Binette について」の節: `Binette — 仕様の版 0.2` と書く。「詳しく」を押すと、短い説明が出る
- 「設定できる項目はまだありません」と書く

```json
{
  "id": "io.github.nozomi-hiragi.binette.settings",
  "version": "0.1.0",
  "binette": "0.2",
  "name": "設定",
  "icon": "icon.svg",
  "entry": { "html": "src/index.html", "as": "src/main.ts" }
}
```

- `role` は持たない。ホームの一覧にふつうのアプリとして並び、開くと OS の「戻る」の帯が上に出る（[home.md](home.md#os-の枠との分担)）
- 通常の id と document API を使う（決定 2026-10-27）。start で id="details" のボタンに click リスナーを付け、押すと id="description" の p の textContent に説明を書く（案・実装済み）
- 版の `0.2` は HTML に書いたもので、OS から読んではいない

## 未決のこと

- どんな設定の項目を置くか（例: テーマ、アプリごとの権限の取り消し、ストレージ、バックアップ）
- 設定を読み書きする呼び出し。設定アプリだけに許す呼び出しにするか、その権限の仕組み
- Binette の版などを OS から読む呼び出し
- ほかのアプリが設定画面に項目を差し込めるか（v0.1 の `.bina` の `settings` をどう引き継ぐか）
- 設定アプリを差し替えられるか
