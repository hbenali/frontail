# Log formats

Colorizing is **on by default**. Start with `--ui-no-colors` to turn it off server-wide; each viewer can flip the **Colors** button in the sidebar, and that per-browser choice is remembered and overrides the server default.

![Colorized apache2 access log](https://raw.githubusercontent.com/hbenali/frontail/master/docs/screenshots/overview.png)

## How a line is colored

- **Line already has ANSI escape codes** (an app using `chalk`, `colorlog`, ...): the codes are rendered as-is and format detection is skipped for that line. A badge in the topbar shows **ANSI colors** (all selected sources) or **Mixed colors** (some), and a **Sanitized** download button appears.
- **Plain-text line**: frontail recognises the format and colors the fields: timestamps, IPs, HTTP methods and paths, status codes (2xx green, 3xx cyan, 4xx amber, 5xx red), thread and pid, log level.
- **Nothing matches**: a generic fallback still colors timestamps (including `2024/01/01 12:00:00`), level words, IPv4 addresses, `[bracketed]` metadata and `"quoted strings"`.

## Recognised formats

| Format | Example |
| --- | --- |
| JSON lines (pino, winston, bunyan, structured logging) | `{"level":"error","msg":"boom"}` shown as colorized `key=value` pairs |
| logfmt | `ts=2026-10-10T18:20:10Z level=error msg="db unreachable"` |
| Apache / Nginx access log (combined, common, HTTP/1.x/2/3) | `10.0.0.5 - - [10/Oct/2026:18:20:01 +0000] "GET /api HTTP/2.0" 200 5120` |
| Apache error log (classic and `[core:error]`) | `[Fri Oct 10 18:20:01.1 2026] [core:error] [pid 12] ...` |
| Nginx error log | `2026/10/10 18:20:01 [error] 12#0: ...` |
| Tomcat / Catalina (`juli`, one-line and two-line) | `10-Oct-2026 18:20:01.123 INFO [main] org.apache.catalina...` |
| Spring Boot default console | `2026-10-10 18:20:03.123  INFO 4242 --- [main] c.e.App : Started` |
| Logback / Log4j `[thread] LEVEL logger` | `18:20:04.456 [http-1] ERROR c.e.UserService - Failed` |
| Log4j / Logback pipe-delimited | `2026-10-10 18:20:04,456 \| INFO \| message` |
| Python `logging` | `INFO:root:hello` and `2026-10-10 18:20:05,789 - worker - WARNING - msg` |
| PostgreSQL | `2026-10-10 18:20:06.001 UTC [1234] ERROR:  relation ...` |
| MySQL 8 / MariaDB | `2026-10-10T18:20:07.123456Z 0 [Warning] [MY-010068] [Server] ...` |
| Kubernetes klog / glog | `E1010 18:20:08.123456 1 controller.go:177] failed` |
| Redis | `1234:M 10 Oct 2026 18:20:09.123 * Ready to accept connections` |
| Java stack traces | `at com.example.Foo.bar(Foo.java:42)`, `Caused by: ...`, `Exception in thread "main" ...` |
| Python tracebacks | `Traceback (most recent call last):` and `  File "/app/x.py", line 3, in <module>` |
| syslog (also what `--journal` produces) | `Oct 10 18:20:12 myhost sshd[2231]: Accepted publickey ...` |

Not seeing your format? Use [Custom format rules](Custom-format-rules), or open an issue with a few sample lines.

## Screenshots

| Format | Example |
| --- | --- |
| Nginx error log | ![Nginx error log](https://raw.githubusercontent.com/hbenali/frontail/master/docs/screenshots/nginx-error.png) |
| Apache2 error log | ![Apache2 error log](https://raw.githubusercontent.com/hbenali/frontail/master/docs/screenshots/apache-error.png) |
| Tomcat / Catalina | ![Tomcat catalina.out](https://raw.githubusercontent.com/hbenali/frontail/master/docs/screenshots/catalina.png) |
| Log4j / Logback | ![Log4j/Logback pipe format](https://raw.githubusercontent.com/hbenali/frontail/master/docs/screenshots/log4j-logback.png) |
| syslog | ![Syslog](https://raw.githubusercontent.com/hbenali/frontail/master/docs/screenshots/syslog.png) |
| Generic fallback | ![Unstructured log with generic fallback coloring](https://raw.githubusercontent.com/hbenali/frontail/master/docs/screenshots/generic-fallback.png) |

## Sanitized download

If a source contains ANSI codes, a **Sanitized** download button appears next to **Download**. It strips the escape sequences line by line on the server (`/download?...&sanitize=1`), handy for pasting logs elsewhere.

![ANSI-colored source with Sanitized download available](https://raw.githubusercontent.com/hbenali/frontail/master/docs/screenshots/ansi-source.png)
