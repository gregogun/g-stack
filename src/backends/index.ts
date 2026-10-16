/**
 * Backends: the agent CLIs `gstack spawn` can run a subagent on.
 *
 * Each backend only says how to build its command line. Running it (prompt
 * on stdin, timeout, report) is shared, in spawn.ts. To add a backend, write
 * one `BackendCli` in its own file and register it below.
 */
import type { Backend } from '../models.ts';
import { claude } from './claude.ts';
import { pi } from './pi.ts';

export type BackendCli = {
  /** The executable looked up on PATH. */
  executable: string;
  /** Shown when the executable is missing: how to get it. */
  installHint: string;
  /**
   * Arguments for a headless run that reads the prompt from stdin and prints
   * the final answer on stdout. `model` is null for the backend's default:
   * pass no model flag.
   */
  args: (model: string | null) => string[];
};

export const backends: Partial<Record<Backend, BackendCli>> = { claude, pi };
