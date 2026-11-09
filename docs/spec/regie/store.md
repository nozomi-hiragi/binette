# Régie: 保存

[Régie の目次](README.md)

インストール済みアプリと OS の記録の保存先です。今のコードでは `packages/regie/src/store.ts` にあります（場所は変えません）。

保存の形は [storage.md](../storage.md) のとおり、中身を OPFS、メタデータと名簿を IndexedDB に置きます。v0.2.0 の旧 IndexedDB の記録は移行しません。

## ファイルの木（案・実装済み）

`packages/regie/src/fs.ts` の `FileTree` は、パスとバイト列を扱うカーネル用の API です。メモリ版と IndexedDB・OPFS 版は同じ操作を持ち、読み書きするバイト列を写します。アプリに権限付きで渡す API は後の作業です。

```ts
interface FileTree {
  read(path: string): Promise<Uint8Array | undefined>;
  readFiles(paths: readonly string[]): Promise<(Uint8Array | undefined)[]>;
  write(path: string, data: Uint8Array): Promise<void>;
  writeFiles(files: ReadonlyMap<string, Uint8Array>, remove?: readonly string[]): Promise<void>;
  list(prefix: string): Promise<string[]>;
  delete(path: string): Promise<void>;
  replaceSystem(files: ReadonlyMap<string, Uint8Array>): Promise<void>;
  readOverlay(path: string): Promise<Uint8Array | undefined>;
  listOverlay(prefix: string): Promise<string[]>;
  update(path: string, transform: (value: Uint8Array | undefined) => Uint8Array): Promise<void>;
}
```

- `createMemoryFileTree()`、`createIndexedDbFileTree({ name? })` で作る。IndexedDB の既定名は `binette-apps`、接続は初回操作時に開く。内容は SHA-256 の名前で OPFS に保存する
- パスは正規の絶対パス。`list` は指定パス自身とその子孫のファイルを返し、結果は文字コード順。ファイルが無ければ `read` は `undefined`、`delete` は何もしない
- `readOverlay` と `listOverlay` は `/apps/example/a` のような論理パスを取り、対応する `/user/apps/example/a` と `/system/apps/example/a` を重ねる。設定を含む `/apps/cadre` とその子孫は `/system` だけを使う
- `readFiles` は複数ファイルを同じ時点の状態から読む。`write`・`writeFiles`・`delete`・`update` は `/system` を変更できない。`writeFiles` は複数ファイルの書き込みと省略可能な削除をまとめて原子的に行う。`replaceSystem` は `/system/…` のファイルの集合を丸ごと入れ替える。`update` は 1 ファイルの読み書きを原子的に行い、起動履歴の同時更新に使う
- これはカーネル用の API であり、それ自体はアプリごとの権限を検査しない。`replaceSystem` はカーネルの更新処理だけに渡す

保存層の `StorageBackend` は `forOwner(owner)` で所有者を選び、メタデータの参照・復元・移動や `gc()` を扱います。`appOwner` はプロバイダーとアプリの番号を名簿から解決し、`removeApp` は名簿と表からアプリを外します。即時削除を指定しなければ不要な内容は GC が消します。メモリ版と差し替え可能な `ContentStore` はテストにも使います。GC はスケジューラの OS の予定 `os/gc`（初期値 1 日）で実行します。

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
  listVersion?: string; // 提供リストの版
}
interface AppStore {
  readonly system: SystemStore;
  list(): Promise<InstalledApp[]>;
  get(key: string): Promise<InstalledApp | undefined>;
  put(app: InstalledApp): Promise<void>;
  moveSource(from: string, to: string, lists?: ProviderListRegistration[]): Promise<void>;
}
```

- `appId(source, id)` が返す `key` は完全なアプリ ID。埋め込みは生の ID、提供リストからのものは正規化したリスト URL ＋ `#` ＋識別子を使う。`binette:system`・`binette:bundled` はいずれも生の ID を使い、既定は `cadre`・`designer`。サブアプリの ID は `cadre.home`・`cadre.settings` だが、AppStore には親のパッケージだけを保存する。旧 `[source, id]` キーは移行しない
- `icon` は SVG の文字列。無ければ `undefined`
- `installedAt` は `Date.now()` の値。Unix epoch からのミリ秒を `number` で持つ。`listVersion` は提供リストの版を `manifest.version` と別に保存する
- `put` は同じ key の記録を置き換える。`get` は無ければ `undefined`
- `createMemoryAppStore()` はメモリに保存する。再読み込みで消える
- `createIndexedDbAppStore(options?)` はグローバルの `indexedDB` に保存する。`options.name` で DB 名を指定できる（既定は `binette-apps`）。再読み込み後も使える
- `createAppStore(tree)` は指定した `FileTree` の保存層を使う。アプリの所有者ごとに `/build/app.wasm`・`/build/record.json` と成果物を置き、同じトランザクションで表を更新する
- `list`・`get` はアプリの名簿から所有者と記録を探す

取得したソースとアイコンは所有者の `/source/…`、ビルド結果は `/build/…` に保持します。

