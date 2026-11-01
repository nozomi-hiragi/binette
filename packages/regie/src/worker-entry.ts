import { serveApp, type WorkerScope } from "./worker.ts";

// ブラウザと Deno の module Worker で同じ実装を使う。
// ルートの型設定は DOM だが、この入口を実行するのは Worker だけ。
serveApp(self as unknown as WorkerScope);
