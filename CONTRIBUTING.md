# 開発とリリース

## 確認

Node.js 22.18 以上で、ルートから実行します。

```sh
npm ci
npm run typecheck   # 全パッケージの型検査
npm test            # バージョンの検査とテスト
npm run check-pack  # npm の配布物を作り、別の利用者として入れて試す
```

ワークスペースの中では、`@binette/source` という条件でビルドせずに `src/` を読みます（`tsconfig.json` の `customConditions`、デモの `--conditions` と `vite.config.ts`）。npm の配布物は `dist/` の JS と型定義、JSR は `src/` の TypeScript です。

## バージョンの決め方

パッケージのバージョン `X.Y.Z` は仕様書の版と揃えます。

- `X.Y` は仕様書の版と同じにする。仕様書 v0.1 を実装するパッケージは `0.1.Z`
- 仕様書を変えたリリースは、仕様書の版を上げ、パッケージをその版の `X.Y.0` にする
- 仕様書を変えず、実装だけを変えたリリースは、パッチ `Z` だけを上げる
- 全パッケージは常に同じバージョンにする。1.0.0 より前は、パッチでも破壊的変更を含むことがある

## リリース（npm / JSR）

リリースは、バージョンを揃えて CHANGELOG の見出しに日付を入れた変更を `main` にマージして行います。マージ後、npm と JSR への公開、タグと GitHub Release の作成が自動で進みます。タグは手で作りません。

1. 全パッケージの `package.json` と `jsr.json` の `version` を新しいバージョンにする
2. パッケージどうしの依存（`package.json` の `@binette/core` と、`jsr.json` の `imports` の `jsr:@binette/core@…`）を同じバージョンに揃える
3. `npm install` で `package-lock.json` を更新する
4. `npm test` でバージョンの検査を通す
5. CHANGELOG.md の見出しを `## vX.Y.Z（未リリース）` から `## vX.Y.Z (YYYY-MM-DD)` にする。日付は公開日
6. `main` にマージする

### 公開ワークフロー（`.github/workflows/publish.yml`）

- `main` への push で動きます。`plan` ジョブが、今のバージョンのタグ `vX.Y.Z` が origin にあるかを調べ、あれば何もしません
- タグが無ければ、`npm-jsr` 環境で `publish` ジョブが進みます。CI と同じ確認に加え、CHANGELOG の見出しを確かめます。未リリースの見出しのままでは公開の前に失敗します
- npm: trusted publisher（OIDC）で provenance を付けて公開します。trusted publisher が未設定のパッケージ（初回）は `NPM_TOKEN` で公開します。公開済みのバージョンは飛ばします
- JSR: GitHub Actions の OIDC で公開します
- 公開が済むと、`release` ジョブがタグ `vX.Y.Z` と GitHub Release を作ります。メジャーが 0 の間は pre-release です
