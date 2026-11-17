import { spawnSync } from 'node:child_process';
const files = [
  'server.mjs', 'shared/model.mjs', 'shared/geometry.mjs',
  'public/js/client.mjs', 'public/js/plot.mjs', 'public/js/display.mjs', 'public/js/admin.mjs',
  'tests/model.test.mjs', 'tests/geometry.test.mjs', 'tests/server.test.mjs',
];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(1);
}
console.log('JavaScript syntax checks passed (' + files.length + ' files).');
