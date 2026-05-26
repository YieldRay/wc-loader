import process from "node:process";
import fs from "node:fs";
import { styleText } from "node:util";
import esbuild from "esbuild";
import type { BuildOptions } from "esbuild";

if (process.argv.includes("--dev")) {
  await run();
  console.log(styleText("dim", "Watching for changes..."));
  watchFiles(["src/**/*"], (eventType, filename) => {
    if (!eventType) return;
    console.log(styleText("dim", `\u2192 ${filename} changed, rebuilding...`));
    run().catch(console.error);
  });
} else {
  run().catch((error) => {
    console.error(styleText("red", `\u2718 Build failed:\n${error}`));
    process.exit(1);
  });
}

async function run() {
  const start = performance.now();

  await build({
    outfile: "dist/index.js",
    banner: { js: "// entrypoint for bundler" },
    plugins: [
      {
        name: "external-deps",
        setup(build) {
          build.onResolve({ filter: /^[^.\/]/ }, (args) => ({
            path: args.path,
            external: true,
          }));
        },
      },
    ],
  });
  console.log(`  ${styleText("dim", "dist/index.js")} ${styleText("dim", "(external deps)")}`);

  await build({
    outfile: "dist/index.cdn.js",
    banner: { js: "// dependencies loaded from esm.sh" },
    plugins: [
      {
        name: "esm-sh",
        setup(build) {
          build.onResolve({ filter: /^[^.\/]/ }, (args) => ({
            path: `https://esm.sh/${args.path}`,
            external: true,
          }));
        },
      },
    ],
  });
  console.log(`  ${styleText("dim", "dist/index.cdn.js")} ${styleText("dim", "(esm.sh)")}`);

  await build({
    outfile: "dist/index.bundled.js",
    banner: { js: "// all dependencies bundled" },
  });
  console.log(`  ${styleText("dim", "dist/index.bundled.js")} ${styleText("dim", "(bundled)")}`);

  const elapsed = (performance.now() - start).toFixed(0);
  console.log(styleText("green", `\u2714 Built in ${elapsed}ms`));
}

async function build(options?: Partial<BuildOptions>) {
  const defaultOptions: BuildOptions = {
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    target: ["esnext"],
    outfile: "dist/index.js",
    minifyIdentifiers: false,
  };

  return esbuild.build({ ...defaultOptions, ...options });
}

function watchFiles(patterns: string[], listener: fs.WatchListener<string>) {
  const files = fs.globSync(patterns);
  const watchers = files.map((file) =>
    fs.watch(file, { recursive: true }, (event, filename) => {
      listener(event, filename);
    }),
  );
  return {
    close: () => {
      watchers.forEach((watcher) => watcher.close());
    },
  };
}
