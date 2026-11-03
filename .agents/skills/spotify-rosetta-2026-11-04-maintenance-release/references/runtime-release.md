# Runtime, Tests, and Release

## DOM strategy

- First support Spotify's native right-side lyrics surface.
- Also support the fullscreen native lyrics surface.
- When no native lyrics surface exists or Spotify renders an empty/no-lyrics
  state, use the project-owned Now Playing section.
- Do not insert the Now Playing fallback when native lyric content is present;
  doing so creates duplicate lyrics.
- Observe Spotify re-renders and re-place the project container idempotently.
- Never remove or directly replace React-owned native lyric nodes merely to test
  a fallback; DOM removal can destabilize Spotify. Verify no-native behavior with
  synthetic DOM fixtures and, when possible, a genuinely lyric-less track.

Current Spotify versions hash the old `main-nowPlayingView-*` classes. Also
support:

- `#Desktop_PanelContainer_Id`
- `[data-npv-root="true"]`
- `aside[aria-label*="当前播放"]`
- `aside[aria-label*="Now Playing" i]`

Locate the track information block by following the title link to an ancestor
that also contains an artist link, then insert after that block. Keep the old
class-based selectors as fallbacks.

## Build and local install

```powershell
npm run typecheck
npm test
npm run build
Copy-Item .\dist\spotify-rosetta.js "$env:APPDATA\spicetify\Extensions\spotify-rosetta.js" -Force
spicetify apply --no-restart
```

Restart Spotify after copying the bundle. Keep Spotify normal at completion:

- Debugging port, when needed: `--remote-debugging-port=9223`
- Never use `--remote-allow-origins=*`; it weakens the authenticated DevTools
  session and is unnecessary for the local CDP helper.
- Verify the installed bundle hash matches `dist`.
- Finish with Spotify running normally and port `9223` not listening.

## Test expectations

Cover behavior, not wording snapshots:

- native right panel and fullscreen injection;
- no duplicate insertion during React re-render;
- Now Playing fallback only when native lyrics are absent/empty;
- cleanup on disable and song change;
- provider identity and lyric-sequence rejection;
- cache behavior and language-version conflicts.

## GitHub release

- Repository: `woshiren0901-lab/spotify-rosetta`
- Network may require local HTTP proxy `127.0.0.1:7897`.
- Git Credential Manager can provide the GitHub OAuth token without printing it.
- Push the tested `main` commit before creating the Release.
- Create a ZIP containing source, tests, scripts, build output, license, package
  metadata, and README.
- Upload the ZIP as a Release asset and verify its state is `uploaded`.
- The project is GPL-3.0-only.

## Documentation boundary

Keep detailed installation, usage, privacy, and source attribution in
`readme.txt`. The last section must remain `现有平台与开源项目`. Add any new
platform/open-source dependency there with purpose, link, and license boundary.
