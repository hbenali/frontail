# Custom format rules

For a log format you want colored precisely, pass `--ui-colors-preset <path>` with a JSON file of rules (see [`preset/colors-example.json`](https://github.com/hbenali/frontail/blob/master/preset/colors-example.json)). Rules are checked **before** the built-in formats, so they can also override them.

```json
[
  {
    "name": "log4j-pipe",
    "regex": "^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}[.,]\\d{3})\\s*\\|\\s*(\\w+)\\s*\\|\\s*",
    "template": "{1:time} | {2:level} | "
  },
  {
    "name": "traceid-field",
    "regex": "traceId=(\\S+)",
    "template": "traceId={1:#c084fc}"
  }
]
```

| Key | |
| --- | --- |
| `regex` | JS regex source as a JSON string (escape backslashes). Anchor with `^` for a structured prefix, or leave unanchored to color a field anywhere in the line |
| `flags` | Optional regex flags, e.g. `"i"`. Avoid `"g"`: matching is single-shot per line |
| `template` | Replacement for the matched text. `{N}` inserts capture group N; `{N:spec}` colors it |

## Template specs

| Spec | Result |
| --- | --- |
| `{1:time}`, `{1:ip}`, `{1:logger}`, ... | any name maps to a `log-fc-<name>` CSS class (reuse built-ins like `time`, `ip`, `meta`, `str`, `path`, `method`) |
| `{1:status}` | colored by first digit (2xx green, 3xx cyan, 4xx amber, 5xx red) |
| `{1:level}` | colored by severity (error, warn, info, debug) |
| `{1:#c084fc}` | inline color; `rgb(...)` and `hsl(...)` work too |
| `{1}` | plain text, unstyled |

Only the text the regex matched is replaced; the rest of the line is untouched.

## Tips

- The browser matches against **HTML-escaped** text, so a literal `"` is `&quot;`, `<` is `&lt;`, `&` is `&amp;`. Write `&quot;` in your regex when you mean a double quote.
- Keep regexes simple and anchored. They run on every incoming line, so avoid nested quantifiers.
- With Docker, bind-mount the file and point at it: `-v ./my-colors.json:/frontail/preset/my-colors.json:ro ... --ui-colors-preset /frontail/preset/my-colors.json`.
