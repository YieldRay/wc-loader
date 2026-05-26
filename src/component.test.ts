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
  document.body.appendChild(container);
  return { dom, document, container };
}

// We test the lifecycle behavior by simulating what extendsElement does,
// since the full loadComponent pipeline requires fetch and customElements which
// are complex to mock in a unit test. This validates the disposal/re-bind contract.

describe("Component Lifecycle - Effect Disposal", () => {
  test("effects are stopped when scope is disposed (simulates disconnectedCallback)", async () => {
    const { container } = createDOM(`<span>{{ count() }}</span>`);
    const [count, setCount] = signal(0);

    const stopScope = reactiveNodes(container.childNodes, { count });

    const span = container.querySelector("span")!;
    assert.strictEqual(span.textContent, "0");

    setCount(1);
    await nextTick();
    assert.strictEqual(span.textContent, "1");

    // Simulate disconnect - stop the scope
    stopScope();

    // After stopping, changes should NOT propagate
    setCount(2);
    await nextTick();
    assert.strictEqual(span.textContent, "1"); // unchanged
  });

  test("effects can be re-created on fresh DOM (simulates reconnect)", async () => {
    const { container } = createDOM(`<span>{{ count() }}</span>`);
    const [count, setCount] = signal(0);

    // First bind
    let stopScope = reactiveNodes(container.childNodes, { count });
    const span = container.querySelector("span")!;
    assert.strictEqual(span.textContent, "0");

    setCount(1);
    await nextTick();
    assert.strictEqual(span.textContent, "1");

    // Disconnect
    stopScope();

    setCount(2);
    await nextTick();
    assert.strictEqual(span.textContent, "1"); // still old value

    // Reconnect: re-create the innerHTML and re-bind (what _bindReactiveNodes does)
    container.innerHTML = `<span>{{ count() }}</span>`;
    stopScope = reactiveNodes(container.childNodes, { count });

    const newSpan = container.querySelector("span")!;
    // Should pick up current signal value
    assert.strictEqual(newSpan.textContent, "2");

    setCount(3);
    await nextTick();
    assert.strictEqual(newSpan.textContent, "3");

    stopScope();
  });

  test("multiple disconnect/reconnect cycles work", async () => {
    const { container } = createDOM(`<span>{{ count() }}</span>`);
    const [count, setCount] = signal(0);

    for (let i = 1; i <= 3; i++) {
      container.innerHTML = `<span>{{ count() }}</span>`;
      const stop = reactiveNodes(container.childNodes, { count });

      setCount(i);
      await nextTick();
      assert.strictEqual(
        container.querySelector("span")!.textContent,
        String(i),
      );

      stop();

      // Verify no updates after stop
      setCount(i * 100);
      await nextTick();
      assert.strictEqual(
        container.querySelector("span")!.textContent,
        String(i),
      );
    }
  });

  test("disposal stops nested #if effects", async () => {
    const { container } = createDOM(
      `<div><p #if="show()">{{ msg() }}</p></div>`,
    );
    const [show, setShow] = signal(true);
    const [msg] = signal("hello");

    const stopScope = reactiveNodes(container.childNodes, { show, msg });
    assert.ok(container.querySelector("p") !== null);

    stopScope();

    // Toggling show after disposal should have no effect
    setShow(false);
    await nextTick();
    // Element is still there because the effect that would remove it is stopped
    assert.ok(container.querySelector("p") !== null);
  });

  test("disposal stops #for effects", async () => {
    const { container } = createDOM(
      `<ul><li #for="items()">{{ text }}</li></ul>`,
    );
    const [items, setItems] = signal([{ text: "A" }]);

    const stopScope = reactiveNodes(container.childNodes, { items });
    assert.strictEqual(container.querySelectorAll("li").length, 1);

    stopScope();

    setItems([{ text: "A" }, { text: "B" }, { text: "C" }]);
    await nextTick();
    // Should still be 1 since the effect is stopped
    assert.strictEqual(container.querySelectorAll("li").length, 1);
  });
});

describe("Component Lifecycle - Context Preservation", () => {
  test("context (signals) maintain state across disconnect/reconnect", async () => {
    const { container } = createDOM(`<span>{{ count() }}</span>`);
    const [count, setCount] = signal(0);
    const context = { count, setCount };

    // Initial bind
    let stop = reactiveNodes(container.childNodes, context);
    setCount(5);
    await nextTick();
    assert.strictEqual(container.querySelector("span")!.textContent, "5");

    // Disconnect
    stop();

    // Mutate state while disconnected
    setCount(10);
    await nextTick();

    // Reconnect with same context
    container.innerHTML = `<span>{{ count() }}</span>`;
    stop = reactiveNodes(container.childNodes, context);

    // Should show current value (10), not the value at disconnect (5)
    assert.strictEqual(container.querySelector("span")!.textContent, "10");
    stop();
  });
});
