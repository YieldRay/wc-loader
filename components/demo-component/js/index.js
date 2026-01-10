import { loadComponent, defineComponent } from "../../../dist/index.bundled.js";
loadComponent("demo-counter", "../../demo-counter/");

function getNow() {
  return new Date().toLocaleString();
}

// export default class DemoComponent extends HTMLElement {
//   constructor(innerHTML) {
//     super();
//     this.attachShadow({ mode: "open" }).innerHTML = innerHTML + "<strong>injected via constructor</strong>"
//   }

//   connectedCallback() {
//     const tick = () => {
//       this.shadowRoot.getElementById("demo").textContent = getNow();
//     };
//     tick();
//     setInterval(tick, 1000);
//   }
// }

export default defineComponent((root) => {
  const tick = () => {
    root.getElementById("demo").textContent = getNow();
  };
  tick();
  setInterval(tick, 1000);
});
