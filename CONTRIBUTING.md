# 開発とリリース

## 確認

Deno 2.9 以上で、ルートから実行します。npm と Node は使いません。

```sh
deno task check          # 全パッケージの型検査（replique は asc で AS として検査）
deno task build          # dist に静的フロントを書き出す
deno task docs           # 仕様書と API ドキュメントを site に生成
deno task docs:serve     # 仕様書をローカルでプレビュー
deno task pages          # GitHub Pages に出すもの（OS と API ドキュメント）を pages/os と pages/docs/api に生成
deno task test           # バージョンの検査とテスト
deno task check-pack     # JSR に出すファイルだけを写し、別の利用者として動かして試す
deno run -A scripts/publish.ts --dry-run --allow-dirty  # JSR への公開の予行
```

実ブラウザの OPFS 検証は別途 `node scripts/storage-opfs.browser.cjs` で実行します。グローバルの Playwright と Google Chrome が必要です（別の Chromium チャンネルを使う場合は `PLAYWRIGHT_CHANNEL` を指定）。この検証は `deno task test` には含めません。

ワークスペースは、ルートの `deno.json` の `workspace` にあるパッケージです。各パッケージの `deno.json` に name・version・exports・imports と、JSR に出すファイル（`publish.include`）を書きます。公開時は一時ワークスペースに 6 パッケージを用意し、Réplique の公開用コピーに全機能を含め、機能間の指定子を相対パスに書き換えます。npm の依存は `npm:` で指定し、`deno.lock` で固定します。Vite のために `nodeModulesDir: "auto"` にしているので、`node_modules` ができます（git には入れません）。

Deno のコードでは `node:` のモジュールを使いません。ファイルは `Deno.readTextFile` などの Deno の API と `@std/fs`・`@std/path` で、サーバーは `Deno.serve` で扱います。

## Binette の開発

`deno task start` は `deno task build:system` でシステムアプリと同梱アプリをビルドし、目録と固定物を用意してから Vite を http://localhost:5175/ に起動します。アプリや `public/` を変更したときは `deno task build:system` を再実行します。`deno task build` は同じ準備のあと、相対 URL で動く静的ファイルを `dist/` に生成し、GitHub Pages のサブパスにも配置できます。Binette は IndexedDB を使い、ブラウザのビルド用に asc を別ファイルとして配布します。

`build:system` は `apps/` と `bundled/` の直下で `app.json` を持つフォルダを自動で見つけます。asc を依存込みで minify した `system/tools/asc.js` と Réplique の AS ソースを生成し、SHA-256 付きの `manifest.json` と `system/…`、`public/` のファイルを `.binapp/public/` に用意し、Vite が開発時と本番ビルドで配ります。本番のカーネルは固定名の `regie.js` と `regie-worker.js` に分かれ、ビルド時に `index.html` に `regie.js` の SHA-384 SRI を書き込みます。`.binapp/` と `dist/` は生成物なのでコミットしません。同梱アプリを追加するときは、`apps/cadre/deno.json` と同じ AS の型設定をそのアプリの `deno.json` に置き、ルートの `workspace` と `check` の入口にも追加します。

入口は直下の `index.html`・`vite.config.ts` と `src/main.ts` です。書き出しとホームの表示は、システムアプリ、同梱アプリの順に、それぞれフォルダ名を UTF-16 コード単位の辞書順（`<`・`>`）で比べます。並び順と並べ替えの仕様は未決です。`deno task check` は生成物が無くても通り、`deno task test` は `dist/` と `.binapp/` を除外します。

`public/` の手書きの `sw.js`・`manifest.webmanifest`・`icon.svg` は配布用ディレクトリにコピーされます。Service Worker は `src/main.ts` が本番だけ相対 URL と scope `./` で登録し、`deno task start` では登録しません。`deno task check` は SW を `deno check --no-config public/sw.js` で別に検査し、ファイル内の webworker の型を使います。DOM の型と混ぜないためです。`deno task build` は入口とカーネルのハッシュを `sw.js` のキャッシュの版に足し、組になる目録の `kernel` と人が読む `label` を記録します。新しい SW は待機し、設定から準備済みの `/system` と一緒に更新します。`sw.js` 自体の作りを変えたときはキャッシュの基本の版も変えてください。

設定は Cadre のサブアプリ `cadre.settings`（`apps/cadre`）が持ちます（決定）。今はホームの選択、新しい版への更新、デバッグ値、起動の履歴で、ほかの項目は未決です。ホームも Cadre のサブアプリ `cadre.home`（`app.json` の `sub.home.roles: ["home"]`）です。ホーム・設定は親と同じ AS の入口と CSS を使い、`api.sub()` で入口を選びます。役割は名乗るだけでは効かず、`system/boot.json` の既定と設定で割り当てたアプリにだけ、その役割の API が `onCreate(last, api)` の辞書で届きます（[docs/spec/roles.md](docs/spec/roles.md)）。Régie が常駐のシステムアプリ `apps/cadre`（`"roles": ["cadre"]`）を最初に起動し、Cadre が `CadreApi.openHome()` でホームを開きます。Cadre は AS の Décor でホームバーと `appArea()` を描き、Scene はその領域にアプリを配置します。Cadre はスタックに数えず、落ち続けたときだけ Scene が表示領域とホームボタンの最低限の大枠を出します。

