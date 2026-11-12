import { assertEquals } from "@std/assert";
import { allowsNetUrl, matchesNetUrl } from "../src/net.ts";

Deno.test("net の URL は正規化してパスの境目を守る", () => {
  assertEquals(matchesNetUrl("https://EXAMPLE.com/repo/a", "https://example.COM/repo/"), true);
  assertEquals(matchesNetUrl("https://example.com/repository/a", "https://example.com/repo/"), false);
  assertEquals(matchesNetUrl("https://example.com/any", "https://example.com"), true);
  assertEquals(matchesNetUrl("https://other.example.com/repo/a", "https://example.com/repo/"), false);
});

Deno.test("net の deny は要求と allow より優先する", () => {
  const lists = { request: ["https://example.com/"], appAllow: [], appDeny: ["https://example.com/private/"], commonAllow: [], commonDeny: [] };
  assertEquals(allowsNetUrl("https://example.com/public/a", lists), true);
  assertEquals(allowsNetUrl("https://example.com/private/a", lists), false);
  assertEquals(allowsNetUrl("https://another.example/", lists), false);
});
