import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';
import path from 'path';
import writePluginImportsFile from './platform/app/.webpack/writePluginImportsFile';
import fs from 'fs';

const SRC_DIR = path.resolve(__dirname, './platform/app/src');
const DIST_DIR = path.resolve(__dirname, './platform/app/dist');
const PUBLIC_DIR = path.resolve(__dirname, './platform/app/public');

// Environment variables (similar to webpack.pwa.js)
const APP_CONFIG = process.env.APP_CONFIG || 'config/default.js';
const PUBLIC_URL = process.env.PUBLIC_URL || '/';

// Add these constants
const NODE_ENV = process.env.NODE_ENV;
const BUILD_NUM = process.env.CIRCLE_BUILD_NUM || '0';
const VERSION_NUMBER = fs.readFileSync(path.join(__dirname, './version.txt'), 'utf8') || '';
const COMMIT_HASH = fs.readFileSync(path.join(__dirname, './commit.txt'), 'utf8') || '';
const PROXY_TARGET = process.env.PROXY_TARGET;
const PROXY_DOMAIN = process.env.PROXY_DOMAIN;
const PROXY_PATH_REWRITE_FROM = process.env.PROXY_PATH_REWRITE_FROM;
const PROXY_PATH_REWRITE_TO = process.env.PROXY_PATH_REWRITE_TO;
const MONAI_PROXY_DOMAIN = process.env.MONAI_PROXY_DOMAIN || 'http://localhost:8002';

// Add port constant
const OHIF_PORT = Number(process.env.OHIF_PORT || 3000);

export default defineConfig({
  source: {
    entry: {
      index: `${SRC_DIR}/index.js`,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.env.NODE_DEBUG': JSON.stringify(process.env.NODE_DEBUG),
      'process.env.DEBUG': JSON.stringify(process.env.DEBUG),
      'process.env.PUBLIC_URL': JSON.stringify(process.env.PUBLIC_URL || '/'),
      'process.env.BUILD_NUM': JSON.stringify(BUILD_NUM),
      'process.env.VERSION_NUMBER': JSON.stringify(VERSION_NUMBER),
      'process.env.COMMIT_HASH': JSON.stringify(COMMIT_HASH),
      'process.env.USE_LOCIZE': JSON.stringify(process.env.USE_LOCIZE || ''),
      'process.env.LOCIZE_PROJECTID': JSON.stringify(process.env.LOCIZE_PROJECTID || ''),
      'process.env.LOCIZE_API_KEY': JSON.stringify(process.env.LOCIZE_API_KEY || ''),
      'process.env.REACT_APP_I18N_DEBUG': JSON.stringify(process.env.REACT_APP_I18N_DEBUG || ''),
    },
  },
  plugins: [pluginReact(), pluginNodePolyfill()],
  tools: {
    rspack: {
      experiments: {
        asyncWebAssembly: true,
      },
      module: {
        rules: [
          {
            test: /\.css$/,
            use: [
              {
                loader: 'postcss-loader',
                options: {
                  postcssOptions: {
                    plugins: {
                      tailwindcss: {},
                      autoprefixer: {},
                    },
                  },
                },
              },
            ],
            type: 'javascript/auto',
          },
          {
            test: /\.wasm$/,
            type: 'asset/resource',
          },
        ],
      },
      resolve: {
        fallback: {
          buffer: require.resolve('buffer'),
        },
      },
      watchOptions: {
        ignored: /node_modules\/@cornerstonejs/,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './platform/app/src'),
      '@components': path.resolve(__dirname, './platform/app/src/components'),
      '@hooks': path.resolve(__dirname, './platform/app/src/hooks'),
      '@routes': path.resolve(__dirname, './platform/app/src/routes'),
      '@state': path.resolve(__dirname, './platform/app/src/state'),
      'dicom-microscopy-viewer':
        'dicom-microscopy-viewer/dist/dynamic-import/dicomMicroscopyViewer.min.js',
    },
  },
  output: {
    copy: [
      // Copy plugin files (handled by writePluginImportsFile)
      ...(writePluginImportsFile(SRC_DIR, DIST_DIR) || []),
      // Copy public directory except config and html-templates
      {
        from: path.resolve(__dirname, 'node_modules/onnxruntime-web/dist'),
        to: `${DIST_DIR}/ort`,
        force: true,
      },
      {
        from: PUBLIC_DIR,
        to: DIST_DIR,
        globOptions: {
          ignore: ['**/config/**', '**/html-templates/**', '.DS_Store'],
        },
      },
      // Copy Google config
      {
        from: path.resolve(PUBLIC_DIR, 'config/google.js'),
        to: 'google.js',
      },
      // Copy app config
      {
        from: path.resolve(PUBLIC_DIR, APP_CONFIG),
        to: 'app-config.js',
      },
      // Copy Dicom Microscopy Viewer files
      {
        from: path.resolve(__dirname, 'node_modules/dicom-microscopy-viewer/dist/dynamic-import'),
        to: DIST_DIR,
        globOptions: {
          ignore: ['**/*.min.js.map'],
        },
      },
    ],
  },
  html: {
    template: path.resolve(PUBLIC_DIR, 'html-templates/index.html'),
    templateParameters: {
      PUBLIC_URL,
    },
  },
  server: {
    port: OHIF_PORT,
    // 启动入口统一交给主页(:8791) —— 由 scripts/start-dev.ps1 打开浏览器，
    // dev server 不再自行弹出 :3000。
    open: false,
    // Configure proxy
    proxy: {
      '/monai': {
        target: MONAI_PROXY_DOMAIN,
        changeOrigin: true,
        pathRewrite: {
          '^/monai': '',
        },
      },
      '/dicomweb': {
        target: 'http://localhost:5000',
      },
      // Default local route: proxy DICOMweb to the docker Orthanc (:8042),
      // mirroring the nginx-orthanc recipe so `yarn dev:fast` works with no
      // extra PROXY_* env vars. Conditional PROXY_TARGET below can override.
      '/pacs': {
        target: 'http://localhost:8042',
        changeOrigin: true,
        pathRewrite: {
          '^/pacs': '',
        },
      },
      // Add conditional proxy based on env vars
      ...(PROXY_TARGET && PROXY_DOMAIN
        ? {
            [PROXY_TARGET]: {
              target: PROXY_DOMAIN,
              changeOrigin: true,
              pathRewrite: {
                [`^${PROXY_PATH_REWRITE_FROM}`]: PROXY_PATH_REWRITE_TO,
              },
            },
          }
        : {}),
    },
    // Configure history API fallback
    historyApiFallback: {
      disableDotRule: true,
      index: `${PUBLIC_URL}index.html`,
    },
  },
});
