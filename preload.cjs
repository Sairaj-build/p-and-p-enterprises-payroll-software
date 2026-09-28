const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('emppay', {
  load: () => ipcRenderer.invoke('db:load'),
  setup: (credentials) => ipcRenderer.invoke('auth:setup', credentials),
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  save: (db) => ipcRenderer.invoke('db:save', db),
  openFile: () => ipcRenderer.invoke('file:open'),
  readWorkbook: (filePath) => ipcRenderer.invoke('file:readWorkbook', filePath),
  backup: (payload) => ipcRenderer.invoke('file:backup', payload),
  autoBackup: (payload) => ipcRenderer.invoke('file:autoBackup', payload),
  listAutoBackups: () => ipcRenderer.invoke('file:listAutoBackups'),
  restoreAutoBackup: (filePath) => ipcRenderer.invoke('file:restoreAutoBackup', filePath),
  restore: () => ipcRenderer.invoke('file:restore'),
  exportFile: (payload) => ipcRenderer.invoke('file:export', payload),
  exportWorkbook: (payload) => ipcRenderer.invoke('file:exportWorkbook', payload),
  // KYC Document Secure Storage
  openKycFilePicker: () => ipcRenderer.invoke('file:openKycFilePicker'),
  saveKycDocument: (payload) => ipcRenderer.invoke('file:saveKycDocument', payload),
  getKycDocument: (payload) => ipcRenderer.invoke('file:getKycDocument', payload),
  deleteKycDocument: (payload) => ipcRenderer.invoke('file:deleteKycDocument', payload),
  // System & Integration API provisions
  openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
  sendWhatsAppApi: (payload) => ipcRenderer.invoke('whatsapp:sendApi', payload),
  // Payslip Image Generation & Clipboard Sharing
  renderPayslipImage: (payload) => ipcRenderer.invoke('payslip:renderImage', payload),
  copyPayslipImage: (payload) => ipcRenderer.invoke('payslip:copyImage', payload),
  showItemInFolder: (filePath) => ipcRenderer.invoke('payslip:showInFolder', filePath),
  savePayslipImageAs: (payload) => ipcRenderer.invoke('payslip:saveImageAs', payload)
});

