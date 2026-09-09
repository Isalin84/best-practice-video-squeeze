const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let mainWindow;
let activeProcess = null;

const STUDIO_URL = 'https://bestpracticeai.ru';

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function executableName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function bundledBinary(name) {
  if (!app.isPackaged) return null;
  const candidate = path.join(process.resourcesPath, 'bin', platformKey(), executableName(name));
  return fs.existsSync(candidate) ? candidate : null;
}

function packageBinary(packageName) {
  try {
    const candidate = require(packageName).path;
    return candidate && fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function systemBinary(name) {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', `${name}.exe`),
        path.join(process.env.ProgramFiles || '', 'ffmpeg', 'bin', `${name}.exe`),
        path.join(process.env.ProgramFiles || '', 'ffmpeg', `${name}.exe`)
      ]
    : [
        `/opt/homebrew/bin/${name}`,
        `/usr/local/bin/${name}`,
        `/usr/bin/${name}`
      ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function resolveBinary(name) {
  const packageName = name === 'ffmpeg'
    ? '@ffmpeg-installer/ffmpeg'
    : '@ffprobe-installer/ffprobe';
  return bundledBinary(name) || packageBinary(packageName) || systemBinary(name);
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#0B1D3A',
    title: 'Best Practice Video Squeeze',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      ...options
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function probeVideo(filePath) {
  const ffprobe = resolveBinary('ffprobe');
  if (!ffprobe) {
    throw new Error('FFprobe не найден. Установите приложение заново или установите FFmpeg.');
  }

  const result = await runProcess(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=codec_type,width,height',
    '-of', 'json',
    filePath
  ]);

  if (result.code !== 0) {
    throw new Error(formatFfmpegError(result.stderr, result.code));
  }

  const data = JSON.parse(result.stdout);
  const videoStream = (data.streams || []).find((stream) => stream.codec_type === 'video') || {};
  const size = Number(data.format?.size || 0);
  const duration = Number(data.format?.duration || 0);

  return {
    path: filePath,
    name: path.basename(filePath),
    bytes: Number.isFinite(size) ? size : 0,
    duration: Number.isFinite(duration) ? duration : 0,
    width: Number(videoStream.width || 0),
    height: Number(videoStream.height || 0)
  };
}

function outputFileName(inputPath, preset, extension) {
  const parsed = path.parse(inputPath);
  const labels = {
    telegramQuick: 'Telegram быстро',
    telegramBalanced: 'Telegram баланс',
    quality: 'Качество',
    tiny: 'Минимальный файл'
  };
  const suffix = labels[preset] || 'Best Practice';
  return `${parsed.name} — ${suffix}.${extension}`;
}

async function uniqueOutputPath(inputPath, outputDirectory, preset, extension) {
  const originalName = outputFileName(inputPath, preset, extension);
  const parsed = path.parse(originalName);
  let candidate = path.join(outputDirectory, originalName);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDirectory, `${parsed.name} ${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function buildCompressionArgs(inputPath, outputPath, settings) {
  const maxWidth = {
    source: null,
    hd1080: 1920,
    hd720: 1280,
    sd480: 854
  }[settings.resolution] ?? 1920;

  // force_divisible_by=2 fixes the exact failure from macOS screen captures:
  // a 3852×2168 file may become 1919×1080, which libx264 rejects.
  const scale = maxWidth
    ? `scale=w=min(${maxWidth}\\,iw):h=-2:force_original_aspect_ratio=decrease:force_divisible_by=2`
    : 'scale=w=iw:h=ih:force_divisible_by=2';

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', inputPath,
    '-map', '0:v:0'
  ];

  if (settings.includeAudio) {
    args.push('-map', '0:a?');
  } else {
    args.push('-an');
  }

  args.push(
    '-vf', scale,
    '-r', settings.preset === 'quality' ? '60' : '30',
    '-map_metadata', '-1',
    '-avoid_negative_ts', 'make_zero'
  );

  if (settings.format === 'webm') {
    args.push(
      '-c:v', 'libvpx-vp9',
      '-crf', String(settings.quality),
      '-b:v', '0',
      '-deadline', 'good',
      '-cpu-used', '4'
    );
    if (settings.includeAudio) args.push('-c:a', 'libopus', '-b:a', '96k');
  } else {
    args.push(
      '-c:v', 'libx264',
      '-preset', settings.preset === 'telegramQuick' ? 'fast' : 'medium',
      '-crf', String(settings.quality),
      '-pix_fmt', 'yuv420p',
      '-tag:v', 'avc1'
    );
    if (settings.includeAudio) {
      args.push('-c:a', 'aac', '-b:a', settings.preset === 'tiny' ? '64k' : '128k');
    }
    if (settings.format === 'mp4') args.push('-movflags', '+faststart');
  }

  args.push(
    '-metadata', 'comment=Created with Best Practice Video Squeeze',
    '-progress', 'pipe:1',
    '-nostats',
    outputPath
  );
  return args;
}

function formatFfmpegError(stderr, code) {
  const text = String(stderr || '').trim();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const useful = lines.slice(-6).join(' ');
  if (/not divisible by 2/i.test(text)) {
    return 'Видео имеет нечётный размер кадра. Версия исправлена: кадр автоматически выравнивается под H.264.';
  }
  return useful || `FFmpeg завершился с ошибкой (код ${code}).`;
}

async function compressVideo({ inputPath, outputDirectory, settings }) {
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) {
    throw new Error('FFmpeg не найден. Установите приложение заново или установите FFmpeg.');
  }
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('Исходный файл не найден.');

  const directory = outputDirectory && fs.existsSync(outputDirectory)
    ? outputDirectory
    : path.dirname(inputPath);
  const extension = settings.format || 'mp4';
  const outputPath = await uniqueOutputPath(inputPath, directory, settings.preset, extension);
  const inputStat = await fsp.stat(inputPath);

  const child = spawn(ffmpeg, buildCompressionArgs(inputPath, outputPath, settings), {
    windowsHide: true
  });
  activeProcess = child;

  let progressBuffer = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    progressBuffer += chunk.toString();
    const lines = progressBuffer.split(/\r?\n/);
    progressBuffer = lines.pop() || '';
    for (const line of lines) {
      const match = line.match(/^out_time_(?:ms|us)=(\d+(?:\.\d+)?)/);
      if (match) {
        const duration = Number(settings.duration || 0);
        const divisor = line.startsWith('out_time_us=') ? 1_000_000 : 1_000_000;
        if (duration > 0) {
          sendToRenderer('compression-progress', Math.min(0.99, Math.max(0, Number(match[1]) / divisor / duration)));
        }
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  activeProcess = null;

  if (result.signal || result.code !== 0) {
    await fsp.rm(outputPath, { force: true }).catch(() => {});
    throw new Error(formatFfmpegError(stderr, result.code));
  }

  const outputStat = await fsp.stat(outputPath);
  return {
    outputPath,
    originalBytes: inputStat.size,
    outputBytes: outputStat.size
  };
}

ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите видео',
    properties: ['openFile'],
    filters: [
      { name: 'Видео', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpeg', 'mpg'] },
      { name: 'Все файлы', extensions: ['*'] }
    ]
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle('choose-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Куда сохранить сжатое видео?',
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle('analyze-video', async (_event, filePath) => probeVideo(filePath));
ipcMain.handle('compress-video', async (_event, payload) => compressVideo(payload));

ipcMain.handle('cancel-compression', () => {
  if (activeProcess && !activeProcess.killed) activeProcess.kill();
  return true;
});

ipcMain.handle('reveal-output', async (_event, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
});

ipcMain.handle('open-studio', () => shell.openExternal(STUDIO_URL));
ipcMain.handle('get-runtime-info', () => ({
  ffmpeg: Boolean(resolveBinary('ffmpeg')),
  platform: process.platform,
  arch: process.arch,
  studioUrl: STUDIO_URL
}));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
