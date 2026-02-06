import { defineComponent } from "./components.ts";
import { signal } from "./signals.ts";

export default defineComponent(({ onConnected, onDisconnected }) => {
  const [count, setCount] = signal(0);

  onConnected((root) => {
    console.log("Component connected", root);
  });

  onDisconnected((root) => {
    console.log("Component disconnected", root);
  });

  const increment = () => {
    setCount(count() + 1);
  };

  return {
    count,
    increment,
  };
});
