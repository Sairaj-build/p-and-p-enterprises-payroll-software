const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeImage } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const dataDir = () => path.join(app.getPath('userData'), 'data');
const backupsDir = () => path.join(dataDir(), 'backups');
const kycDir = (empCode) => path.join(app.getPath('userData'), 'kyc', String(empCode || 'unknown'));
const dbFile = () => path.join(dataDir(), 'emppay.json');

const KYC_ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'pdf'];
const KYC_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const emptyDb = {
  sites: [],
  employees: [],
  attendance: [],
  components: [],
  structures: [],
  ruleVersions: [],
  rules: { pfRate: 12, pfCeiling: 15000, esicRate: 0.75, esicCeiling: 21000, pt: 200, lwf: 20, otMultiplier: 1.5, version: 1 },
  loans: [],
  arrears: [],
  bonusStatements: [],
  payrollRuns: [],
  kycDocuments: [],
  audit: []
};

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(emptyDb));
  }
}

function writeDb(db) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dbFile(), JSON.stringify(db, null, 2), 'utf8');
}

function passwordDigest(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function passwordMatches(password, stored) {
  try {
    const [salt, expected] = String(stored).split(':');
    const actual = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function performAutoBackup(payload) {
  try {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });

    // Save auto-backup file with clean timestamp
    const now = new Date();
    const timestampStr = now.toISOString().replace(/[:.]/g, '-');
    const fileName = `EMPPAY-auto-${timestampStr}.json`;
    const filePath = path.join(dir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');

    // Keep the most recent 30 rolling auto-backups
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('EMPPAY-auto-') && f.endsWith('.json'))
      .map(f => ({ name: f, path: path.join(dir, f), time: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 30) {
      files.slice(30).forEach(file => {
        try { fs.unlinkSync(file.path); } catch (_) { }
      });
    }

    return { success: true, filePath, fileName, timestamp: now.toISOString() };
  } catch (err) {
    console.error('AutoBackup error:', err);
    return { success: false, error: err.message };
  }
}

function listAutoBackups() {
  try {
    const dir = backupsDir();
    if (!fs.existsSync(dir)) return [];

    const fileNames = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const fullPath = path.join(dir, f);
        try {
          const stat = fs.statSync(fullPath);
          return { f, fullPath, stat, mtimeMs: stat.mtimeMs };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return fileNames.slice(0, 20).map(({ f, fullPath, stat, mtimeMs }) => {
      let empCount = null;
      let runCount = null;
      let siteCount = null;
      try {
        // Read small prefix or safely parse
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        empCount = Array.isArray(content.employees) ? content.employees.length : 0;
        runCount = Array.isArray(content.payrollRuns) ? content.payrollRuns.length : 0;
        siteCount = Array.isArray(content.sites) ? content.sites.length : 0;
      } catch (_) { }
      return {
        fileName: f,
        filePath: fullPath,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        mtimeMs,
        empCount,
        runCount,
        siteCount
      };
    });
  } catch (err) {
    console.error('listAutoBackups error:', err);
    return [];
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    title: 'P & P Enterprises - Payroll Control Room',
    icon: fs.existsSync(path.join(__dirname, 'icon.ico')) ? path.join(__dirname, 'icon.ico') : path.join(__dirname, 'logo.jpg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('db:load', () => readDb());
  ipcMain.handle('db:save', (_event, db) => {
    writeDb(db);
    return true;
  });

  ipcMain.handle('auth:setup', (_event, { username, password }) => {
    const db = readDb();
    if (db.auth || !username || !password || password.length < 6) return false;
    db.auth = { username, password: passwordDigest(password), createdAt: new Date().toISOString() };
    writeDb(db);
    return true;
  });

  ipcMain.handle('auth:login', (_event, { username, password }) => {
    const db = readDb();
    return Boolean(db.auth && db.auth.username === username && passwordMatches(password, db.auth.password));
  });

  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Excel or CSV', extensions: ['xlsx', 'xls', 'csv'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('file:readWorkbook', async (_event, filePath) => {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    return workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      return {
        name,
        rows: XLSX.utils.sheet_to_json(sheet, { defval: '' }),
        rawRows: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      };
    });
  });

  ipcMain.handle('file:backup', async (_event, payload) => {
    const result = await dialog.showSaveDialog({
      defaultPath: `EMPPAY-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'EMPPAY Backup', extensions: ['json'] }]
    });
    if (result.canceled) return null;
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return result.filePath;
  });

  ipcMain.handle('file:autoBackup', (_event, payload) => {
    return performAutoBackup(payload);
  });

  ipcMain.handle('file:listAutoBackups', () => {
    return listAutoBackups();
  });

  ipcMain.handle('file:restoreAutoBackup', (_event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) return null;
      return {
        filePath,
        payload: JSON.parse(fs.readFileSync(filePath, 'utf8'))
      };
    } catch (err) {
      console.error('restoreAutoBackup error:', err);
      return null;
    }
  });

  ipcMain.handle('file:restore', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'EMPPAY Backup', extensions: ['json'] }]
    });
    if (result.canceled) return null;
    return {
      filePath: result.filePaths[0],
      payload: JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'))
    };
  });

  ipcMain.handle('file:export', async (_event, payload) => {
    const result = await dialog.showSaveDialog({
      defaultPath: payload.filename || 'EMPPAY-export.csv'
    });
    if (result.canceled) return null;
    fs.writeFileSync(result.filePath, payload.content, 'utf8');
    return result.filePath;
  });

  // -------------------------------------------------------
  // KYC DOCUMENT SECURE STORAGE HANDLERS
  // -------------------------------------------------------

  ipcMain.handle('file:openKycFilePicker', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'KYC Documents', extensions: KYC_ALLOWED_EXTENSIONS }
      ],
      title: 'Select KYC Document'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('file:saveKycDocument', async (_event, payload) => {
    try {
      const { empCode, docId, sourcePath, mimeType } = payload;

      // Validate file exists
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        return { success: false, error: 'Source file not found.' };
      }

      // Validate extension
      const ext = path.extname(sourcePath).replace('.', '').toLowerCase();
      if (!KYC_ALLOWED_EXTENSIONS.includes(ext)) {
        return { success: false, error: `File type .${ext} is not allowed. Allowed: ${KYC_ALLOWED_EXTENSIONS.join(', ')}` };
      }

      // Validate size
      const stat = fs.statSync(sourcePath);
      if (stat.size > KYC_MAX_SIZE_BYTES) {
        return { success: false, error: `File size ${(stat.size / 1024 / 1024).toFixed(2)} MB exceeds maximum 5 MB.` };
      }

      // Create employee KYC directory
      const dir = kycDir(empCode);
      fs.mkdirSync(dir, { recursive: true });

      const storedFileName = `${docId}_${Date.now()}.${ext}`;
      const destPath = path.join(dir, storedFileName);

      fs.copyFileSync(sourcePath, destPath);

      return {
        success: true,
        storedPath: destPath,
        storedFileName,
        ext,
        mimeType: mimeType || `image/${ext}`,
        sizeBytes: stat.size
      };
    } catch (err) {
      console.error('saveKycDocument error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:getKycDocument', async (_event, { storedPath }) => {
    try {
      if (!storedPath || !fs.existsSync(storedPath)) {
        return { success: false, error: 'Document file not found on disk.' };
      }
      const data = fs.readFileSync(storedPath);
      const ext = path.extname(storedPath).replace('.', '').toLowerCase();
      const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };
      const mimeType = mimeMap[ext] || 'application/octet-stream';
      return {
        success: true,
        base64: data.toString('base64'),
        mimeType
      };
    } catch (err) {
      console.error('getKycDocument error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:deleteKycDocument', async (_event, { storedPath }) => {
    try {
      if (storedPath && fs.existsSync(storedPath)) {
        fs.unlinkSync(storedPath);
      }
      return { success: true };
    } catch (err) {
      console.error('deleteKycDocument error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:exportWorkbook', async (_event, payload) => {
    const XLSX = require('xlsx');
    const result = await dialog.showSaveDialog({
      defaultPath: payload.filename || 'EMPPAY-export.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    });
    if (result.canceled) return null;
    
    const wb = XLSX.utils.book_new();
    (payload.sheets || []).forEach(s => {
      const ws = XLSX.utils.aoa_to_sheet(s.data || []);
      XLSX.utils.book_append_sheet(wb, ws, s.name || 'Sheet1');
    });
    
    XLSX.writeFile(wb, result.filePath);
    return result.filePath;
  });

  // -------------------------------------------------------
  // SYSTEM & INTEGRATION HANDLERS
  // -------------------------------------------------------
  ipcMain.handle('system:openExternal', async (_event, url) => {
    try {
      if (!url || typeof url !== 'string') return { success: false, error: 'Invalid URL' };
      await shell.openExternal(url);
      return { success: true };
    } catch (err) {
      console.error('system:openExternal error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('whatsapp:sendApi', async (_event, payload) => {
    try {
      const { endpoint, token, phone, message, provider, senderId } = payload || {};
      if (!endpoint) {
        return { success: false, error: 'API Endpoint URL is required' };
      }
      if (!phone) {
        return { success: false, error: 'Recipient phone number is required' };
      }

      // Format recipient phone: numbers only
      const cleanPhone = String(phone).replace(/\D/g, '');
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

      let postData = '';
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'EMPPAY-Payroll-Desktop/1.0'
      };

      if (token) {
        headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      }

      if (provider === 'meta') {
        // Meta WhatsApp Cloud API format
        postData = JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedPhone,
          type: 'text',
          text: { preview_url: false, body: message }
        });
      } else if (provider === 'twilio') {
        // Twilio format
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        postData = new URLSearchParams({
          From: senderId ? (senderId.startsWith('whatsapp:') ? senderId : `whatsapp:${senderId}`) : 'whatsapp:+14155238886',
          To: `whatsapp:+${formattedPhone}`,
          Body: message
        }).toString();
      } else {
        // Generic Webhook / Provider format
        postData = JSON.stringify({
          to: formattedPhone,
          phone: formattedPhone,
          message,
          senderId: senderId || '',
          timestamp: new Date().toISOString()
        });
      }

      headers['Content-Length'] = Buffer.byteLength(postData);

      const parsedUrl = new URL(endpoint);
      const reqLib = parsedUrl.protocol === 'http:' ? http : https;

      return new Promise((resolve) => {
        const req = reqLib.request(endpoint, {
          method: 'POST',
          headers,
          timeout: 15000
        }, (res) => {
          let resBody = '';
          res.on('data', chunk => { resBody += chunk; });
          res.on('end', () => {
            const isOk = res.statusCode >= 200 && res.statusCode < 300;
            let parsedRes = null;
            try { parsedRes = JSON.parse(resBody); } catch (_) { parsedRes = resBody; }
            resolve({
              success: isOk,
              statusCode: res.statusCode,
              response: parsedRes,
              error: isOk ? null : `API returned HTTP ${res.statusCode}: ${typeof parsedRes === 'string' ? parsedRes : JSON.stringify(parsedRes)}`
            });
          });
        });

        req.on('error', (err) => {
          console.error('whatsapp:sendApi request error:', err);
          resolve({ success: false, error: err.message });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Request timed out after 15 seconds' });
        });

        req.write(postData);
        req.end();
      });
    } catch (err) {
      console.error('whatsapp:sendApi error:', err);
      return { success: false, error: err.message };
    }
  });

  // -------------------------------------------------------
  // HIGH-QUALITY PAYSLIP IMAGE GENERATION & SHARING
  // -------------------------------------------------------
  ipcMain.handle('payslip:renderImage', async (_event, payload) => {
    try {
      const { html, empCode, period } = payload || {};
      if (!html) return { success: false, error: 'Payslip HTML content is required' };

      const payslipDir = path.join(app.getPath('userData'), 'payslip_images');
      fs.mkdirSync(payslipDir, { recursive: true });

      const renderWin = new BrowserWindow({
        width: 860,
        height: 1200,
        show: false,
        useContentSize: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      // Inline logo.jpg as base64 data URI so it renders reliably offline and in data: URLs
      let finalHtml = html;
      const logoPath = path.join(__dirname, 'logo.jpg');
      if (fs.existsSync(logoPath)) {
        const logoBase64 = fs.readFileSync(logoPath).toString('base64');
        finalHtml = finalHtml.replace(/src=["']logo\.jpg["']/g, `src="data:image/jpeg;base64,${logoBase64}"`);
      }

      // Load formatted standalone payslip HTML
      await renderWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(finalHtml));

      // Zoom factor 1.5x gives crisp high-DPI rendering for clear mobile display
      renderWin.webContents.setZoomFactor(1.5);
      await new Promise(r => setTimeout(r, 350));

      // Measure content height and resize window
      const scrollHeight = await renderWin.webContents.executeJavaScript(
        'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 800)'
      );
      renderWin.setSize(860, Math.ceil(scrollHeight * 1.5) + 60);
      await new Promise(r => setTimeout(r, 150));

      const image = await renderWin.webContents.capturePage();
      renderWin.close();

      const safeEmp = String(empCode || 'EMP').replace(/[^\w-]/g, '_');
      const safePeriod = String(period || 'period').replace(/[^\w-]/g, '_');
      const fileName = `Payslip_${safeEmp}_${safePeriod}.png`;
      const filePath = path.join(payslipDir, fileName);
      const pngBuffer = image.toPNG();
      fs.writeFileSync(filePath, pngBuffer);

      // Auto-copy to system clipboard so pasting (Ctrl+V) in WhatsApp Desktop / Web is instant
      try {
        clipboard.writeImage(image);
      } catch (clipErr) {
        console.warn('Could not copy image to clipboard:', clipErr);
      }

      return {
        success: true,
        filePath,
        fileName,
        dataUrl: image.toDataURL(),
        sizeBytes: pngBuffer.length
      };
    } catch (err) {
      console.error('payslip:renderImage error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('payslip:copyImage', async (_event, { filePath }) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        const img = nativeImage.createFromPath(filePath);
        clipboard.writeImage(img);
        return { success: true };
      }
      return { success: false, error: 'Payslip image file not found on disk.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('payslip:showInFolder', async (_event, filePath) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return { success: true };
      }
      return { success: false, error: 'File not found on disk.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('payslip:saveImageAs', async (_event, { defaultName, dataUrl, filePath: srcPath }) => {
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultName || 'EMPPAY-Payslip.png',
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      });
      if (result.canceled || !result.filePath) return null;
      if (srcPath && fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, result.filePath);
      } else if (dataUrl) {
        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(result.filePath, Buffer.from(base64Data, 'base64'));
      }
      return result.filePath;
    } catch (err) {
      console.error('payslip:saveImageAs error:', err);
      return null;
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
