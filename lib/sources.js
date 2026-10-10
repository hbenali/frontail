'use strict';

// Command-backed log sources: systemd journal and remote files over SSH.
// Pure builders returning { name, type, follow, read } where follow/read are
// { command, args } (spawned without a shell). Inputs come from the command
// line / config file, so they are validated to rule out option injection
// (a host or unit starting with "-") and remote shell injection (the remote
// path is passed to the remote shell, so it is single-quoted).

const UNIT_RX = /^[A-Za-z0-9_][A-Za-z0-9_@.:\\-]*$/;
const HOST_RX = /^(?:[A-Za-z0-9_.-]+@)?(?:[A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9A-Fa-f:]+\])$/;

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/**
 * @param {{ journal?: boolean, journalUnit?: string[] }} opts
 * @param {number} buffer lines to show on start
 * @returns {object[]} zero or one journal source
 */
function journalSources(opts, buffer) {
  const units = (opts && opts.journalUnit) || [];
  if (!(opts && opts.journal) && units.length === 0) return [];

  units.forEach((unit) => {
    if (!UNIT_RX.test(unit)) {
      throw new Error(`Invalid --journal-unit "${unit}"`);
    }
  });
  const unitArgs = units.flatMap((unit) => ['-u', unit]);

  return [
    {
      name: units.length > 0 ? `journal:${units.join(',')}` : 'journal',
      type: 'journal',
      follow: {
        command: 'journalctl',
        args: ['--no-pager', '-f', '-n', String(buffer), ...unitArgs],
      },
      read: { command: 'journalctl', args: ['--no-pager', ...unitArgs] },
    },
  ];
}

/**
 * @param {string} spec [user@]host:/absolute/path
 * @param {number} buffer lines to show on start
 */
function sshSource(spec, buffer) {
  const idx = spec.indexOf(':/');
  const target = idx === -1 ? '' : spec.slice(0, idx);
  const remotePath = idx === -1 ? '' : spec.slice(idx + 1);

  if (!HOST_RX.test(target) || /[\0\n\r]/.test(remotePath)) {
    throw new Error(
      `Invalid --ssh "${spec}", expected [user@]host:/absolute/path`
    );
  }

  const ssh = (remoteCommand) => ({
    command: 'ssh',
    // BatchMode: fail instead of prompting (there is no terminal);
    // "--" ends option parsing so the host can never be read as an option.
    args: [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '--',
      // ssh wants a bare IPv6 address, not the bracketed URL form.
      target.replace(/[[\]]/g, ''),
      remoteCommand,
    ],
  });

  return {
    name: `${target}:${remotePath}`,
    type: 'ssh',
    follow: ssh(`tail -n ${Number(buffer)} -F ${shellQuote(remotePath)}`),
    read: ssh(`cat ${shellQuote(remotePath)}`),
  };
}

/**
 * @param {{ journal?: boolean, journalUnit?: string[], ssh?: string[] }} opts
 * @param {number} buffer
 */
function commandSources(opts, buffer) {
  return [
    ...journalSources(opts, buffer),
    ...((opts && opts.ssh) || []).map((spec) => sshSource(spec, buffer)),
  ];
}

module.exports = { commandSources, journalSources, sshSource, shellQuote };
