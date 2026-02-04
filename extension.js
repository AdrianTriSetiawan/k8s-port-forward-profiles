const vscode = require('vscode');
const path = require('path');
const cp = require('child_process');

const CONFIG_RELATIVE = path.join('.vscode', 'portforward.json');
const DEFAULT_TEMPLATE = {
  profiles: [
    {
      name: 'api',
      context: '',
      namespace: 'default',
      resource: 'svc/api',
      localPort: 8080,
      remotePort: 80,
      localAddress: '127.0.0.1',
      autoStart: false,
      autoReconnect: true
    }
  ]
};

function getWorkspaceUri() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  return folders[0].uri;
}

function profileKey(profile) {
  const name = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : '';
  if (name) {
    return `name:${name}`;
  }
  const ns = profile.namespace || '';
  const resource = profile.resource || '';
  const localPort = profile.localPort || '';
  const remotePort = profile.remotePort || '';
  return `res:${resource}|ns:${ns}|${localPort}:${remotePort}`;
}

function normalizeProfile(profile) {
  const normalized = {
    name: typeof profile.name === 'string' ? profile.name : '',
    context: typeof profile.context === 'string' ? profile.context : '',
    namespace: typeof profile.namespace === 'string' ? profile.namespace : '',
    resource: typeof profile.resource === 'string' ? profile.resource : '',
    localPort: Number(profile.localPort),
    remotePort: Number(profile.remotePort),
    localAddress: typeof profile.localAddress === 'string' ? profile.localAddress : '',
    autoStart: Boolean(profile.autoStart),
    autoReconnect: profile.autoReconnect !== false
  };
  return normalized;
}

function isValidProfile(profile) {
  if (!profile.resource || typeof profile.resource !== 'string') {
    return false;
  }
  if (!Number.isFinite(profile.localPort) || profile.localPort <= 0) {
    return false;
  }
  if (!Number.isFinite(profile.remotePort) || profile.remotePort <= 0) {
    return false;
  }
  return true;
}

