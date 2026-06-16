var PNTT_CONFIG = {
  APP_NAME: 'Pham Nhan Cau Dao Online 9.1',
  BUILD_ID: 'PNTT_ONLINE_9_1_20260616',
  ROOT_FOLDER_NAME: 'PNTT_Game_Data',
  ACCOUNTS_FILE_NAME: 'accounts.json',
  SAVES_FOLDER_NAME: 'saves',
  MAX_ACCOUNTS: 50,
  ALLOW_SELF_REGISTER: true,
  TOKEN_TTL_SECONDS: 21600,
  SESSION_PREFIX: 'pntt_session_',
  DEFAULT_ASSET_BASE: 'https://hieuminhngoc2022.github.io/pham-nhan-cau-dao/assets/',
  RAW_ASSET_BASE: 'https://raw.githubusercontent.com/hieuminhngoc2022/pham-nhan-cau-dao/main/assets/'
};

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Pham Nhan Cau Dao Online 9.1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function pnttServerInfo() {
  return safeResult_(function () {
    var accounts = readAccounts_();
    return {
      ok: true,
      appName: PNTT_CONFIG.APP_NAME,
      buildId: PNTT_CONFIG.BUILD_ID,
      maxAccounts: PNTT_CONFIG.MAX_ACCOUNTS,
      accountCount: Object.keys(accounts.accounts || {}).length,
      allowSelfRegister: PNTT_CONFIG.ALLOW_SELF_REGISTER,
      assetBase: PNTT_CONFIG.DEFAULT_ASSET_BASE,
      rawAssetBase: PNTT_CONFIG.RAW_ASSET_BASE,
      serverTime: new Date().toISOString()
    };
  });
}

function pnttRegister(payload) {
  return withLock_(function () {
    return safeResult_(function () {
      if (!PNTT_CONFIG.ALLOW_SELF_REGISTER) {
        throw new Error('May chu dang tat tao tai khoan moi.');
      }
      payload = payload || {};
      var userId = normalizeUserId_(payload.userId);
      var password = String(payload.password || '');
      var characterName = sanitizeCharacterName_(payload.characterName || payload.userId);
      validateCredentials_(userId, password, characterName);

      var accounts = readAccounts_();
      if (accounts.accounts[userId]) {
        throw new Error('ID nay da ton tai. Hay dang nhap hoac chon ID khac.');
      }
      if (Object.keys(accounts.accounts).length >= PNTT_CONFIG.MAX_ACCOUNTS) {
        throw new Error('Da dat gioi han ' + PNTT_CONFIG.MAX_ACCOUNTS + ' tai khoan.');
      }

      var now = new Date().toISOString();
      var salt = makeSalt_();
      accounts.accounts[userId] = {
        userId: userId,
        characterName: characterName,
        salt: salt,
        passwordHash: hashPassword_(password, salt),
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
        lastSaveAt: '',
        meta: {}
      };
      writeAccounts_(accounts);

      var token = createSession_(userId);
      return {
        ok: true,
        token: token,
        user: publicUser_(accounts.accounts[userId]),
        saveJson: null,
        message: 'Tao tai khoan thanh cong.'
      };
    });
  });
}

function pnttLogin(payload) {
  return withLock_(function () {
    return safeResult_(function () {
      payload = payload || {};
      var userId = normalizeUserId_(payload.userId);
      var password = String(payload.password || '');
      if (!userId || !password) {
        throw new Error('Can nhap ID va mat khau.');
      }

      var accounts = readAccounts_();
      var account = accounts.accounts[userId];
      if (!account || account.passwordHash !== hashPassword_(password, account.salt)) {
        throw new Error('Sai ID hoac mat khau.');
      }

      account.lastLoginAt = new Date().toISOString();
      account.updatedAt = account.lastLoginAt;
      writeAccounts_(accounts);

      var token = createSession_(userId);
      return {
        ok: true,
        token: token,
        user: publicUser_(account),
        saveJson: readSaveJson_(userId),
        message: 'Dang nhap thanh cong.'
      };
    });
  });
}

