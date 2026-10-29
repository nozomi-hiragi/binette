import { assertEquals, assertThrows } from "@std/assert";
import { Window } from "happy-dom";
import {
  button,
  column,
  component,
  mount,
  row,
  text,
  useEffect,
  useState,
  type View,
} from "../src/index.ts";

Deno.test("component のカウンターは自動で更新され、兄弟の状態も残る", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  function Counter({ label }: { label: string }): View {
    const [count, setCount] = useState(0);
    return button(`${label}: ${count}`, () => setCount((n) => n + 1));
  }
  try {
    root.render(
      column([
        component(Counter, { label: "A" }),
        component(Counter, { label: "B" }),
      ]),
    );
    const buttons = host.querySelectorAll("button");
    buttons[1].click();
    await Promise.resolve();
    assertEquals(
      [...host.querySelectorAll("button")].map((el) => el.textContent),
      ["A: 0", "B: 1"],
    );
    buttons[0].click();
    assertEquals(buttons[0].textContent, "A: 0");
    await Promise.resolve();
    assertEquals(
      [...host.querySelectorAll("button")].map((el) => el.textContent),
      ["A: 1", "B: 1"],
    );
  } finally {
    root.unmount();
    await window.happyDOM.close();
  }
});

Deno.test("key 付き component の状態は一覧の並べ替えについていく", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  function Counter({ label }: { label: string }): View {
    const [count, setCount] = useState(0);
    return button(`${label}: ${count}`, () => setCount((n) => n + 1));
  }
  const draw = (labels: string[]) =>
    column(labels.map((label) => component(Counter, { label }).key(label)));
  try {
    root.render(draw(["A", "B"]));
    host.querySelectorAll("button")[0].click();
    await Promise.resolve();
    root.render(draw(["B", "A"]));
    assertEquals(
      [...host.querySelectorAll("button")].map((el) => el.textContent),
      ["B: 0", "A: 1"],
    );
    host.querySelectorAll("button")[0].click();
    await Promise.resolve();
    assertEquals(
      [...host.querySelectorAll("button")].map((el) => el.textContent),
      ["B: 1", "A: 1"],
    );
  } finally {
    root.unmount();
    await window.happyDOM.close();
  }
});

Deno.test("消えた component と unmount はエフェクトを片付け、状態を破棄する", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  const events: string[] = [];
  function Counter({ label }: { label: string }): View {
    const [count, setCount] = useState(0);
    useEffect(() => {
      events.push(`setup ${label}`);
      return () => {
        events.push(`cleanup ${label}`);
      };
    }, []);
    return button(`${label}: ${count}`, () => setCount((n) => n + 1));
  }
  const draw = (labels: string[]) =>
    column(labels.map((label) => component(Counter, { label }).key(label)));
  try {
    root.render(draw(["A", "B"]));
    await Promise.resolve();
    host.querySelectorAll("button")[0].click();
    await Promise.resolve();
    root.render(draw(["B"]));
    assertEquals(events, ["setup A", "setup B", "cleanup A"]);
    root.render(draw(["A", "B"]));
    await Promise.resolve();
    assertEquals(
      [...host.querySelectorAll("button")].map((el) => el.textContent),
      ["A: 0", "B: 0"],
    );
    root.unmount();
    assertEquals(events.slice(0, 4), [
      "setup A",
      "setup B",
      "cleanup A",
      "setup A",
    ]);
    assertEquals(events.slice(4).sort(), ["cleanup A", "cleanup B"]);
  } finally {
    root.unmount();
    await window.happyDOM.close();
  }
});

Deno.test("同じマイクロタスク内の setter は root の描き直しをまとめる", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  let renders = 0;
  function Counter(): View {
    renders++;
    const [count, setCount] = useState(0);
    return button(String(count), () => {
      setCount((n) => n + 1);
      setCount((n) => n + 1);
      setCount((n) => n + 1);
    });
  }
  try {
    root.render(component(Counter, {}));
    host.querySelector("button")!.click();
    assertEquals(renders, 1);
    await Promise.resolve();
    assertEquals(renders, 2);
    assertEquals(host.querySelector("button")?.textContent, "3");
  } finally {
    root.unmount();
    await window.happyDOM.close();
  }
});

Deno.test("フックは component の外から呼べない", () => {
  assertThrows(() => useState(0), Error, "useState");
  assertThrows(() => useEffect(() => {}, []), Error, "useEffect");
});

Deno.test("エフェクトは依存値の変化時に前の片付けの後で実行される", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  const events: string[] = [];
  function Item({ value }: { value: string }): View {
    useEffect(() => {
      events.push(`setup ${value}`);
      return () => {
        events.push(`cleanup ${value}`);
      };
    }, [value]);
    return text(value);
  }
  try {
    root.render(component(Item, { value: "A" }));
    await Promise.resolve();
    root.render(component(Item, { value: "A" }));
    await Promise.resolve();
    assertEquals(events, ["setup A"]);
    root.render(component(Item, { value: "B" }));
    await Promise.resolve();
    assertEquals(events, ["setup A", "cleanup A", "setup B"]);
    root.unmount();
    assertEquals(events, ["setup A", "cleanup A", "setup B", "cleanup B"]);
  } finally {
    root.unmount();
    await window.happyDOM.close();
  }
});

