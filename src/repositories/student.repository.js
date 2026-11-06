'use strict';

const { escapeLike } = require('../utils/text');

// SearchText is internal and never selected for API output.
const COLUMNS = `StudentID, FullName, PathImage, Gender, DateOfBirth, ClassName, Major, Email, Phone, Address, GPA,
  Description, CreateDate, UpdateDate`;

/**
 * Data access for the Students table. All SQL is parameterized.
 */
function createStudentRepository(db) {
  const cache = new Map();
  const stmt = (sql) => {
    let prepared = cache.get(sql);
    if (!prepared) {
      prepared = db.prepare(sql);
      cache.set(sql, prepared);
    }
    return prepared;
  };

  /** `q` must already be normalized (utils/text.normalizeText). */
  function where(q) {
    if (!q) return { sql: '', params: [] };
    const pattern = `%${escapeLike(q)}%`;
    return {
      sql: `WHERE (SearchText LIKE ? ESCAPE '\\' OR printf('sv%06d', StudentID) LIKE ? ESCAPE '\\')`,
      params: [pattern, pattern],
    };
  }

  function toParams(record) {
    return {
      FullName: record.FullName,
      PathImage: record.PathImage ?? null,
      Gender: record.Gender,
      DateOfBirth: record.DateOfBirth,
      ClassName: record.ClassName,
      Major: record.Major,
      Email: record.Email ?? null,
      Phone: record.Phone ?? null,
      Address: record.Address ?? null,
      GPA: record.GPA ?? null,
      Description: record.Description ?? null,
      UpdateDate: record.UpdateDate,
      SearchText: record.SearchText,
    };
  }

  return {
    findById(id) {
      return stmt(`SELECT ${COLUMNS} FROM Students WHERE StudentID = ?`).get(id) ?? null;
    },

    count({ q = '' } = {}) {
      const w = where(q);
      return stmt(`SELECT COUNT(*) AS total FROM Students ${w.sql}`).get(...w.params).total;
    },

    /** One page, newest first. */
    findPage({ q = '', limit, offset }) {
      const w = where(q);
      return stmt(`SELECT ${COLUMNS} FROM Students ${w.sql} ORDER BY StudentID DESC LIMIT ? OFFSET ?`).all(
        ...w.params,
        limit,
        offset,
      );
    },

    /** Every matching row in ascending ID order (export). */
    findAll({ q = '' } = {}) {
      const w = where(q);
      return stmt(`SELECT ${COLUMNS} FROM Students ${w.sql} ORDER BY StudentID ASC`).all(...w.params);
    },

    insert(record) {
      const result = stmt(`
        INSERT INTO Students (FullName, PathImage, Gender, DateOfBirth, ClassName, Major, Email, Phone, Address, GPA,
                              Description, CreateDate, UpdateDate, SearchText)
        VALUES ($FullName, $PathImage, $Gender, $DateOfBirth, $ClassName, $Major, $Email, $Phone, $Address, $GPA,
                $Description, $CreateDate, $UpdateDate, $SearchText)
      `).run({ ...toParams(record), CreateDate: record.CreateDate });
      return Number(result.lastInsertRowid);
    },

    /** Returns the number of updated rows (0 when the student does not exist). */
    update(id, record) {
      const result = stmt(`
        UPDATE Students
        SET FullName = $FullName, PathImage = $PathImage, Gender = $Gender, DateOfBirth = $DateOfBirth,
            ClassName = $ClassName, Major = $Major, Email = $Email, Phone = $Phone, Address = $Address, GPA = $GPA,
            Description = $Description, UpdateDate = $UpdateDate, SearchText = $SearchText
        WHERE StudentID = $StudentID
      `).run({ ...toParams(record), StudentID: id });
      return Number(result.changes);
    },

    deleteById(id) {
      return Number(stmt('DELETE FROM Students WHERE StudentID = ?').run(id).changes);
    },
  };
}

module.exports = { createStudentRepository };
