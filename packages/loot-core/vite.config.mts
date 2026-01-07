import path from 'path';
import { createRequire } from 'module';

import alias from '@rollup/plugin-alias';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import peggyLoader from 'vite-plugin-peggy-loader';

const require = createRequire(import.meta.url);

// Pre-resolve shim paths for pnpm linker compatibility
const shimPaths = {
  process: require.resolve('vite-plugin-node-polyfills/shims/process'),
  buffer: require.resolve('vite-plugin-node-polyfills/shims/buffer'),
  global: require.resolve('vite-plugin-node-polyfills/shims/global'),
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  const outDir = path.resolve(__dirname, 'lib-dist/browser');
  const crdtDir = path.resolve(__dirname, '../crdt');

  return {
    mode,
    base: '/kcab/',
    build: {
      target: 'es2020',
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.resolve(__dirname, 'src/server/main.ts'),
        name: 'backend',
        formats: ['iife'],
        fileName: () =>
          isDev ? 'kcab.worker.dev.js' : `kcab.worker.[hash].js`,
      },
      rollupOptions: {
        plugins: [
          alias({
            entries: [
              { find: 'vite-plugin-node-polyfills/shims/process', replacement: shimPaths.process },
              { find: 'vite-plugin-node-polyfills/shims/buffer', replacement: shimPaths.buffer },
              { find: 'vite-plugin-node-polyfills/shims/global', replacement: shimPaths.global },
            ],
          }),
        ],
        onwarn(warning, warn) {
          // Suppress sourcemap warnings from peggy-loader
          if (
            warning.plugin === 'peggy-loader' &&
            warning.message?.includes('Sourcemap')
          ) {
            return;
          }

          // Use default warning handler for other warnings
          warn(warning);
        },
        output: {
          chunkFileNames: isDev
            ? '[name].kcab.worker.dev.js'
            : '[id].[name].kcab.worker.[hash].js',
          format: 'iife',
          name: 'backend',
          globals: {
            buffer: 'Buffer',
            'process/browser': 'process',
          },
        },
        external: [],
      },
      sourcemap: true,
      minify: isDev ? false : 'terser',
      terserOptions: {
        compress: {
          drop_debugger: false,
        },
        mangle: false,
      },
    },
    resolve: {
      extensions: [
        '.web.js',
        '.web.ts',
        '.web.tsx',
        '.js',
        '.ts',
        '.tsx',
        '.json',
      ],
      alias: {
        // Resolve vite-plugin-node-polyfills shims for pnpm linker compatibility
        'vite-plugin-node-polyfills/shims/process': require.resolve(
          'vite-plugin-node-polyfills/shims/process',
        ),
        'vite-plugin-node-polyfills/shims/buffer': require.resolve(
          'vite-plugin-node-polyfills/shims/buffer',
        ),
        'vite-plugin-node-polyfills/shims/global': require.resolve(
          'vite-plugin-node-polyfills/shims/global',
        ),
        // CRDT package alias
        '@actual-app/crdt': path.resolve(crdtDir, 'src'),
      },
    },
    define: {
      'process.env': '{}',
      'process.env.IS_DEV': JSON.stringify(isDev),
      'process.env.PUBLIC_URL': JSON.stringify(process.env.PUBLIC_URL || '/'),
      'process.env.ACTUAL_DATA_DIR': JSON.stringify('/'),
      'process.env.ACTUAL_DOCUMENT_DIR': JSON.stringify('/documents'),
    },
    plugins: [
      peggyLoader(),
      nodePolyfills({
        include: [
          'process',
          'stream',
          'path',
          'zlib',
          'fs',
          'assert',
          'buffer',
        ],
        globals: {
          process: true,
          global: true,
        },
      }),
      visualizer({ template: 'raw-data', filename: `${outDir}/stats.json` }),
    ],
    optimizeDeps: {
      include: [
        'buffer',
        'process',
        'assert',
        'path-browserify',
        'stream-browserify',
        'browserify-zlib',
      ],
    },
  };
});
