# Changelog

## v0.2.0（未リリース）

- 最初から入れるアプリを .binapp に書き出し、初回もブラウザでビルドせずに開く
- Binette が持つ最小のホームを追加。アイコンと名前からアプリを開き、戻れる
- Régie にメモリと IndexedDB の AppStore を追加。同じ版のビルド結果を使い回す
- app.json の icon の型を検査し、SVG を画像として表示する
- ハローの例と、カウンター・ハローのアイコンを追加。単独で起動できる素のフロント（standalone）を追加

## v0.1.0 (2026-10-21)

- 仕様書 v0.1 の下書きと、それを実装した `@binette/core`・`@binette/scene`・`@binette/coulisses` を npm と JSR に初めて公開する
