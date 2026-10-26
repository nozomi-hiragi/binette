import { createCoulisses, importPanoplie } from "../src/index.ts";

const port = Number(Deno.env.get("PORT") ?? 8790);
// 起動時に一度だけ読む。site/ を変えたら再起動する
const panoplie = await importPanoplie(`${import.meta.dirname}/site`);
const coulisses = createCoulisses({ panoplie, cors: "http://localhost:5175" });

Deno.serve({ port, onListen: () => console.log(`Coulisses デモ: http://localhost:${port}`) }, async (request) => {
  try {
    return await coulisses.fetch(request);
  } catch {
    return new Response("サーバーでエラーが発生しました。", { status: 500 });
  }
});
