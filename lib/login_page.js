'use strict';

/**
 * Server-rendered sign-in page.
 *
 * Replaces the browser's native Basic Auth dialog: the page is plain HTML with
 * inline CSS (the CSP allows 'unsafe-inline' for styles but not for scripts)
 * and posts to <urlPath>/login. Copy is bilingual; the language follows
 * ?lang=ru|en when present, otherwise the Accept-Language header (ru* → ru).
 */

const MESSAGES = {
  ru: {
    lang: 'ru',
    title: 'Вход',
    heading: 'Вход в frontail',
    user: 'Логин',
    password: 'Пароль',
    submit: 'Войти',
    error: 'Неверный логин или пароль.',
    throttled: 'Слишком много попыток. Подождите немного и попробуйте снова.',
    required: 'Введите логин и пароль.',
    switchTo: 'English',
    switchHref: 'en',
  },
  en: {
    lang: 'en',
    title: 'Sign in',
    heading: 'Sign in to frontail',
    user: 'Username',
    password: 'Password',
    submit: 'Sign in',
    error: 'Wrong username or password.',
    throttled: 'Too many attempts. Wait a moment and try again.',
    required: 'Enter a username and a password.',
    switchTo: 'Русский',
    switchHref: 'ru',
  },
};

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/**
 * Picks the page language: an explicit ?lang= wins, otherwise ru for Russian
 * browsers and en for everything else.
 * @param {string|undefined} explicit
 * @param {string} [acceptLanguage]
 * @returns {'ru'|'en'}
 */
function detectLang(explicit, acceptLanguage) {
  const wanted = String(explicit || '').toLowerCase();
  if (wanted === 'ru' || wanted === 'en') {
    return wanted;
  }
  if (/^\s*ru\b/i.test(String(acceptLanguage || ''))) {
    return 'ru';
  }
  const anyRu = String(acceptLanguage || '')
    .split(',')
    .some((part) => /^\s*ru[-_]?/i.test(part));
  return anyRu ? 'ru' : 'en';
}

/**
 * @param {{ action?: string, logoutPath?: string, next?: string, error?: 'invalid'|'throttled'|'required'|null, lang?: 'ru'|'en', user?: string }} [opts]
 * @returns {string} full HTML document
 */
function renderLoginPage(opts = {}) {
  const options = opts;
  const lang = detectLang(options.lang);
  const copy = MESSAGES[lang];
  const action = escapeHtml(options.action || '/login');
  const next = escapeHtml(options.next || '');
  const user = escapeHtml(options.user || '');
  const errorText =
    options.error === 'throttled'
      ? copy.throttled
      : options.error === 'required'
        ? copy.required
        : options.error === 'invalid'
          ? copy.error
          : '';
  const errorBlock = errorText
    ? `<p class="error" role="alert">${escapeHtml(errorText)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="${copy.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>frontail — ${copy.title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #16181d; color: #e6e8ec;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 24px;
  }
  .card {
    width: 100%; max-width: 360px; background: #1d2027; border: 1px solid #2b2f38;
    border-radius: 12px; padding: 28px 28px 22px; box-shadow: 0 12px 40px rgba(0,0,0,.45);
  }
  h1 { margin: 0 0 20px; font-size: 18px; font-weight: 600; letter-spacing: .2px; }
  label { display: block; margin-bottom: 14px; font-size: 12px; color: #9aa2af; text-transform: uppercase; letter-spacing: .6px; }
  input {
    width: 100%; margin-top: 6px; padding: 9px 11px; border-radius: 7px;
    border: 1px solid #333844; background: #14161b; color: #e6e8ec; font-size: 14px;
  }
  input:focus { outline: 2px solid #3b82f6; outline-offset: 1px; border-color: #3b82f6; }
  .error {
    margin: 0 0 14px; padding: 9px 11px; border-radius: 7px; font-size: 13px;
    background: rgba(239, 68, 68, .12); border: 1px solid rgba(239, 68, 68, .35); color: #fca5a5;
  }
  button {
    width: 100%; margin-top: 6px; padding: 10px 12px; border: 0; border-radius: 7px;
    background: #3b82f6; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  button:hover { background: #2f74e0; }
  .foot { margin-top: 18px; display: flex; justify-content: flex-end; }
  .foot a { color: #8b95a5; font-size: 12px; text-decoration: none; }
  .foot a:hover { color: #c3cad6; }
</style>
</head>
<body>
<main class="card">
  <h1>${copy.heading}</h1>
  ${errorBlock}
  <form method="post" action="${action}" autocomplete="on">
    <input type="hidden" name="next" value="${next}">
    <label>${copy.user}
      <input name="username" value="${user}" autocomplete="username" autofocus required>
    </label>
    <label>${copy.password}
      <input type="password" name="password" autocomplete="current-password" required>
    </label>
    <button type="submit">${copy.submit}</button>
  </form>
  <div class="foot">
    <a href="?lang=${copy.switchHref}">${copy.switchTo}</a>
  </div>
</main>
</body>
</html>`;
}

module.exports = { renderLoginPage, detectLang, MESSAGES };