function pnttLoadGame(payload) {
  return safeResult_(function () {
    payload = payload || {};
    var session = requireSession_(payload.token);
    var accounts = readAccounts_();
    var account = accounts.accounts[session.userId];
    if (!account) throw new Error('Tai khoan khong ton tai.');
    return {
      ok: true,
      user: publicUser_(account),
      saveJson: readSaveJson_(session.userId),
      serverTime: new Date().toISOString()
    };
  });
}

function pnttSaveGame(payload) {
  return withLock_(function () {
    return safeResult_(function () {
      payload = payload || {};
      var session = requireSession_(payload.token);
      var saveJson = String(payload.saveJson || '');
      if (!saveJson) throw new Error('Save rong.');
      if (saveJson.length > 8 * 1024 * 1024) {
        throw new Error('Save qua lon, can don bot vat pham/log truoc khi luu.');
      }
      JSON.parse(saveJson);

      writeSaveJson_(session.userId, saveJson);

      var accounts = readAccounts_();
      var account = accounts.accounts[session.userId];
      if (account) {
        account.lastSaveAt = new Date().toISOString();
        account.updatedAt = account.lastSaveAt;
        account.meta = payload.meta || {};
        writeAccounts_(accounts);
      }

      return {
        ok: true,
        savedAt: new Date().toISOString(),
        bytes: saveJson.length
      };
    });
  });
}

function pnttLogout(payload) {
  return safeResult_(function () {
    payload = payload || {};
    if (payload.token) {
      CacheService.getScriptCache().remove(PNTT_CONFIG.SESSION_PREFIX + payload.token);
    }
    return { ok: true };
  });
}

function pnttAdminListAccounts(adminKey) {
  return safeResult_(function () {
    requireAdmin_(adminKey);
    var accounts = readAccounts_();
    var rows = Object.keys(accounts.accounts || {}).map(function (id) {
      return publicUser_(accounts.accounts[id]);
    });
    return { ok: true, accounts: rows };
  });
}

function pnttAdminCreateAccount(payload) {
  return withLock_(function () {
    return safeResult_(function () {
      payload = payload || {};
      requireAdmin_(payload.adminKey);
      var userId = normalizeUserId_(payload.userId);
      var password = String(payload.password || '');
      var characterName = sanitizeCharacterName_(payload.characterName || payload.userId);
      validateCredentials_(userId, password, characterName);

      var accounts = readAccounts_();
      if (accounts.accounts[userId]) throw new Error('ID da ton tai: ' + userId);
      if (Object.keys(accounts.accounts).length >= PNTT_CONFIG.MAX_ACCOUNTS) {
        throw new Error('Da dat gioi han ' + PNTT_CONFIG.MAX_ACCOUNTS + ' tai khoan.');
      }

      var now = new Date().toISOString();
      var salt = makeSalt_();
      accounts.accounts[userId] = {
        userId: userId,
        characterName: characterName,
        salt: salt,
        passwordHash: hashPassword_(password, salt),
        createdAt: now,
        updatedAt: now,
        lastLoginAt: '',
        lastSaveAt: '',
        meta: {}
      };
      writeAccounts_(accounts);
      return { ok: true, user: publicUser_(accounts.accounts[userId]) };
    });
  });
}

function safeResult_(fn) {
  try {
    return fn();
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err)
    };
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function getRootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('PNTT_DATA_FOLDER_ID');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (err) {
      props.deleteProperty('PNTT_DATA_FOLDER_ID');
    }
  }
  var folders = DriveApp.getFoldersByName(PNTT_CONFIG.ROOT_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PNTT_CONFIG.ROOT_FOLDER_NAME);
  props.setProperty('PNTT_DATA_FOLDER_ID', folder.getId());
  return folder;
}

