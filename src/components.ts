/**
 * @fileoverview Component loading and registration system for Native SFC (Single File Components).
 *
 * This module provides the core functionality to:
 * - Load HTML-based web components from external files
 * - Parse and process component templates, styles, and scripts
 * - Register custom elements with the browser's CustomElementRegistry
 * - Handle style encapsulation via Shadow DOM and adoptedStyleSheets
 *
 * The component loading process:
 * 1. Fetch the component HTML file
 * 2. Extract and process global styles (move to document head)
 * 3. Rewrite relative URLs in scripts and stylesheets to absolute URLs
 * 4. Convert styles to CSSStyleSheet objects for adoptedStyleSheets (prevents FOUC)
 * 5. Evaluate ES modules and extract the default export (component class)
 * 6. Create an extended component class that injects shadow root with template
 * 7. Register the component with customElements.define()
 */

import * as stackTraceParser from "stacktrace-parser";
import { blobMap, esm, getImporterUrl } from "./rewriter.ts";
import { requestText, request } from "./network.ts";
import { NativeSFCError, warn } from "./error.ts";
import { emit } from "./events.ts";
import { config } from "./config.ts";

/**
 * Cache of loaded components to prevent duplicate definitions and enable reuse.
 * Maps component name to its source URL and CustomElementConstructor.
 */
const loadedComponentsRecord = new Map<string, { url: string; cec: CustomElementConstructor }>();

/**
 * Load and register a web component from an HTML file.
 *
 * This is the primary entry point for loading Native SFC components.
 * The HTML file can contain:
 * - Template markup (the component's shadow DOM content)
 * - `<style>` tags (scoped to the component's shadow DOM)
 * - `<style global>` tags (injected into the main document)
 * - `<script type="module">` (ES modules, default export should be the component class)
 * - `<script>` (classic scripts, executed when component is instantiated)
 * - `<link rel="stylesheet">` (external stylesheets, also supports `global` attribute)
 *
 * @param name - The custom element tag name (must contain a hyphen, e.g., "my-component")
 * @param url - URL to the component HTML file (relative to the importer or absolute)
 * @param afterConstructor - Optional callback invoked after component constructor completes
 * @returns The CustomElementConstructor for the registered component
 * @throws {NativeSFCError} If the component name is already registered by external code
 *
 * @example
 * // Load and use a component
 * await loadComponent('my-button', './components/my-button.html');
 * document.body.innerHTML = '<my-button>Click me</my-button>';
 */
export async function loadComponent(
  name: string,
  url: string,
  afterConstructor?: VoidFunction,
): Promise<CustomElementConstructor> {
  // Resolve relative URL against the importer's location (the file that called loadComponent)
  const importerUrl = getImporterUrl() || location.href;
  url = new URL(url, importerUrl).href;

  // At this point, url is the fully resolved absolute URL of the component HTML file
  emit("component-loading", { name, url });

  // Check if this component name is already registered in the browser
  if (customElements.get(name)) {
    if (!loadedComponentsRecord.has(name)) {
      // The component was registered externally (not via loadComponent)
      // We cannot override it, so throw an error to prevent silent failures
      throw new NativeSFCError(`Component name ${JSON.stringify(name)} is already being used`);
    }

    // Component was previously loaded via loadComponent - check if it's the same source
    const loadedComponentRecord = loadedComponentsRecord.get(name)!;
    if (loadedComponentRecord.url === url) {
      // Same component from same URL - return cached constructor (idempotent behavior)
      return loadedComponentRecord.cec;
    }
    // Note: If same name but different URL, we proceed to redefine (hot-reload scenario)
  }

  // Fetch the component HTML source code
  const html = await requestText(
    url,
    `loadComponent(${JSON.stringify(name)}, ${JSON.stringify(url)})`,
  );

  // Parse HTML into a Document object for DOM manipulation
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Step 1: Extract [global] styles and move them to the main document's <head>
  // After this call, doc only contains component-scoped styles
  filterGlobalStyle(doc);

  // Step 2: Rewrite all relative URLs in scripts and stylesheets to absolute URLs
  // This ensures resources load correctly regardless of where the component is used
  rewriteStyleAndScript(doc, url);

  // Step 3: Convert all styles to CSSStyleSheet objects for adoptedStyleSheets
  // This prevents Flash of Unstyled Content (FOUC) by applying styles synchronously
  // when the shadow root is created, rather than waiting for <style> tags to load
  const adoptedStyleSheets = await collectAdoptedStyleSheets(doc);

  // Note: @import rules inside <style> tags are NOT supported because:
  // 1. CSSStyleSheet.replaceSync() does not support @import
  // 2. We don't rewrite relative URLs inside CSS @import declarations

  // Step 4: Evaluate all ES module scripts and collect their exports
  // The default export should be the component class (extends HTMLElement)
  const result = await evaluateModules(doc, url);
  // After this call, all <script type="module"> elements are removed from doc

  // Step 5: Move remaining scripts (classic, non-module) from <head> to <body>
  // We only use doc.body.innerHTML as the template, so scripts must be in <body>
  for (const el of doc.querySelectorAll("script")) {
    doc.body.prepend(el);
  }
  // Classic scripts will be re-executed when injected into the shadow root
  // (they are cloned and replaced to trigger execution)

  // Extract the default export from the evaluated modules
  const component: any = result.default;
  const defaultExportIsComponent = component?.prototype instanceof HTMLElement;

  // The template is doc.body.innerHTML (not doc.documentElement.innerHTML)
  // This avoids including the <body> wrapper, making CSS selectors simpler
  // Component authors don't need to write <body> tags in their HTML files

  // Warn if default export exists but is not a valid web component class
  if (component && !defaultExportIsComponent) {
    warn(
      `The default export of component ${JSON.stringify(name)} loaded from ${url} is not a web component class`,
      component,
    );
  }

  /**
   * Helper closure to create the extended component class and register it.
   * This reduces code duplication between the HTMLElement and custom class cases.
   */
  const define = (component: typeof HTMLElement) => {
    // Create a subclass that automatically injects the shadow root with template and styles
    const cec = extendsElement(component, doc.body.innerHTML, adoptedStyleSheets, afterConstructor);
    // Register with the browser's custom elements registry
    customElements.define(name, cec);
    emit("component-defined", { name, url });
    // Cache for reuse and duplicate detection
    loadedComponentsRecord.set(name, { cec, url });
    return cec;
  };

  // If no valid component class was exported, use plain HTMLElement as the base
  if (!component || !defaultExportIsComponent) {
    return define(HTMLElement);
  } else {
    return define(component);
  }
}

