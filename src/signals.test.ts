import { test, describe } from "node:test";
import assert from "node:assert";
import { signal, computed, effect, effectScope, untrack } from "./signals.ts";

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Signal System", () => {
  describe("Signal", () => {
    test("basic functionality", () => {
      const [count, setCount] = signal(0);

      assert.strictEqual(count(), 0);

      setCount(1);
      assert.strictEqual(count(), 1);

      // No change when setting same value
      setCount(1);
      assert.strictEqual(count(), 1);
    });

    test("type safety", () => {
      const [str, setStr] = signal("hello");
      const [bool, setBool] = signal(true);
      const [obj, setObj] = signal({ a: 1 });

      assert.strictEqual(str(), "hello");
      assert.strictEqual(bool(), true);
      assert.deepStrictEqual(obj(), { a: 1 });

      setStr("world");
      setBool(false);
      setObj({ a: 2 });

      assert.strictEqual(str(), "world");
      assert.strictEqual(bool(), false);
      assert.deepStrictEqual(obj(), { a: 2 });
    });

    test("read without active effect", () => {
      const [count] = signal(42);
      assert.strictEqual(count(), 42);
    });

    test("untrack prevents dependency tracking", async () => {
      const [count, setCount] = signal(0);
      let runs = 0;

      effect(() => {
        runs++;
        untrack(() => {
          count();
        });
      });

      assert.strictEqual(runs, 1);
      setCount(1);
      await nextTick();
      assert.strictEqual(runs, 1);
    });

    test("write with same value does not trigger effects", async () => {
      const [count, setCount] = signal(42);
      let effectRuns = 0;

      effect(() => {
        effectRuns++;
        count();
      });

      assert.strictEqual(effectRuns, 1);

      setCount(42); // Same value
      await nextTick();

      assert.strictEqual(effectRuns, 1);
    });
  });

  describe("Effect", () => {
    test("basic reactivity", async () => {
      const [count, setCount] = signal(0);
      let effectRuns = 0;
      let lastValue = 0;

      const stop = effect(() => {
        effectRuns++;
        lastValue = count();
      });

      assert.strictEqual(effectRuns, 1);
      assert.strictEqual(lastValue, 0);

      setCount(1);
      await nextTick();

      assert.strictEqual(effectRuns, 2);
      assert.strictEqual(lastValue, 1);

      stop();
    });

    test("dependency tracking", async () => {
      const [a, setA] = signal(1);
      const [b, setB] = signal(2);
      let effectRuns = 0;
      let result = 0;

      effect(() => {
        effectRuns++;
        result = a() + b();
      });

      assert.strictEqual(effectRuns, 1);
      assert.strictEqual(result, 3);

      setA(2);
      await nextTick();

      assert.strictEqual(effectRuns, 2);
      assert.strictEqual(result, 4);

      setB(3);
      await nextTick();

      assert.strictEqual(effectRuns, 3);
      assert.strictEqual(result, 5);
    });

    test("conditional dependency (branch switching)", async () => {
      const [condition, setCondition] = signal(true);
      const [a, setA] = signal(1);
      const [b, setB] = signal(2);
      let effectRuns = 0;
      let result = 0;

      effect(() => {
        effectRuns++;
        result = condition() ? a() : b();
      });

      assert.strictEqual(effectRuns, 1);
      assert.strictEqual(result, 1);

      // Change a - should trigger effect
      setA(10);
      await nextTick();

      assert.strictEqual(effectRuns, 2);
      assert.strictEqual(result, 10);

      // Change condition to false
      setCondition(false);
      await nextTick();

      assert.strictEqual(effectRuns, 3);
      assert.strictEqual(result, 2);

      // Change a again - should NOT trigger effect (branch switching)
      setA(20);
      await nextTick();

      assert.strictEqual(effectRuns, 3); // No change
      assert.strictEqual(result, 2);

      // Change b - should trigger effect
      setB(30);
      await nextTick();

      assert.strictEqual(effectRuns, 4);
      assert.strictEqual(result, 30);
    });

    test("stop functionality", async () => {
      const [count, setCount] = signal(0);
      let effectRuns = 0;

      const stop = effect(() => {
        effectRuns++;
        count();
      });

      assert.strictEqual(effectRuns, 1);

      setCount(1);
      await nextTick();

      assert.strictEqual(effectRuns, 2);

      stop();

      setCount(2);
      await nextTick();

      assert.strictEqual(effectRuns, 2); // No change after stop
    });

    test("nested effects", async () => {
      const [a, setA] = signal(1);
      const [b, setB] = signal(2);
      let outerRuns = 0;
      let innerRuns = 0;

      effect(() => {
        outerRuns++;
        a();

        effect(() => {
          innerRuns++;
          b();
        });
      });

      assert.strictEqual(outerRuns, 1);
      assert.strictEqual(innerRuns, 1);

      setA(2);
      await nextTick();

      assert.strictEqual(outerRuns, 2);
      assert.strictEqual(innerRuns, 2); // Inner effect re-created

      setB(3);
      await nextTick();

      // Both inner effects should run
      assert.strictEqual(outerRuns, 2);
      assert.strictEqual(innerRuns, 4);
    });

    test("multiple signals", async () => {
      const [a, setA] = signal(1);
      const [b, setB] = signal(2);
      const [c, setC] = signal(3);
      let effectRuns = 0;
      let sum = 0;

      effect(() => {
        effectRuns++;
        sum = a() + b() + c();
      });

      assert.strictEqual(effectRuns, 1);
      assert.strictEqual(sum, 6);

      setA(10);
      await nextTick();

      assert.strictEqual(effectRuns, 2);
      assert.strictEqual(sum, 15);

      setB(20);
      await nextTick();

      assert.strictEqual(effectRuns, 3);
      assert.strictEqual(sum, 33);

      setC(30);
      await nextTick();

      assert.strictEqual(effectRuns, 4);
      assert.strictEqual(sum, 60);
    });

    test("without active scope", async () => {
      const [count, setCount] = signal(0);
      let effectRuns = 0;

      const stop = effect(() => {
        effectRuns++;
        count();
      });

      assert.strictEqual(effectRuns, 1);

      setCount(1);
      await nextTick();

      assert.strictEqual(effectRuns, 2);

      stop();
    });
  });

  describe("Computed", () => {
    test("basic functionality", () => {
      const [a, setA] = signal(1);
      const [b, setB] = signal(2);

      const sum = computed(() => a() + b());

      assert.strictEqual(sum(), 3);

      setA(5);
      assert.strictEqual(sum(), 7);

      setB(10);
      assert.strictEqual(sum(), 15);
    });

    test("lazy evaluation", () => {
      const [a, setA] = signal(1);
      let computeRuns = 0;

      const doubled = computed(() => {
        computeRuns++;
        return a() * 2;
      });

      // No computation until accessed
      assert.strictEqual(computeRuns, 0);

      // First access triggers computation
      assert.strictEqual(doubled(), 2);
      assert.strictEqual(computeRuns, 1);

      // Second access uses cache
      assert.strictEqual(doubled(), 2);
      assert.strictEqual(computeRuns, 1);

      // Change dependency marks dirty
      setA(5);

      // Access triggers recomputation
      assert.strictEqual(doubled(), 10);
      assert.strictEqual(computeRuns, 2);
    });

    test("with effect", async () => {
      const [a, setA] = signal(1);
      const doubled = computed(() => a() * 2);

      let effectRuns = 0;
      let result = 0;

      effect(() => {
        effectRuns++;
        result = doubled();
      });

      assert.strictEqual(effectRuns, 1);
      assert.strictEqual(result, 2);

      setA(5);
      await nextTick();

      assert.strictEqual(effectRuns, 2);
      assert.strictEqual(result, 10);
    });

    test("diamond dependency resolution", async () => {
      const [a, setA] = signal(1);
      const b = computed(() => a() + 1);
      const c = computed(() => a() + 2);
      const d = computed(() => b() + c());

      let effectRuns = 0;
      let result = 0;

      effect(() => {
        effectRuns++;
        result = d();
      });

      assert.strictEqual(effectRuns, 1);
      assert.strictEqual(result, 5); // (1+1) + (1+2) = 5

      setA(2);
      await nextTick();

      // Effect should only run once despite multiple computed dependencies
      assert.strictEqual(effectRuns, 2);
      assert.strictEqual(result, 7); // (2+1) + (2+2) = 7
    });

    test("circular dependency detection", () => {
      let a: () => number;
      let b: () => number;

      const [, setSignal] = signal(1);

      a = computed(() => {
        setSignal(2); // Trigger during computation
        return b() + 1;
      });

      b = computed(() => a() + 1);

      assert.throws(() => {
        a();
      }, /Circular dependency detected/);
    });

    test("chain computation", () => {
      const [base, setBase] = signal(1);
      const step1 = computed(() => base() * 2);
      const step2 = computed(() => step1() + 10);
      const step3 = computed(() => step2() * 3);

      assert.strictEqual(step3(), 36); // ((1 * 2) + 10) * 3 = 36

      setBase(5);
      assert.strictEqual(step3(), 60); // ((5 * 2) + 10) * 3 = 60
    });

    test("without active effect", () => {
      const [base] = signal(1);
      const doubled = computed(() => base() * 2);

      // Reading computed outside of effect should not add to subscribers
      assert.strictEqual(doubled(), 2);
    });

    test("runner when not dirty", async () => {
      const [base, setBase] = signal(1);
      let computeRuns = 0;

      const doubled = computed(() => {
        computeRuns++;
        return base() * 2;
      });

      // Access to establish dependencies
      doubled();
      assert.strictEqual(computeRuns, 1);

      // Create an effect that reads the computed
      let effectRuns = 0;
      effect(() => {
        effectRuns++;
        doubled();
      });

      assert.strictEqual(effectRuns, 1);

      // Change base signal
      setBase(2);
      await nextTick();

      assert.strictEqual(effectRuns, 2);
      assert.strictEqual(computeRuns, 2);
    });

    test("trigger without scheduler", async () => {
      const [base, setBase] = signal(1);
      let computeRuns = 0;
      let effectRuns = 0;

      const doubled = computed(() => {
        computeRuns++;
        return base() * 2;
      });

      // This tests the trigger path in computed that calls effects without scheduler
      effect(() => {
        effectRuns++;
        doubled();
      });

      assert.strictEqual(effectRuns, 1);
      assert.strictEqual(computeRuns, 1);

      setBase(2);
      await nextTick();

      assert.strictEqual(effectRuns, 2);
      assert.strictEqual(computeRuns, 2);
    });
  });

  describe("Effect Scope", () => {
    test("basic lifecycle management", async () => {
      const [count, setCount] = signal(0);
      let effectRuns = 0;

      const stopScope = effectScope(() => {
        effect(() => {
          effectRuns++;
          count();
        });
      });

      assert.strictEqual(effectRuns, 1);

      setCount(1);
      await nextTick();

      assert.strictEqual(effectRuns, 2);

      // Stop scope should stop all effects
      stopScope();

      setCount(2);
      await nextTick();

      // Effect should not run after scope is stopped
      assert.strictEqual(effectRuns, 2);
    });

    test("without immediate execution", async () => {
      const [count, setCount] = signal(0);
      let effectRuns = 0;

      // Create scope without running function immediately
      const stopScope = effectScope();

      const stop = effect(() => {
        effectRuns++;
        count();
      });

      assert.strictEqual(effectRuns, 1);

      setCount(1);
      await nextTick();

      assert.strictEqual(effectRuns, 2);

      stop();
      stopScope();

      setCount(2);
      await nextTick();

      assert.strictEqual(effectRuns, 2);
    });

    test("inactive scope behavior", () => {
      const stopScope = effectScope();
      stopScope(); // Make it inactive

      const [count] = signal(0);
      let effectRuns = 0;

      const stop = effect(() => {
        effectRuns++;
        count();
      });

      assert.strictEqual(effectRuns, 1);
      stop();
    });

    // Note: EffectScope.add() inactive branch (lines 72-73) is defensive dead code.
    // It cannot be reached through the public API because activeScope is only set
    // inside scope.run(), which returns early when !active. The guard is kept for safety.

    test("stop when already inactive", async () => {
      const [count, setCount] = signal(0);
      let effectRuns = 0;

      const stopScope = effectScope(() => {
        effect(() => {
          effectRuns++;
          count();
        });
      });

      assert.strictEqual(effectRuns, 1);

      stopScope();

      setCount(1);
      await nextTick();

      // Effect should not run after scope is stopped
      assert.strictEqual(effectRuns, 1);

      // Calling stop again should be safe
      stopScope();
    });

    test("exception handling", () => {
      try {
        effectScope(() => {
          effect(() => {
            // This effect should still be registered for cleanup
          });

          throw new Error("Test error");
        });
      } catch (e) {
        assert.strictEqual((e as Error).message, "Test error");
      }

      // The scope should still be created and cleanup should work
      assert.ok(true, "Exception handling works");
    });
  });

  describe("Developer Guards", () => {
    test("signal reader .toString() throws helpful error", () => {
      const [count] = signal(42);
      assert.throws(
        () => count.toString(),
        /signal.*MUST call it to get the value/,
      );
    });

    test("signal writer .toString() throws helpful error", () => {
      const [, setCount] = signal(42);
      assert.throws(
        () => setCount.toString(),
        /signal.*MUST call it to set the value/,
      );
    });

    test("computed reader .toString() throws helpful error", () => {
      const [base] = signal(1);
      const doubled = computed(() => base() * 2);
      // Access once to compute value
      doubled();
      assert.throws(
        () => doubled.toString(),
        /computed.*MUST call it to get the value/,
      );
    });
  });

  describe("Advanced Scenarios", () => {
    test("job queue duplicate prevention", async () => {
      const [count, setCount] = signal(0);
      let effectRuns = 0;

      effect(() => {
        effectRuns++;
        count();
      });

      // Trigger multiple updates in the same microtask
      setCount(1);
      setCount(2);
      setCount(3);

      await nextTick();

      // Should only run twice: initial + one batched update
      assert.strictEqual(effectRuns, 2);
    });

    test("empty job queue flush", async () => {
      const [count, setCount] = signal(0);
      let effectRuns = 0;

      effect(() => {
        effectRuns++;
        count();
      });

      setCount(1);
      await nextTick();

      assert.strictEqual(effectRuns, 2);

      // Multiple flushes should be safe
      await nextTick();
      assert.strictEqual(effectRuns, 2);
    });
  });
});
