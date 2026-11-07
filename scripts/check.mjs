import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import postcss from 'postcss';
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((entry) => entry.name !== 'vendor')
        .map((entry) =>
          entry.isDirectory() ? files(directory + '/' + entry.name) : directory + '/' + entry.name,
        ),
    )
  ).flat();
}
const paths = (
  await Promise.all(['api', 'server', 'public', 'src', 'scripts', 'tests'].map(files))
).flat();
for (const path of paths.filter((path) => /\.(m?js)$/.test(path))) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (result.status) {
    process.stderr.write(result.stderr);
    process.exit(result.status);
  }
}
for (const path of paths.filter((path) => path.endsWith('.css')))
  postcss.parse(await readFile(path, 'utf8'), { from: path });
console.log('All source JavaScript and CSS parsed successfully.');