function extendsElement<BaseClass extends typeof HTMLElement = typeof HTMLElement>(
  BaseClass: BaseClass = HTMLElement as BaseClass,
  innerHTML: string, // we must use innerHTML instead of cloneNode(true)
  adoptedStyleSheets?: CSSStyleSheet[],
  afterConstructor?: VoidFunction,
): CustomElementConstructor {
  // we doubt whether this is a good way
  // since the user provides a web component class,
  // then we create a subclass for it that injects shadow root

  //@ts-ignore
  return class extends BaseClass {
    constructor(...args: any[]) {
      //! we provide an extra argument to user's component constructor
      //@ts-ignore
      super(innerHTML, adoptedStyleSheets);
      //! if the user's constructor does not create a shadow root, we will create one here
      if (!this.shadowRoot) {
        const shadowRoot = this.attachShadow({ mode: "open" });
        shadowRoot.innerHTML = innerHTML;
        if (adoptedStyleSheets && adoptedStyleSheets.length > 0) {
          shadowRoot.adoptedStyleSheets = adoptedStyleSheets;
        }
      }

      if (afterConstructor) {
        afterConstructor.call(this);
      }
    }
  } as BaseClass;
}

/**
 * A dual-purpose component definition helper that adapts behavior based on execution context.
 *
 * This function provides a unified API for writing component logic that works in two scenarios:
 * 1. **Inside a loadComponent-imported module**: Returns a web component class that will
 *    invoke the provided function with the component's ShadowRoot when connected to the DOM.
 * 2. **In normal document context**: Immediately executes the function with `document` as root,
 *    enabling the same code to work as both a reusable component and a standalone script.
 *
 * The context detection works by analyzing the call stack to determine if the caller
 * originated from a blob URL (created by loadComponent's ES module evaluation).
 *
 * **Important**: The `this` binding inside the function refers to:
 * - The custom element instance (HTMLElement) when used as a web component
 * - `undefined` when used in normal document context
 *
 * To access `this`, you **must use a regular function**, not an arrow function,
 * since arrow functions lexically bind `this` and ignore `.call()` binding.
 *
 * @param fc - A function that receives the root element (Document or ShadowRoot) and
 *             performs DOM manipulation, event binding, or other component initialization.
 *             Must be a regular function (not arrow function) if you need to access `this`.
 * @returns When used in component context: a CustomElementConstructor class.
 *          When used in document context: the return value of `fc` (typically undefined).
 *
 * @example
 * // In a component HTML file (loaded via loadComponent):
 * // <script type="module">
 * import { defineComponent } from 'native-sfc';
 *
 * // ✅ Use regular function to access `this` (the custom element instance)
 * export default defineComponent(function(root) {
 *   // 'root' is the ShadowRoot when used as component
 *   // 'this' is the custom element instance
 *   this.addEventListener('click', () => {
 *     console.log('element clicked:', this.tagName);
 *   });
 *   root.querySelector('button')?.addEventListener('click', () => {
 *     console.log('button clicked');
 *   });
 * });
 *
 * // ❌ Arrow function - `this` will NOT be the element instance
 * export default defineComponent((root) => {
 *   // `this` is lexically bound, not the element!
 * });
 * // </script>
 */
