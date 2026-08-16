'use strict';

// Appends a fresh fake line to a random demo log file every couple of
// seconds, so a public demo deployment looks "live" without ever
// touching real data. No dependencies - Node built-ins only.

const fs = require('fs');
const path = require('path');

const DIR = process.env.DEMO_LOG_DIR || '/demo';
const MIN_INTERVAL_MS = Number(process.env.DEMO_MIN_INTERVAL_MS) || 900;
const MAX_INTERVAL_MS = Number(process.env.DEMO_MAX_INTERVAL_MS) || 2500;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n, len) {
  return String(n).padStart(len || 2, '0');
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomIp() {
  return [10, Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)].join('.');
}

function accessLogLine(d) {
  const methods = ['GET', 'GET', 'GET', 'POST', 'PUT', 'DELETE'];
  const paths = ['/index.html', '/api/users', '/api/login', '/assets/app.js', '/health', '/api/orders/42'];
  const statuses = [200, 200, 200, 200, 301, 304, 404, 500];
  const method = pick(methods);
  const status = pick(statuses);
  const size = status === 304 ? 0 : Math.floor(Math.random() * 5000);
  const date = `${pad(d.getDate())}/${MONTHS[d.getMonth()]}/${d.getFullYear()}:${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} +0000`;
  return `${randomIp()} - - [${date}] "${method} ${pick(paths)} HTTP/1.1" ${status} ${size}`;
}

function nginxErrorLine(d) {
  const levels = ['error', 'warn', 'notice', 'crit'];
  const date = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const msgs = [
    'connect() failed (111: Connection refused) while connecting to upstream',
    'upstream server temporarily disabled',
    'client closed connection while waiting for request',
    'SSL_do_handshake() failed',
  ];
  return `${date} [${pick(levels)}] 1234#0: *${Math.floor(Math.random() * 999)} ${pick(msgs)}`;
}

function apacheErrorLine(d) {
  const levels = ['core:error', 'ssl:warn', 'core:notice'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const date = `${days[d.getDay()]} ${MONTHS[d.getMonth()]} ${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.123456 ${d.getFullYear()}`;
  const msgs = ['AH00126: Invalid URI in request', 'AH01909: certificate does not match server name', 'AH00094: Command line: httpd'];
  return `[${date}] [${pick(levels)}] [pid ${1000 + Math.floor(Math.random() * 999)}] ${pick(msgs)}`;
}

function catalinaLine(d) {
  const levels = ['INFO', 'WARNING', 'SEVERE'];
  const date = `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const msgs = [
    '[main] org.apache.catalina.startup.Catalina.start Server startup in 1234 ms',
    '[http-nio-8080-exec-1] org.apache.catalina.core.StandardWrapperValve.invoke Servlet.service() threw exception',
    '[http-nio-8080-exec-2] org.apache.catalina.core.StandardWrapperValve.invoke Exception processing request',
  ];
  return `${date} ${pick(levels)} ${pick(msgs)}`;
}

function platformLine(d) {
  const levels = ['INFO', 'WARN', 'ERROR', 'DEBUG'];
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())},${pad(d.getMilliseconds(), 3)}`;
  const msgs = [
    'Global AuthenticationManager configured with AuthenticationProvider bean [o.s.s.c.a.a.c.InitializeAuthenticationProviderBeanManagerConfigurer<main>]',
    `Slow query detected traceId=${Math.random().toString(16).slice(2, 8)} duration=${Math.floor(Math.random() * 999)}ms`,
    `Something failed [worker-${Math.ceil(Math.random() * 4)}] "connection refused" ${randomIp()}`,
    `Cache hit ratio ${Math.random().toFixed(2)}`,
  ];
  return `${date} | ${levels[Math.floor(Math.random() * levels.length)].padEnd(5)} | ${pick(msgs)}`;
}

function syslogLine(d) {
  const date = `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const msgs = [
    'sshd[1234]: Accepted publickey for user',
    'systemd[1]: Started Session 42 of user.',
    'kernel: eth0: link up',
    'cron[567]: (root) CMD (/usr/bin/backup.sh)',
  ];
  return `${date} myhost ${pick(msgs)}`;
}

function customLine(d) {
  const templates = [
    () => `Custom app message at ${d.toISOString().slice(0, 19)} from ${randomIp()} with WARN severity [cache-manager] and note "retrying operation"`,
    () => `Random text mentioning ERROR occasionally with an IP ${randomIp()} and a "quoted phrase" for good measure`,
    () => 'Another completely plain line with no recognizable structure at all',
  ];
  return pick(templates)();
}

function coloredLine() {
  const variants = [
    '\x1b[32mINFO\x1b[0m  Server started successfully on port 8080',
    `\x1b[33mWARN\x1b[0m  Disk usage at ${70 + Math.floor(Math.random() * 30)}%`,
    '\x1b[31mERROR\x1b[0m Failed to connect to database',
    `\x1b[36mDEBUG\x1b[0m Cache refreshed in ${Math.floor(Math.random() * 200)}ms`,
  ];
  return pick(variants);
}

const FILES = [
  { name: 'access.log', gen: accessLogLine },
  { name: 'nginx-error.log', gen: nginxErrorLine },
  { name: 'apache-error.log', gen: apacheErrorLine },
  { name: 'catalina.out', gen: catalinaLine },
  { name: 'platform.log', gen: platformLine },
  { name: 'syslog.log', gen: syslogLine },
  { name: 'custom.log', gen: customLine },
  { name: 'colored.log', gen: coloredLine },
];

function tick() {
  const file = pick(FILES);
  const line = file.gen(new Date());
  fs.appendFile(path.join(DIR, file.name), `${line}\n`, () => {});
  const next = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
  setTimeout(tick, next);
}

tick();
