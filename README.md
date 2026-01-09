# lib.js Documentation

A JavaScript library for dynamic component loading with ES module support and web component integration.

## Overview

lib.js provides functionality to dynamically load and register web components from HTML files containing ES modules. It handles module rewriting, URL resolution, and component lifecycle management with shadow DOM support.

## Key Features

- **Dynamic Component Loading**: Load web components from HTML files at runtime
- **ES Module Support**: Automatic rewriting and loading of ES modules
- **URL Resolution**: Smart handling of relative and absolute imports
- **Shadow DOM Integration**: Automatic shadow root creation and management
- **Global Style Support**: Handle global styles that apply to the entire document
- **Component Caching**: Prevent duplicate component definitions
- **Directory-based Components**: Support loading components from directories

## Public API

### loadComponent(name, url, afterConstructor)

Loads and registers a web component from an HTML file or directory.

**Parameters:**
- `name` (string): The custom element name to register
- `url` (string): The URL of the HTML file or directory containing the component
- `afterConstructor` (function, optional): Callback function executed after component construction

**Returns:**
- Promise<Constructor>: The registered web component constructor

**Examples:**

```javascript
import { loadComponent } from "./lib.js";

// Load from HTML file
loadComponent("my-layout", "./components/layout.html");

// Load from directory (depends on server to serve appropriate file)
loadComponent("demo-component", "./components/demo-component/");

// Load with afterConstructor callback
loadComponent("my-modal", "./components/modal.html", function() {
  this.addEventListener('close', () => console.log('Modal closed'));
});
```

**Behavior:**
- If URL ends with `/`, it depends on the server to serve the appropriate file (typically `index.html`)
- Resolves relative URLs based on the calling file's location
- Throws error if component name is already registered with different URL
- Returns cached component if already loaded with same URL
- Automatically handles ES module imports within the component

### defineComponent(fc)

A dual-purpose helper function for component definition that works both in component context and document context.

**Parameters:**
- `fc` (function): Component function that receives a root element (shadow root or document)

**Returns:**
- When called from loadComponent context: Web component class
- When called from normal document: Executes function with document as root

**Examples:**

```javascript
// In a component file (components/demo-component/js/index.js)
import { defineComponent } from "../../../lib.js";

export default defineComponent((root) => {
  const tick = () => {
    root.getElementById("demo").textContent = new Date().toLocaleString();
  };
  tick();
  setInterval(tick, 1000);
});

// In normal document context
defineComponent((root) => {
  // Runs immediately with document as root
  root.body.innerHTML = '<h1>App Initialized</h1>';
});
```

## Component Structure Patterns

### Pattern 1: Simple HTML Component

For simple components, create an HTML file with inline styles and scripts:

```html
<!-- components/demo-counter/index.html -->
<button id="decrement">-</button>
<span id="counter-value">0</span>
<button id="increment">+</button>

<script type="module">
  export default class DemoCounter extends HTMLElement {
    connectedCallback() {
      this.shadowRoot.getElementById("decrement").addEventListener("click", () => {
        this._updateCounter(-1);
      });
      this.shadowRoot.getElementById("increment").addEventListener("click", () => {
        this._updateCounter(1);
      });
    }

    _updateCounter(delta) {
      const counterValueElem = this.shadowRoot.getElementById("counter-value");
      let currentValue = parseInt(counterValueElem.textContent, 10);
      currentValue += delta;
      counterValueElem.textContent = currentValue;
    }
  }
</script>

<style>
  :host {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    font-size: 1.5rem;
  }
</style>
```

### Pattern 2: Directory-based Component with External Files

For complex components, organize files in a directory structure:

```
components/demo-component/
├── index.html          # Main component HTML (served by server)
├── css/
│   └── index.css      # Component styles
└── js/
    └── index.js       # Component logic
```

**index.html:**
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Demo Component</title>
  </head>
  <body>
    <p>Current Time: <time id="demo"></time></p>
    <demo-counter></demo-counter>
  </body>

  <!-- External script -->
  <script type="module" src="./js/index.js"></script>
</html>

<link rel="stylesheet" href="./css/index.css" />
<style>
  :host {
    display: flex;
    flex-direction: column;
  }
</style>
```

**js/index.js:**
```javascript
import { loadComponent, defineComponent } from "../../../lib.js";

// Load child components
loadComponent("demo-counter", "../../demo-counter/");

export default defineComponent((root) => {
  const tick = () => {
    root.getElementById("demo").textContent = new Date().toLocaleString();
  };
  tick();
  setInterval(tick, 1000);
});
```

**css/index.css:**
```css
time {
  font-family: monospace;
}
```

### Pattern 3: Layout Component with Slots

Components can use slots for content projection:

```html
<!-- components/layout.html -->
<link rel="stylesheet" href="https://unpkg.com/landsoul" />

<header>
  <slot name="header">
    <my-header></my-header>
  </slot>
</header>

<main>
  <slot></slot>
</main>

<footer></footer>

