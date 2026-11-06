'use strict';

const ROLE_COLUMNS = `r.RoleID, r.Code, r.Name, r.Description, r.IsSystem, r.CreateDate, r.UpdateDate,
  (SELECT COUNT(*) FROM Users u WHERE u.RoleID = r.RoleID) AS UserCount`;

function createRoleRepository(db) {
  const cache = new Map();
  const stmt = (sql) => {
    let prepared = cache.get(sql);
    if (!prepared) {
      prepared = db.prepare(sql);
      cache.set(sql, prepared);
    }
    return prepared;
  };

  return {
    findAll() {
      return stmt(`SELECT ${ROLE_COLUMNS} FROM Roles r ORDER BY r.RoleID ASC`).all();
    },

    findById(id) {
      return stmt(`SELECT ${ROLE_COLUMNS} FROM Roles r WHERE r.RoleID = ?`).get(id) ?? null;
    },

    findByCode(code) {
      return stmt(`SELECT ${ROLE_COLUMNS} FROM Roles r WHERE r.Code = ?`).get(code) ?? null;
    },

    findOptions() {
      return stmt('SELECT RoleID, Code, Name FROM Roles ORDER BY RoleID ASC').all();
    },

    /** Permission codes stored for one role (unsorted). */
    findPermissionCodes(roleId) {
      return stmt('SELECT PermissionCode FROM RolePermissions WHERE RoleID = ?')
        .all(roleId)
        .map((row) => row.PermissionCode);
    },

    /** Map RoleID → [codes] for every role. */
    findAllPermissionCodes() {
      const map = new Map();
      for (const row of stmt('SELECT RoleID, PermissionCode FROM RolePermissions').all()) {
        if (!map.has(row.RoleID)) map.set(row.RoleID, []);
        map.get(row.RoleID).push(row.PermissionCode);
      }
      return map;
    },

    insert({ Code, Name, Description, IsSystem = 0, CreateDate }) {
      const result = stmt(`
        INSERT INTO Roles (Code, Name, Description, IsSystem, CreateDate, UpdateDate) VALUES (?, ?, ?, ?, ?, ?)
      `).run(Code, Name, Description ?? null, IsSystem ? 1 : 0, CreateDate, CreateDate);
      return Number(result.lastInsertRowid);
    },

    update(id, { Name, Description, UpdateDate }) {
      return Number(
        stmt('UPDATE Roles SET Name = ?, Description = ?, UpdateDate = ? WHERE RoleID = ?').run(
          Name,
          Description ?? null,
          UpdateDate,
          id,
        ).changes,
      );
    },

    /** Replaces the permission set of a role (call inside a transaction). */
    replacePermissions(roleId, codes) {
      stmt('DELETE FROM RolePermissions WHERE RoleID = ?').run(roleId);
      const insert = stmt('INSERT INTO RolePermissions (RoleID, PermissionCode) VALUES (?, ?)');
      for (const code of codes) insert.run(roleId, code);
    },

    deleteById(id) {
      return Number(stmt('DELETE FROM Roles WHERE RoleID = ?').run(id).changes);
    },
  };
}

module.exports = { createRoleRepository };
