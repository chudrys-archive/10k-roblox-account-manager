'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA, atomicWrite, logger } = require('./util');

const log = logger('vault');
const FILE = path.join(DATA, 'accounts.vault');
const BACKUP_DIR = path.join(DATA, 'backups');
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

/**
 * Encrypted account store. AES-256-GCM over the whole JSON blob.
 * Key protection:
 *   - "dpapi": random key wrapped by Windows DPAPI (CurrentUser) – no prompt, tied to this Windows user.
 *   - "scrypt": key derived from a master password – must unlock on start.
 */
class Vault {
  constructor(helper) {
    this.helper = helper;
    this.key = null;
    this.kdf = null;
    this.salt = null;
    this.wrappedKey = null;
    this.data = null;
    this.lastBackup = 0;
  }

  get locked() { return !this.key; }
  get exists() { return fs.existsSync(FILE); }

  async init() {
    if (!this.exists) {
      await this._createDpapi();
      this.data = { accounts: [] };
      this.save(this.data);
      log.info('created new DPAPI-protected vault');
      return;
    }
    const env = this._readEnvelope();
    this.kdf = env.kdf;
    if (env.kdf === 'dpapi') {
      try {
        const raw = await this.helper.call('unprotect', { data: env.wrappedKey });
        this.key = Buffer.from(raw, 'base64');
        this.wrappedKey = env.wrappedKey;
      } catch (e) {
        throw new Error('Could not unwrap vault key with DPAPI (was it created under a different Windows user?): ' + e.message);
      }
      this.data = this._decrypt(env, this.key);
    }
    // scrypt: stays locked until unlock(password)
  }

  _readEnvelope() {
    const env = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (env.v !== 1) throw new Error('unsupported vault version');
    return env;
  }

  async _createDpapi() {
    this.key = crypto.randomBytes(32);
    this.wrappedKey = await this.helper.call('protect', { data: this.key.toString('base64') });
    this.kdf = 'dpapi';
    this.salt = null;
  }

  unlock(password) {
    const env = this._readEnvelope();
    if (env.kdf !== 'scrypt') return true;
    const key = crypto.scryptSync(String(password), Buffer.from(env.salt, 'base64'), 32, SCRYPT);
    const data = this._decrypt(env, key); // throws on wrong password
    this.key = key;
    this.salt = Buffer.from(env.salt, 'base64');
    this.data = data;
    return true;
  }

  _decrypt(env, key) {
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
      d.setAuthTag(Buffer.from(env.tag, 'base64'));
      const pt = Buffer.concat([d.update(Buffer.from(env.data, 'base64')), d.final()]);
      return JSON.parse(pt.toString('utf8'));
    } catch {
      throw new Error('Vault decryption failed (wrong password or corrupted file)');
    }
  }

  save(data) {
    if (!this.key) throw new Error('vault is locked');
    this.data = data;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(data), 'utf8')), c.final()]);
    const env = {
      v: 1, kdf: this.kdf,
      salt: this.salt ? this.salt.toString('base64') : undefined,
      wrappedKey: this.kdf === 'dpapi' ? this.wrappedKey : undefined,
      iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: ct.toString('base64'),
      savedAt: new Date().toISOString(),
    };
    this._backup();
    atomicWrite(FILE, JSON.stringify(env));
  }

  /** Keep rolling backups (at most one per 10 min, newest 15 kept). Backups are still encrypted. */
  _backup() {
    if (!fs.existsSync(FILE) || Date.now() - this.lastBackup < 10 * 60 * 1000) return;
    this.lastBackup = Date.now();
    try {
      const name = `accounts-${new Date().toISOString().replace(/[:.]/g, '-')}.vault`;
      fs.copyFileSync(FILE, path.join(BACKUP_DIR, name));
      const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('accounts-')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 15))) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
    } catch (e) { log.warn('backup failed: ' + e.message); }
  }

  /** Set (or remove with empty string) a master password. Re-encrypts immediately. */
  async setMasterPassword(newPassword) {
    if (!this.key) throw new Error('vault is locked');
    if (newPassword) {
      this.salt = crypto.randomBytes(16);
      this.key = crypto.scryptSync(String(newPassword), this.salt, 32, SCRYPT);
      this.kdf = 'scrypt';
      this.wrappedKey = null;
    } else {
      await this._createDpapi();
    }
    this.lastBackup = 0;
    this.save(this.data);
    log.info(`vault protection changed to ${this.kdf}`);
  }

  verifyPassword(password) {
    if (this.kdf !== 'scrypt') return true;
    const k = crypto.scryptSync(String(password), this.salt, 32, SCRYPT);
    return crypto.timingSafeEqual(k, this.key);
  }
}

module.exports = { Vault };
