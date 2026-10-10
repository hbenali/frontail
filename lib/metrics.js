'use strict';

// Minimal Prometheus text-format registry (exposition format 0.0.4); avoids
// pulling in a client library for six metrics.

const escapeLabel = (v) =>
  String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

module.exports = (version) => {
  const startedAt = Date.now();
  const linesBySource = new Map();
  let tailErrors = 0;
  const gauges = [];

  return {
    countLine(source) {
      linesBySource.set(source, (linesBySource.get(source) || 0) + 1);
    },

    countError() {
      tailErrors += 1;
    },

    // fn is evaluated on every scrape
    gauge(name, help, fn) {
      gauges.push({ name, help, fn });
    },

    render() {
      const out = [];
      const metric = (name, type, help, samples) => {
        out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
        samples.forEach(([labels, value]) => {
          out.push(`${name}${labels} ${value}`);
        });
      };

      metric('frontail_build_info', 'gauge', 'Build information.', [
        [`{version="${escapeLabel(version)}"}`, 1],
      ]);
      metric(
        'frontail_uptime_seconds',
        'gauge',
        'Seconds since the server started.',
        [['', Math.round((Date.now() - startedAt) / 1000)]]
      );
      gauges.forEach(({ name, help, fn }) => {
        metric(name, 'gauge', help, [['', fn()]]);
      });
      metric(
        'frontail_lines_total',
        'counter',
        'Log lines read, by source.',
        [...linesBySource].map(([source, n]) => [
          `{source="${escapeLabel(source)}"}`,
          n,
        ])
      );
      metric(
        'frontail_tail_errors_total',
        'counter',
        'Errors reported by tail or the container engine.',
        [['', tailErrors]]
      );

      return `${out.join('\n')}\n`;
    },
  };
};
