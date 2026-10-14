# Stoat PTT

An unofficial [Stoat desktop](https://github.com/stoatchat/for-desktop) client for Windows with push-to-talk.

## Use

1. Run `stoat-ptt-setup.exe`, or extract the portable ZIP and run `stoat-ptt.exe`.
2. Sign in, join a voice channel, and leave Stoat's mic **unmuted**.
3. **Hold Mouse 5 / Forward to talk. Release to mute.** Usually the upper side button.

Click the PTT pill at the bottom right to choose Mouse 4, a keyboard key, or a release delay. Works while other apps are focused or Stoat is in the tray. Stoat's manual mute still takes priority.

## Build

Requires Node.js 24 and pnpm 11.25.0.

```powershell
git clone https://github.com/batisanerd/stoat-ptt.git
cd stoat-ptt
pnpm install --frozen-lockfile
pnpm make
```

Installer and ZIP: `out/make/`. Development: `pnpm start`.

Based on Stoat for Desktop. Licensed under [AGPL-3.0](LICENSE).
