# Third-party notices

Best Practice Video Squeeze uses the following open-source components:

- Electron — MIT license: https://github.com/electron/electron
- electron-builder — MIT license: https://github.com/electron-userland/electron-builder
- FFmpeg binaries — license and source information are shipped by the corresponding platform package under `@ffmpeg-installer/*`. FFmpeg licensing depends on the enabled codecs; the build should be distributed with the notices required by the selected binary.
- FFprobe binaries — shipped by the corresponding platform package under `@ffprobe-installer/*`.
- Montserrat and Lora webfont files — distributed through Fontsource packages. See https://fontsource.org/ and the package metadata for license details.

The installer bundles platform-specific FFmpeg and FFprobe binaries only to keep the local workflow one-click. The application does not send video content or telemetry to a remote service.
