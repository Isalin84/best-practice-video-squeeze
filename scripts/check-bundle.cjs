const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const platform = `${process.platform}-${process.arch}`;
const resources = process.platform === 'win32'
  ? path.resolve('dist/win-unpacked/resources')
  : path.resolve(`dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Best Practice Video Squeeze.app/Contents/Resources`);
const archive = path.join(resources, 'app.asar');
if (process.platform === 'darwin') execFileSync('codesign', ['--verify', '--deep', '--strict', path.dirname(path.dirname(resources))]);
for (const name of ['src/index.html', 'src/styles.css', 'src/renderer.js', 'electron/preload.cjs', 'assets/app-icon.png']) {
  if (!asar.extractFile(archive, name).length) throw new Error(`Missing packaged asset: ${name}`);
}
const suffix = process.platform === 'win32' ? '.exe' : '';
const bin = name => path.join(resources, 'bin', platform, name + suffix);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'video-squeeze-check-'));
const output = path.join(tmp, 'check.mp4');
execFileSync(bin('ffmpeg'), ['-v','error','-f','lavfi','-i','testsrc=size=321x181:rate=30','-t','1','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',output]);
const info = JSON.parse(execFileSync(bin('ffprobe'), ['-v','error','-show_streams','-of','json',output], {encoding:'utf8'}));
if (info.streams[0].codec_name !== 'h264' || info.streams[0].width % 2 || info.streams[0].height % 2) throw new Error('Invalid compression output');
execFileSync(bin('ffmpeg'), ['-v','error','-i',output,'-f','null','-']);
console.log(`Packaged assets and FFmpeg encode/decode passed: ${platform}`);
