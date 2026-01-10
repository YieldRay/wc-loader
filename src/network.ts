import { WCLoaderError } from "./error.ts";

export async function requestText(url: string | URL, userFriendlySource: string): Promise<string> {
  return request(url, userFriendlySource).then((res) => res.text());
}

export async function request(url: string | URL, userFriendlySource: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new WCLoaderError(`Failed to fetch ${url} at ${userFriendlySource}`, {
        cause: new Error(`HTTP status ${response.status}`),
      });
    }
    return response;
  } catch (error) {
    if (!(error instanceof WCLoaderError)) {
      throw new WCLoaderError(`Failed to fetch ${url} at ${userFriendlySource}`, {
        cause: error,
      });
    }
  }
}
