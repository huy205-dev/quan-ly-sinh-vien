'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { GENDERS } = require('../constants/student');
const { normalizeText } = require('../utils/text');
const { seedDatabase } = require('./seed');

const genderList = GENDERS.map((g) => `'${g}'`).join(', ');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS Roles (
  RoleID      INTEGER PRIMARY KEY AUTOINCREMENT,
  Code        TEXT    NOT NULL UNIQUE,
  Name        TEXT    NOT NULL,
  Description TEXT,
  IsSystem    INTEGER NOT NULL DEFAULT 0 CHECK (IsSystem IN (0, 1)),
  CreateDate  TEXT    NOT NULL,
  UpdateDate  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS Permissions (
  Code   TEXT PRIMARY KEY,
  Module TEXT NOT NULL,
  Action TEXT NOT NULL,
  Name   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS RolePermissions (
  RoleID         INTEGER NOT NULL REFERENCES Roles(RoleID) ON DELETE CASCADE,
  PermissionCode TEXT    NOT NULL REFERENCES Permissions(Code) ON DELETE CASCADE,
  PRIMARY KEY (RoleID, PermissionCode)
);

CREATE TABLE IF NOT EXISTS Users (
  UserID        INTEGER PRIMARY KEY AUTOINCREMENT,
  Username      TEXT    NOT NULL UNIQUE,
  PasswordHash  TEXT    NOT NULL,
  FullName      TEXT    NOT NULL,
  Email         TEXT,
  RoleID        INTEGER NOT NULL REFERENCES Roles(RoleID),
  IsActive      INTEGER NOT NULL DEFAULT 1 CHECK (IsActive IN (0, 1)),
  LastLoginDate TEXT,
  CreateDate    TEXT    NOT NULL,
  UpdateDate    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS IX_Users_RoleID ON Users(RoleID);

CREATE TABLE IF NOT EXISTS Students (
  StudentID   INTEGER PRIMARY KEY AUTOINCREMENT,
  FullName    TEXT NOT NULL,
  PathImage   TEXT,
  Gender      TEXT NOT NULL CHECK (Gender IN (${genderList})),
  DateOfBirth TEXT NOT NULL,
  ClassName   TEXT NOT NULL,
  Major       TEXT NOT NULL,
  Email       TEXT,
  Phone       TEXT,
  Address     TEXT,
  GPA         REAL CHECK (GPA IS NULL OR (GPA >= 0 AND GPA <= 4)),
  Description TEXT,
  CreateDate  TEXT NOT NULL,
  UpdateDate  TEXT NOT NULL,
  SearchText  TEXT NOT NULL DEFAULT ''
);
`;

/**
 * Runs `fn` inside BEGIN IMMEDIATE … COMMIT, rolling back on any error.
 * `fn` must be synchronous (node:sqlite is synchronous). Nested calls join the outer transaction.
 */
function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      throw new Error('transaction(fn): fn must be synchronous');
    }
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

function registerFunctions(db) {
  // vn_normalize(text): diacritic-insensitive search key (same algorithm as utils/text.normalizeText).
  db.function('vn_normalize', { deterministic: true }, (value) => normalizeText(value));
  // vn_search_text(a, b, …): normalized concatenation of the non-empty arguments.
  db.function('vn_search_text', { deterministic: true, varargs: true }, (...parts) =>
    normalizeText(parts.filter((p) => p !== null && p !== undefined && p !== '').join(' ')),
  );
}

/**
 * Opens (or creates) the SQLite database: pragmas, schema, permission catalog sync,
 * seed data when empty, SearchText backfill.
 */
function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  registerFunctions(db);
  db.exec(SCHEMA);
  transaction(db, () => {
    seedDatabase(db);
    db.exec(`
      UPDATE Students
      SET SearchText = vn_search_text(FullName, ClassName, Major, Email, Phone, Address, Description)
      WHERE SearchText IS NULL OR SearchText = ''
    `);
  });
  return db;
}

module.exports = { openDatabase, transaction };
