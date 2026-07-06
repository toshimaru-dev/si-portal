const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const watchLogPlugin = {
  name: 'watch-log',
  setup(build) {
    build.onStart(() => {
      console.log('esbuild: build started');
    });
    build.onEnd((result) => {
      if (result.errors.length === 0) {
        console.log('esbuild: build finished');
      }
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
};

/** @type {import('esbuild').BuildOptions} */
const webviewJsConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/webview.js',
  sourcemap: true,
};

/** @type {import('esbuild').BuildOptions} */
const webviewCssConfig = {
  entryPoints: ['src/webview/style.css'],
  bundle: true,
  outfile: 'dist/webview.css',
};

async function run() {
  const configs = [extensionConfig, webviewJsConfig, webviewCssConfig];
  if (watch) {
    const withPlugin = configs.map((c) => ({
      ...c,
      plugins: [...(c.plugins ?? []), watchLogPlugin],
    }));
    const contexts = await Promise.all(withPlugin.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    console.log('esbuild: build complete');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