export function defineComponent(fc: (root: Document | ShadowRoot) => void): any {
  // note that files in src/* are always bundled, so we can use stack trace to detect who called the entry point
  const whoDefineMe = stackTraceParser.parse(new Error().stack!).at(-1)!.file!;

  if (blobMap.has(whoDefineMe)) {
    return class extends HTMLElement {
      connectedCallback() {
        fc.call(this, this.shadowRoot || this.attachShadow({ mode: "open" }));
      }
    };
  }

  return fc.call(undefined, document);
}

function filterGlobalStyle(doc: Document) {
  // all style tag and link[rel="stylesheet"] with global attribute

  for (const styleElement of doc.querySelectorAll("style")) {
    if (styleElement.hasAttribute("global")) {
      document.head.append(styleElement);
      // move to outer document, no need to remove from doc, append will remove it automatically
    }
  }

  for (const linkElement of doc.querySelectorAll('link[rel="stylesheet"]')) {
    if (linkElement.hasAttribute("global")) {
      document.head.append(linkElement);
      // move to outer document, no need to remove from doc, append will remove it automatically
    }
  }
}

function cssStyleSheetFromText(styleText: string, userFriendlySource: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(styleText);
  } catch (error) {
    // do not crash on invalid CSS
    warn(`Failed to create CSSStyleSheet at ${userFriendlySource}`, error);
  }
  return sheet;
}

async function collectAdoptedStyleSheets(doc: Document): Promise<CSSStyleSheet[]> {
  const adoptedStyleSheets = [];

  for (const link of doc.querySelectorAll(`link[rel="stylesheet"]`)) {
    const styleText = await requestText((link as HTMLLinkElement).href, link.outerHTML).catch(
      (error) => {
        warn(`Failed to load ${link.outerHTML}`, error);
        // just like the html, failed <link rel="stylesheet"> will not crash the document
        return "";
      },
    );
    if (!styleText) continue; // skip empty style
    const sheet = cssStyleSheetFromText(styleText, link.outerHTML);
    adoptedStyleSheets.push(sheet);
    link.remove();
  }

  for (const style of doc.querySelectorAll("style")) {
    const styleText = style.innerHTML;
    if (!styleText) continue; // skip empty style
    const sheet = cssStyleSheetFromText(styleText, style.outerHTML);
    adoptedStyleSheets.push(sheet);
    style.remove();
  }
  return adoptedStyleSheets;
}

function rewriteStyleAndScript(doc: Document, url: string) {
  // rewrite all script[src] to absolute URLs
  for (const script of doc.querySelectorAll("script[src]")) {
    const src = new URL(
      script.getAttribute("src") || "", // getAttribute to avoid getting absolute URL directly, do not use script.src
      url,
    ).href;
    (script as HTMLScriptElement).src = src;
  }

  // rewrite all link[href] to absolute URLs
  for (const link of doc.querySelectorAll("link[href]")) {
    const href = new URL(
      link.getAttribute("href") || "", // getAttribute to avoid getting absolute URL directly, do not use link.href
      url,
    ).href;
    (link as HTMLLinkElement).href = href;
  }

  // note that we do NOT rewrite style @import(...) here
  // and since the style will be injected into adoptedStyleSheets
  // and @import rules are not allowed in new CSSStyleSheet()
  // so there is also no need to rewrite them
  // as a result, we are NOT allowed to use @import in component html files
}

async function evaluateModules(doc: Document, url: string) {
  // the final exported module, composed into a single one

  const result: any = {};
  for (const script of doc.querySelectorAll('script[type="module"]')) {
    const src = (script as HTMLScriptElement).src;
    if (src) {
      const res = await request(src, script.outerHTML);
      const code = await res.text();
      const module = await esm(code, res.url);
      Object.assign(result, module);
    } else {
      const module = await esm(script.textContent, url);
      Object.assign(result, module);
    }
    script.remove();
  }
  return result;
}
