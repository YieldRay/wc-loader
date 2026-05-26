import { test, describe } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import { signal } from "./signals.ts";
import { reactiveNodes } from "./template.ts";

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createDOM(html: string) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  const document = dom.window.document;
  (globalThis as any).document = document;
  (globalThis as any).Node = dom.window.Node;
  const container = document.createElement("div");
  container.innerHTML = html;
  return { dom, document, container };
}

describe("Template - Expression Caching", () => {
  test("same expression string reuses compiled function (no error on repeated eval)", async () => {
    const { container } = createDOM(`
      <span>{{ count() }}</span>
      <span>{{ count() }}</span>
    `);

    const [count, setCount] = signal(0);
    const cleanup = reactiveNodes(container.childNodes, { count });

    const spans = container.querySelectorAll("span");
    assert.strictEqual(spans[0].textContent, "0");
    assert.strictEqual(spans[1].textContent, "0");

    setCount(5);
    await nextTick();

    assert.strictEqual(spans[0].textContent, "5");
    assert.strictEqual(spans[1].textContent, "5");

    cleanup();
  });
});

describe("Template - Text Interpolation", () => {
  test("renders static and dynamic parts", () => {
    const { container } = createDOM(`<p>Hello {{ name() }}!</p>`);
    const [name] = signal("World");

    const cleanup = reactiveNodes(container.childNodes, { name });
    assert.strictEqual(container.querySelector("p")!.textContent, "Hello World!");
    cleanup();
  });

  test("updates on signal change", async () => {
    const { container } = createDOM(`<p>Count: {{ count() }}</p>`);
    const [count, setCount] = signal(0);

    const cleanup = reactiveNodes(container.childNodes, { count });
    assert.strictEqual(container.querySelector("p")!.textContent, "Count: 0");

    setCount(42);
    await nextTick();
    assert.strictEqual(container.querySelector("p")!.textContent, "Count: 42");
    cleanup();
  });

  test("handles multiple expressions in one text node", async () => {
    const { container } = createDOM(`<p>{{ first() }} {{ last() }}</p>`);
    const [first, setFirst] = signal("John");
    const [last] = signal("Doe");

    const cleanup = reactiveNodes(container.childNodes, { first, last });
    assert.strictEqual(container.querySelector("p")!.textContent, "John Doe");

    setFirst("Jane");
    await nextTick();
    assert.strictEqual(container.querySelector("p")!.textContent, "Jane Doe");
    cleanup();
  });

  test("handles expression returning undefined", () => {
    const { container } = createDOM(`<p>{{ val() }}</p>`);
    const [val] = signal(undefined);

    const cleanup = reactiveNodes(container.childNodes, { val });
    assert.strictEqual(container.querySelector("p")!.textContent, "undefined");
    cleanup();
  });
});

describe("Template - Attribute Binding", () => {
  test("sets attribute from expression", () => {
    const { container } = createDOM(`<div :title="msg()"></div>`);
    const [msg] = signal("hello");

    const cleanup = reactiveNodes(container.childNodes, { msg });
    assert.strictEqual(container.querySelector("div")!.getAttribute("title"), "hello");
    cleanup();
  });

  test("updates attribute on signal change", async () => {
    const { container } = createDOM(`<div :data-hint="hint()"></div>`);
    const [hint, setHint] = signal("Type here");

    const cleanup = reactiveNodes(container.childNodes, { hint });
    assert.strictEqual(
      container.querySelector("div")!.getAttribute("data-hint"),
      "Type here",
    );

    setHint("Search...");
    await nextTick();
    assert.strictEqual(
      container.querySelector("div")!.getAttribute("data-hint"),
      "Search...",
    );
    cleanup();
  });

  test("boolean attribute: true sets empty string, false removes", async () => {
    const { container } = createDOM(
      `<button :disabled="isDisabled()">Click</button>`,
    );
    const [isDisabled, setIsDisabled] = signal(true);

    const cleanup = reactiveNodes(container.childNodes, { isDisabled });
    assert.strictEqual(
      container.querySelector("button")!.hasAttribute("disabled"),
      true,
    );

    setIsDisabled(false);
    await nextTick();
    assert.strictEqual(
      container.querySelector("button")!.hasAttribute("disabled"),
      false,
    );
    cleanup();
  });
});

describe("Template - Property Binding", () => {
  test("sets property from expression", () => {
    const { container } = createDOM(`<input .value="text()" />`);
    const [text] = signal("hello");

    const cleanup = reactiveNodes(container.childNodes, { text });
    assert.strictEqual((container.querySelector("input") as any).value, "hello");
    cleanup();
  });

  test("updates property on signal change", async () => {
    const { container } = createDOM(`<input .value="text()" />`);
    const [text, setText] = signal("hello");

    const cleanup = reactiveNodes(container.childNodes, { text });
    setText("world");
    await nextTick();
    assert.strictEqual((container.querySelector("input") as any).value, "world");
    cleanup();
  });
});

describe("Template - Event Binding", () => {
  test("calls expression on event", () => {
    const { container } = createDOM(
      `<button @click="handler()">Click</button>`,
    );
    let called = false;
    const handler = () => {
      called = true;
    };

    const cleanup = reactiveNodes(container.childNodes, { handler });
    container.querySelector("button")!.click();
    assert.strictEqual(called, true);
    cleanup();
  });

  test("event object is available in expression", () => {
    const { container } = createDOM(
      `<button @click="handler(event)">Click</button>`,
    );
    let receivedEvent: any = null;
    const handler = (e: any) => {
      receivedEvent = e;
    };

    const cleanup = reactiveNodes(container.childNodes, { handler });
    container.querySelector("button")!.click();
    assert.ok(receivedEvent !== null);
    assert.strictEqual(receivedEvent.type, "click");
    cleanup();
  });
});

