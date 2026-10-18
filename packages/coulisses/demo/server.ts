import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createCoulisses } from "../src/index.ts";

const port = Number(process.env.PORT ?? 8790);
const handler = createCoulisses({
  root: fileURLToPath(new URL("./site/", import.meta.url)),
  cors: "http://localhost:5175",
});

createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(new URL(incoming.url ?? "/", `http://localhost:${port}`), {
      method: incoming.method,
    });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500);
    outgoing.end("サーバーでエラーが発生しました。");
  }
}).listen(port, () => console.log(`Coulisses デモ: http://localhost:${port}`));
