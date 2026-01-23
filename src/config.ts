import { on } from "./events.ts";

type Awaitable<T> = T | Promise<T>;

const config = {
  fetch: globalThis.fetch,
  rewriteModule: (code: string, sourceUrl: string): Awaitable<string> =>
    `import.meta.url=${JSON.stringify(sourceUrl)};\n${code}`,
  on,
};

Object.preventExtensions(config);

export { config };
