# Native-SFC

Load a single HTML file as a Web Component.

```html
<!-- index.html -->
<my-counter></my-counter>
<script type="module">
  import { loadComponent } from "https://esm.sh/native-sfc";
  loadComponent("my-counter", "./my-counter.html");
</script>
```

```html
<!-- my-counter.html -->
<button @click="setCount(count() + 1)">Count is: {{ count() }}</button>
<script type="module">
  import { signal } from "https://esm.sh/native-sfc";
  export default class MyCounter extends HTMLElement {
    setup() {
      const [count, setCount] = signal(0);
      return { count, setCount };
    }
    connectedCallback() {}
  }
</script>
```

## How it works

The component loader fetches everything (HTML, JS, CSS) as text,
then processes them to create a Web Component.

1. **HTML Parsing**: The HTML file is parsed and processed
2. **Style Handling**: All `<style>` and `<link rel="stylesheet">` are collected and converted to `adoptedStyleSheets` of the component's shadow root (avoids FOUC)
3. **Script Handling**: ESM modules (`<script type="module">`) are evaluated and their exports are merged. The `default` export, if it's a class extending `HTMLElement`, becomes the base class of the component
4. **Global Styles**: Styles with `global` attribute are moved to the outer document instead of the shadow root
5. **URL Rewriting**: All relative URLs in `src` and `href` attributes are rewritten to absolute URLs based on the component file location

## Component API

### `loadComponent(name: string, url: string)`

Load a component from a HTML file and register it as a custom element.

- `name`: The custom element name (e.g., `"my-component"`)
- `url`: The URL to the component HTML file (relative to the importer)

### `defineComponent(setup: ({ onConnected?, onDisconnected? }) => void)`

A helper function for dual-mode component definition:

- When used inside a `loadComponent`-imported module, it defines a web component class with lifecycle callbacks
- When used in normal document context, it runs the setup function with `document` as root
- The setup function receives `{ onConnected, onDisconnected }` callbacks
- Return an object from setup to expose reactive state to the template

## Signals API

### `signal<T>(initialValue: T): [() => T, (v: T) => void]`

Creates a reactive signal with a getter and setter.

- Returns a tuple: `[getter, setter]`
- `getter()`: Returns the current value
- `setter(value)`: Updates the signal value and triggers reactivity

### `computed<T>(fn: () => T): () => T`

Creates a computed value that automatically tracks dependencies.

- `fn`: Function that computes and returns the value
- Returns a getter function that returns the computed result
- Automatically updates when dependencies change

### `effect(fn: VoidFunction): VoidFunction`

Creates a reactive effect that runs whenever its dependencies change.

- `fn`: Function to execute
- Returns a cleanup function to stop the effect
- Useful for side effects and subscriptions

### `effectScope(fn: VoidFunction): VoidFunction`

Creates an effect scope to batch multiple effects together.

- `fn`: Function containing effect definitions
- Returns a cleanup function to stop all effects in the scope
- Useful for organizing related effects

## HTML Template API

### .property

Binds a DOM property to a reactive expression.

```html
<input .value="someSignal()" />
```

### :attribute

Binds a DOM attribute to a reactive expression.

```html
<img :src="imageUrl()" />
```

### @event

Binds a DOM event to a reactive expression.

```html
<button @click="handleClick()" />
```

### {{ expression }}

Embeds a reactive expression inside text content.

```html
<p>Total: {{ total() }}</p>
```

### #if="condition"

Conditionally renders an element based on a reactive expression.

```html
<div #if="isVisible()">This content is visible only if isVisible() is true.</div>
```

### #for="arrayExpression"

Renders a list of elements based on a reactive array expression.

```html
<li #for="items().map(item => ({ item }))">{{ item.name }}</li>
```

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
- Add hooks for common shadow root operations