<script type="module">
  import confetti from "canvas-confetti";
  import { loadComponent } from "../lib.js";

  loadComponent("my-header", "./header.html");

  export default class MyLayout extends HTMLElement {
    connectedCallback() {
      this.shadowRoot.querySelector("footer").textContent = navigator.userAgent;
      this.shadowRoot.querySelector("main").addEventListener("click", (e) => {
        confetti({
          particleCount: 20,
          spread: 70,
          origin: { y: 0.6 },
        });
      });
    }
  }
</script>

<style>
  :host {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100%;
    padding: 1rem;
  }

  main {
    flex: 1;
  }

  footer {
    position: fixed;
    bottom: 0;
    margin-top: auto;
    font-weight: lighter;
    font-size: 0.7rem;
    line-height: 0.6rem;
    padding: 0.5em;
  }
</style>
```

## Component Export Patterns

### Option 1: HTMLElement Subclass

Export a custom HTMLElement class:

```javascript
export default class MyComponent extends HTMLElement {
  connectedCallback() {
    // Component logic here
  }
}
```

### Option 2: defineComponent Function

Use the `defineComponent` helper for simpler syntax:

```javascript
import { defineComponent } from "../lib.js";

export default defineComponent((root) => {
  // Component logic here
  // root is the shadow root
});
```

### Option 3: Re-export from External Module

```javascript
// Inline script option
export { default } from "./js/index.js";
```

## Loading Components in Main Application

**index.html:**
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WCLoader</title>
    <style>
      :root, body, my-layout {
        margin: 0;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <my-layout>
      <demo-component></demo-component>
    </my-layout>

    <script type="module">
      import { loadComponent } from "./lib.js";
      loadComponent("my-layout", "./components/layout.html");
      loadComponent("demo-component", "./components/demo-component/");
    </script>
  </body>
</html>
```

## Styling Components

### Host Styles

Use `:host` to style the component element itself:

```css
:host {
  display: block;
  padding: 1rem;
}
```

### External Stylesheets

Link to external CSS files:

```html
<link rel="stylesheet" href="https://unpkg.com/landsoul" />
<link rel="stylesheet" href="./css/component.css" />
```

### Global Styles

Add `global` attribute to apply styles to the entire document:

```html
<style global>
  :root { --primary-color: blue; }
</style>

<link rel="stylesheet" href="global.css" global>
```

## Advanced Features

### Component Nesting

Components can load other components:

```javascript
import { loadComponent } from "../lib.js";

// Load child components
loadComponent("my-header", "./header.html");
loadComponent("demo-counter", "../../demo-counter/");
```

### External Dependencies

Import from CDNs or npm packages:

```javascript
import confetti from "canvas-confetti";
import { someUtility } from "https://esm.sh/some-package";
```

### Dynamic Content

Update component content dynamically:

```javascript
connectedCallback() {
  const tick = () => {
    this.shadowRoot.getElementById("time").textContent = new Date().toLocaleString();
  };
  setInterval(tick, 1000);
}
```

## Internal Architecture

### Module Rewriting

The library automatically rewrites ES module imports:

- **Relative imports** (`./module.js`, `../utils.js`): Converted to absolute URLs
- **Absolute imports** (`/module.js`): Resolved relative to current origin
- **Bare imports** (`lodash`, `react`): Rewritten to use `https://esm.sh/`
- **Browser URLs** (`https://`, `blob:`): Left unchanged
- **Data URLs** (`data:`): Left unchanged

### URL Resolution

Import URLs are resolved based on the calling context:
- Uses stack trace analysis to determine the importer file
- Resolves relative URLs against the importer's location
- Handles blob URLs created by the module system

### Component Loading Process

1. **Fetch HTML**: Download component HTML file (server determines what to serve for directories)
2. **Parse DOM**: Parse HTML into document object
3. **Process Global Styles**: Move `[global]` styles to document head
4. **Rewrite URLs**: Convert all relative URLs to absolute URLs
5. **Load Modules**: Execute all `<script type="module">` elements
6. **Create Component**: Combine modules and template into web component
7. **Register Element**: Define custom element with generated name

## Error Handling

### Common Errors

**Component Name Conflict:**
```javascript
// Error: Component name "my-button" is already being used
await loadComponent('my-button', './different-button.html');
```

**Invalid Component Export:**
```javascript
// Error: Default export is not a web component constructor
// Component must export HTMLElement subclass or use defineComponent
```

**Module Load Failure:**
```javascript
// Error: Failed to load module script: ./missing.js, status: 404
```

## Best Practices

1. **Use descriptive component names** with hyphens (required for custom elements)
2. **Organize complex components** in directories with server-configured default files
3. **Use defineComponent** for simpler component logic
4. **Leverage external stylesheets** for reusable styles
5. **Handle component lifecycle** with connectedCallback/disconnectedCallback
6. **Use slots** for flexible content projection
7. **Keep components focused** on single responsibilities
8. **Configure your server** to serve appropriate files for directory requests

## Browser Compatibility

- **ES Modules**: Requires native ES module support
- **Custom Elements**: Requires web components support
- **Shadow DOM**: Requires shadow DOM v1 support
- **Dynamic Imports**: Requires dynamic import() support

Supports all modern browsers (Chrome 61+, Firefox 60+, Safari 10.1+, Edge 16+).