describe("Template - #if Directive", () => {
  test("renders element when condition is true", () => {
    const { container } = createDOM(
      `<div><p #if="show()">Visible</p></div>`,
    );
    const [show] = signal(true);

    const cleanup = reactiveNodes(container.childNodes, { show });
    assert.ok(container.querySelector("p") !== null);
    assert.strictEqual(container.querySelector("p")!.textContent, "Visible");
    cleanup();
  });

  test("removes element when condition is false", () => {
    const { container } = createDOM(
      `<div><p #if="show()">Visible</p></div>`,
    );
    const [show] = signal(false);

    const cleanup = reactiveNodes(container.childNodes, { show });
    assert.strictEqual(container.querySelector("p"), null);
    cleanup();
  });

  test("toggles element on signal change", async () => {
    const { container } = createDOM(
      `<div><p #if="show()">Visible</p></div>`,
    );
    const [show, setShow] = signal(true);

    const cleanup = reactiveNodes(container.childNodes, { show });
    assert.ok(container.querySelector("p") !== null);

    setShow(false);
    await nextTick();
    assert.strictEqual(container.querySelector("p"), null);

    setShow(true);
    await nextTick();
    assert.ok(container.querySelector("p") !== null);
    assert.strictEqual(container.querySelector("p")!.textContent, "Visible");
    cleanup();
  });

  test("nested content has reactive bindings", async () => {
    const { container } = createDOM(
      `<div><p #if="show()">Count: {{ count() }}</p></div>`,
    );
    const [show] = signal(true);
    const [count, setCount] = signal(0);

    const cleanup = reactiveNodes(container.childNodes, { show, count });
    assert.strictEqual(container.querySelector("p")!.textContent, "Count: 0");

    setCount(10);
    await nextTick();
    assert.strictEqual(container.querySelector("p")!.textContent, "Count: 10");
    cleanup();
  });
});

describe("Template - #for Directive", () => {
  test("renders list items from array", () => {
    const { container } = createDOM(
      `<ul><li #for="items()">{{ text }}</li></ul>`,
    );
    const [items] = signal([{ text: "A" }, { text: "B" }, { text: "C" }]);

    const cleanup = reactiveNodes(container.childNodes, { items });
    const lis = container.querySelectorAll("li");
    assert.strictEqual(lis.length, 3);
    cleanup();
  });

  test("updates on signal change", async () => {
    const { container } = createDOM(
      `<ul><li #for="items()">{{ text }}</li></ul>`,
    );
    const [items, setItems] = signal([{ text: "A" }]);

    const cleanup = reactiveNodes(container.childNodes, { items });
    assert.strictEqual(container.querySelectorAll("li").length, 1);

    setItems([{ text: "A" }, { text: "B" }]);
    await nextTick();
    assert.strictEqual(container.querySelectorAll("li").length, 2);
    cleanup();
  });

  test("clears items when set to empty array", async () => {
    const { container } = createDOM(
      `<ul><li #for="items()">{{ text }}</li></ul>`,
    );
    const [items, setItems] = signal([{ text: "A" }, { text: "B" }]);

    const cleanup = reactiveNodes(container.childNodes, { items });
    assert.strictEqual(container.querySelectorAll("li").length, 2);

    setItems([]);
    await nextTick();
    assert.strictEqual(container.querySelectorAll("li").length, 0);
    cleanup();
  });

  test("each item gets its own context", () => {
    const { container } = createDOM(
      `<ul><li #for="items()">{{ name }}-{{ age }}</li></ul>`,
    );
    const [items] = signal([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ]);

    const cleanup = reactiveNodes(container.childNodes, { items });
    const lis = container.querySelectorAll("li");
    assert.strictEqual(lis.length, 2);
    // Items may be in reverse order due to insertion at placeholder.nextSibling
    const texts = Array.from(lis).map((li) => li.textContent);
    assert.ok(texts.includes("Alice-30"));
    assert.ok(texts.includes("Bob-25"));
    cleanup();
  });
});

describe("Template - Effect Cleanup", () => {
  test("cleanup function stops all effects", async () => {
    const { container } = createDOM(`<p>{{ count() }}</p>`);
    const [count, setCount] = signal(0);

    const cleanup = reactiveNodes(container.childNodes, { count });
    assert.strictEqual(container.querySelector("p")!.textContent, "0");

    cleanup();

    setCount(99);
    await nextTick();
    // Should NOT update after cleanup
    assert.strictEqual(container.querySelector("p")!.textContent, "0");
  });

  test("cleanup stops #if effects", async () => {
    const { container } = createDOM(
      `<div><p #if="show()">Visible</p></div>`,
    );
    const [show, setShow] = signal(true);

    const cleanup = reactiveNodes(container.childNodes, { show });
    assert.ok(container.querySelector("p") !== null);

    cleanup();

    setShow(false);
    await nextTick();
    // Should still be there since effects are stopped
    assert.ok(container.querySelector("p") !== null);
  });
});
