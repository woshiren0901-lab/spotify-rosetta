# Spotify Rosetta

Spotify Rosetta is a GPL-3.0 Spicetify extension for Windows that adds existing human Chinese translations to Spotify's native lyrics surfaces. When Spotify has no lyrics, it can also fill the gap with a strictly matched same-source original.

## Features

- Keeps Spotify's native lyrics, scrolling, and line highlighting.
- Supports line-level and word-level translations when available.
- Shows verified provider originals in the Now Playing fallback when Spotify has no lyrics and the song itself has no Chinese translation.
- Places the fallback directly below track metadata and above artist biography, with large native-lyrics-style typography.
- Shows an optional truly transparent in-Spotify lyrics overlay with the previous line, current line, and next two lines. Untimed lyrics advance by playback progress but never become clickable.
- Can additionally open a separate always-on-top Document Picture-in-Picture lyrics window. Chromium does not support transparency for that window type, so it keeps an opaque dark background.
- Supports click-to-seek on native lyric translations, Now Playing fallback lines, and desktop lyric lines.
- Uses exact ISRC and metadata identity checks, then verifies the source lyric sequence.
- Supports NetEase, QQ Music, Musixmatch, LyricsTranslate, curated bilingual web pages, and local LRC/JSON imports.
- Binds manual-search candidates to the track that was playing when the search started, preventing stale lyrics from being applied after a song change.
- Does not include machine translation, AI translation, or generated lyric completion.

## Documentation

See [readme.txt](readme.txt) for installation, usage, data sources, limitations, rollback instructions, and license attribution.

## Install

Build the extension with `npm run build`, copy `dist/spotify-rosetta.js` to Spicetify's Extensions directory, then run `spicetify apply`.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
