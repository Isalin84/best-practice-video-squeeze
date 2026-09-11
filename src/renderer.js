const PRESETS = {
  telegramQuick: { quality: 25, resolution: 'hd720', badge: 'БЫСТРЕЕ' },
  telegramBalanced: { quality: 23, resolution: 'hd1080', badge: 'СОВЕТУЮ' },
  quality: { quality: 20, resolution: 'source', badge: 'ЧЁТЧЕ' },
  tiny: { quality: 28, resolution: 'sd480', badge: 'ЛЕГЧЕ' }
};

const state = {
  preset: 'telegramBalanced',
  format: 'mp4',
  resolution: 'hd1080',
  quality: 23,
  includeAudio: true,
  selectedPath: null,
  metadata: null,
  outputDirectory: null,
  isCompressing: false,
  lastOutputPath: null
};

const $ = (id) => document.getElementById(id);
const videoInput = $('videoInput');
const dropZone = $('dropZone');

function friendlyFileSize(bytes) {
  if (!bytes) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = Number(bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return index === 0 ? `${Math.round(value)} ${units[index]}` : `${value.toFixed(1)} ${units[index]}`;
}

function friendlyDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 6000);
}

function setStatus(text, note = 'Файл останется на этом компьютере', type = 'ready') {
  $('statusText').textContent = text;
  $('statusNote').textContent = note;
  $('statusDot').style.backgroundColor = type === 'error' ? 'var(--bp-carmine)' : type === 'working' ? 'var(--bp-amber)' : 'var(--bp-verde)';
}

function qualityLabel(value) {
  if (value < 21) return 'почти без потерь';
  if (value <= 23) return 'высокое качество';
  if (value <= 26) return 'сбалансировано';
  return 'максимально компактно';
}

function refreshQuality() {
  state.quality = Number($('qualityRange').value);
  $('qualityValue').textContent = `CRF ${state.quality} · ${qualityLabel(state.quality)}`;
}

function refreshOutputName() {
  if (!state.selectedPath) {
    $('outputName').textContent = '—';
    return;
  }
  const parts = state.selectedPath.split(/[\\/]/);
  const name = parts[parts.length - 1] || 'video';
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const labels = {
    telegramQuick: 'Telegram быстро',
    telegramBalanced: 'Telegram баланс',
    quality: 'Качество',
    tiny: 'Минимальный файл'
  };
  $('outputName').textContent = `${base} — ${labels[state.preset]}.${state.format}`;
}

function refreshControls() {
  document.querySelectorAll('.settings-panel button, .settings-panel input, .settings-panel select, #clearSourceButton, #selectVideoButton, #repeatButton').forEach(el => { el.disabled = state.isCompressing; });
  const hasVideo = Boolean(state.selectedPath && state.metadata);
  $('compressButton').disabled = !hasVideo || state.isCompressing;
  $('compressButton').innerHTML = state.isCompressing ? '<span aria-hidden="true">◌</span> Сжимаю…' : '<span aria-hidden="true">↯</span> Сжать видео';
  $('stopButton').hidden = !state.isCompressing;
  $('progressTrack').hidden = !state.isCompressing;
  refreshOutputName();
}

async function loadVideo(filePath) {
  if (!filePath || state.isCompressing) return;
  state.selectedPath = filePath;
  state.metadata = null;
  state.lastOutputPath = null;
  $('dropZone').hidden = true;
  $('sourceReady').hidden = false;
  $('sourceName').textContent = filePath.split(/[\\/]/).pop();
  $('sourcePath').textContent = filePath;
  $('sourceSize').textContent = '…';
  $('sourceDuration').textContent = '…';
  $('sourceFrame').textContent = '…';
  $('resultPanel').hidden = true;
  setStatus('Читаю свойства видео…');
  refreshControls();

  try {
    state.metadata = await window.videoSqueeze.analyzeVideo(filePath);
    $('sourceSize').textContent = friendlyFileSize(state.metadata.bytes);
    $('sourceDuration').textContent = friendlyDuration(state.metadata.duration);
    $('sourceFrame').textContent = state.metadata.width && state.metadata.height ? `${state.metadata.width}×${state.metadata.height}` : '—';
    $('outputFolder').textContent = state.outputDirectory || filePath.split(/[\\/]/).slice(0, -1).join('/') || 'Папка исходного видео';
    setStatus('Готово к сжатию');
  } catch (error) {
    state.selectedPath = null;
    state.metadata = null;
    $('dropZone').hidden = false;
    $('sourceReady').hidden = true;
    setStatus('Файл не удалось прочитать', 'Выберите другое видео', 'error');
    showToast(error.message || 'Не удалось прочитать видео.');
  }
  refreshControls();
}

function clearVideo() {
  if (state.isCompressing) return;
  state.selectedPath = null;
  state.metadata = null;
  state.lastOutputPath = null;
  $('dropZone').hidden = false;
  $('sourceReady').hidden = true;
  $('resultPanel').hidden = true;
  setStatus('Выберите видео, чтобы начать');
  refreshControls();
}

