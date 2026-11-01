# システムアプリ

[仕様の目次](../README.md)

システムアプリは、OS（Binette）の機能を持つアプリです。ほかのアプリと同じく宣言的 UI または HTML ＋ AS で書きます（[app.md](../app.md)）。

## システムアプリの扱い（決定）

- ホームと設定は、Binette のシステムアプリとして持つ
- 置き場所はリポジトリ直下の `apps/<アプリ>/`。`app.json` を持つフォルダを足すだけで増える。リポジトリの `apps/` にあるアプリは、どれもシステムアプリ。通常のアプリを OS と一緒に配る場合は、`bundled/<アプリ>/` に置く。同梱アプリにシステムアプリの権限は渡さない

- [boot.md](../boot.md) と [roles.md](../roles.md) の構成では、システムアプリはビルド済みの `.wasm` として `/system/apps/<アプリ>/` に取ってきて置く。ホームバーも役割 `homebar` のシステムアプリになる。設定アプリはコアで、差し替えも `/user` での上書きもできない（決定 2026-11-01）

## 配り方（実装済み）

- `deno task build:system`（`scripts/build-system.ts`）が、`apps/` の直下で `app.json` を持つフォルダを全部見つけ、`.binapp/system/<フォルダ名>.binapp` にビルドする。同じ処理で `bundled/` から `.binapp/bundled/<フォルダ名>.binapp` も作る。`bundled/` が空でもよい。書き出す前に各出力先の古い `.binapp` と、移行前の `.binapp/` 直下の生成物を消す。1 つでも失敗したら、どのアプリかを出して終わる。`.binapp` の形は [regie/build.md](../regie/build.md#書き出し実装済み)
- `deno task start` と `deno task build` は、先にこれを走らせる。`.binapp/` は生成物で、コミットしない
- 入口の `src/main.ts` は、書き出した `.binapp` を `import.meta.glob` で全部読み、`mountShell` に `prebuilt` として渡す（[scene/shell.md](../scene/shell.md#api案)）
- 入手元（`source`）はシステムアプリが `binette:system`、同梱アプリが `binette:bundled` で固定する。配信の URL は中身のハッシュで変わるので使わない
- 開くたびに、OS が持つ中身で保存し直す（版を上げ忘れた OS の更新でも古いものを残さない）。入れた日時 `installedAt` は最初のものを保つ
- ブラウザではビルドも検証もしない（HTML や権限の検証、クリックの関数が export にあるかの確認）。OS と一緒にビルドして配るものなので、OS と同じだけ信頼する
- 並び順は、システムアプリ、同梱アプリの順に、それぞれフォルダ名を UTF-16 のコード単位で比べた順。書き出し側も、読む側も同じ比べ方をする

## 一覧（実装済み）

| フォルダ | 名前 | 役割 | 仕様 |
| --- | --- | --- | --- |
| `apps/home` | ホーム | `role: "home"`。ほかのアプリを並べて開く | [home.md](home.md) |
| `apps/settings` | 設定 | 設定画面。今は骨組み | [settings.md](settings.md) |

通常の同梱アプリとしてデザイナーを `bundled/designer/` に置く構成です。ルートの Deno workspace と `deno task check` の入口にも含めます。通常の同梱アプリなので、システムアプリの権限は持ちません。

## 未決のこと

- システムアプリに、ふつうのアプリより強い権限を持たせるか。今は、ホームだけが `apps.*` を使える（入手元と `role` だけで判断する）。権限の仕組みそのものが未決
- ユーザーがシステムアプリを消したり、止めたりできるか
- ホームなどを、ほかのアプリに差し替えられるか → 役割の割り当てで差し替えられる。設定アプリだけは差し替えない（決定 2026-11-01、[roles.md](../roles.md)）
- 並び順と並べ替え
- システムアプリの更新を、OS の更新と分けるか
