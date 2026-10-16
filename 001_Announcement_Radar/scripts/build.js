const { spawnSync } = require('child_process');
const path = require('path');

const now = new Date();
const pad = value => String(value).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const output = `release/build-${stamp}`;
const executable = process.execPath;
const builderCli = require.resolve('electron-builder/out/cli/cli.js');

console.log(`\n本次安装包将输出到：${output}\n`);

const result = spawnSync(
  executable,
  [builderCli, '--win', `--config.directories.output=${output}`],
  {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
      ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/'
    }
  }
);

if (result.error) {
  console.error(`无法启动打包工具：${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`\n打包完成：${path.resolve(output)}\n`);
