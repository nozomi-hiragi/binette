# Régie: 保存

[Régie の目次](README.md)

インストール済みアプリと OS の記録の保存先です。今のコードでは `packages/regie/src/store.ts` にあります（場所は変えません）。

## AppStore（実装済み）

ビルド結果を保存します。アプリ自身が使うデータのストレージとは別です。

```ts
interface InstalledApp {
  key: string;
  source: string;
  manifest: AppManifest;
  icon: string | undefined;
  html: string;
  wasm: Uint8Array;
  installedAt: number;
}
interface AppStore {
  readonly system: SystemStore;
  list(): Promise<InstalledApp[]>;
  get(key: string): Promise<InstalledApp | undefined>;
  put(app: InstalledApp): Promise<void>;
}
```

- `installedAppKey(source, id)` は `JSON.stringify([source, id])` を返す。`key` はこれを使う。入手元と ID の区切りが衝突しない形にする
- `icon` は SVG の文字列。無ければ `undefined`
- `installedAt` は `Date.now()` の値。Unix epoch からのミリ秒を `number` で持つ
- `put` は同じ key の記録を置き換える。`get` は無ければ `undefined`
- `createMemoryAppStore()` はメモリに保存する。再読み込みで消える
- `createIndexedDbAppStore(options?)` はグローバルの `indexedDB` に保存する。`options.name` で DB 名を指定できる（既定は `binette-apps`）。再読み込み後も使える

版を比べてビルドするか決めるのはシステム（[system.md](system.md#インストール)）です。入手元の検証や権限の確認はまだしません。

## SystemStore（案・実装済み）

AppStore.system で同じ保存先の OS の記録を読み書きします。メモリ版は AppStore ごとに持ち、読み書きで値を写します。IndexedDB 版は同じ DB を v2 に上げ、既存の apps 表を残して system 表を追加します。system は last:<installedAppKey>、launches、settings のキーで最後の状態・履歴・設定を保存します。各書き込みはトランザクションの完了まで待ちます。

```ts
interface LifecycleRecord {
  state: number; // core の State の番号（[core.md](../core.md#ライフサイクルの番号案)）
  done: boolean;
  page: string;
  reason: { kind: number; cause: number }; // DestroyKind・DestroyCause
}
interface LaunchRecord { time: number; app: string } // Unix epoch ミリ秒、installedAppKey
interface SystemSettings {
  home: string; // installedAppKey。既定 "" は system のホーム
  stackSize: number; // 既定 3
  stopDelay: number; // 既定 10000 ミリ秒
  callTimeout: number; // 既定 5000 ミリ秒
  destroyTimeout: number; // 既定 5000 ミリ秒
  historyLimit: number; // 既定 100
  homeRetryWindow: number; // 既定 5000 ミリ秒
}
interface SystemStore {
  getLast(key: string): Promise<LifecycleRecord | undefined>;
  putLast(key: string, record: LifecycleRecord): Promise<void>;
  listLaunches(): Promise<LaunchRecord[]>;
  recordLaunch(record: LaunchRecord, limit?: number): Promise<void>;
  getSettings(): Promise<Partial<SystemSettings> | undefined>;
  putSettings(settings: Partial<SystemSettings>): Promise<void>;
}
```

getLast・getSettings は記録が無ければ undefined、listLaunches は古い順の配列（初回は空）を返します。recordLaunch は既定 100 件を上限に、古いものから消します。0 件にもできます。IndexedDB では履歴の読み足しと書き込みを同じトランザクションにし、同時に起動しても失いません。

putSettings は全体を置き換えます。部分的に保存でき、省いた項目はシステムの既定を使います。home は文字列、stackSize は 1 以上の整数、historyLimit は 0 以上の整数、時間は有限の 0 以上の数です。範囲外と知らない項目はエラーです。DEFAULT_SYSTEM_SETTINGS と validateSystemSettings(settings) も公開します。内部 API では短い時間も使えるままにし、設定アプリの os.set は呼び出しと onDestroy の時間切れを 1000 ミリ秒以上に制限します。