function setPreset(preset) {
  state.preset = preset;
  const config = PRESETS[preset];
  state.resolution = config.resolution;
  $('qualityRange').value = config.quality;
  $('resolutionSelect').value = config.resolution;
  document.querySelectorAll('.preset-row').forEach((row) => row.classList.toggle('is-selected', row.dataset.preset === preset));
  refreshQuality();
  refreshOutputName();
}

async function compress() {
  if (!state.selectedPath || !state.metadata || state.isCompressing) return;
  state.isCompressing = true;
  $('resultPanel').hidden = true;
  $('progressFill').style.width = '0%';
  setStatus('Сжимаю видео…', 'Приложение работает локально', 'working');
  refreshControls();

  try {
    const result = await window.videoSqueeze.compressVideo({
      inputPath: state.selectedPath,
      outputDirectory: state.outputDirectory || null,
      settings: {
        preset: state.preset,
        format: state.format,
        resolution: state.resolution,
        quality: state.quality,
        includeAudio: state.includeAudio,
        duration: state.metadata.duration
      }
    });
    state.lastOutputPath = result.outputPath;
    state.isCompressing = false;
    const saved = result.originalBytes > 0 ? Math.max(0, Math.round((1 - result.outputBytes / result.originalBytes) * 100)) : 0;
    $('resultSummary').textContent = `${friendlyFileSize(result.outputBytes)} вместо ${friendlyFileSize(result.originalBytes)}`;
    $('resultPercent').textContent = `−${saved}%`;
    $('resultPanel').hidden = false;
    $('progressFill').style.width = '100%';
    setStatus(`Готово · сохранено ${saved}%`, 'Файл останется на этом компьютере');
    refreshControls();
  } catch (error) {
    state.isCompressing = false;
    refreshControls();
    setStatus('Сжатие не завершено', 'Проверьте файл или выберите другой профиль', 'error');
    showToast(error.message || 'FFmpeg не смог обработать файл.');
  }
}

async function selectVideo() {
  if (state.isCompressing) return;
  try { await loadVideo(await window.videoSqueeze.selectVideo()); }
  catch (error) { showToast(error.message); }
}

function setupEvents() {
  $('selectVideoButton').addEventListener('click', selectVideo);
  dropZone.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    selectVideo();
  });
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectVideo(); }
  });
  videoInput.addEventListener('change', () => {
    const file = videoInput.files?.[0];
    if (file) loadVideo(window.videoSqueeze.pathForFile(file));
  });
  ['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault(); dropZone.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault(); dropZone.classList.remove('is-dragging');
  }));
  dropZone.addEventListener('drop', (event) => {
    const file = event.dataTransfer.files?.[0];
    if (file) loadVideo(window.videoSqueeze.pathForFile(file));
  });
  $('clearSourceButton').addEventListener('click', clearVideo);
  document.querySelectorAll('.preset-row').forEach((row) => row.addEventListener('click', () => setPreset(row.dataset.preset)));
  $('formatSelect').addEventListener('change', (event) => { state.format = event.target.value; refreshOutputName(); });
  $('resolutionSelect').addEventListener('change', (event) => { state.resolution = event.target.value; });
  $('qualityRange').addEventListener('input', refreshQuality);
  $('audioToggle').addEventListener('change', (event) => { state.includeAudio = event.target.checked; });
  $('chooseFolderButton').addEventListener('click', async () => {
    const folder = await window.videoSqueeze.chooseOutputFolder();
    if (folder) { state.outputDirectory = folder; $('outputFolder').textContent = folder; }
  });
  $('compressButton').addEventListener('click', compress);
  $('stopButton').addEventListener('click', async () => { await window.videoSqueeze.cancelCompression(); });
  $('revealButton').addEventListener('click', () => state.lastOutputPath && window.videoSqueeze.revealOutput(state.lastOutputPath));
  $('openResultButton').addEventListener('click', () => state.lastOutputPath && window.videoSqueeze.openOutput(state.lastOutputPath));
  $('repeatButton').addEventListener('click', compress);
  $('studioHeaderLink').addEventListener('click', () => window.videoSqueeze.openStudio());
  $('studioFooterLink').addEventListener('click', () => window.videoSqueeze.openStudio());
  window.videoSqueeze.onProgress((value) => { $('progressFill').style.width = `${Math.round(value * 100)}%`; });
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!window.videoSqueeze) {
    document.querySelector('.app-shell').hidden = true;
    const message = document.createElement('main');
    message.style.cssText = 'max-width:640px;margin:15vh auto;padding:32px;line-height:1.7';
    message.innerHTML = '<h1>Запустите Video Squeeze.app</h1><p>Это внутренний экран приложения. В браузере он не может выбирать и сжимать видео.</p><p>Откройте приложение «Video Squeeze» на рабочем столе или в папке Documents → Local VideoCompressor.</p>';
    document.body.append(message);
    return;
  }
  setupEvents();
  setPreset(state.preset);
  refreshQuality();
  refreshControls();
  const info = await window.videoSqueeze.getRuntimeInfo();
  if (!info.ffmpeg) {
    $('compressButton').disabled = true;
    setStatus('FFmpeg не найден', 'Установите приложение заново', 'error');
    showToast('В сборке нет FFmpeg. Пересоберите установщик или установите FFmpeg отдельно.');
  }
});
