const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const dns = require('./modules/dns');
const crtsh = require('./modules/crtsh');
const subdomain = require('./modules/subdomain');
const typosquat = require('./modules/typosquat');

let mainWindow = null;

// Track active scan so we can cancel it
let activeScan = null;

// Enable Wayland/Ozone if on Linux Wayland
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'GotRecon? — Target Recon Dashboard',
    backgroundColor: '#14141a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1.0,
    },
    icon: path.join(__dirname, 'assets', 'gotrecon.svg'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC: Start Scan ──────────────────────────────────────────────────────────

ipcMain.handle('scan:start', async (event, domain) => {
  // Normalize domain
  if (domain.includes('://')) domain = domain.split('://')[1];
  domain = domain.replace(/\/+$/, '').trim();
  if (!domain) return { error: 'Empty domain' };

  // Abort controller for cancelling
  const controller = new AbortController();
  activeScan = controller;

  const result = {
    domain,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    dnsRecords: [],
    certEntries: [],
    subdomains: [],
    typosquats: [],
  };

  const send = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  try {
    // 1. DNS Resolution
    if (controller.signal.aborted) throw new Error('cancelled');
    send('scan:status', { phase: 'dns', message: 'Resolving DNS records...' });
    result.dnsRecords = await dns.queryAll(domain);
    send('scan:dns', result.dnsRecords);

    // 2. Certificate Transparency (crt.sh)
    if (controller.signal.aborted) throw new Error('cancelled');
    send('scan:status', { phase: 'certs', message: 'Querying crt.sh...' });
    const crtResult = await crtsh.query(domain, controller.signal);
    result.certEntries = crtResult.certs;
    result.subdomains = crtResult.subdomains;
    send('scan:certs', result.certEntries);
    send('scan:subdomains', result.subdomains);

    // 3. Resolve subdomain IPs
    if (controller.signal.aborted) throw new Error('cancelled');
    send('scan:status', { phase: 'subips', message: 'Resolving subdomain IPs...' });
    result.subdomains = await subdomain.resolveIPs(result.subdomains, 20, controller.signal);
    send('scan:subdomains', result.subdomains);

    // 4. Typosquat detection
    if (controller.signal.aborted) throw new Error('cancelled');
    send('scan:status', { phase: 'typo', message: 'Generating typosquat permutations...' });
    const candidates = typosquat.generate(domain);
    send('scan:typo-total', candidates.length);
    send('scan:status', {
      phase: 'typo',
      message: `Checking typosquats (${candidates.length} candidates)...`,
    });
    result.typosquats = await typosquat.check(candidates, 30, controller.signal, (progress, entry) => {
      send('scan:typo-progress', { progress, entry });
    });
    send('scan:typosquats', result.typosquats);

    if (controller.signal.aborted) throw new Error('cancelled');
    send('scan:status', { phase: 'done', message: 'Done.' });
  } catch (err) {
    if (err.message === 'cancelled' || controller.signal.aborted) {
      send('scan:status', { phase: 'cancelled', message: 'Scan cancelled.' });
      send('scan:error', 'Scan was stopped by user.');
    } else {
      send('scan:error', err.message);
    }
  }

  activeScan = null;
  return result;
});


ipcMain.handle('scan:stop', async () => {
  if (activeScan) {
    activeScan.abort();
  }
});
