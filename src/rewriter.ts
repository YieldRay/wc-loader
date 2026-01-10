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
    url.startsWith("blob:https://") ||
    url.startsWith("data:")
  );
}

// track blob URLs to their original source URLs
export const blobMap = new Map<string, string>();
// track components loaded by loadComponent(), name -> {url, component}

export async function esm(code: string, sourceUrl: string): Promise<any> {
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

export function getImporterUrl() {
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

function matchCSSAtImport(code: string) {
  // two cases:
  // @import "url" ...
  // @import url("url") ...
  // we match only the bare url
  const regex1 = /@import\s+["']([^"']+)["']/g;
  const regex2 = /@import\s+url\(\s*["']?([^"')]+)["']?\s*\)/g;

  // {s: start index, e: end index, url: the matched url}
  const imports: Array<{ s: number; e: number; url: string }> = [];
  let match: RegExpExecArray | null;

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
  const urls: Array<{ s: number; e: number; url: string }> = [];
  let match: RegExpExecArray | null;

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

    if (!isBrowserUrl(specifier)) {
      const rewritten = new URL(specifier, sourceUrl).href;
      code = code.slice(0, urlEntry.s) + rewritten + code.slice(urlEntry.e);
    }
  }

  // when rewrite esm import, we use an AST parser to make sure correctness
  // here we use regex, which will not be 100% correct, especially for matching comments, strings, etc.
  // (which should never be matched)

  return code;
}
