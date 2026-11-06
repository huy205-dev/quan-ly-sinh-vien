'use strict';

/**
 * Password hashing with scrypt (node:crypto). Stored format: scrypt$<saltHex>$<hashHex>.
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCRYPT_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function format(salt, hash) {
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function parse(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return null;
  if (!/^[0-9a-f]+$/i.test(parts[1]) || !/^[0-9a-f]+$/i.test(parts[2])) return null;
  const salt = Buffer.from(parts[1], 'hex');
  const hash = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || hash.length !== KEY_LENGTH) return null;
  return { salt, hash };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await scryptAsync(String(password).normalize('NFC'), salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return format(salt, hash);
}

/** Synchronous variant, used only when seeding a new database. */
function hashPasswordSync(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(String(password).normalize('NFC'), salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return format(salt, hash);
}

// Hash of a random secret: lets login spend the same scrypt time when the username does not exist.
let dummyHash = null;
function getDummyHash() {
  if (!dummyHash) dummyHash = hashPasswordSync(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

/** Constant-time comparison of a password against a stored scrypt hash. */
async function verifyPassword(password, stored) {
  const parsed = parse(stored);
  if (!parsed || typeof password !== 'string') return false;
  const candidate = await scryptAsync(password.normalize('NFC'), parsed.salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return crypto.timingSafeEqual(candidate, parsed.hash);
}

module.exports = { hashPassword, hashPasswordSync, verifyPassword, getDummyHash };
