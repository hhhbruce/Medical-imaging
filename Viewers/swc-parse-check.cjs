// Parse-check AgentFlowViz.tsx (and friends) with the same SWC compiler Rsbuild uses.
const { transformSync } = require('@swc/core');
const fs = require('fs');

const files = [
  'extensions/default/src/utils/AgentFlowViz.tsx',
  'extensions/default/src/utils/Toolbox.tsx',
  'extensions/default/src/commandsModule.ts',
];

let failed = false;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  try {
    transformSync(src, {
      filename: f,
      jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022' },
    });
    console.log(`[OK]   ${f}`);
  } catch (e) {
    failed = true;
    console.log(`[FAIL] ${f}`);
    console.log(String(e && e.message ? e.message : e).split('\n').slice(0, 14).join('\n'));
  }
}
process.exit(failed ? 1 : 0);
