import { parse } from "es-module-lexer/js";
import * as stackTraceParser from "stacktrace-parser";

function rewriteModule(code: string, sourceUrl: string): string {
  const [imports] = parse(code);

  const rewritableImports = imports.filter((i) => {
    const specifier = code.slice(i.s, i.e);
    return !isBrowserUrl(specifier) && !specifier.startsWith("data:");
  });

  for (const importEntry of rewritableImports.reverse()) {
    // imports like "./xxx" or "/xxx" will be rewritten to absolute URLs
    const specifier = code.slice(importEntry.s, importEntry.e);
    let rewritten = specifier;
    // TODO: we make sure only handle static import syntax and static import(string) here

    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      rewritten = new URL(specifier, sourceUrl).href;
    } else {
      // bare module specifier, since the module will NOT follow import maps,
      // we use esm.sh instead
      rewritten = `https://esm.sh/${specifier}`;
    }
    code = code.slice(0, importEntry.s) + rewritten + code.slice(importEntry.e);
  }
  // we also rewrite import.meta.url, which will then be used in `getImporterUrl` function
  return `import.meta.url=${JSON.stringify(sourceUrl)};\n${code}`;
}

function isBrowserUrl(url: string): boolean {
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:http://") ||
    url.startsWith("blob:https://")
  );
}

// track blob URLs to their original source URLs
const blobMap = new Map<string, string>();
// track components loaded by loadComponent(), name -> {url, component}
const loadedComponentsRecord = new Map<string, { url: string; cec: CustomElementConstructor }>();

async function esm(code: string, sourceUrl: string): Promise<any> {
  code = rewriteModule(code, sourceUrl);

  const blob = new Blob([code], { type: "text/javascript" });
  const blobUrl = URL.createObjectURL(blob);
  blobMap.set(blobUrl, sourceUrl);

  try {
    const module = await import(blobUrl);
    return module;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function getImporterUrl() {
  const stack = stackTraceParser.parse(new Error().stack!);
  for (const { file } of stack) {
    if (file && file !== import.meta.url) {
      if (file.startsWith("blob:")) {
        if (blobMap.has(file)) {
          return blobMap.get(file);
        }
        // skip if it is not a esm blob module we created
        continue;
      }
      return file;
    }
  }

  return null;
}

export async function loadComponent(
  name: string,
  url: string,
  afterConstructor?: VoidFunction
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

  // rewrite all script[src] to absolute URLs
  for (const script of doc.querySelectorAll("script[src]")) {
    const src = new URL(
      script.getAttribute("src") || "", // getAttribute to avoid getting absolute URL directly, do not use script.src
      url
    ).href;
    (script as HTMLScriptElement).src = src;
  }

  // rewrite all link[href] to absolute URLs
  for (const link of doc.querySelectorAll("link[href]")) {
    const href = new URL(
      link.getAttribute("href") || "", // getAttribute to avoid getting absolute URL directly, do not use link.href
      url
    ).href;
    (link as HTMLLinkElement).href = href;
  }

  const adoptedStyleSheets = [];
  for (const link of doc.querySelectorAll(`link[rel="stylesheet"]`)) {
    if (!link.hasAttribute("adopted")) {
      continue;
    }
    // this match <link rel="stylesheet" adopted>
    // we doubt if we should extend html standard like this
    // however, we do need a way to load style in sync to avoid FOUC
    const res = await fetch((link as HTMLLinkElement).href);
    if (!res.ok) {
      throw new Error(`Failed to load adopted stylesheet: ${(link as HTMLLinkElement).href}, status: ${res.status}`);
    }
    const style = await res.text();
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(style);
    adoptedStyleSheets.push(sheet);
    link.remove();
  }

  // note that we do NOT rewrite dynamic style import in <style>@import url(...)</style> at this moment

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
  // now all script[type="module"] are removed from doc

  // move all style to body instead of head, because we will only use doc.body.innerHTML later
  for (const selector of ["style", 'link[rel="stylesheet"]', "script"]) {
    // a script tag without type="module" is also moved to body and then injected to shadow root
    // but use a bare script tag is not recommended, so we may add a warning later
    for (const el of doc.querySelectorAll(selector)) {
      doc.body.prepend(el);
    }
  }
  // a normal script tag that is not a module will be injected into the shadow root and executed there

  const component = result.default;
  const defaultExportIsComponent = component.prototype instanceof HTMLElement;

  // we will inject doc.body.innerHTML into the shadow root of the component
  // if we use doc.documentElement.innerHTML, this will include extra <body> element, which make styling complicated
  // and there is NO need to write a <body> tag in the component html file

  if (!component || !defaultExportIsComponent) {
    const cec = extendsElement(HTMLElement, doc.body.innerHTML, adoptedStyleSheets, afterConstructor);
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
  afterConstructor?: VoidFunction
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

function matchCSSAtImport(code: string) {
  // two cases:
  // @import "url" ...
  // @import url("url") ...
  // we match only the bare url
  const regex1 = /@import\s+["']([^"']+)["']/g;
  const regex2 = /@import\s+url\(\s*["']?([^"')]+)["']?\s*\)/g;

  // {s: start index, e: end index, url: the matched url}
  const imports = [];
  let match;

  while ((match = regex1.exec(code)) !== null) {
    imports.push({ s: match.index + 8, e: match.index + 8 + match[1].length, url: match[1] });
  }

  while ((match = regex2.exec(code)) !== null) {
    imports.push({ s: match.index + 11, e: match.index + 11 + match[1].length, url: match[1] });
  }

  return imports;
}

function matchCSSUrlFunction(code: string) {
  // match url("...") or url('...') or url(...)
  const regex = /url\(\s*["']?([^"')]+)["']?\s*\)/g;

  // {s: start index, e: end index, url: the matched url}
  const urls = [];
  let match;

  while ((match = regex.exec(code)) !== null) {
    urls.push({ s: match.index + 4, e: match.index + 4 + match[1].length, url: match[1] });
  }

  return urls;
}

// TODO: unused here, why?
// if we need to rewrite CSS imports, we should both rewrite <style> and <link rel="stylesheet">
// for <style> it is fine, but for <link> we may need to fetch the CSS content and inject a <style> tag instead
// (or inject CSSStyleSheet via CSSOM API),
// so the rewritten code cannot preserve the original link tag, which is a behavior change
// so now we should NOT use a relative css @import() rule in component html files
function rewriteCSSImports(code: string, sourceUrl: string) {
  const imports = matchCSSAtImport(code);

  for (const importEntry of imports.reverse()) {
    const specifier = importEntry.url;

    if (!isBrowserUrl(specifier)) {
      const rewritten = new URL(specifier, sourceUrl).href;
      code = code.slice(0, importEntry.s) + rewritten + code.slice(importEntry.e);
    }
  }

  const urls = matchCSSUrlFunction(code);

  for (const urlEntry of urls.reverse()) {
    const specifier = urlEntry.url;

    if (!isBrowserUrl(specifier) && !specifier.startsWith("data:")) {
      const rewritten = new URL(specifier, sourceUrl).href;
      code = code.slice(0, urlEntry.s) + rewritten + code.slice(urlEntry.e);
    }
  }

  // when rewrite esm import, we use an AST parser to make sure correctness
  // here we use regex, which will not be 100% correct, especially for matching comments, strings, etc.
  // (which should never be matched)

  return code;
}
