import esbuild from "esbuild";
//@ts-ignore
import process from "node:process";
import type { Plugin } from "esbuild";

const esmShPlugin: Plugin = {
  name: "rewrite-to-esm-sh",
  setup(build) {
    build.onResolve({ filter: /^[^.\/]/ }, (args) => {
      if (args.path.startsWith("http")) return;

      return {
        path: `https://esm.sh/${args.path}`,
        external: true,
      };
    });
  },
};

esbuild
  .build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    target: ["esnext"],
    outfile: "dist/index.js",
    plugins: [esmShPlugin],
    minifyIdentifiers: false,
  })
  .catch(() => process.exit(1));
