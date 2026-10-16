# Model config

`gstack models get <role>` prints the backend and model a role runs on. `gstack spawn` uses the same resolution when no `--backend` or `--model` is given.

## Where config lives

Each layer overrides the one before it, field by field:

1. **Built-in defaults.** Roles `explorer`, `synthesizer` and `investigator`, each on the default backend with model `default`.
2. **User config:** `$GSTACK_HOME/config.json`. `GSTACK_HOME` defaults to `~/.gstack`.
3. **Repo config:** `.gstack/config.json` at the project root. The project root is the nearest directory at or above the current one that holds `.git`; without one, it's the current directory.

No config file is needed. A missing file is the same as an empty one.

## Shape

```json
{
  "defaultBackend": "pi",
  "roles": {
    "explorer": { "model": "haiku" },
    "synthesizer": { "backend": "pi", "model": "gpt-5" },
    "reviewer": { "backend": "claude", "model": "opus" }
  }
}
```

- `defaultBackend` (optional): `"pi"` or `"claude"`. The backend for roles that don't name one. Without it, the default is `pi` if a `pi` executable is on `PATH`, otherwise `claude`.
- `roles` (optional): role name to `{ "backend"?, "model"? }`. Naming a role that isn't built in adds it.
  - `backend`: `"pi"` or `"claude"`.
  - `model`: a non-empty string passed to the backend's model flag. `"default"` means pass no model flag, so the backend uses its own default.

Any other key is an error. Invalid config exits 2 with a message naming the file and the field, for example:

```
gstack: invalid config in /home/me/.gstack/config.json: roles.explorer.backend must be one of "pi", "claude"
```

## Output

```
$ gstack models get explorer
role: explorer
backend: pi
model: default (no model flag)

$ gstack models get explorer --json
{"role":"explorer","backend":"pi","model":null}
```

In JSON, `model` is `null` when no model flag is passed.
