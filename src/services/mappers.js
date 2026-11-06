'use strict';

const { formatStudentCode } = require('../utils/text');

const orNull = (value) => (value === undefined || value === '' ? null : value);

/** Student JSON in the field order defined by the API contract. */
function toStudentDto(row) {
  return {
    StudentID: row.StudentID,
    StudentCode: formatStudentCode(row.StudentID),
    FullName: row.FullName,
    PathImage: orNull(row.PathImage),
    Gender: row.Gender,
    DateOfBirth: row.DateOfBirth,
    ClassName: row.ClassName,
    Major: row.Major,
    Email: orNull(row.Email),
    Phone: orNull(row.Phone),
    Address: orNull(row.Address),
    GPA: orNull(row.GPA),
    Description: orNull(row.Description),
    CreateDate: row.CreateDate,
    UpdateDate: row.UpdateDate,
  };
}

/** Public user object (never includes PasswordHash). */
function toUserDto(row) {
  return {
    UserID: row.UserID,
    Username: row.Username,
    FullName: row.FullName,
    Email: orNull(row.Email),
    RoleID: row.RoleID,
    RoleCode: row.RoleCode,
    RoleName: row.RoleName,
    IsActive: row.IsActive === 1,
    LastLoginDate: orNull(row.LastLoginDate),
    CreateDate: row.CreateDate,
    UpdateDate: row.UpdateDate,
  };
}

function toRoleDto(row, permissions) {
  return {
    RoleID: row.RoleID,
    Code: row.Code,
    Name: row.Name,
    Description: orNull(row.Description),
    IsSystem: row.IsSystem === 1,
    UserCount: row.UserCount ?? 0,
    Permissions: permissions,
    CreateDate: row.CreateDate,
    UpdateDate: row.UpdateDate,
  };
}

module.exports = { toStudentDto, toUserDto, toRoleDto };
