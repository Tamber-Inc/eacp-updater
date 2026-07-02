const tty = process.stdout.isTTY;

const wrap = (code) => (text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : `${text}`);

export const bold = wrap('1');
export const dim = wrap('2');
export const green = wrap('32');
export const red = wrap('31');
export const cyan = wrap('36');
export const yellow = wrap('33');

export function step(title) {
  console.log(`\n${cyan('▸')} ${bold(title)}`);
}

export function ok(message) {
  console.log(`  ${green('✓')} ${message}`);
}

export function info(message) {
  console.log(`  ${dim(message)}`);
}

export function warn(message) {
  console.log(`  ${yellow('!')} ${message}`);
}

export function fail(message) {
  console.error(`\n${red('✗')} ${message}`);
  process.exit(1);
}

export function banner(message) {
  console.log(`\n${green('●')} ${bold(message)}`);
}

export function table(rows) {
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, String(cell).length);
    });
  }
  for (const row of rows) {
    console.log(`  ${row
      .map((cell, index) => String(cell).padEnd(widths[index]))
      .join('  ')}`);
  }
}