function getSavesFolder_() {
  var root = getRootFolder_();
  var folders = root.getFoldersByName(PNTT_CONFIG.SAVES_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : root.createFolder(PNTT_CONFIG.SAVES_FOLDER_NAME);
}

function getOrCreateFile_(folder, name, initialContent) {
  var files = folder.getFilesByName(name);
  if (files.hasNext()) return files.next();
  return folder.createFile(name, initialContent || '', MimeType.PLAIN_TEXT);
}

function getFileByName_(folder, name) {
  var files = folder.getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}

function readAccounts_() {
  var root = getRootFolder_();
  var file = getOrCreateFile_(root, PNTT_CONFIG.ACCOUNTS_FILE_NAME, JSON.stringify({
    version: 1,
    appName: PNTT_CONFIG.APP_NAME,
    createdAt: new Date().toISOString(),
    accounts: {}
  }, null, 2));
  var raw = file.getBlob().getDataAsString('UTF-8') || '{}';
  var data = JSON.parse(raw);
  data.accounts = data.accounts || {};
  return data;
}

function writeAccounts_(accounts) {
  accounts.version = accounts.version || 1;
  accounts.appName = accounts.appName || PNTT_CONFIG.APP_NAME;
  accounts.updatedAt = new Date().toISOString();
  var file = getOrCreateFile_(getRootFolder_(), PNTT_CONFIG.ACCOUNTS_FILE_NAME, '{}');
  file.setContent(JSON.stringify(accounts, null, 2));
}

function saveFileName_(userId) {
  return 'save_' + userId.replace(/[^a-z0-9_.-]/g, '_') + '.json';
}

function readSaveJson_(userId) {
  var file = getFileByName_(getSavesFolder_(), saveFileName_(userId));
  if (!file) return null;
  return file.getBlob().getDataAsString('UTF-8') || null;
}

function writeSaveJson_(userId, saveJson) {
  var file = getOrCreateFile_(getSavesFolder_(), saveFileName_(userId), '{}');
  file.setContent(saveJson);
}

function normalizeUserId_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9_.-]/g, '');
}

function sanitizeCharacterName_(value) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, 32);
}

function validateCredentials_(userId, password, characterName) {
  if (!/^[a-z0-9_.-]{3,32}$/.test(userId)) {
    throw new Error('ID chi dung a-z, 0-9, dau cham, gach duoi, gach ngang; dai 3-32 ky tu.');
  }
  if (!password || password.length < 4 || password.length > 64) {
    throw new Error('Mat khau can dai 4-64 ky tu.');
  }
  if (!characterName || characterName.length < 1 || characterName.length > 32) {
    throw new Error('Ten nhan vat can dai 1-32 ky tu.');
  }
}

function makeSalt_() {
  return Utilities.getUuid().replace(/-/g, '') + String(Date.now());
}

function hashPassword_(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + '|' + String(password),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64Encode(bytes);
}

function createSession_(userId) {
  var token = Utilities.getUuid() + '-' + Utilities.getUuid();
  var session = {
    userId: userId,
    issuedAt: new Date().toISOString()
  };
  CacheService.getScriptCache().put(
    PNTT_CONFIG.SESSION_PREFIX + token,
    JSON.stringify(session),
    PNTT_CONFIG.TOKEN_TTL_SECONDS
  );
  return token;
}

function requireSession_(token) {
  token = String(token || '');
  if (!token) throw new Error('Chua dang nhap.');
  var key = PNTT_CONFIG.SESSION_PREFIX + token;
  var raw = CacheService.getScriptCache().get(key);
  if (!raw) throw new Error('Phien dang nhap da het han. Hay dang nhap lai.');
  CacheService.getScriptCache().put(key, raw, PNTT_CONFIG.TOKEN_TTL_SECONDS);
  return JSON.parse(raw);
}

function publicUser_(account) {
  return {
    userId: account.userId,
    characterName: account.characterName,
    createdAt: account.createdAt || '',
    lastLoginAt: account.lastLoginAt || '',
    lastSaveAt: account.lastSaveAt || '',
    meta: account.meta || {}
  };
}

function requireAdmin_(adminKey) {
  var expected = PropertiesService.getScriptProperties().getProperty('PNTT_ADMIN_KEY');
  if (!expected) throw new Error('Chua cau hinh PNTT_ADMIN_KEY trong Script Properties.');
  if (String(adminKey || '') !== expected) throw new Error('Admin key khong dung.');
}
