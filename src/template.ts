import { effect, computed, effectScope, untrack } from "./signals.ts";
import { warn } from "./error.ts";

function toCamelCase(str: string): string {
  // since we use real DOM attributes, we need to convert kebab-case to camelCase
  return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

type TextPart = { type: "static"; content: string } | { type: "dynamic"; content: string };

function parseTextContent(text: string): TextPart[] {
  const regex = /\{\{(.+?)\}\}/g;
  const parts: TextPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add static text before the expression
    if (match.index > lastIndex) {
      parts.push({
        type: "static",
        content: text.slice(lastIndex, match.index),
      });
    }
    // Add dynamic expression
    parts.push({
      type: "dynamic",
      content: match[1].trim(),
    });
    lastIndex = regex.lastIndex;
  }

  // Add remaining static text
  if (lastIndex < text.length) {
    parts.push({
      type: "static",
      content: text.slice(lastIndex),
    });
  }

  return parts;
}

/**
 * @param nodes Array of Node
 * @param context A record which the key is string and the value can be signal functions or plain variables
 */
export function reactiveNodes(
  nodes: NodeListOf<Node> | Node[],
  context: Record<string, any>,
): VoidFunction {
  // To make expression reactive, this function should be called inside an effect
  const evalExpr = (expr: string, additionalContext: Record<string, any> = {}) => {
    const ctx =
      typeof context === "object"
        ? Object.assign({}, context, additionalContext)
        : additionalContext;
    const keys = Object.keys(ctx);
    const values = Object.values(ctx);

    try {
      const func = new Function(...keys, `return ${expr.trimStart()}`);
      return func(...values);
    } catch (error) {
      warn(`Failed to evaluate expression: "${expr}"`, error);
    }
  };

  const recursive = (nodes: NodeListOf<Node> | Node[]) => {
    for (const node of Array.from(nodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement; // note: this may also be a custom element

        // Process #if directive first
        const ifAttr = element.getAttribute("#if");
        if (ifAttr) {
          if (element.hasAttribute("#for")) {
            warn("Cannot use #if and #for on the same element");
          }
          const template = element.cloneNode(true) as HTMLElement;
          const parent = element.parentNode;
          const placeholder = document.createComment("if");

          parent?.replaceChild(placeholder, element);
          template.removeAttribute("#if");

          let renderedNode: HTMLElement | null = null;
          let cleanup: VoidFunction | null = null;

          effect(() => {
            const condition = evalExpr(ifAttr);

            if (condition) {
              // Render if not already rendered
              if (!renderedNode) {
                const clone = template.cloneNode(true) as HTMLElement;
                cleanup = reactiveNodes([clone], context);
                placeholder.parentNode?.insertBefore(clone, placeholder.nextSibling);
                renderedNode = clone;
              }
            } else {
              // Remove if currently rendered
              if (renderedNode) {
                cleanup?.(); // Stop all effects
                renderedNode.remove();
                renderedNode = null;
                cleanup = null;
              }
            }
          });

          // Skip normal processing for this element since it's been removed
          continue;
        }

        // Process #for directive
        const forAttr = element.getAttribute("#for");
        if (forAttr) {
          const template = element.cloneNode(true) as HTMLElement;
          const parent = element.parentNode;
          const placeholder = document.createComment("for");

          parent?.replaceChild(placeholder, element);
          template.removeAttribute("#for");

          let renderedItems: Array<{ node: HTMLElement; cleanup: VoidFunction }> = [];

          // TODO: For now, we re-render everything on each change. we can implement diffing later.
          effect(() => {
            const contexts = evalExpr(forAttr);

            if (!Array.isArray(contexts)) {
              warn("#for expression must return an array");
              return;
            }

            // Clear all previously rendered items
            renderedItems.forEach(({ node, cleanup }) => {
              cleanup(); // Stop all effects
              node.remove();
            });
            renderedItems = [];

            // Render each item
            contexts.forEach((itemContext) => {
              const clone = template.cloneNode(true) as HTMLElement;
              const cleanup = reactiveNodes([clone], { ...context, ...itemContext });
              placeholder.parentNode?.insertBefore(clone, placeholder.nextSibling);
              renderedItems.push({ node: clone, cleanup });
            });
          });

          // Skip normal processing for this element since it's been removed
          continue;
        }

        for (const attr of Array.from(element.attributes)) {
          if (attr.name.startsWith(".")) {
            const propName = toCamelCase(attr.name.slice(1));
            const expr = attr.value;
            effect(() => {
              const value = evalExpr(expr);
              untrack(() => Reflect.set(element, propName, value));
            });
            element.removeAttribute(attr.name);
          } else if (attr.name.startsWith(":")) {
            // No need to convert to camelCase since DOM attributes are always in lowercase
            const attrName = attr.name.slice(1);
            const expr = attr.value;
            effect(() => {
              const value = evalExpr(expr);
              untrack(() => {
                if (typeof value === "boolean") {
                  value ? element.setAttribute(attrName, "") : element.removeAttribute(attrName);
                } else {
                  element.setAttribute(attrName, value);
                }
              });
            });
            element.removeAttribute(attr.name);
          } else if (attr.name.startsWith("@")) {
            // No need to convert to camelCase since DOM events are always in lowercase
            const eventName = attr.name.slice(1);
            const expr = attr.value;
            const listener = computed(() => (event: Event) => {
              evalExpr(expr, { event });
            })();
            element.addEventListener(eventName, listener);
            element.removeAttribute(attr.name);
          }
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        const text = textNode.textContent || "";
        const parts = parseTextContent(text);

        // Only process if there are dynamic parts
        if (parts.some((part) => part.type === "dynamic")) {
          const parentNode = textNode.parentNode;
          if (parentNode) {
            // Create a document fragment to hold the new nodes
            const fragment = document.createDocumentFragment();
            const textNodes: Text[] = [];

            for (const part of parts) {
              const newTextNode = document.createTextNode(
                part.type === "static" ? part.content : "",
              );
              fragment.appendChild(newTextNode);
              textNodes.push(newTextNode);

              if (part.type === "dynamic") {
                effect(() => {
                  const value = evalExpr(part.content);
                  untrack(
                    () =>
                      // Convert value to string
                      // Note that we DO NOT use JSON.stringify here like some other frameworks
                      (newTextNode.textContent = String(value)),
                  );
                });
              }
            }

            // Replace the original text node with the fragment
            parentNode.replaceChild(fragment, textNode);
          }
        }
      }
      if (node.childNodes.length > 0) {
        recursive(node.childNodes);
      }
    }
  };

  return effectScope(() => {
    recursive(nodes);
  });
}
