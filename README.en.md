# DSH Glass Theme & Productivity

[中文](README.md) · [Downloads](https://github.com/tszmzz1026/dsh-epindel-boot-animation/releases/latest)

An original CSS glass theme and a productivity center for DeepSeek Harness. **No game images, characters, models, animation clips, voices or music are included.** Backgrounds and assistant marks use CSS gradients and geometry. Screenshots use isolated demo data.

![Code-only DSH demo](docs/overview.png)

## What changed in 2.1.1

- Stream wallpaper uploads to disk with bounded buffering. Interrupted uploads preserve the last complete wallpaper; concurrent edits return a retry message.
- Lock duplicate upload actions, keep the current wallpaper if clearing fails, and prevent a delayed startup restore from replacing a new upload.
- Pause video in hidden windows and resume according to the saved playback setting; respect reduced motion.
- Validate video ranges, retain legacy wallpaper compatibility, and back up profile metadata and installation records before removing conflicting plugins. Verify the exact source repository and package directory.

Theme `1.1.1`; productivity remains `1.3.1`. The beauty, extensions and full ZIPs can still be installed separately.

### Included 2.1.0 repairs

| Change | Detail |
| --- | --- |
| Unique package identity | The theme package is now `dsh-glass-aurum` instead of `dsh-glass-theme`. Another author (`cnayu`) publishes a package with that same name (`1.0.2`); a market upgrade replaced this theme with that code, which made the sidebar blue, the input no longer gold, and the top-right "主题" entry disappear. A unique name removes the collision. Disable or uninstall the old package name first. |
| Installer identity checks | Installs verify package name and repository, and stop with a clear message when a same-name dependency comes from another source. Re-run with `--replace-conflict` to remove it first. |
| Image / video wallpaper | The theme panel has a new wallpaper section: local image or video backgrounds with opacity, blur, fit, mute, volume and pause. The host stores the file under `plugin-data/dsh-glass-aurum`, so it does not consume browser storage and survives cache clearing. |
| Safer copying | Recursive `fs.cpSync` crashes on some Windows Node builds, so the installer copies file by file. |

"Generate a theme from an image" is intentionally not shipped. It is left to you, implemented with your own DeepSeek Harness + API; the theme side already exposes the integration point. See the [theme package notes](packages/dsh-glass-aurum/README.md).

## Install

Choose the beauty, extensions or full ZIP from the latest release. Extract it and run `install-desktop.cmd`; after current tasks finish, fully quit DSH from the tray and relaunch. Disable an existing third-party theme before enabling the new theme. Installers back up profile metadata and do not copy API keys, model settings or chat history.

The theme adds glass surfaces, gold input text, code colors, card navigation and image/video wallpapers. Productivity adds main/side chats, local memory with real save status, goals, tasks, daily plans, full-text search, checkpoints, context controls, cleanup requests and Markdown summaries. Model-assisted features use your own API configuration. No background extraction model or cross-device sync is added.

Tested on Windows / DSH Desktop 0.12.0 / Harness 0.2.0-rc.2. Use `node scripts/setup.mjs`, `node scripts/install-suite.mjs --check`, then `node scripts/install-suite.mjs`. Select `--bundle beauty`, `extensions` or `full`. Run with `--uninstall` to remove only that selection.

Code is MIT licensed. This release contains original UI code, functional extensions, installers and demo screenshots without third-party game content. Independent of DeepSeek.
