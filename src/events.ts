interface NativeSFCEvents {
  "component-loading": { name: string; url: string };
  "component-defined": { name: string; url: string };
}

type NativeSFCEventsMap = {
  [K in keyof NativeSFCEvents]: CustomEvent<NativeSFCEvents[K]>;
};

export const eventTarget = new EventTarget() as {
  addEventListener<K extends keyof NativeSFCEventsMap>(
    type: K,
    listener: (this: EventTarget, ev: NativeSFCEventsMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof NativeSFCEventsMap>(
    type: K,
    listener: (this: EventTarget, ev: NativeSFCEventsMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  dispatchEvent(event: NativeSFCEventsMap[keyof NativeSFCEventsMap]): boolean;
};

export function emit(eventName: keyof NativeSFCEvents, detail: NativeSFCEvents[typeof eventName]) {
  const event = new CustomEvent(eventName, { detail });
  eventTarget.dispatchEvent(event);
}

export function on<K extends keyof NativeSFCEvents>(
  eventName: K,
  listener: (ev: NativeSFCEventsMap[K]) => any,
) {
  eventTarget.addEventListener(eventName, listener as EventListener);
  return () => {
    eventTarget.removeEventListener(eventName, listener as EventListener);
  };
}
