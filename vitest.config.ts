import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Agent worktrees live under .claude/; their tests aren't ours.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
