'use strict';

const fs = require('fs');
const jsdom = require('jsdom/lib/old-api.js');
const events = require('events');

describe('browser application', () => {
  let io;
  let window;

  function initApp() {
    window.App.init({
      socket: io,
      container: window.document.querySelector('.log'),
      filterInput: window.document.querySelector('#filter'),
      pauseBtn: window.document.querySelector('#pauseBtn'),
      topbar: window.document.querySelector('.topbar'),
      body: window.document.querySelector('body'),
    });
  }

  function clickOnElement(line) {
    const click = window.document.createEvent('MouseEvents');
    click.initMouseEvent(
      'click',
      true,
      true,
      window,
      0,
      0,
      0,
      0,
      0,
      false,
      false,
      false,
      false,
      0,
      null
    );
    line.dispatchEvent(click);
  }

  beforeEach((done) => {
    io = new events.EventEmitter();
    const html =
      '<title></title><body><div class="topbar"></div>' +
      '<div class="log"></div><button type="button" id="pauseBtn"></button>' +
      '<input type="test" id="filter"/></body>';
    const ansiup = fs.readFileSync('./web/assets/ansi_up.js', 'utf-8');
    const src = fs.readFileSync('./web/assets/app.js', 'utf-8');

    jsdom.env({
      html,
      url: 'http://localhost?filter=line',
      src: [ansiup, src],
      onload: (domWindow) => {
        window = domWindow;
        window.matchMedia =
          window.matchMedia ||
          function matchMedia() {
            return { matches: false, addListener: () => {}, removeListener: () => {} };
          };

        initApp();
        done();
      },
    });
  });

  it('should show lines from socket.io', () => {
    io.emit('line', 'test');

    const log = window.document.querySelector('.log');
    log.childNodes.length.should.be.equal(1);
    const line = log.childNodes[0];
    line.classList.contains('log-line').should.equal(true);
    line.tagName.should.be.equal('DIV');
    line.querySelector('.line-content p').textContent.should.be.equal('test');
  });

  it('should select line when clicked', () => {
    io.emit('line', 'test');

    const line = window.document.querySelector('.log-line');
    clickOnElement(line);

    line.classList.contains('selected').should.equal(true);
  });

  it('should deselect line when selected line clicked', () => {
    io.emit('line', 'test');

    const line = window.document.querySelector('.log-line');
    clickOnElement(line);
    clickOnElement(line);

    line.classList.contains('selected').should.equal(false);
  });

  it('should limit number of lines in browser', () => {
    io.emit('options:lines', 2);
    io.emit('line', 'line1');
    io.emit('line', 'line2');
    io.emit('line', 'line3');

    const log = window.document.querySelector('.log');
    log.childNodes.length.should.be.equal(2);
    log.childNodes[0].querySelector('.line-content p').textContent.should.be.equal('line2');
    log.childNodes[1].querySelector('.line-content p').textContent.should.be.equal('line3');
  });

  it('should hide topbar', () => {
    io.emit('options:hide-topbar');

    const topbar = window.document.querySelector('.topbar');
    topbar.className.should.match(/hide/);
    const body = window.document.querySelector('body');
    body.className.should.match(/no-topbar/);
  });

  it('should not indent log lines', () => {
    io.emit('options:no-indent');

    const log = window.document.querySelector('.log');
    log.className.should.match(/no-indent/);
  });

  it('should highlight word', () => {
    io.emit('options:highlightConfig', {
      words: {
        foo: 'background: black',
        bar: 'background: black',
      },
    });
    io.emit('line', 'foo bar');

    const line = window.document.querySelector('.log-line');
    line.querySelector('.line-content').innerHTML.should.containEql(
      '<span style="background: black">foo</span> <span style="background: black">bar</span>'
    );
  });

  it('should highlight line', () => {
    io.emit('options:highlightConfig', {
      lines: {
        line: 'background: black',
      },
    });
    io.emit('line', 'line1');

    const line = window.document.querySelector('.log-line');
    line.getAttribute('style').should.equal('background: black');
    line.querySelector('.line-content p').textContent.should.be.equal('line1');
  });

  it('should escape HTML', () => {
    io.emit('line', '<a/>');

    const line = window.document.querySelector('.log-line');
    line.querySelector('.line-content p').innerHTML.should.equal('&lt;a/&gt;');
  });

  it('should work filter from URL', () => {
    io.emit('line', 'line1');
    io.emit('line', 'another');
    io.emit('line', 'line2');

    const filterInput = window.document.querySelector('#filter');
    filterInput.value.should.be.equal('line');
    const log = window.document.querySelector('.log');
    log.childNodes.length.should.be.equal(3);
    log.childNodes[0].classList.contains('filtered-out').should.equal(false);
    log.childNodes[1].classList.contains('filtered-out').should.equal(true);
    log.childNodes[2].classList.contains('filtered-out').should.equal(false);
    window.location.href.should.containEql('filter=line');
  });

  it('should clean filter', () => {
    io.emit('line', 'line1');
    io.emit('line', 'another');
    io.emit('line', 'line2');

    const filterInput = window.document.querySelector('#filter');
    const event = new window.KeyboardEvent('keyup', { keyCode: 27 });
    filterInput.dispatchEvent(event);
    const log = window.document.querySelector('.log');
    log.childNodes.length.should.be.equal(3);
    log.childNodes[0].classList.contains('filtered-out').should.equal(false);
    log.childNodes[1].classList.contains('filtered-out').should.equal(false);
    log.childNodes[2].classList.contains('filtered-out').should.equal(false);
    window.location.href.should.be.equal('http://localhost/');
  });

  it('should change filter', () => {
    io.emit('line', 'line1');
    io.emit('line', 'another');
    io.emit('line', 'line2');

    const log = window.document.querySelector('.log');
    const filterInput = window.document.querySelector('#filter');
    filterInput.value = 'other';
    const event = new window.KeyboardEvent('keyup', { keyCode: 13 });
    filterInput.dispatchEvent(event);
    log.childNodes.length.should.be.equal(3);
    log.childNodes[0].classList.contains('filtered-out').should.equal(true);
    log.childNodes[1].classList.contains('filtered-out').should.equal(false);
    log.childNodes[2].classList.contains('filtered-out').should.equal(true);
    window.location.href.should.containEql('filter=other');
  });

  it('should pause', () => {
    io.emit('line', 'line1');
    const btn = window.document.querySelector('#pauseBtn');
    const event = window.document.createEvent('Event');
    event.initEvent('click', true, true);
    btn.dispatchEvent(event);
    io.emit('line', 'line2');
    io.emit('line', 'line3');

    btn.classList.contains('active').should.equal(true);
    const log = window.document.querySelector('.log');
    log.childNodes.length.should.be.equal(1);
    log.lastChild.querySelector('.line-content p').textContent.should.be.equal('line1');
  });

  it('should play', () => {
    const btn = window.document.querySelector('#pauseBtn');
    const event = window.document.createEvent('Event');
    event.initEvent('click', true, true);
    btn.dispatchEvent(event);
    io.emit('line', 'line1');
    const log = window.document.querySelector('.log');
    log.childNodes.length.should.be.equal(0);
    btn.classList.contains('active').should.equal(true);
    btn.dispatchEvent(event);
    io.emit('line', 'line2');

    btn.classList.contains('active').should.equal(false);
    log.childNodes.length.should.be.equal(1);
    log.lastChild.querySelector('.line-content p').textContent.should.be.equal('line2');
  });
});
