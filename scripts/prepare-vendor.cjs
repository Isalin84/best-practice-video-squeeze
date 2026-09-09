const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const tar = require('tar');

const root = path.resolve(__dirname, '..');
const vendorRoot = path.join(root, 'vendor');
const requestedPlatform = process.argv[2] || 'all';

const packageVersions = {
  '@ffmpeg-installer/darwin-arm64': '4.1.5',
  '@ffmpeg-installer/darwin-x64': '4.1.0',
  '@ffmpeg-installer/win32-x64': '4.1.0',
  '@ffprobe-installer/darwin-arm64': '5.0.1',
  '@ffprobe-installer/darwin-x64': '5.1.0',
  '@ffprobe-installer/win32-x64': '5.1.0'
};

const targets = [
  ['darwin-arm64', '@ffmpeg-installer/darwin-arm64', '@ffprobe-installer/darwin-arm64'],
  ['darwin-x64', '@ffmpeg-installer/darwin-x64', '@ffprobe-installer/darwin-x64'],
  ['win32-x64', '@ffmpeg-installer/win32-x64', '@ffprobe-installer/win32-x64']
];

const buildTargets = requestedPlatform === 'mac'
  ? ['darwin-arm64', 'darwin-x64']
  : requestedPlatform === 'win'
    ? ['win32-x64']
    : targets.map(([target]) => target);

async function packagePath(packageName) {
  try {
    const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
    const executableBase = packageName.includes('ffprobe') ? 'ffprobe' : 'ffmpeg';
    const executable = packageName.includes('win32') ? `${executableBase}.exe` : executableBase;
    const localPath = path.join(packageRoot, executable);
    if ((await fs.stat(localPath)).isFile()) return localPath;
  } catch {
    // The package for another target OS/CPU is not installed by npm.
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bp-video-squeeze-'));
  try {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const packageSpec = `${packageName}@${packageVersions[packageName] || 'latest'}`;
    execFileSync(npmCommand, [
      'pack', packageSpec,
      '--cache', path.join(tempRoot, 'npm-cache'),
      '--silent',
      '--pack-destination', tempRoot
    ], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8'
    });
    const files = await fs.readdir(tempRoot);
    const archive = files.find((file) => file.endsWith('.tgz'));
    if (!archive) return null;
    const unpackRoot = path.join(tempRoot, 'unpacked');
    await fs.mkdir(unpackRoot, { recursive: true });
    await tar.x({ file: path.join(tempRoot, archive), cwd: unpackRoot });
    const executableBase = packageName.includes('ffprobe') ? 'ffprobe' : 'ffmpeg';
    const executable = packageName.includes('win32') ? `${executableBase}.exe` : executableBase;
    const executablePath = path.join(unpackRoot, 'package', executable);
    return (await fs.stat(executablePath)).isFile() ? executablePath : null;
  } catch (error) {
    console.warn(`Could not fetch ${packageName}: ${error.message}`);
    return null;
  }
}

async function copyBinary(packageName, targetPath) {
  try {
    if ((await fs.stat(targetPath)).isFile()) return true;
  } catch {
    // Prepare the target only when it is absent or incomplete.
  }
  const sourcePath = await packagePath(packageName);
  if (!sourcePath) {
    console.warn(`Missing vendor binary: ${packageName}`);
    return false;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  if (!targetPath.endsWith('.exe')) await fs.chmod(targetPath, 0o755);
  return true;
}

async function copyFonts() {
  const fontTargets = [
    ['@fontsource/montserrat', path.join(root, 'assets', 'fonts', 'montserrat')],
    ['@fontsource/lora', path.join(root, 'assets', 'fonts', 'lora')]
  ];
  for (const [packageName, target] of fontTargets) {
    try {
      const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
      const source = path.join(packageRoot, 'files');
      await fs.mkdir(target, { recursive: true });
      await fs.cp(source, target, { recursive: true });
    } catch {
      // CSS fallbacks keep the UI usable if a font package changes its file layout.
    }
  }
}

(async () => {
  await fs.mkdir(vendorRoot, { recursive: true });
  for (const [target, ffmpegPackage, ffprobePackage] of targets) {
    if (!buildTargets.includes(target)) continue;
    const directory = path.join(vendorRoot, target);
    await copyBinary(ffmpegPackage, path.join(directory, 'ffmpeg' + (target.startsWith('win32') ? '.exe' : '')));
    await copyBinary(ffprobePackage, path.join(directory, 'ffprobe' + (target.startsWith('win32') ? '.exe' : '')));
  }
  const buildRoot = path.join(vendorRoot, 'build');
  await fs.rm(buildRoot, { recursive: true, force: true });
  for (const target of buildTargets) {
    const source = path.join(vendorRoot, target);
    const destination = path.join(buildRoot, target);
    await fs.cp(source, destination, { recursive: true });
  }
  await copyFonts();
  console.log(`Prepared vendor binaries in ${vendorRoot} (build target: ${requestedPlatform})`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
