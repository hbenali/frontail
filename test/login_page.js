/*
 * The sign-in page's language switch is a plain link, so it has to carry the
 * post-login destination itself; otherwise switching the language throws the
 * operator back to the root instead of the page they asked for.
 */
process.env.NODE_CONFIG_DIR = __dirname + '/config';
require('should');
const { renderLoginPage } = require('../lib/login_page');

describe('login page', () => {
  it('keeps the destination in the language link', () => {
    const html = renderLoginPage({ next: '/logs/app.log?tail=50', lang: 'en' });
    html.should.containEql('?lang=ru&amp;next=%2Flogs%2Fapp.log%3Ftail%3D50');
  });

  it('has no destination to keep on a plain visit', () => {
    const html = renderLoginPage({ lang: 'en' });
    html.should.containEql('<a href="?lang=ru">');
  });
});