提供リストのアプリは [binette-apps](https://github.com/nozomi-hiragi/binette-apps) で開発・追加・配布します。デザイナーとドキュメントアプリを収録し、タグ済みの版を固定 URL `https://nozomi-hiragi.github.io/binette-apps/` で公開します。追加・リリースの手順は同リポジトリの README に従います。`deno task pages` はこの URL だけを既定リストに設定し、Binette 自身の提供リストは生成しません。ローカルの `build:system` は `BINETTE_LISTS` 未指定なら空のままです。必要ならカンマ区切りの https の URL で指定します。

Réplique の AS ソースは `/system/libraries/replique/` に機能ごとに配布します。CLI の `--replique` は単一ファイルではなく、直下に `index.ts` と各機能の `.ts` を持つソースフォルダを受け取ります。

```sh
deno run -A packages/regie/src/cli.ts build bundled/filer --out .binapp/filer.binapp --replique packages/replique
deno run -A packages/regie/src/cli.ts integrity bundled/filer --replique packages/replique
```

## CI（`.github/workflows/ci.yml`）

- CI は `main` か `v*` に向けた PR のときだけ動きます。`main` や `v*` へのマージ後の push では、同じ確認を繰り返さないために動かしません。手で動かすときは Actions の画面から実行します（`workflow_dispatch`）
- リリースでは、`v*` から `main` への PR で CI が動き、マージ後に公開ワークフローが同じ確認をもう一度してから公開します
- それ以外のブランチに向けた PR では動きません。小さい直しが続くときは、まとめ用のブランチに集め（ここへの PR では CI は動きません）、まとめて `v*` に入れる PR で 1 回だけ CI を通します
- PR の向き先をあとから `v*` に変えただけでは CI は動きません。push するか、Actions の画面から PR のブランチで実行してください

## バージョンの決め方

パッケージのバージョン `X.Y.Z` は仕様書の版と揃えます。

- `X.Y` は仕様書の版と同じにする。仕様書 v0.1 を実装するパッケージは `0.1.Z`
- 仕様書を変えたリリースは、仕様書の版を上げ、パッケージをその版の `X.Y.0` にする
- 仕様書を変えず、実装だけを変えたリリースは、パッチ `Z` だけを上げる
- JSR に公開する 6 パッケージは常に同じバージョンにする。OS 内の Réplique の機能別の版は別に管理する。1.0.0 より前は、パッチでも破壊的変更を含むことがある

## リリース（JSR）

JSR に公開するのは `@binette/core`、`@binette/decor`、`@binette/regie`、`@binette/scene`、`@binette/coulisses`、`@binette/replique` の 6 パッケージです。Réplique の 14 機能は集約パッケージに含め、機能別パッケージは公開しません。

リリースは、バージョンを揃えて CHANGELOG の見出しに日付を入れた変更を `main` にマージして行います。マージ後、JSR への公開、タグと GitHub Release の作成が自動で進みます。タグは手で作りません。

1. 公開する 6 パッケージの `deno.json` の `version` を新しいバージョンにする
2. パッケージどうしの依存（各 `deno.json` の `imports` の `jsr:@binette/core@…`）を同じバージョンに揃える
3. `deno task test` でバージョンの検査を通す
4. CHANGELOG.md の見出しを `## vX.Y.Z（未リリース）` から `## vX.Y.Z (YYYY-MM-DD)` にする。日付は公開日
5. `main` にマージする

### 公開ワークフロー（`.github/workflows/publish.yml`）

- `main` への push で動きます。`plan` ジョブが、今のバージョンのタグ `vX.Y.Z` が origin にあるかを調べ、あれば何もしません
- タグが無ければ、`npm-jsr` 環境で `publish` ジョブが進みます。CI と同じ確認に加え、CHANGELOG の見出しを確かめます。未リリースの見出しのままでは公開の前に失敗します
- `deno run -A scripts/publish.ts` で公開用コピーを用意し、GitHub Actions の OIDC を使って JSR に公開します。CI の予行も同じスクリプトに `--dry-run` を渡します。環境の名前 `npm-jsr` は、npm に出していたころの名残です（GitHub 側の設定に合わせて残しています）
- npm には出しません。npm に公開済みの 0.1.0 はそのまま残ります
- 公開が済むと、`release` ジョブがタグ `vX.Y.Z` と GitHub Release を作ります。メジャーが 0 の間は pre-release です
