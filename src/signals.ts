type Getter<T> = () => T;
type Setter<T> = (newValue: T) => void;

interface ReactiveEffect {
  (): void;
  deps: Set<Set<ReactiveEffect>>;
  options?: { scheduler: (job: VoidFunction) => void };
}

let activeEffect: ReactiveEffect | null = null;
const jobQueue: VoidFunction[] = [];
let isFlushPending = false;

function queueJob(job: VoidFunction): void {
  if (!jobQueue.includes(job)) {
    jobQueue.push(job);
  }
  if (!isFlushPending) {
    isFlushPending = true;
    Promise.resolve().then(flushJobs);
  }
}

function flushJobs(): void {
  isFlushPending = false;
  const jobs = [...jobQueue];
  jobQueue.length = 0;
  jobs.forEach((job) => job());
}

function cleanup(effect: ReactiveEffect): void {
  effect.deps.forEach((dep) => {
    dep.delete(effect);
  });
  effect.deps.clear();
}

function createReactiveEffect(
  fn: VoidFunction,
  deps: ReactiveEffect["deps"] = new Set(),
  options?: ReactiveEffect["options"],
): ReactiveEffect {
  const effect: ReactiveEffect = fn as ReactiveEffect;
  effect.deps = deps;
  effect.options = options;
  return effect;
}

class EffectScope {
  private effects: VoidFunction[] = [];
  private active = true;

  run<T>(fn: () => T): T | undefined {
    if (!this.active) return;

    const prevScope = activeScope;
    activeScope = this;
    try {
      return fn();
    } finally {
      activeScope = prevScope;
    }
  }

  add(stopFn: VoidFunction): void {
    if (this.active) {
      this.effects.push(stopFn);
    } else {
      stopFn();
    }
  }

  stop(): void {
    if (this.active) {
      this.effects.forEach((stop) => stop());
      this.effects = [];
      this.active = false;
    }
  }
}

let activeScope: EffectScope | null = null;

export function effectScope(fn?: VoidFunction): VoidFunction {
  const scope = new EffectScope();
  if (fn) scope.run(fn);
  return () => scope.stop();
}

export function effect(fn: VoidFunction): VoidFunction {
  const effect = createReactiveEffect(
    () => {
      cleanup(effect);
      const prevEffect = activeEffect;
      activeEffect = effect;
      try {
        fn();
      } finally {
        activeEffect = prevEffect;
      }
    },
    new Set(),
    { scheduler: queueJob },
  );

  effect();

  const stop = () => {
    cleanup(effect);
  };

  if (activeScope) {
    activeScope.add(stop);
  }

  return stop;
}

export function signal<T>(initialValue: T): readonly [Getter<T>, Setter<T>] {
  let value = initialValue;
  const subscribers = new Set<ReactiveEffect>();

  const read: Getter<T> = () => {
    if (activeEffect) {
      subscribers.add(activeEffect);
      activeEffect.deps.add(subscribers);
    }
    return value;
  };

  read.toString = () =>
    `signal<<${value}>>: This is a signal reader, you MUST call it to get the value.`;

  const write: Setter<T> = (newValue: T) => {
    if (value !== newValue) {
      value = newValue;
      const effectsToRun = new Set(subscribers);
      effectsToRun.forEach((effect) => {
        if (effect.options?.scheduler) {
          effect.options.scheduler(effect);
        } else {
          effect();
        }
      });
    }
  };

  write.toString = () =>
    `signal<<${value}>>: This is a signal writer, you MUST call it to set the value.`;

  return [read, write] as const;
}

export function computed<T>(fn: () => T): Getter<T> {
  let value: T;
  let dirty = true;
  let isComputing = false;

  const runner: VoidFunction = () => {
    if (!dirty) {
      dirty = true;
      trigger(subscribers);
    }
  };

  const internalEffect = createReactiveEffect(runner);
  const subscribers = new Set<ReactiveEffect>();

  const trigger: Setter<Set<ReactiveEffect>> = (subs: Set<ReactiveEffect>) => {
    const effectsToRun = new Set(subs);
    effectsToRun.forEach((effect) => {
      if (effect.options?.scheduler) {
        effect.options.scheduler(effect);
      } else {
        effect();
      }
    });
  };

  const read: Getter<T> = () => {
    if (isComputing) {
      throw new Error("Circular dependency detected in computed");
    }
    if (activeEffect) {
      subscribers.add(activeEffect);
      activeEffect.deps.add(subscribers);
    }

    if (dirty) {
      isComputing = true;
      const prevEffect = activeEffect;
      activeEffect = internalEffect;
      cleanup(internalEffect);
      try {
        value = fn();
        dirty = false;
      } finally {
        activeEffect = prevEffect;
        isComputing = false;
      }
    }
    return value;
  };

  read.toString = () =>
    `computed<<${value}>>: This is a computed reader, you MUST call it to get the value.`;

  return read;
}
