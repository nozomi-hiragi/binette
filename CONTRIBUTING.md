# 開発とリリース

## 確認

Deno 2.9 以上で、ルートから実行します。npm と Node は使いません。

```sh
deno task check          # 全パッケージの型検査（replique は asc で AS として検査）
deno task build          # dist に静的フロントを書き出す
deno task docs           # 仕様書と API ドキュメントを site に生成
deno task docs:serve     # 仕様書をローカルでプレビュー
deno task test           # バージョンの検査とテスト
deno task check-pack     # JSR に出すファイルだけを写し、別の利用者として動かして試す
deno publish --dry-run   # JSR への公開の予行
```

ワークスペースは、ルートの `deno.json` の `workspace` にあるパッケージです。各パッケージの `deno.json` に name・version・exports・imports と、JSR に出すファイル（`publish.include`）を書きます。npm の依存は `npm:` で指定し、`deno.lock` で固定します。Vite のために `nodeModulesDir: "auto"` にしているので、`node_modules` ができます（git には入れません）。

Deno のコードでは `node:` のモジュールを使いません。ファイルは `Deno.readTextFile` などの Deno の API と `@std/fs`・`@std/path` で、サーバーは `Deno.serve` で扱います。

## Binette の開発

`deno task start` は `deno task build:system` でシステムアプリと同梱アプリをビルドし、目録と固定物を用意してから Vite を http://localhost:5175/ に起動します。アプリや `public/` を変更したときは `deno task build:system` を再実行します。`deno task build` は同じ準備のあと、相対 URL で動く静的ファイルを `dist/` に生成し、GitHub Pages のサブパスにも配置できます。Binette は IndexedDB を使い、asc を配布しません。

`build:system` は `apps/` と `bundled/` の直下で `app.json` を持つフォルダを自動で見つけます。配布用の `manifest.json` と `system/…`、`public/` のファイルを `.binapp/public/` に用意し、Vite が開発時と本番ビルドで配ります。本番のカーネルは固定名の `regie.js` と `regie-worker.js` に分かれ、ビルド時に `index.html` に `regie.js` の SHA-384 SRI を書き込みます。`.binapp/` と `dist/` は生成物なのでコミットしません。同梱アプリを追加するときは、`apps/home/deno.json` と同じ AS の型設定をそのアプリの `deno.json` に置き、ルートの `workspace` と `check` の入口にも追加します。

入口は直下の `index.html`・`vite.config.ts` と `src/main.ts` です。書き出しとホームの表示は、システムアプリ、同梱アプリの順に、それぞれフォルダ名を UTF-16 コード単位の辞書順（`<`・`>`）で比べます。並び順と並べ替えの仕様は未決です。`deno task check` は生成物が無くても通り、`deno task test` は `dist/` と `.binapp/` を除外します。

`public/` の手書きの `sw.js`・`manifest.webmanifest`・`icon.svg` は配布用ディレクトリにコピーされます。Service Worker は `src/main.ts` が本番だけ相対 URL と scope `./` で登録し、`deno task start` では登録しません。`deno task check` は SW を `deno check --no-config public/sw.js` で別に検査し、ファイル内の webworker の型を使います。DOM の型と混ぜないためです。`deno task build` は `regie.js` と `regie-worker.js` のハッシュを `sw.js` のキャッシュの版（`binette-v0.2.0-3-<ハッシュ>`）に足すので、カーネルが変われば新しい SW に切り替わります。`sw.js` 自体の作りを変えたときは `binette-v0.2.0-3` の版も変えてください。

設定は Binette のシステムアプリ `apps/settings` が持ちます（決定）。今は骨組みで、設定の項目と、それを読み書きする呼び出しは未決です。ホームもシステムアプリ `apps/home`（`"role": "home"`）です。Scene の `mountShell` がホームを開き、画面の下にホームバーを出し、アプリのアイコンのドックでの切り替えと、アイコンのメニューからの終了を受け持ちます。

## バージョンの決め方

パッケージのバージョン `X.Y.Z` は仕様書の版と揃えます。

- `X.Y` は仕様書の版と同じにする。仕様書 v0.1 を実装するパッケージは `0.1.Z`
- 仕様書を変えたリリースは、仕様書の版を上げ、パッケージをその版の `X.Y.0` にする
- 仕様書を変えず、実装だけを変えたリリースは、パッチ `Z` だけを上げる
- 全パッケージは常に同じバージョンにする。1.0.0 より前は、パッチでも破壊的変更を含むことがある

## リリース（JSR）

リリースは、バージョンを揃えて CHANGELOG の見出しに日付を入れた変更を `main` にマージして行います。マージ後、JSR への公開、タグと GitHub Release の作成が自動で進みます。タグは手で作りません。

1. 全パッケージの `deno.json` の `version` を新しいバージョンにする
2. パッケージどうしの依存（各 `deno.json` の `imports` の `jsr:@binette/core@…`）を同じバージョンに揃える
3. `deno task test` でバージョンの検査を通す
4. CHANGELOG.md の見出しを `## vX.Y.Z（未リリース）` から `## vX.Y.Z (YYYY-MM-DD)` にする。日付は公開日
5. `main` にマージする

### 公開ワークフロー（`.github/workflows/publish.yml`）

- `main` への push で動きます。`plan` ジョブが、今のバージョンのタグ `vX.Y.Z` が origin にあるかを調べ、あれば何もしません
- タグが無ければ、`npm-jsr` 環境で `publish` ジョブが進みます。CI と同じ確認に加え、CHANGELOG の見出しを確かめます。未リリースの見出しのままでは公開の前に失敗します
- `deno publish` で、GitHub Actions の OIDC を使って JSR に公開します。環境の名前 `npm-jsr` は、npm に出していたころの名残です（GitHub 側の設定に合わせて残しています）
- npm には出しません。npm に公開済みの 0.1.0 はそのまま残ります
- 公開が済むと、`release` ジョブがタグ `vX.Y.Z` と GitHub Release を作ります。メジャーが 0 の間は pre-release です
