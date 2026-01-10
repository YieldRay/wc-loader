import * as stackTraceParser from "stacktrace-parser";
import { blobMap, esm, getImporterUrl } from "./rewriter.ts";
import { requestText, request } from "./network.ts";
import { WCLoaderError, warn } from "./error.ts";
import { emit } from "./events.ts";

const loadedComponentsRecord = new Map<string, { url: string; cec: CustomElementConstructor }>();

export async function loadComponent(
  name: string,
  url: string,
  afterConstructor?: VoidFunction,
): Promise<CustomElementConstructor> {
  // when load a component, the url is relative to the importer file
  const importerUrl = getImporterUrl() || location.href;
  url = new URL(url, importerUrl).href;

  // url is the real, absolute URL of the component html file
  emit("component-loading", { name, url });

  if (customElements.get(name)) {
    if (!loadedComponentsRecord.has(name)) {
      // component name is not defined via loadComponent before, we cannot define it again
      throw new WCLoaderError(`Component name ${JSON.stringify(name)} is already being used`);
    }

    const loadedComponentRecord = loadedComponentsRecord.get(name)!;
    if (loadedComponentRecord.url === url) {
      return loadedComponentRecord.cec;
    }
  }

  const html = await requestText(
    url,
    `loadComponent(${JSON.stringify(name)}, ${JSON.stringify(url)})`,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  filterGlobalStyle(doc);
  // now [global] styles are moved to the outer document, there is no [global] styles in doc

  rewriteStyleAndScript(doc, url);

  // remove all styles to be adoptedStyleSheets
  // which is necessary to avoid FOUC
  const adoptedStyleSheets = await collectAdoptedStyleSheets(doc);

  // note that we do NOT rewrite dynamic style import in <style>@import url(...)</style> at this moment

  const result = await evaluateModules(doc, url);
  // now all script[type="module"] are removed from doc

  // move all script to body instead of head, because we will only use doc.body.innerHTML later
  for (const el of doc.querySelectorAll("script")) {
    doc.body.prepend(el);
  }
  // a normal script tag that is not a module will be injected into the shadow root and executed there

  const component = result.default;
  const defaultExportIsComponent = component?.prototype instanceof HTMLElement;

  // we will inject doc.body.innerHTML into the shadow root of the component
  // if we use doc.documentElement.innerHTML, this will include extra <body> element, which make styling complicated
  // and there is NO need to write a <body> tag in the component html file

  if (component && !defaultExportIsComponent) {
    warn(
      `The default export of component ${JSON.stringify(name)} loaded from ${url} is not a web component class`,
      component,
    );
  }

  // this is a helper closure to reduce code duplication
  const define = (component: typeof HTMLElement, html: string) => {
    const cec = extendsElement(component, html, adoptedStyleSheets, afterConstructor);
    customElements.define(name, cec);
    emit("component-defined", { name, url });
    loadedComponentsRecord.set(name, { cec, url });
    return cec;
  };

  if (!component || !defaultExportIsComponent) {
    return define(HTMLElement, doc.body.innerHTML);
  } else {
    return define(component, doc.body.innerHTML);
  }
}

function extendsElement<BaseClass extends typeof HTMLElement = typeof HTMLElement>(
  BaseClass: BaseClass = HTMLElement as BaseClass,
  innerHTML: string,
  adoptedStyleSheets?: CSSStyleSheet[],
  afterConstructor?: VoidFunction,
): CustomElementConstructor {
  // we doubt if this is a good way
  // since the user provider a web component class,
  // then we create a subclass for it that injects shadow root

  //@ts-ignore
  return class extends BaseClass {
    constructor(...args: any[]) {
      //! we provide an extra argument to user's component constructor
      //@ts-ignore
      super(innerHTML, adoptedStyleSheets);
      //! if the user constructor do not create shadow root, we will create one here
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
 * a dual component definition helper function
 * - when used inside loadComponent-imported module, it defines a web component class
 * - when used in normal document context, it just runs the function with document as root
 */
export function defineComponent(fc: (root: Document | ShadowRoot) => void): any {
  // note that files in src/* are always bundled, so we can use stack trace to detect who call the entry point
  const whoDefineMe = stackTraceParser.parse(new Error().stack!).at(-1)!.file!;

  if (blobMap.has(whoDefineMe)) {
    return class extends HTMLElement {
      connectedCallback() {
        fc.call(this, this.shadowRoot || this.attachShadow({ mode: "open" }));
      }
    };
  }

  return fc.call(globalThis, document);
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
    // this match <link rel="stylesheet" href="...">
    const styleText = await requestText((link as HTMLLinkElement).href, link.outerHTML).catch(
      (error) => {
        warn(`Failed to load ${link.outerHTML}`, error);
        // just like the html, failed <link rel="stylesheet"> will not break the document
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
  // the final exported module, composed to a single one

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
