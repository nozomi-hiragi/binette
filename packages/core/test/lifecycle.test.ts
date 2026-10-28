import { assert, assertEquals } from "@std/assert";
import { DestroyCause, DestroyKind, State } from "../src/index.ts";

Deno.test("ライフサイクルの enum は Réplique と同じ名前・順・番号", async () => {
  const source = await Deno.readTextFile(new URL("../../replique/src/index.ts", import.meta.url));
  for (const [name, values] of Object.entries({ State, DestroyKind, DestroyCause })) {
    const match = source.match(new RegExp(`export enum ${name} \\{([^}]+)\\}`));
    assert(match, `Réplique に ${name} がある`);
    const members = match[1].split(",").map(member => member.trim()).filter(Boolean);
    const names = Object.keys(values).filter(key => Number.isNaN(Number(key)));
    assertEquals(members, names, name);
    assertEquals(Object.values(values).filter(value => typeof value === "number"), members.map((_, index) => index), name);
  }
});
