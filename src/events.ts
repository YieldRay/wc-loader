interface WCLoaderEvents {
  "component-loading": { name: string; url: string };
  "component-defined": { name: string; url: string };
}

type WCLoaderEventsMap = {
  [K in keyof WCLoaderEvents]: CustomEvent<WCLoaderEvents[K]>;
};

export const eventTarget = new EventTarget() as {
  addEventListener<K extends keyof WCLoaderEventsMap>(
    type: K,
    listener: (this: HTMLDivElement, ev: WCLoaderEventsMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof WCLoaderEventsMap>(
    type: K,
    listener: (this: HTMLDivElement, ev: WCLoaderEventsMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  dispatchEvent(event: WCLoaderEventsMap[keyof WCLoaderEventsMap]): boolean;
};

export function emit(eventName: keyof WCLoaderEvents, detail: WCLoaderEvents[typeof eventName]) {
  const event = new CustomEvent(eventName, { detail });
  eventTarget.dispatchEvent(event);
}
