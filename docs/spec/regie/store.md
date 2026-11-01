# Régie: 保存

[Régie の目次](README.md)

インストール済みアプリと OS の記録の保存先です。今のコードでは `packages/regie/src/store.ts` にあります（場所は変えません）。

## ファイルの木（案・実装済み）

`packages/regie/src/fs.ts` の `FileTree` は、パスとバイト列を扱うカーネル用の API です。メモリ版と IndexedDB 版は同じ操作を持ち、読み書きするバイト列を写します。アプリに権限付きで渡す API は後の作業です。

```ts
interface FileTree {
  read(path: string): Promise<Uint8Array | undefined>;
  readFiles(paths: readonly string[]): Promise<(Uint8Array | undefined)[]>;
  write(path: string, data: Uint8Array): Promise<void>;
  writeFiles(files: ReadonlyMap<string, Uint8Array>): Promise<void>;
  list(prefix: string): Promise<string[]>;
  delete(path: string): Promise<void>;
  replaceSystem(files: ReadonlyMap<string, Uint8Array>): Promise<void>;
  readOverlay(path: string): Promise<Uint8Array | undefined>;
  listOverlay(prefix: string): Promise<string[]>;
  update(path: string, transform: (value: Uint8Array | undefined) => Uint8Array): Promise<void>;
}
```

- `createMemoryFileTree()`、`createIndexedDbFileTree({ name? })` で作る。IndexedDB の既定名は `binette-apps`、接続は初回操作時に開く
- パスは正規の絶対パス。`list` は指定パス自身とその子孫のファイルを返し、結果は文字コード順。ファイルが無ければ `read` は `undefined`、`delete` は何もしない
- `readOverlay` と `listOverlay` は `/apps/home/a` のような論理パスを取り、対応する `/user/apps/home/a` と `/system/apps/home/a` を重ねる。`/apps/settings` とその子孫は `/system` だけを使う
- `readFiles` は複数ファイルを同じ時点の状態から読む。`write`・`writeFiles`・`delete`・`update` は `/system` を変更できない。`writeFiles` は複数ファイルをまとめて原子的に書く。`replaceSystem` は `/system/…` のファイルの集合を丸ごと入れ替える。`update` は 1 ファイルの読み書きを原子的に行い、起動履歴の同時更新に使う
- これはカーネル用の API であり、それ自体はアプリごとの権限を検査しない。`replaceSystem` はカーネルの更新処理だけに渡す

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
- `createAppStore(tree)` は指定した `FileTree` を使う。`/apps/<ID>/<入手元>/` に、WASM をそのまま `app.wasm`、残りの記録を `record.json` として置き、2 ファイルを原子的に書く。ID と入手元は `encodeURIComponent` で符号化し、空文字と `.`・`..` は正規パスと衝突しないよう別に表す。保存形式と配置は案
- `list` は `/apps` 以下の記録ファイルを探す。索引は持たず、一覧はパス順に返す。`get` は key の入手元と ID からパスを求めて直接読む

版を比べてビルドするか決めるのはシステム（[system.md](system.md#インストール)）です。入手元の検証や権限の確認はまだしません。

## アプリごとのデータ（案・実装済み）

`AppStore.data` で `/data/<アプリの ID>/<名前>` を読み書きします。ID と名前は `encodeURIComponent` で符号化して 1 つの部品にします（空文字と `.`・`..` は別に表す）。名前は階層にならず、中身は文字列（UTF-8）だけです。ID `system` は OS の記録（`/data/system/`）と同じ場所なので拒みます。

```ts
interface AppDataStore {
  /** 名前から中身への写し */
  read(id: string): Promise<Map<string, string>>;
  /** value が null なら消す */
  write(id: string, name: string, value: string | null): Promise<void>;
}
```

システムはアプリを起動するときに `read` で写しを作って Worker に渡し、`write` は順に呼びます（[Réplique の StorageApi](../replique.md#storageapi)）。容量の上限は未決です。

## SystemStore（案・実装済み）

AppStore.system で同じファイルの木の OS の記録を読み書きします。最後の状態・履歴・設定は `/data/system/` 以下に置きます（配置は案）。IndexedDB は DB を v3 に上げて files 表を作り、旧 apps・system 表の記録を移します。旧表は残します。各書き込みはトランザクションの完了まで待ちます。

```ts
interface LifecycleRecord {
  state: number; // core の State の番号（[core.md](../core.md#ライフサイクルの番号案)）
  done: boolean;
  page: string;
  reason: { kind: number; cause: number }; // DestroyKind・DestroyCause
}
interface LaunchRecord { time: number; app: string } // Unix epoch ミリ秒、installedAppKey
interface SystemSettings {
  roles: Record<string, string>; // 役割 → installedAppKey。既定 {} はブートの既定の割り当て（[system.md](system.md#役割の割り当て実装済み形は案)）
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

putSettings は全体を置き換えます。部分的に保存でき、省いた項目はシステムの既定を使います。roles は役割から installedAppKey への文字列の写し、stackSize は 1 以上の整数、historyLimit は 0 以上の整数、時間は有限の 0 以上の数です。範囲外と知らない項目はエラーです。getSettings は、v0.2.0 の途中まで保存していた home を roles.home に読み替えて返します。DEFAULT_SYSTEM_SETTINGS と validateSystemSettings(settings) も公開します。内部 API では短い時間も使えるままにし、設定アプリの os.set は呼び出しと onDestroy の時間切れを 1000 ミリ秒以上に制限します。
