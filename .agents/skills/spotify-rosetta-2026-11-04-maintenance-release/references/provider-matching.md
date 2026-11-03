# Provider Matching Rules

## Recording identity

Use identity signals in this order:

1. Exact ISRC when both Spotify and the provider expose one.
2. Localized title and title aliases.
3. Artist and artist aliases.
4. Album, duration, language version, and version labels.

Reject a provider result when title is similar but the artist identifies a
different recording. Do not borrow a song translation from an original artist
to a cover, or the reverse. A manual/local selection is the only explicit
override.

Recognize language versions such as `English ver.`, `日本語版`, `韓文版`, and
`粵語版`. Infer Spotify's language from metadata and native lyric scripts only
when confidence is high; do not classify Han-only text as Chinese without a
stronger signal.

## Translation eligibility

- NetEase: accept only entries that actually contain `tlyric`.
- QQ Music: accept only entries that actually contain `ts`.
- Musixmatch: require a crowd translation.
- LyricsTranslate and the web provider: require a human translation from the
  same page/source.
- Spotify and LRCLIB are original-only sources.

An original-only provider result is not a valid translation result. Continue to
the next candidate instead of publishing it.

## Lyric identity check after fetch

After fetching a translated candidate, compare its original sequence with
Spotify native lyrics:

- Allow one native line to map to multiple provider lines and vice versa.
- Tolerate punctuation, whitespace, CJK variants, small particles, and inserted
  words.
- Require short fragments to match exactly.
- Keep mappings monotonic; do not reorder verses or reuse unrelated repeated
  lines.
- A metadata-perfect candidate with a poor lyric-sequence match must be
  discarded.

When changing gates that can invalidate cached results, bump the cache record
schema so stale wrong matches are not reused.

## Network behavior

- Use per-provider timeouts and abort all stale requests when the track changes.
- A single provider failure must not block other providers.
- Spicetify `CosmosAsync` parses non-Spotify HTML as JSON. For HTML pages, use
  the Spicetify CORS proxy transport implemented in `src/core/http.ts`; direct
  browser fetch is normally blocked by CORS.
- Do not retry 429/5xx failures indefinitely. Use bounded cooldowns.

## Regression classes

Always test:

- Same title, different artist.
- Different language version of the same song.
- Cover versus original.
- Provider line split/merge differences.
- Traditional/simplified or Japanese variant characters.
- Repeated chorus lines kept in source order.
- A candidate with `tlyric`/`ts` whose actual original lyrics belong to another
  song.
