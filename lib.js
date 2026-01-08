import { parse } from "https://esm.sh/es-module-lexer/js";
import * as stackTraceParser from "https://esm.sh/stacktrace-parser";
// TODO: we need to add a esbuild or rollup step later to pre-bundle es-module-lexer and stacktrace-parser

function rewriteModule(code, sourceUrl) {
  const [imports] = parse(code);

  const rewritableImports = imports.filter((i) => {
    const specifier = code.slice(i.s, i.e);
    return !isBrowserUrl(specifier) && !specifier.startsWith("data:");
  });

  for (const importEntry of rewritableImports.reverse()) {
    // imports like "./xxx" or "/xxx" will be rewritten to absolute URLs
    const specifier = code.slice(importEntry.s, importEntry.e);
    let rewritten = specifier;

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

function isBrowserUrl(url) {
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:http://") ||
    url.startsWith("blob:https://")
  );
}

// track blob URLs to their original source URLs
const blobMap = new Map();

async function esm(code, sourceUrl) {
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
  const stack = stackTraceParser.parse(new Error().stack);
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

export async function loadComponent(name, url, afterConstructor) {
  // when load a component, the url is relative to the importer file
  const importerUrl = getImporterUrl() || location.href;
  url = new URL(url, importerUrl).href;

  if (customElements.get(name)) {
    return customElements.get(name);
  }

  // TODO: we may allow custom the fetch function
  const html = await fetch(url).then((res) => res.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  filterGlobalStyle(doc);
  // now [global] styles are moved to the outer document, there is no [global] styles in doc

  // rewrite all script[src] to absolute URLs
  for (const script of doc.querySelectorAll("script[src]")) {
    const src = new URL(
      script.getAttribute("src"), // getAttribute to avoid getting absolute URL directly, do not use script.src
      url
    ).href;
    script.src = src;
  }

  // rewrite all link[href] to absolute URLs
  for (const link of doc.querySelectorAll("link[href]")) {
    const href = new URL(
      link.getAttribute("href"), // getAttribute to avoid getting absolute URL directly, do not use link.href
      url
    ).href;
    link.href = href;
  }

  // note that we do NOT rewrite dynamic style import in <style>@import url(...)</style> at this moment

  // the final exported module, composed to a single one
  const result = {};
  for (const script of doc.querySelectorAll('script[type="module"]')) {
    const src = script.src;
    if (src) {
      // we do not use dynamic import() here because we need to rewrite the import URLs inside the module code
      // const module = await import(src);
      const res = await fetch(src);
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

  // we will inject doc.body.innerHTML into the shadow root of the component
  // if we use doc.documentElement.innerHTML, this will include extra <body> element, which make styling complicated
  // and there is NO need to write a <body> tag in the component html file

  if (!component) {
    const impl = extendsElement(HTMLElement, doc.body.innerHTML, afterConstructor);
    customElements.define(name, impl);
    return impl;
  }

  if (!(component.prototype instanceof HTMLElement)) {
    throw new Error(`Default export is not a web component constructor: ${name}`);
  }

  const impl = extendsElement(component, doc.body.innerHTML, afterConstructor);
  customElements.define(name, impl);
  return impl;
}

function extendsElement(BaseClass = HTMLElement, innerHTML, afterConstructor) {
  return class extends BaseClass {
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = innerHTML;
      if (afterConstructor) {
        afterConstructor.call(this);
      }
    }
  };
}

function filterGlobalStyle(doc) {
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

function matchCSSAtImport(code) {
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

// TODO: unused here, why?
// if we need to rewrite CSS imports, we should both rewrite <style> and <link rel="stylesheet">
// for <style> it is fine, but for <link> we may need to fetch the CSS content and inject a <style> tag instead
// (or inject CSSStyleSheet via CSSOM API),
// so the rewritten code cannot preserve the original link tag, which is a behavior change
// so now we should NOT use a relative css @import() rule in component html files
function rewriteCSSImports(code, sourceUrl) {
  const imports = matchCSSAtImport(code);

  for (const importEntry of imports.reverse()) {
    const specifier = importEntry.url;

    if (!isBrowserUrl(specifier)) {
      const rewritten = new URL(specifier, sourceUrl).href;
      code = code.slice(0, importEntry.s) + rewritten + code.slice(importEntry.e);
    }
  }

  return code;
}
