import { assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import { setBootProgress, setBootStage } from "./boot-screen.ts";

function createDom(html?: string) {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = html ?? `
    <div id="app">
      <div class="boot-screen" role="status">
        <div class="boot-body">
          <svg class="boot-icon" viewBox="0 0 128 128" width="72" height="72" aria-hidden="true">
            <rect width="128" height="128" rx="28" fill="#3273b9"/>
            <path d="M38 27h28c17 0 27 8 27 21 0 8-4 14-11 17 10 3 15 9 15 18 0 15-11 24-30 24H38V27zm16 14v18h11c8 0 12-3 12-9s-4-9-12-9H54zm0 32v20h12c10 0 15-3 15-10s-5-10-15-10H54z" fill="#fff"/>
          </svg>
          <div class="boot-title">Binette</div>
          <div class="boot-bar-track" aria-hidden="true">
            <div class="boot-bar"></div>
          </div>
          <div class="boot-status"><span class="boot-stage">起動中</span><span class="boot-detail" aria-hidden="true"></span></div>
        </div>
        <div class="boot-note" aria-hidden="true" hidden>初回だけ時間がかかります</div>
      </div>
    </div>
  `;
  return { window, document: document as unknown as Document };
}

Deno.test("boot-screen: 画面が無いときでも例外を投げずに何もしない", () => {
  const { document } = createDom('<div id="app"></div>');
  // 要素が何もない状態で呼んでも落ちない
  setBootStage("更新を確認中", document);
  setBootProgress({ loaded: 100, total: 200 }, document);

  // root が空の DocumentFragment や null の場合でも落ちない
  const frag = document.createDocumentFragment();
  setBootStage("起動中", frag);
  setBootProgress({ loaded: 0, total: 0 }, frag);
});

Deno.test("boot-screen: setBootStage で段階を更新し、不定表示を保つ", () => {
  const { document } = createDom();
  const stage = document.querySelector(".boot-stage")!;
  const screen = document.querySelector(".boot-screen")!;
  const note = document.querySelector(".boot-note") as HTMLElement;

  setBootStage("更新を確認中", document);
  assertEquals(stage.textContent, "更新を確認中");
  assertEquals(screen.classList.contains("boot-determinate"), false);
  assertEquals(note.hidden, true);

  setBootStage("起動中", document);
  assertEquals(stage.textContent, "起動中");
});

Deno.test("boot-screen: setBootProgress で確定表示に切り替え、バイト数と注記を反映する", () => {
  const { document } = createDom();
  const screen = document.querySelector(".boot-screen")!;
  const stage = document.querySelector(".boot-stage")!;
  const detail = document.querySelector(".boot-detail")!;
  const bar = document.querySelector(".boot-bar") as HTMLElement;
  const note = document.querySelector(".boot-note") as HTMLElement;

  const loaded = 11.6 * 1024 * 1024;
  const total = 18.1 * 1024 * 1024;
  setBootProgress({ loaded, total }, document);

  assertEquals(screen.classList.contains("boot-determinate"), true);
  assertEquals(stage.textContent, "システムを取得中");
  assertEquals(detail.textContent, " 11.6 / 18.1 MB");
  assertEquals(note.hidden, false);
  assertEquals(bar.style.width, `${(loaded / total) * 100}%`);

  setBootProgress({ loaded: total, total }, document);
  assertEquals(detail.textContent, " 18.1 / 18.1 MB");
  assertEquals(bar.style.width, "100%");

  // 取得完了後に段階を「起動中」に戻すと確定表示が解除され注記が隠れる
  setBootStage("起動中", document);
  assertEquals(screen.classList.contains("boot-determinate"), false);
  assertEquals(stage.textContent, "起動中");
  assertEquals(detail.textContent, "");
  assertEquals(bar.style.width, "");
  assertEquals(note.hidden, true);
});
