import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';

/** Whether an executable file `name` is in one of PATH's directories. */
export const isOnPath = async (
  name: string,
  env: Record<string, string | undefined>
): Promise<boolean> => {
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      const file = path.join(dir, name);
      await access(file, constants.X_OK);
      if ((await stat(file)).isFile()) return true;
    } catch {
      // Not here; keep looking.
    }
  }
  return false;
};
