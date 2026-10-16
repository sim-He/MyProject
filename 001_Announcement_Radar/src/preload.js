const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noticeWatch', {
  getState: () => ipcRenderer.invoke('state:get'),
  addSource: input => ipcRenderer.invoke('source:add', input),
  updateSource: input => ipcRenderer.invoke('source:update', input),
  removeSource: id => ipcRenderer.invoke('source:remove', id),
  scanSource: id => ipcRenderer.invoke('scan:source', id),
  scanAll: () => ipcRenderer.invoke('scan:all'),
  markRead: (id, read) => ipcRenderer.invoke('notice:read', id, read),
  clearRead: () => ipcRenderer.invoke('notice:clear-read'),
  updateSettings: value => ipcRenderer.invoke('settings:update', value),
  addBrowser: () => ipcRenderer.invoke('browser:add'),
  removeBrowser: id => ipcRenderer.invoke('browser:remove', id),
  openUrl: (url, sourceId) => ipcRenderer.invoke('url:open', { url, sourceId }),
  sourceMenu: id => ipcRenderer.invoke('context:source', id),
  onState: callback => ipcRenderer.on('state:changed', (_, state) => callback(state))
});
