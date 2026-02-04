# K8s Port Forward Profiles

Manage persistent `kubectl port-forward` profiles with a sidebar UI.

## Features
- Activity Bar view with port-forward profiles
- Start/stop individual profiles
- Start/stop all profiles
- Auto-reconnect when a forward dies
- Config stored in `.vscode/portforward.json`
- Status details including last exit code and last error

## Requirements
- `kubectl` must be available on your PATH
- `kubectl config` must be set up for your cluster/context

## Config
Create `.vscode/portforward.json` in your workspace:

```json
{
  "profiles": [
    {
      "name": "api",
      "context": "",
      "namespace": "default",
      "resource": "svc/api",
      "localPort": 8080,
      "remotePort": 80,
      "localAddress": "127.0.0.1",
      "autoStart": false,
      "autoReconnect": true
    }
  ]
}
```

## Commands
- `K8s Port Forward Profiles: Refresh Port Forwards`
- `K8s Port Forward Profiles: Start Port Forward`
- `K8s Port Forward Profiles: Stop Port Forward`
- `K8s Port Forward Profiles: Restart Port Forward`
- `K8s Port Forward Profiles: Start All Port Forwards`
- `K8s Port Forward Profiles: Stop All Port Forwards`
- `K8s Port Forward Profiles: Open portforward.json`
- `K8s Port Forward Profiles: Create portforward.json`

## Notes
- Profiles are keyed by `name` (if provided), otherwise by `resource + ports`.
- If a profile is removed from the config, its running forward is stopped.

## Packaging
- `npx @vscode/vsce package`
- Output `.vsix` will be created in the repo root.

## Publishing
See `PUBLISHING.md` for Marketplace steps.

---

MIT License