function toErrorInfo(error) {
  if (!error) {
    return null;
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return {
    message: error.message ? String(error.message) : String(error)
  };
}

function formatExitSummary(lastExit) {
  if (!lastExit) {
    return '';
  }
  if (lastExit.error && lastExit.error.message) {
    return `error: ${lastExit.error.message}`;
  }
  if (Number.isFinite(lastExit.code)) {
    return `exit ${lastExit.code}`;
  }
  if (lastExit.signal) {
    return `signal ${lastExit.signal}`;
  }
  return '';
}

function buildTooltip(profile, status, lastExit) {
  const lines = [];
  lines.push(`${profile.resource} (${profile.localPort}:${profile.remotePort})`);
  if (profile.context) {
    lines.push(`Context: ${profile.context}`);
  }
  const namespaceLabel = profile.namespace ? profile.namespace : 'default';
  lines.push(`Namespace: ${namespaceLabel}`);
  lines.push(`Status: ${status}`);
  if (lastExit) {
    if (Number.isFinite(lastExit.code)) {
      lines.push(`Last exit code: ${lastExit.code}`);
    }
    if (lastExit.signal) {
      lines.push(`Last exit signal: ${lastExit.signal}`);
    }
    if (lastExit.error && lastExit.error.message) {
      lines.push(`Last error: ${lastExit.error.message}`);
    }
    if (lastExit.at) {
      lines.push(`Last exit time: ${lastExit.at}`);
    }
  }
  return lines.join('\n');
}

class PortForwardManager {
  constructor(output, onDidChange) {
    this.output = output;
    this.onDidChange = onDidChange;
    this.records = new Map();
  }

  syncProfiles(profiles) {
    const seen = new Set();
    for (const profile of profiles) {
      const key = profileKey(profile);
      seen.add(key);
      const record = this.ensureRecord(key, profile);
      record.profile = profile;
      if (profile.autoStart && !record.desired) {
        this.start(profile);
      }
    }

    for (const [key, record] of this.records.entries()) {
      if (!seen.has(key)) {
        if (record.desired) {
          this.stopRecord(record, { reason: 'profile removed' });
        }
        this.records.delete(key);
      }
    }
  }

  ensureRecord(key, profile) {
    if (!this.records.has(key)) {
      this.records.set(key, {
        key,
        profile,
        child: null,
        desired: false,
        status: 'stopped',
        retries: 0,
        restartTimer: null,
        lastExit: null
      });
    }
    return this.records.get(key);
  }

  getRecord(profile) {
    const key = profileKey(profile);
    return this.records.get(key) || null;
  }

  getStatus(profile) {
    const key = profileKey(profile);
    const record = this.records.get(key);
    return record ? record.status : 'stopped';
  }

  start(profile) {
    const normalized = normalizeProfile(profile);
    if (!isValidProfile(normalized)) {
      vscode.window.showWarningMessage('Invalid port-forward profile. Check portforward.json.');
      return;
    }

    const key = profileKey(normalized);
    const record = this.ensureRecord(key, normalized);
    record.profile = normalized;
    record.desired = true;

    if (record.child) {
      return;
    }

    if (record.restartTimer) {
      clearTimeout(record.restartTimer);
      record.restartTimer = null;
    }

    record.status = 'starting';
    this.onDidChange();

    const args = [];
    if (normalized.context) {
      args.push('--context', normalized.context);
    }
    if (normalized.namespace) {
      args.push('-n', normalized.namespace);
    }
    args.push('port-forward');
    args.push(normalized.resource);

    const portSpec = `${normalized.localPort}:${normalized.remotePort}`;
    args.push(portSpec);

    if (normalized.localAddress) {
      args.push('--address', normalized.localAddress);
    }

    this.output.appendLine(`Starting: kubectl ${args.join(' ')}`);

    let child;
    try {
      child = cp.spawn('kubectl', args, { windowsHide: true });
    } catch (error) {
      record.status = 'error';
      record.lastExit = { code: null, signal: null, error: toErrorInfo(error), at: new Date().toISOString() };
      this.output.appendLine(`Failed to spawn kubectl: ${error.message}`);
      this.onDidChange();
      return;
    }

    record.child = child;

    child.stdout.on('data', (data) => {
      this.output.appendLine(data.toString().trim());
    });

    child.stderr.on('data', (data) => {
      this.output.appendLine(data.toString().trim());
    });

    child.on('spawn', () => {
      record.status = 'running';
      record.retries = 0;
      this.onDidChange();
    });

    child.on('exit', (code, signal) => {
      record.child = null;
      record.lastExit = { code, signal, error: null, at: new Date().toISOString() };

      if (record.desired && normalized.autoReconnect) {
        record.status = 'restarting';
        this.onDidChange();
        this.scheduleRestart(record);
      } else {
        record.status = 'stopped';
        this.onDidChange();
      }
    });

    child.on('error', (error) => {
      record.child = null;
      record.status = 'error';
      record.lastExit = { code: null, signal: null, error: toErrorInfo(error), at: new Date().toISOString() };
      this.output.appendLine(`kubectl error: ${error.message}`);
      this.onDidChange();
    });
  }

  stop(profile) {
    const key = profileKey(profile);
    const record = this.records.get(key);
    if (!record) {
      return;
    }
    this.stopRecord(record, { reason: 'user' });
  }

  stopRecord(record, meta) {
    record.desired = false;
    if (record.restartTimer) {
      clearTimeout(record.restartTimer);
      record.restartTimer = null;
    }
    if (record.child) {
      try {
        record.child.kill();
      } catch (error) {
        this.output.appendLine(`Failed to stop kubectl: ${error.message}`);
      }
      record.child = null;
    }
    record.status = 'stopped';
    if (meta && meta.reason) {
      this.output.appendLine(`Stopped port-forward (${record.key}) due to ${meta.reason}.`);
    }
    this.onDidChange();
  }

  restart(profile) {
    this.stop(profile);
    this.start(profile);
  }

  scheduleRestart(record) {
    record.retries += 1;
    const backoff = Math.min(1000 * Math.pow(2, record.retries - 1), 30000);
    this.output.appendLine(`Reconnecting in ${Math.round(backoff / 1000)}s: ${record.key}`);
    record.restartTimer = setTimeout(() => {
      record.restartTimer = null;
      if (record.desired) {
        this.start(record.profile);
      }
    }, backoff);
  }
}

class ProfileItem extends vscode.TreeItem {
  constructor(profile, status, lastExit) {
    const label = profile.name || profile.resource;
    super(label, vscode.TreeItemCollapsibleState.None);
    const ns = profile.namespace ? `ns:${profile.namespace}` : 'ns:default';
    const statusLabel = status || 'stopped';
    const showExitSummary = statusLabel !== 'running' && statusLabel !== 'starting';
    const exitSummary = showExitSummary ? formatExitSummary(lastExit) : '';
    const detailParts = [`${profile.localPort}:${profile.remotePort}`, ns, statusLabel];
    if (exitSummary) {
      detailParts.push(exitSummary);
    }
    this.description = detailParts.join(' | ');
    this.contextValue = 'k8sPortForwardProfiles.profile';
    this.command = {
      command: 'k8sPortForwardProfiles.toggleProfile',
      title: 'Toggle Port Forward',
      arguments: [profile]
    };

    const icon = {
      running: 'debug-start',
      starting: 'sync',
      restarting: 'sync',
      stopped: 'circle-large-outline',
      error: 'error'
    }[status] || 'circle-large-outline';

    this.iconPath = new vscode.ThemeIcon(icon);
    this.tooltip = buildTooltip(profile, statusLabel, lastExit);
  }
}

class PortForwardTreeDataProvider {
  constructor(manager) {
    this.manager = manager;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.profiles = [];
    this.hasConfig = false;
    this.configError = '';
    this.configWarning = '';
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  async reload() {
    const workspaceUri = getWorkspaceUri();
    if (!workspaceUri) {
      this.profiles = [];
      this.hasConfig = false;
      this.configError = 'No workspace folder is open.';
      this.configWarning = '';
      await vscode.commands.executeCommand('setContext', 'k8sPortForwardProfiles.hasConfig', false);
      this.refresh();
      return;
    }

    const configUri = vscode.Uri.joinPath(workspaceUri, CONFIG_RELATIVE);
    try {
      const data = await vscode.workspace.fs.readFile(configUri);
      const parsed = JSON.parse(data.toString());
      const rawProfiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
      const normalized = rawProfiles.map(normalizeProfile);
      const validProfiles = normalized.filter(isValidProfile);
      const invalidCount = normalized.length - validProfiles.length;

      this.profiles = validProfiles;
      this.hasConfig = true;
      this.configError = '';
      this.configWarning = invalidCount > 0 ? `${invalidCount} invalid profile(s) ignored.` : '';

      await vscode.commands.executeCommand('setContext', 'k8sPortForwardProfiles.hasConfig', true);
      this.manager.syncProfiles(validProfiles);
    } catch (error) {
      if (error && error.code === 'FileNotFound') {
        this.profiles = [];
        this.hasConfig = false;
        this.configError = '';
        this.configWarning = '';
        await vscode.commands.executeCommand('setContext', 'k8sPortForwardProfiles.hasConfig', false);
        this.manager.syncProfiles([]);
      } else {
        this.profiles = [];
        this.hasConfig = true;
        this.configError = error.message || 'Failed to read portforward.json.';
        this.configWarning = '';
        await vscode.commands.executeCommand('setContext', 'k8sPortForwardProfiles.hasConfig', true);
      }
    }

    this.refresh();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren() {
    const workspaceUri = getWorkspaceUri();
    if (!workspaceUri) {
      return [
        new vscode.TreeItem('Open a workspace folder to use port-forward profiles.')
      ];
    }

    if (!this.hasConfig) {
      const item = new vscode.TreeItem('Create .vscode/portforward.json');
      item.command = {
        command: 'k8sPortForwardProfiles.createConfig',
        title: 'Create portforward.json'
      };
      item.iconPath = new vscode.ThemeIcon('add');
      return [item];
    }

    if (this.configError) {
      const item = new vscode.TreeItem(`Config error: ${this.configError}`);
      item.iconPath = new vscode.ThemeIcon('warning');
      return [item];
    }

    const items = [];
    if (this.configWarning) {
      const warningItem = new vscode.TreeItem(this.configWarning);
      warningItem.iconPath = new vscode.ThemeIcon('warning');
      items.push(warningItem);
    }

    if (!this.profiles.length) {
      items.push(new vscode.TreeItem('No profiles found in portforward.json.'));
      return items;
    }

    return items.concat(
      this.profiles.map((profile) => {
        const record = this.manager.getRecord(profile);
        const status = record ? record.status : 'stopped';
        const lastExit = record ? record.lastExit : null;
        return new ProfileItem(profile, status, lastExit);
      })
    );
  }
}

async function createConfigFile() {
  const workspaceUri = getWorkspaceUri();
  if (!workspaceUri) {
    vscode.window.showWarningMessage('Open a workspace folder first.');
    return;
  }

  const vscodeDir = vscode.Uri.joinPath(workspaceUri, '.vscode');
  const configUri = vscode.Uri.joinPath(workspaceUri, CONFIG_RELATIVE);

  await vscode.workspace.fs.createDirectory(vscodeDir);
  const contents = JSON.stringify(DEFAULT_TEMPLATE, null, 2);
  await vscode.workspace.fs.writeFile(configUri, Buffer.from(contents, 'utf8'));
  await vscode.commands.executeCommand('vscode.open', configUri);
}

async function openConfigFile() {
  const workspaceUri = getWorkspaceUri();
  if (!workspaceUri) {
    vscode.window.showWarningMessage('Open a workspace folder first.');
    return;
  }
  const configUri = vscode.Uri.joinPath(workspaceUri, CONFIG_RELATIVE);
  try {
    await vscode.workspace.fs.stat(configUri);
  } catch (error) {
    vscode.window.showWarningMessage('portforward.json not found. Use Create portforward.json first.');
    return;
  }
  await vscode.commands.executeCommand('vscode.open', configUri);
}

function activate(context) {
  const output = vscode.window.createOutputChannel('K8s Port Forward');
  let provider;
  const manager = new PortForwardManager(output, () => provider && provider.refresh());
  provider = new PortForwardTreeDataProvider(manager);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('k8sPortForwardProfiles', provider),
    output
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('k8sPortForwardProfiles.refresh', () => provider.reload()),
    vscode.commands.registerCommand('k8sPortForwardProfiles.startProfile', (profile) => manager.start(profile)),
    vscode.commands.registerCommand('k8sPortForwardProfiles.stopProfile', (profile) => manager.stop(profile)),
    vscode.commands.registerCommand('k8sPortForwardProfiles.restartProfile', (profile) => manager.restart(profile)),
    vscode.commands.registerCommand('k8sPortForwardProfiles.toggleProfile', (profile) => {
      const status = manager.getStatus(profile);
      if (status === 'running' || status === 'starting' || status === 'restarting') {
        manager.stop(profile);
      } else {
        manager.start(profile);
      }
    }),
    vscode.commands.registerCommand('k8sPortForwardProfiles.startAll', () => {
      provider.profiles.forEach((profile) => manager.start(profile));
    }),
    vscode.commands.registerCommand('k8sPortForwardProfiles.stopAll', () => {
      provider.profiles.forEach((profile) => manager.stop(profile));
    }),
    vscode.commands.registerCommand('k8sPortForwardProfiles.createConfig', () => createConfigFile()),
    vscode.commands.registerCommand('k8sPortForwardProfiles.openConfig', () => openConfigFile())
  );

  const workspaceUri = getWorkspaceUri();
  if (workspaceUri) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceUri, CONFIG_RELATIVE)
    );

    watcher.onDidCreate(() => provider.reload());
    watcher.onDidChange(() => provider.reload());
    watcher.onDidDelete(() => provider.reload());

    context.subscriptions.push(watcher);
  }

  provider.reload();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
