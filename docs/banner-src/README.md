# Banner source

`docs/banner.png` (1280x640, also the repository's GitHub social preview) is rendered from `banner.html`
with headless Chrome, using the real UI screenshot `docs/screenshots/overview.png`:

```sh
google-chrome --headless=new --hide-scrollbars --window-size=1280,640 --force-device-scale-factor=1 \
  --virtual-time-budget=9000 --screenshot=docs/banner.png "file://$PWD/docs/banner-src/banner.html"
```

(Fonts, Inter and JetBrains Mono, are loaded from Google Fonts at render time.)
