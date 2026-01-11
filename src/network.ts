import { NativeSFCError } from "./error.ts";

let fetch = globalThis.fetch;

export function defineFetch(customFetch: typeof fetch) {
  fetch = customFetch;
}

export async function requestText(url: string | URL, userFriendlySource: string): Promise<string> {
  return request(url, userFriendlySource).then((res) => res.text());
}

export async function request(url: string | URL, userFriendlySource: string) {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new NativeSFCError(`Failed to fetch ${url} at ${userFriendlySource}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new NativeSFCError(`Failed to fetch ${url} at ${userFriendlySource}`, {
      cause: new Error(`HTTP status ${response.status}`),
    });
  }
  return response;
}
