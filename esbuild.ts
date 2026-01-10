import esbuild from "esbuild";
import type { BuildOptions, Plugin } from "esbuild";
import process from "node:process";
import fs from "node:fs";

const run = async () => {
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

  console.log("Build completed.");
};

if (process.argv.includes("--dev")) {
  await run();
  console.log("Watching files for changes...");
  watchFiles(["src/**/*"], (eventType, filename) => {
    if (!eventType) return;
    console.log(`${filename} changed (${eventType}), rebuilding...`);
    run().catch(console.error);
  });
} else {
  console.log("Building...");
  run().catch(() => process.exit(1));
}

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
