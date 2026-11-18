// Purpose: Enforce frontend dependency direction and feature public entry points.
// Pattern: Development-only graph checks; production bundles contain no audit tooling.
// Usage: pnpm --filter @prem/frontend check:architecture.
// Related: src/app/, src/features/*/index.ts, ../scripts/quality/source-size.mjs.
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const features = readdirSync(join(__dirname, 'src/features'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
module.exports = {
  forbidden: [
    {
      name: 'no-circular-source',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^src/', circular: true },
    },
    {
      name: 'no-unresolved',
      severity: 'error',
      from: { path: '^src/' },
      to: { couldNotResolve: true },
    },
    {
      name: 'shared-stays-independent',
      severity: 'error',
      from: { path: '^src/(shared|components)/' },
      to: { path: '^src/(app|pages|features)/' },
    },
    {
      name: 'features-do-not-import-pages',
      severity: 'error',
      from: { path: '^src/features/' },
      to: { path: '^src/(app|pages)/' },
    },
    {
      name: 'pages-do-not-import-app',
      severity: 'error',
      from: { path: '^src/pages/' },
      to: { path: '^src/app/' },
    },
    ...features.map((feature) => ({
      name: `${feature}-uses-peer-facades`,
      severity: 'error',
      from: { path: `^src/features/${feature}/` },
      to: {
        path: '^src/features/',
        pathNot: [`^src/features/${feature}/`, '^src/features/[^/]+/index\\.tsx?$', '\\.css$'],
      },
    })),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.app.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      conditionNames: ['types', 'import', 'require', 'node', 'browser', 'default'],
      exportsFields: ['exports'],
    },
  },
};