Deno.test("再描画でフックの種類や個数を変えるとエラーになる", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  function Item({ mode }: { mode: string }): View {
    if (mode === "effect") useEffect(() => {}, []);
    else useState(0);
    if (mode === "extra") useState(1);
    return text(mode);
  }
  try {
    root.render(component(Item, { mode: "state" }));
    assertThrows(() => root.render(component(Item, { mode: "effect" })), Error);
  } finally {
    root.unmount();
    await window.happyDOM.close();
  }
  const otherWindow = new Window();
  const otherHost = otherWindow.document.createElement(
    "div",
  ) as unknown as HTMLElement;
  const otherRoot = mount(otherHost);
  try {
    otherRoot.render(component(Item, { mode: "state" }));
    assertThrows(
      () => otherRoot.render(component(Item, { mode: "extra" })),
      Error,
    );
  } finally {
    otherRoot.unmount();
    await otherWindow.happyDOM.close();
  }
  const thirdWindow = new Window();
  const thirdHost = thirdWindow.document.createElement(
    "div",
  ) as unknown as HTMLElement;
  const thirdRoot = mount(thirdHost);
  try {
    thirdRoot.render(component(Item, { mode: "extra" }));
    assertThrows(
      () => thirdRoot.render(component(Item, { mode: "state" })),
      Error,
    );
  } finally {
    thirdRoot.unmount();
    await thirdWindow.happyDOM.close();
  }
});

Deno.test("部品の種類と親の種類が変わると状態を破棄して片付ける", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  const events: string[] = [];
  function A(): View {
    const [count, setCount] = useState(0);
    useEffect(() => {
      events.push("setup A");
      return () => {
        events.push("cleanup A");
      };
    }, []);
    return button(`A: ${count}`, () => setCount((n) => n + 1));
  }
  function B(): View {
    useEffect(() => {
      events.push("setup B");
      return () => {
        events.push("cleanup B");
      };
    }, []);
    return text("B");
  }
  try {
    root.render(column([component(A, {}).key("item")]));
    host.querySelector("button")!.click();
    await Promise.resolve();
    assertEquals(host.querySelector("button")?.textContent, "A: 1");
    root.render(column([component(B, {}).key("item")]));
    assertEquals(events.includes("cleanup A"), true);
    root.render(column([component(A, {}).key("item")]));
    assertEquals(host.querySelector("button")?.textContent, "A: 0");
    host.querySelector("button")!.click();
    await Promise.resolve();
    root.render(row([component(A, {}).key("item")]));
    assertEquals(host.querySelector("button")?.textContent, "A: 0");
    assertEquals(events.filter((event) => event === "cleanup A").length, 2);
    assertEquals(events.filter((event) => event === "cleanup B").length, 1);
  } finally {
    root.unmount();
    await window.happyDOM.close();
  }
});

Deno.test("取り除かれた部品の setter と unmount 前に予約された更新は無効", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  let stale: (value: number) => void = () => {};
  let renders = 0;
  function Item(): View {
    renders++;
    const [count, setCount] = useState(0);
    stale = setCount;
    return text(String(count));
  }
  try {
    root.render(column([component(Item, {}).key("item")]));
    const oldSetter = stale;
    root.render(column([]));
    oldSetter(5);
    await Promise.resolve();
    assertEquals(renders, 1);
    root.render(column([component(Item, {}).key("item")]));
    assertEquals(host.querySelector("span")?.textContent, "0");
    oldSetter(6);
    await Promise.resolve();
    assertEquals(renders, 2);
    stale(1);
    root.unmount();
    await Promise.resolve();
    assertEquals(renders, 2);
    assertEquals(host.childNodes.length, 0);
    stale(2);
    await Promise.resolve();
    assertEquals(renders, 2);
  } finally {
    root.unmount();
    await window.happyDOM.close();
  }
});

Deno.test("エフェクト内の unmount は返された cleanup を実行し、残りを実行しない", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  const events: string[] = [];
  function Item(): View {
    useEffect(() => {
      events.push("first");
      root.unmount();
      return () => {
        events.push("cleanup");
      };
    }, []);
    useEffect(() => {
      events.push("second");
    }, []);
    return text("item");
  }
  try {
    root.render(component(Item, {}));
    await Promise.resolve();
    assertEquals(events, ["first", "cleanup"]);
    assertEquals(host.childNodes.length, 0);
  } finally {
    root.unmount();
    await window.happyDOM.close();
  }
});

Deno.test("エフェクト内の render で残りのエフェクトが二重実行されない", async () => {
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const root = mount(host);
  const events: string[] = [];
  function Item({ value }: { value: number }): View {
    useEffect(() => {
      events.push(`first ${value}`);
      if (value === 0) root.render(component(Item, { value: 1 }));
    }, [value]);
    useEffect(() => {
      events.push(`second ${value}`);
    }, [value]);
    return text(String(value));
  }
  try {
    root.render(component(Item, { value: 0 }));
    await Promise.resolve();
    assertEquals(events, ["first 0", "first 1", "second 1"]);
    assertEquals(host.querySelector("span")?.textContent, "1");
  } finally {
    root.unmount();
    await window.happyDOM.close();
  }
});
