'use strict';

const { escapeLike } = require('../utils/text');

// PasswordHash is deliberately excluded; only findCredentials() reads it.
const USER_COLUMNS = `u.UserID, u.Username, u.FullName, u.Email, u.RoleID, r.Code AS RoleCode, r.Name AS RoleName,
  r.IsSystem AS RoleIsSystem, u.IsActive, u.LastLoginDate, u.CreateDate, u.UpdateDate`;
const FROM = 'FROM Users u JOIN Roles r ON r.RoleID = u.RoleID';

function createUserRepository(db) {
  const cache = new Map();
  const stmt = (sql) => {
    let prepared = cache.get(sql);
    if (!prepared) {
      prepared = db.prepare(sql);
      cache.set(sql, prepared);
    }
    return prepared;
  };

  /** Diacritic-insensitive match on Username / FullName / Email (`q` already normalized). */
  function where(q) {
    if (!q) return { sql: '', params: [] };
    const pattern = `%${escapeLike(q)}%`;
    return {
      sql: `WHERE (vn_normalize(u.Username) LIKE ? ESCAPE '\\'
              OR vn_normalize(u.FullName) LIKE ? ESCAPE '\\'
              OR vn_normalize(u.Email) LIKE ? ESCAPE '\\')`,
      params: [pattern, pattern, pattern],
    };
  }

  return {
    findById(id) {
      return stmt(`SELECT ${USER_COLUMNS} ${FROM} WHERE u.UserID = ?`).get(id) ?? null;
    },

    findByUsername(username) {
      return stmt(`SELECT ${USER_COLUMNS} ${FROM} WHERE u.Username = ?`).get(username) ?? null;
    },

    /** Login lookup: includes PasswordHash. Never send this row to a client. */
    findCredentials(username) {
      return stmt('SELECT UserID, Username, PasswordHash, IsActive FROM Users WHERE Username = ?').get(username) ?? null;
    },

    count({ q = '' } = {}) {
      const w = where(q);
      return stmt(`SELECT COUNT(*) AS total ${FROM} ${w.sql}`).get(...w.params).total;
    },

    findPage({ q = '', limit, offset }) {
      const w = where(q);
      return stmt(`SELECT ${USER_COLUMNS} ${FROM} ${w.sql} ORDER BY u.UserID ASC LIMIT ? OFFSET ?`).all(
        ...w.params,
        limit,
        offset,
      );
    },

    insert({ Username, PasswordHash, FullName, Email, RoleID, IsActive, CreateDate }) {
      const result = stmt(`
        INSERT INTO Users (Username, PasswordHash, FullName, Email, RoleID, IsActive, LastLoginDate, CreateDate, UpdateDate)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(Username, PasswordHash, FullName, Email ?? null, RoleID, IsActive ? 1 : 0, CreateDate, CreateDate);
      return Number(result.lastInsertRowid);
    },

    update(id, { FullName, Email, RoleID, IsActive, UpdateDate }) {
      return Number(
        stmt('UPDATE Users SET FullName = ?, Email = ?, RoleID = ?, IsActive = ?, UpdateDate = ? WHERE UserID = ?').run(
          FullName,
          Email ?? null,
          RoleID,
          IsActive ? 1 : 0,
          UpdateDate,
          id,
        ).changes,
      );
    },

    updatePassword(id, passwordHash, updateDate) {
      return Number(
        stmt('UPDATE Users SET PasswordHash = ?, UpdateDate = ? WHERE UserID = ?').run(passwordHash, updateDate, id).changes,
      );
    },

    updateLastLogin(id, date) {
      stmt('UPDATE Users SET LastLoginDate = ? WHERE UserID = ?').run(date, id);
    },

    deleteById(id) {
      return Number(stmt('DELETE FROM Users WHERE UserID = ?').run(id).changes);
    },

    /** Active users whose role is a system (admin) role, optionally excluding one user. */
    countActiveSystemUsers({ excludeUserId = 0 } = {}) {
      return stmt(`SELECT COUNT(*) AS n ${FROM} WHERE r.IsSystem = 1 AND u.IsActive = 1 AND u.UserID <> ?`).get(
        excludeUserId,
      ).n;
    },
  };
}

module.exports = { createUserRepository };
