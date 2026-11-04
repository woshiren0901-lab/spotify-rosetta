# Spotify Rosetta

Spotify Rosetta is a GPL-3.0 Spicetify extension for Windows that adds existing human Chinese translations to Spotify's native lyrics surfaces. When Spotify has no lyrics, it can also fill the gap with a strictly matched same-source original.

## Features

- Keeps Spotify's native lyrics, scrolling, and line highlighting.
- Supports line-level and word-level translations when available.
- Shows verified provider originals in the Now Playing fallback when Spotify has no lyrics and the song itself has no Chinese translation.
- Places the fallback directly below track metadata and above artist biography, with large native-lyrics-style typography.
- Uses exact ISRC and metadata identity checks, then verifies the source lyric sequence.
- Supports NetEase, QQ Music, Musixmatch, LyricsTranslate, curated bilingual web pages, and local LRC/JSON imports.
- Does not include machine translation, AI translation, or generated lyric completion.

## Documentation

See [readme.txt](readme.txt) for installation, usage, data sources, limitations, rollback instructions, and license attribution.

## Install

Build the extension with `npm run build`, copy `dist/spotify-rosetta.js` to Spicetify's Extensions directory, then run `spicetify apply`.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
