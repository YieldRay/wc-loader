# Native-SFC

Load a single HTML file as a Web Component.

## How it works

The component loader fetches everything (HTML, JS, CSS) as text,
then processes them to create a Web Component.

1. **HTML Parsing**: The HTML file is parsed and processed
2. **Style Handling**: All `<style>` and `<link rel="stylesheet">` are collected and converted to `adoptedStyleSheets` of the component's shadow root (avoids FOUC)
3. **Script Handling**: ESM modules (`<script type="module">`) are evaluated and their exports are merged. The `default` export, if it's a class extending `HTMLElement`, becomes the base class of the component
4. **Global Styles**: Styles with `global` attribute are moved to the outer document instead of the shadow root
5. **URL Rewriting**: All relative URLs in `src` and `href` attributes are rewritten to absolute URLs based on the component file location

## API

### `loadComponent(name, url, afterConstructor?)`

Load a component from a HTML file and register it as a custom element.

- `name`: The custom element name (e.g., `"my-component"`)
- `url`: The URL to the component HTML file (relative to the importer)
- `afterConstructor`: Optional callback executed after the component constructor

### `defineComponent(fc)`

A helper function for dual-mode component definition:

- When used inside a `loadComponent`-imported module, it defines a web component class
- When used in normal document context, it runs the function with `document` as root

## Limitations

- Dynamic imports with relative paths are NOT supported.
- Inside the ESM modules, the `from` syntax in import statements are rewritten to absolute URL, since all modules are actually loaded as blob URLs.
- Since all styles are moved to `adoptedStyleSheets` in component's shadow root, we CANNOT use `@import` rules in styles.
- Relative URLs in CSS (e.g., `background-image: url(./bg.png)`) are resolved relative to the main document (the page URL), not the component file URL.
- Components loaded with the same name and URL are cached and reused.
- Only `script[src]`'s src' `link[rel="stylesheet"]`'s href will be rewritten. Warn that `a[href]`/`img[src]`/etc with relative URLs in the HTML body will NOT be rewritten.

## Next Steps

- Implement component debugger
- Implement component bundler in both runtime and server-side
- Consider to support rewriting relative URLs in CSS
