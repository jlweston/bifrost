const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myAPI', {
  ipcRenderer,
  send: (channel, data) => {
    // whitelist channels
    let validChannels = ['mqtt-setup', 'startup-preferences'];
    if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    // Deliberately strip event as it includes `sender` 
    ipcRenderer.on(channel, (_event, ...args) => func(...args));
  }
});
