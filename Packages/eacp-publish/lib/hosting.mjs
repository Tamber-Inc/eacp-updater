import { cpSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { run } from './exec.mjs';
import { fail } from './ui.mjs';

// A hosting backend is four functions. Anything can host a channel.
//   upload(localPath, object, {json})  — put one file at <storageRoot>/<object>
//   fetchText(object)                  — read <publicRoot>/<object>, null if absent
//   publicUrl(object)
//   name
export async function createBackend(config) {
  const { hosting } = config;

  if (hosting.backend && hosting.backend.startsWith('.')) {
    const module = await import(pathToFileURL(join(config.root, hosting.backend)));
    return module.createBackend(config);
  }

  const kind = hosting.backend
    ?? (hosting.storageRoot.startsWith('gs://') ? 'gcs' : 'local');

  if (kind === 'gcs') return gcsBackend(hosting);
  if (kind === 'local') return localBackend(hosting);
  fail(`unknown hosting backend '${kind}' (built in: gcs, local; or a ./module.mjs path)`);
}

function gcsBackend(hosting) {
  return {
    name: 'gcs',
    publicUrl: (object) => `${hosting.publicRoot}/${object}`,
    upload(localPath, object, { json = false } = {}) {
      const flags = json
        ? ['--content-type=application/json', '--cache-control=no-cache,max-age=0']
        : [];
      run('gcloud', ['storage', 'cp', localPath, `${hosting.storageRoot}/${object}`, ...flags],
        { quiet: true });
    },
    async fetchText(object) {
      const response = await fetch(`${hosting.publicRoot}/${object}`, {
        cache: 'no-store',
      });
      return response.ok ? response.text() : null;
    },
  };
}

// A directory. Doubles as the dry-run and test backend, and works for any
// "just rsync it to my server" hosting.
function localBackend(hosting) {
  const root = hosting.storageRoot.replace(/^file:\/\//, '');
  return {
    name: `local (${root})`,
    publicUrl: (object) => `${hosting.publicRoot}/${object}`,
    upload(localPath, object) {
      const destination = join(root, object);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(localPath, destination);
    },
    async fetchText(object) {
      const path = join(root, object);
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    },
  };
}
