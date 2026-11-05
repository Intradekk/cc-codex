# Configuration

For basic configuration instructions, see [this documentation](https://developers.openai.com/codex/config-basic).

For advanced configuration instructions, see [this documentation](https://developers.openai.com/codex/config-advanced).

For a full configuration reference, see [this documentation](https://developers.openai.com/codex/config-reference).

## Token usage in the status line

The default status line uses the `claude` layout adapted from `statusline.mjs`:
`🤖 model (effort) | 📁 directory | 🌿 branch | 5h: 10% (42m) | ctx: 75K/1M`.
The directory is the active session working directory. Git and subscription limit
blocks are omitted when unavailable. The limit shows **percent used**, with a
weekly (`7d`) fallback when the five-hour window is unavailable. Reset times are
rounded up to minutes and refreshed while idle. Context shows the latest prompt's
input tokens, including cached input, rather than cumulative session usage; it is
hidden while usage is pending after resume. Unknown capacity is shown as `?`.
API costs and cache-temperature timers are not included: Codex does not expose a
cache expiry time.

Existing explicit item selections are preserved. To enable this layout, select
`claude` in `/statusline`, run `/statusline claude` for this session, or save:

```toml
[tui]
status_line = ["claude"]
```

Use `/statusline` to select `total-input-tokens`, `total-output-tokens`, and
`total-cached-input-tokens`, or set them in `config.toml`:

```toml
[tui]
status_line = ["total-input-tokens", "total-output-tokens", "total-cached-input-tokens"]
```

These counters show accumulated session usage, for example
`900 in · 100 out · 200 cached`. Cached tokens are included in input tokens;
do not add them to the input total. Counters are hidden while usage is pending
after resuming a session.

## Lifecycle hooks

Admins can set top-level `allow_managed_hooks_only = true` in
`requirements.toml` to ignore user, project, and session hook configs while
still allowing managed hooks from requirements and managed config layers. This
setting is only supported in `requirements.toml`; putting it in `config.toml`
does not enable managed-hooks-only mode.
