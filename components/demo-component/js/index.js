import { loadComponent } from "../../../lib.js";
loadComponent("demo-counter", "../../demo-counter/");

function getNow() {
  return new Date().toLocaleString();
}

export default class DemoComponent extends HTMLElement {
  connectedCallback() {
    const tick = () => {
      this.shadowRoot.getElementById("demo").textContent = getNow();
    };
    tick();
    setInterval(tick, 1000);
  }
}
