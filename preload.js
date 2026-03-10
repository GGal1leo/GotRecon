const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startScan: (domain) => ipcRenderer.invoke('scan:start', domain),
  stopScan: () => ipcRenderer.invoke('scan:stop'),

  onStatus: (cb) => ipcRenderer.on('scan:status', (_, data) => cb(data)),
  onDns: (cb) => ipcRenderer.on('scan:dns', (_, data) => cb(data)),
  onCerts: (cb) => ipcRenderer.on('scan:certs', (_, data) => cb(data)),
  onSubdomains: (cb) => ipcRenderer.on('scan:subdomains', (_, data) => cb(data)),
  onTypoTotal: (cb) => ipcRenderer.on('scan:typo-total', (_, data) => cb(data)),
  onTypoProgress: (cb) => ipcRenderer.on('scan:typo-progress', (_, data) => cb(data)),
  onTyposquats: (cb) => ipcRenderer.on('scan:typosquats', (_, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('scan:error', (_, data) => cb(data)),

  removeAllListeners: () => {
    ['scan:status', 'scan:dns', 'scan:certs', 'scan:subdomains',
     'scan:typo-total', 'scan:typo-progress', 'scan:typosquats',
     'scan:error'].forEach((ch) => ipcRenderer.removeAllListeners(ch));
  },
});
