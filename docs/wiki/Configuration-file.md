# Configuration file

Instead of long command lines, put options in a JSON file and pass `--config frontail.json`.

```json
{
  "port": 9001,
  "theme": "dark",
  "ui-highlight": true,
  "user": "admin",
  "passwordFile": "/run/secrets/frontail_password",
  "journal-unit": ["sshd", "nginx"],
  "ssh": ["deploy@web1:/var/log/syslog"],
  "files": ["/var/log/syslog", "/var/log/nginx/error.log"]
}
```

- Keys are option names in **camelCase or kebab-case** (`uiHideTopbar` or `ui-hide-topbar`).
- `files` lists the files to tail (used when none are given on the command line).
- **Command-line flags win** over the file.
- Unknown keys are rejected with a clear error, so typos don't silently do nothing.
- Repeatable options (`container`, `journal-unit`, `ssh`, `allowed-origin`) take arrays.
- Keep secrets out of the file: use `passwordFile` or the `FRONTAIL_PASSWORD` environment variable.