版を比べてビルドするか決めるのはシステム（[system.md](system.md#インストール)）です。提供リストの移転時には `moveSource` がプロバイダーの URL を変更し、アプリと保存データの所有者はそのままです。名簿の ID と登録リストは読み出すときに現在の URL を解決します。権限の許可をユーザーに尋ねる仕組みはまだありません。

## アプリごとのデータ（案・実装済み）

`AppStore.data` でアプリ自身の所有者の `/data/<名前>` を読み書きします。名前は `encodeURIComponent` で符号化して 1 つの部品にします（空文字と `.`・`..` は別に表す）。名前は階層にならず、中身は文字列（UTF-8）だけです。ID `system` は従来の API 契約に合わせて拒みます。

```ts
interface AppDataStore {
  /** 名前から中身への写し */
  read(id: string): Promise<Map<string, string>>;
  /** value が null なら消す */
  write(id: string, name: string, value: string | null): Promise<void>;
}
```

サブアプリは親の完全な ID を使い、親と保存領域を共有します。システムはアプリを起動するときに `read` で写しを作って Worker に渡し、`write` は順に呼びます（[Réplique の StorageApi](../replique.md#storageapi)）。容量の上限は未決です。

## SystemStore（案・実装済み）

AppStore.system で同じファイルの木の OS の記録を読み書きします。最後の状態・履歴・設定は `/data/system/` 以下に置きます（配置は案）。IndexedDB の v5 に providers・apps・files の表と番号管理、検索用の索引を置きます。v4 から更新するときは保存済みの行を保ち、索引を作ります。各書き込みはトランザクションの完了まで待ちます。

```ts
interface LifecycleRecord {
  state: number; // core の State の番号（[core.md](../core.md#ライフサイクルの番号案)）
  done: boolean;
  page: string;
  reason: { kind: number; cause: number }; // DestroyKind・DestroyCause
}
interface LaunchRecord { time: number; app: string } // Unix epoch ミリ秒、完全なアプリ ID
interface SystemSettings {
  roles: Record<string, string>; // 役割 → 完全なアプリ ID。既定 {} はブートの既定の割り当て（[system.md](system.md#役割の割り当て実装済み形は案)）
  allowHttpLists?: boolean; // 開発用、既定 false
  stackSize: number; // 既定 3
  stopDelay: number; // 既定 10000 ミリ秒
  callTimeout: number; // 既定 5000 ミリ秒
  destroyTimeout: number; // 既定 5000 ミリ秒
  historyLimit: number; // 既定 100
  homeRetryWindow: number; // 既定 5000 ミリ秒
}
interface SystemStore {
  getLists(): Promise<ProviderListRegistration[]>;
  putLists(lists: ProviderListRegistration[]): Promise<void>;
  getPermissions(key: string): Promise<string[]>;
  putPermissions(key: string, permissions: string[]): Promise<void>;
  getLast(key: string): Promise<LifecycleRecord | undefined>;
  putLast(key: string, record: LifecycleRecord): Promise<void>;
  listLaunches(): Promise<LaunchRecord[]>;
  recordLaunch(record: LaunchRecord, limit?: number): Promise<void>;
  getSettings(): Promise<Partial<SystemSettings> | undefined>;
  putSettings(settings: Partial<SystemSettings>): Promise<void>;
  getSchedules?(): Promise<Record<string, SavedSchedule>>; // スケジューラの予定。省いた実装では保存しない（/data/system/schedules.json）
  putSchedules?(schedules: Record<string, SavedSchedule>): Promise<void>;
}
```

getLast・getSettings は記録が無ければ undefined、listLaunches は古い順の配列（初回は空）を返します。recordLaunch は既定 100 件を上限に、古いものから消します。0 件にもできます。履歴の読み足しと書き込みは保存層のロック内で行い、同時更新で失わないようにします。

putSettings は全体を置き換えます。部分的に保存でき、省いた項目はシステムの既定を使います。roles は役割から 完全なアプリ ID への文字列の写し、stackSize は 1 以上の整数、historyLimit は 0 以上の整数、時間は有限の 0 以上の数です。範囲外と知らない項目はエラーです。getSettings は、v0.2.0 の途中まで保存していた home を roles.home に読み替えて返します。DEFAULT_SYSTEM_SETTINGS と validateSystemSettings(settings) も公開します。内部 API では短い時間も使えるままにし、設定アプリの os.set は呼び出しと onDestroy の時間切れを 1000 ミリ秒以上に制限します。

## Pigeon の受信欄

`AppStore.pigeon` はアプリ ID ごとの受信欄と通知停止設定を扱います。ブラウザ版はファイル内容用の OPFS と分けた IndexedDB に保存し、追加時の ID 採番と上限の適用を一つのトランザクションで行います。メモリ版もあります（[Pigeon](../pigeon.md)）。

## アプリ間のファイル共有

`AppStore.shares` は共有の名簿と `shared/<UUID>` のファイルを扱います。参加済みのアプリだけが読め、書き込みには `write` 権限が必要です。最後の参加者が抜けると名簿とファイルの参照を外し、実ファイルは GC で回収します。持ち主のフォルダと共有の間でファイルを移す操作も用意しています。
