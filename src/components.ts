import * as stackTraceParser from "stacktrace-parser";
import { blobMap, esm, getImporterUrl } from "./rewriter.ts";

const loadedComponentsRecord = new Map<string, { url: string; cec: CustomElementConstructor }>();

export async function loadComponent(
  name: string,
  url: string,
  afterConstructor?: VoidFunction,
): Promise<CustomElementConstructor> {
  // when load a component, the url is relative to the importer file
  const importerUrl = getImporterUrl() || location.href;
  url = new URL(url, importerUrl).href;

  if (customElements.get(name)) {
    if (!loadedComponentsRecord.has(name)) {
      // component name is not defined via loadComponent before, we cannot define it again
      throw new Error(`Component name ${JSON.stringify(name)} is already being used`);
    }

    const loadedComponentRecord = loadedComponentsRecord.get(name)!;
    if (loadedComponentRecord.url === url) {
      return loadedComponentRecord.cec;
    }
  }

  // TODO: we may allow custom the fetch function
  const html = await fetch(url).then((res) => res.text());
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

  if (!component || !defaultExportIsComponent) {
    const cec = extendsElement(
      HTMLElement,
      doc.body.innerHTML,
      adoptedStyleSheets,
      afterConstructor,
    );
    customElements.define(name, cec);
    loadedComponentsRecord.set(name, { cec, url });
    return cec;
  }

  const cec = extendsElement(component, doc.body.innerHTML, adoptedStyleSheets, afterConstructor);
  customElements.define(name, cec);
  loadedComponentsRecord.set(name, { cec, url });
  return cec;
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

      if (doc.contains(styleElement)) {
        styleElement.remove();
      }
    }
  }

  for (const linkElement of doc.querySelectorAll('link[rel="stylesheet"]')) {
    if (linkElement.hasAttribute("global")) {
      document.head.append(linkElement);

      if (doc.contains(linkElement)) {
        linkElement.remove();
      }
    }
  }
}

async function collectAdoptedStyleSheets(doc: Document): Promise<CSSStyleSheet[]> {
  const adoptedStyleSheets = [];
  for (const link of doc.querySelectorAll(`link[rel="stylesheet"]`)) {
    // this match <link rel="stylesheet" href="...">
    const res = await fetch((link as HTMLLinkElement).href);
    if (!res.ok) {
      throw new Error(
        `Failed to load adopted stylesheet: ${(link as HTMLLinkElement).href}, status: ${res.status}`,
      );
    }
    const styleText = await res.text();
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styleText);
    adoptedStyleSheets.push(sheet);
    link.remove();
  }
  for (const style of doc.querySelectorAll("style")) {
    const styleText = style.innerHTML || "";
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styleText);
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
}

async function evaluateModules(doc: Document, url: string) {
  // the final exported module, composed to a single one

  const result: any = {};
  for (const script of doc.querySelectorAll('script[type="module"]')) {
    const src = (script as HTMLScriptElement).src;
    if (src) {
      // we do not use dynamic import() here because we need to rewrite the import URLs inside the module code
      // const module = await import(src);
      const res = await fetch(src);
      // we do not allow <script type="module" src="vue"> to load https://esm.sh/vue directly
      // it works just like "./vue"
      if (!res.ok) {
        // TODO: better error message, similar to browser error when failed in dynamic import()
        throw new Error(`Failed to load module script: ${src}, status: ${res.status}`);
      }
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
