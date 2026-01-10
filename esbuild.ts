import esbuild from "esbuild";
//@ts-ignore no need to install @types/node
import process from "node:process";
import type { BuildOptions, Plugin } from "esbuild";

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

async function build(options?: Partial<BuildOptions>) {
  const defaultOptions: BuildOptions = {
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    target: ["esnext"],
    outfile: "dist/index.js",
    minifyIdentifiers: false,
  };

  return esbuild.build({ ...defaultOptions, ...options }).catch(() => process.exit(1));
}

await build({
  plugins: [esmShPlugin],
  banner: {
    js: "// dependencies loaded from esm.sh",
  },
});

await build({
  outfile: "dist/index.bundled.js",
  banner: {
    js: "// all dependencies bundled",
  },
});
