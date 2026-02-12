import { on } from "./events.ts";

/**
 * The global configuration object for the library.
 */
const config = {
  fetch: globalThis.fetch,
  rewriteModule: (code: string, sourceUrl: string): Awaitable<string> =>
    `import.meta.url=${JSON.stringify(sourceUrl)};\n${code}`,
  on,
};

Object.preventExtensions(config);

export { config };

//
// Helpers part
//

export type Awaitable<T> = T | Promise<T>;

export type ModuleObject = Record<string, any>;

export const bind = <T extends Function>(fn: T, thisArg: any): T => fn.bind(thisArg) as T;
