export class WCLoaderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`WCLoaderError: ${message}`, options);
    this.name = "WCLoaderError";
  }
}

export function warn(...args: any[]) {
  console.warn("WCLoader Warning:", ...args);
}
