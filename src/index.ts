// note that all files MUST be bundled into single one
// since we use stack trace to detect who call the entry point
export { defineComponent, loadComponent } from "./components.ts";
export { NativeSFCError } from "./error.ts";
export { config } from "./config.ts";
