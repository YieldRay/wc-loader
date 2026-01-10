// note that all files MUST be bundled into single one
// since we use stack trace to detect who call the entry point
export { WCLoaderError } from "./error.ts";
export { defineComponent, loadComponent } from "./components.ts";
