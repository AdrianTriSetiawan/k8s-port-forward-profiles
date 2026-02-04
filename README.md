# K8s Port Forward Profiles

Manage persistent `kubectl port-forward` profiles with a sidebar UI.

## Features
- Sidebar list of port-forward profiles
- Start/stop individual profiles
- Start/stop all profiles
- Auto-reconnect when a forward dies
- Config stored in `.vscode/portforward.json`

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

---

MIT License
