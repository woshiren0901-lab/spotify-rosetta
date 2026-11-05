---
name: spotify-rosetta-2026-11-04-maintenance-release
description: "Maintain and release Spotify Rosetta in this repository, including provider identity, human-translation sourcing, language-version matching, native, Now Playing, and desktop lyric injection, tests, packaging, and GitHub releases."
metadata:
  short-description: "Spotify Rosetta project maintenance"
  project: "spotify-rosetta"
  created: "2026-11-04"
---

# Spotify Rosetta Maintenance and Release

This skill belongs to `spotify-rosetta` and applies to work in
`D:\Spotify Rosetta`. Do not apply it to unrelated Spotify or Spicetify
projects.

## Product invariants

- Only display lyrics and Chinese translations that already exist online or
  were explicitly imported by the user.
- Never add machine translation, AI translation, generated missing lines, or
  cross-provider original/translation splicing.
- Preserve Spotify's native lyrics and scrolling when the native lyrics surface
  exists. Use the custom Now Playing section only when Spotify has no lyrics
  surface or shows an empty/no-lyrics state.
- Keep the transparent in-Spotify desktop lyrics overlay limited to the
  previous/current/next-two lines and synchronized with playback. Untimed
  lyrics may advance by estimated progress but must never become seekable.
  Keep the optional Document Picture-in-Picture mode explicitly marked as an
  opaque Chromium window.
- Treat recordings, language versions, covers, live versions, and remixes as
  distinct identities. A correct title alone is not a match.
- Keep `readme.txt`'s final section titled `现有平台与开源项目`; no content may
  follow that section.

## Route by work type

- For provider search, matching, version checks, translation eligibility, or
  sequence alignment, read
  [references/provider-matching.md](references/provider-matching.md).
- For DOM injection, tests, Windows installation, local debugging, packaging, or
  GitHub release steps, read
  [references/runtime-release.md](references/runtime-release.md).

## Verification

For code changes:

```powershell
npm run typecheck
npm test
npm run build
```

Add regression tests for the actual failure class before considering a fix
complete. When the extension is installed, copy
`dist\spotify-rosetta.js` to the Spicetify Extensions directory and run
`spicetify apply --no-restart`. Use the local debugging port only through
`127.0.0.1`; do not add wildcard DevTools-origin options. Finish with Spotify
running normally and the debugging port closed.

Bump the version when behavior changes, keep the ZIP release asset in sync, and
record any new external platform or source in the final README section with its
link and license/usage boundary.
