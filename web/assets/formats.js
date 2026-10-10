// Log-format detection and colorizing: level detection, JSON-lines, the
// built-in format rules (apache/nginx/tomcat/syslog/spring/python/...), user
// rules from --ui-colors-preset, and the generic token fallback.
//
// Pure functions over HTML-escaped text, no DOM and no globals, so the same
// file runs in the browser (window.FrontailFormats) and in Node tests
// (require). NOTE: rules receive *escaped* text, so match &quot; not ".
(function(root) {
  'use strict';

  function _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Level detection ────────────────────────────────────────────

  function _detectLevel(text) {
    var t = text.toLowerCase();
    // klog/glog: "E0101 12:00:00.123456 ..." — severity is the first letter
    var klog = /^([iwef])\d{4} \d{2}:\d{2}:\d{2}\./.exec(t);
    if (klog) return { i: 'info', w: 'warn', e: 'error', f: 'error' }[klog[1]];
    if (/\b(error|err|fatal|critical|crit|exception|traceback|panic)\b/.test(t)) return 'error';
    if (/\b(warn|warning)\b/.test(t)) return 'warn';
    if (/\b(info|information)\b/.test(t)) return 'info';
    if (/\b(debug|trace|verbose)\b/.test(t)) return 'debug';
    return '';
  }

  // ── ANSI detection ──────────────────────────────────────────────

  // eslint-disable-next-line no-control-regex
  var ANSI_RX = /\x1b\[[0-9;]*[a-zA-Z]/;

  function _hasAnsiCodes(text) {
    return ANSI_RX.test(text);
  }

  // ── Format autodetect colorizer (apache2 / nginx / tomcat / syslog) ──
  // Only ever applied to lines WITHOUT embedded ANSI codes — those already
  // carry their own colors via ansi_up and are left untouched.

  function _fcSpan(cls, text) {
    return '<span class="log-fc-' + cls + '">' + text + '</span>';
  }

  function _fcStatusClass(code) {
    var c = String(code).charAt(0);
    if (c === '2') return 'status-2xx';
    if (c === '3') return 'status-3xx';
    if (c === '4') return 'status-4xx';
    if (c === '5') return 'status-5xx';
    return 'status-other';
  }

  function _fcLevelClass(word) {
    var w = (word || '').toLowerCase();
    if (/^(emerg|alert|crit|severe|error|err|fatal|panic)/.test(w)) return 'level-error';
    if (/^warn/.test(w)) return 'level-warn';
    if (/^(notice|info|log$)/.test(w)) return 'level-info';
    return 'level-debug';
  }

  // ── JSON log line colorizing ─────────────────────────────────────
  // Structured JSON-lines logs (pino/winston-json/bunyan/Go structured
  // logging, etc.) get rendered as colorized key=value pairs instead of
  // raw escaped JSON text. Takes priority over every other rule below.

  var JSON_FIELD_CLASS = {
    level: 'level', severity: 'level', lvl: 'level',
    time: 'time', timestamp: 'time', '@timestamp': 'time', ts: 'time',
    status: 'status', statuscode: 'status', status_code: 'status',
    ip: 'ip', remoteaddr: 'ip', remote_addr: 'ip',
  };

  function _jsonFieldSpan(key, valueText) {
    var cls = JSON_FIELD_CLASS[key.toLowerCase()];
    if (cls === 'level') return _fcSpan(_fcLevelClass(valueText), valueText);
    if (cls === 'status') return _fcSpan(_fcStatusClass(valueText), valueText);
    if (cls) return _fcSpan(cls, valueText);
    if (key.toLowerCase() === 'msg' || key.toLowerCase() === 'message') return valueText;
    return _fcSpan('field', valueText);
  }

  function _tryColorizeJson(raw) {
    var trimmed = raw.trim();
    if (trimmed.charAt(0) !== '{' || trimmed.charAt(trimmed.length - 1) !== '}') return null;
    var obj;
    try { obj = JSON.parse(trimmed); } catch { return null; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    var keys = Object.keys(obj);
    if (!keys.length) return null;
    var parts = keys.map(function(key) {
      var val = obj[key];
      var valStr = typeof val === 'string' ? val : JSON.stringify(val);
      var escKey = _escapeHtml(key);
      var escVal = _escapeHtml(valStr);
      return _fcSpan('jkey', escKey) + '=' + _jsonFieldSpan(key, escVal);
    });
    return parts.join(' ');
  }

  var _FORMAT_RULES = [
    { // Apache/Nginx combined or common access log
      regex: /^(\S+) (\S+) (\S+) \[([^\]]+)\] &quot;([A-Z]+) (\S*) (HTTP\/[\d.]+)&quot; (\d{3}) (\S+)/,
      render(m) {
        return _fcSpan('ip', m[1]) + ' ' + m[2] + ' ' + m[3] + ' [' +
          _fcSpan('time', m[4]) + '] &quot;' + _fcSpan('method', m[5]) + ' ' +
          _fcSpan('path', m[6]) + ' ' + _fcSpan('proto', m[7]) + '&quot; ' +
          _fcSpan(_fcStatusClass(m[8]), m[8]) + ' ' + _fcSpan('size', m[9]);
      }
    },
    { // Nginx error log: 2024/01/01 12:00:00 [error] 1234#0: message
      regex: /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+#\d+):/,
      render(m) {
        return _fcSpan('time', m[1]) + ' [' + _fcSpan(_fcLevelClass(m[2]), m[2]) + '] ' +
          _fcSpan('pid', m[3]) + ':';
      }
    },
    { // Apache error log, both classic and current formats
      regex: /^\[([^\]]+)\] \[([\w:]+)\](?: \[(pid \d+|client [^\]]+)\])?/,
      render(m) {
        var out = '[' + _fcSpan('time', m[1]) + '] [' +
          _fcSpan(_fcLevelClass(m[2].split(':').pop()), m[2]) + ']';
        if (m[3]) out += ' [' + _fcSpan('meta', m[3]) + ']';
        return out;
      }
    },
    { // Tomcat 8.5+/9/10 one-line juli format:
      // 12-Jan-2024 15:15:22.123 INFO [main] org.apache.catalina.startup.Catalina.start
      regex: /^(\d{2}-\w{3}-\d{4} \d{2}:\d{2}:\d{2}\.\d{3}) (SEVERE|WARNING|INFO|CONFIG|FINE|FINER|FINEST) \[([^\]]+)\] (\S+)/,
      render(m) {
        return _fcSpan('time', m[1]) + ' ' + _fcSpan(_fcLevelClass(m[2]), m[2]) + ' [' +
          _fcSpan('thread', m[3]) + '] ' + _fcSpan('logger', m[4]);
      }
    },
    { // Classic Tomcat juli header line: Jan 12, 2024 3:15:22 PM org.apache.catalina.core.StandardService log
      regex: /^(\w{3} \d{1,2}, \d{4} \d{1,2}:\d{2}:\d{2} [AP]M) (\S+) (\S+)$/,
      render(m) {
        return _fcSpan('time', m[1]) + ' ' + _fcSpan('logger', m[2]) + ' ' + _fcSpan('method', m[3]);
      }
    },
    { // Classic Tomcat juli level line: INFO: message / SEVERE: message
      regex: /^(SEVERE|WARNING|INFO|CONFIG|FINE|FINER|FINEST):/,
      render(m) {
        return _fcSpan(_fcLevelClass(m[1]), m[1]) + ':';
      }
    },
    { // Generic syslog: Aug 12 10:15:23 myhost sshd[1234]: message
      regex: /^(\w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2}) (\S+) ([\w.\-/]+)(\[\d+\])?:/,
      render(m) {
        return _fcSpan('time', m[1]) + ' ' + _fcSpan('host', m[2]) + ' ' +
          _fcSpan('logger', m[3]) + (m[4] ? _fcSpan('pid', m[4]) : '') + ':';
      }
    },
    { // Log4j/Logback pipe-delimited: 2024-01-01 12:00:00,000 | INFO | message [logger<thread>]
      regex: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[.,]\d{3})\s*\|\s*(\w+)\s*\|\s*/,
      render(m) {
        return _fcSpan('time', m[1]) + ' | ' + _fcSpan(_fcLevelClass(m[2]), m[2]) + ' | ';
      }
    },
    { // Spring Boot default: 2024-01-01 12:00:00.123  INFO 1234 --- [main] c.e.Application : msg
      regex: /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[.,]\d{3}(?:Z|[+-]\d{2}:?\d{2})?)\s+([A-Z]{4,5})\s+(\d+) --- ((?:\[[^\]]*\]\s*)+?)(\S+)\s+:/,
      render(m) {
        return _fcSpan('time', m[1]) + ' ' + _fcSpan(_fcLevelClass(m[2]), m[2]) + ' ' +
          _fcSpan('pid', m[3]) + ' --- ' + _fcSpan('thread', m[4].trim()) + ' ' +
          _fcSpan('logger', m[5]) + ' :';
      }
    },
    { // Logback/Log4j "[thread] LEVEL logger - msg": 12:00:00.123 [main] INFO  c.e.App - msg
      regex: /^((?:\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}:\d{2}[.,]\d{3}) \[([^\]]+)\]\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+(\S+)\s+-\s/,
      render(m) {
        return _fcSpan('time', m[1]) + ' [' + _fcSpan('thread', m[2]) + '] ' +
          _fcSpan(_fcLevelClass(m[3]), m[3]) + ' ' + _fcSpan('logger', m[4]) + ' - ';
      }
    },
    { // Python logging, dash style: 2024-01-01 12:00:00,123 - name - INFO - msg
      regex: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[.,]\d{3})\s+-\s+(\S+)\s+-\s+(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\s+-\s/,
      render(m) {
        return _fcSpan('time', m[1]) + ' - ' + _fcSpan('logger', m[2]) + ' - ' +
          _fcSpan(_fcLevelClass(m[3]), m[3]) + ' - ';
      }
    },
    { // Python logging default: INFO:name:message
      regex: /^(DEBUG|INFO|WARNING|ERROR|CRITICAL):([\w.-]+):/,
      render(m) {
        return _fcSpan(_fcLevelClass(m[1]), m[1]) + ':' + _fcSpan('logger', m[2]) + ':';
      }
    },
    { // PostgreSQL: 2024-01-01 12:00:00.123 UTC [1234] LOG:  message
      regex: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? [A-Z]{2,5}) \[(\d+)\](?: ([\w@.-]+))? (DEBUG\d?|INFO|NOTICE|WARNING|ERROR|LOG|FATAL|PANIC|STATEMENT|DETAIL|HINT|CONTEXT):/,
      render(m) {
        return _fcSpan('time', m[1]) + ' [' + _fcSpan('pid', m[2]) + ']' +
          (m[3] ? ' ' + _fcSpan('meta', m[3]) : '') + ' ' +
          _fcSpan(_fcLevelClass(m[4]), m[4]) + ':';
      }
    },
    { // MySQL 8 / MariaDB error log: 2024-01-01T12:00:00.123456Z 0 [Warning] [MY-010068] [Server] msg
      regex: /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})) (\d+) \[(\w+)\](?: \[([\w-]+)\])?(?: \[(\w+)\])?/,
      render(m) {
        return _fcSpan('time', m[1]) + ' ' + _fcSpan('thread', m[2]) + ' [' +
          _fcSpan(_fcLevelClass(m[3]), m[3]) + ']' +
          (m[4] ? ' [' + _fcSpan('meta', m[4]) + ']' : '') +
          (m[5] ? ' [' + _fcSpan('logger', m[5]) + ']' : '');
      }
    },
    { // Kubernetes klog / glog: I0101 12:00:00.123456       1 main.go:12] msg
      regex: /^([IWEF])(\d{4} \d{2}:\d{2}:\d{2}\.\d+)\s+(\d+) ([\w.-]+:\d+)\]/,
      render(m) {
        var lvl = { I: 'info', W: 'warn', E: 'error', F: 'fatal' }[m[1]];
        return _fcSpan(_fcLevelClass(lvl), m[1]) + _fcSpan('time', m[2]) + ' ' +
          _fcSpan('pid', m[3]) + ' ' + _fcSpan('logger', m[4]) + ']';
      }
    },
    { // Redis: 1234:M 01 Jan 2024 12:00:00.123 * message
      regex: /^(\d+):([XCSM]) (\d{1,2} \w{3} \d{4} \d{2}:\d{2}:\d{2}\.\d{3}) ([.\-*#]) /,
      render(m) {
        var lvl = { '.': 'debug', '-': 'info', '*': 'notice', '#': 'warning' }[m[4]];
        return _fcSpan('pid', m[1]) + ':' + _fcSpan('meta', m[2]) + ' ' +
          _fcSpan('time', m[3]) + ' ' + _fcSpan(_fcLevelClass(lvl), m[4]) + ' ';
      }
    },
    { // Java stack trace frame: "    at com.example.Foo.bar(Foo.java:42)"
      regex: /^(\s+)at ([\w$.<>/-]+)(?:\(([^)]*)\))?/,
      render(m) {
        return m[1] + 'at ' + _fcSpan('logger', m[2]) +
          (m[3] !== undefined ? '(' + _fcSpan('meta', m[3]) + ')' : '');
      }
    },
    { // Java "Caused by: java.io.IOException: msg" / "Suppressed: ..."
      regex: /^(\s*)(Caused by|Suppressed):\s*([\w$.]+)/,
      render(m) {
        return m[1] + _fcSpan('level-error', m[2] + ':') + ' ' + _fcSpan('logger', m[3]);
      }
    },
    { // Java "Exception in thread "main" java.lang.NullPointerException"
      regex: /^Exception in thread &quot;([^&]*)&quot; ([\w$.]+)/,
      render(m) {
        return _fcSpan('level-error', 'Exception in thread') + ' &quot;' +
          _fcSpan('thread', m[1]) + '&quot; ' + _fcSpan('logger', m[2]);
      }
    },
    { // Python traceback header / frame
      regex: /^Traceback \(most recent call last\):/,
      render(m) { return _fcSpan('level-error', m[0]); }
    },
    {
      regex: /^(\s+)File &quot;([^&]*)&quot;, line (\d+)(?:, in (\S+))?/,
      render(m) {
        return m[1] + 'File &quot;' + _fcSpan('path', m[2]) + '&quot;, line ' +
          _fcSpan('size', m[3]) + (m[4] ? ', in ' + _fcSpan('method', m[4]) : '');
      }
    },
    { // logfmt: ts=... level=info msg="started" duration=3ms (whole line of key=value pairs)
      // The two value alternatives are disjoint (quoted body can't contain
      // &quot;, unquoted can't start with it), so this cannot backtrack
      // exponentially on hostile log lines (CodeQL js/redos).
      regex: /^[A-Za-z_][\w.-]*=(?:&quot;(?:(?!&quot;).)*&quot;|(?!&quot;)\S*)(?: +[A-Za-z_][\w.-]*=(?:&quot;(?:(?!&quot;).)*&quot;|(?!&quot;)\S*))+ *$/,
      render(m) {
        return m[0].replace(/([A-Za-z_][\w.-]*)=(&quot;(?:(?!&quot;).)*&quot;|(?!&quot;)\S*)/g, function(whole, key, val) {
          return _fcSpan('jkey', key) + '=' + _jsonFieldSpan(key, val);
        });
      }
    }
  ];

  // ── User-extensible format rules ────────────────────────────────
  // Declarative rules supplied by the server (--ui-colors-preset) as
  // [{ regex, flags, template }]. template placeholders are {N} (group N,
  // unstyled) or {N:spec} where spec is "status" / "level" (auto-classed),
  // a class name (-> log-fc-<name>), or a literal color ("#fff", "rgb(...)").

  var _userFormatRules = [];

  function _fcSpanBySpec(spec, text) {
    if (!spec) return text;
    if (spec === 'status') return _fcSpan(_fcStatusClass(text), text);
    if (spec === 'level') return _fcSpan(_fcLevelClass(text), text);
    if (/^(#|rgb|hsl)/i.test(spec)) {
      return '<span style="color:' + spec.replace(/"/g, '') + '">' + text + '</span>';
    }
    return _fcSpan(spec, text);
  }

  function _compileUserFormatRule(spec) {
    if (!spec || typeof spec.regex !== 'string' || typeof spec.template !== 'string') return null;
    var regex;
    try {
      regex = new RegExp(spec.regex, spec.flags || '');
    } catch { return null; }
    var {template} = spec;
    return {
      regex,
      render(m) {
        return template.replace(/\{(\d+)(?::([^}]+))?\}/g, function(whole, idx, clsSpec) {
          var val = m[Number(idx)];
          if (val === undefined) return '';
          return _fcSpanBySpec(clsSpec, val);
        });
      }
    };
  }

  // ── Generic fallback: token-level coloring for any format not matched
  // above — timestamps, log levels, IPs, bracketed metadata, quoted strings.

  var GENERIC_FC_RX = new RegExp(
    '(\\d{4}[-/]\\d{2}[-/]\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)' +
    '|((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2})' +
    '|(\\b(?:TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|ERR|SEVERE|FATAL|CRITICAL|CRIT|EMERGENCY|EMERG|ALERT)\\b)' +
    '|(\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b)' +
    '|(\\[[^\\[\\]]{1,300}\\])' +
    '|("[^"]{0,200}")',
    'gi'
  );

  function _applyGenericColors(html) {
    return html.replace(GENERIC_FC_RX, function(m, time1, time2, level, ip, bracket, quoted) {
      if (time1 || time2) return _fcSpan('time', m);
      if (level) return _fcSpan(_fcLevelClass(m), m);
      if (ip) return _fcSpan('ip', m);
      if (bracket) return _fcSpan('meta', m);
      if (quoted) return _fcSpan('str', m);
      return m;
    });
  }

  function _applyFormatColors(html) {
    var rules = _userFormatRules.concat(_FORMAT_RULES);
    for (var i = 0; i < rules.length; i++) {
      rules[i].regex.lastIndex = 0; // defensive: user-supplied rules may carry a 'g' flag
      var m = rules[i].regex.exec(html);
      if (m) {
        return html.slice(0, m.index) + rules[i].render(m) + html.slice(m.index + m[0].length);
      }
    }
    return _applyGenericColors(html);
  }

  var api = {
    detectLevel: _detectLevel,
    hasAnsiCodes: _hasAnsiCodes,
    tryColorizeJson: _tryColorizeJson,
    applyFormatColors: _applyFormatColors,
    // rules: [{ regex, flags, template }] from the server (--ui-colors-preset)
    setUserRules: function(rules) {
      _userFormatRules = (rules || []).map(_compileUserFormatRule).filter(Boolean);
    },
    // exposed for tests
    builtInRules: _FORMAT_RULES
  };

  root.FrontailFormats = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
