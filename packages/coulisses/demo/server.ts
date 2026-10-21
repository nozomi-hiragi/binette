import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createCoulisses, importPanoplie } from "../src/index.ts";

const port = Number(process.env.PORT ?? 8790);
// 起動時に一度だけ読む。site/ を変えたら再起動する
const panoplie = await importPanoplie(fileURLToPath(new URL("./site/", import.meta.url)));
const coulisses = createCoulisses({ panoplie, cors: "http://localhost:5175" });

createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(new URL(incoming.url ?? "/", `http://localhost:${port}`), {
      method: incoming.method,
    });
    const response = await coulisses.fetch(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500);
    outgoing.end("サーバーでエラーが発生しました。");
  }
}).listen(port, () => console.log(`Coulisses デモ: http://localhost:${port}`));
