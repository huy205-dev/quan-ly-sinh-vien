'use strict';

const { PERMISSIONS, ALL_PERMISSION_CODES } = require('../constants/permissions');
const { hashPasswordSync } = require('../utils/password');
const { buildStudentSearchText } = require('../utils/text');

const ROLES = [
  {
    Code: 'admin',
    Name: 'Quản trị viên',
    Description: 'Vai trò hệ thống, luôn có toàn quyền. Không thể sửa quyền hoặc xóa.',
    IsSystem: 1,
    Permissions: ALL_PERMISSION_CODES,
  },
  {
    Code: 'giaovu',
    Name: 'Giáo vụ',
    Description: 'Quản lý toàn bộ hồ sơ sinh viên, xem danh sách người dùng.',
    IsSystem: 0,
    Permissions: [
      'student.read',
      'student.create',
      'student.update',
      'student.delete',
      'student.import',
      'student.export',
      'user.read',
    ],
  },
  {
    Code: 'giangvien',
    Name: 'Giảng viên',
    Description: 'Xem, cập nhật và xuất danh sách sinh viên.',
    IsSystem: 0,
    Permissions: ['student.read', 'student.update', 'student.export'],
  },
  {
    Code: 'viewer',
    Name: 'Người xem',
    Description: 'Chỉ được xem danh sách sinh viên.',
    IsSystem: 0,
    Permissions: ['student.read'],
  },
];

const USERS = [
  { Username: 'admin', Password: 'Admin@123', FullName: 'Nguyễn Quản Trị', Email: 'admin@qlsv.edu.vn', RoleCode: 'admin' },
  { Username: 'giaovu', Password: 'Giaovu@123', FullName: 'Trần Thị Giáo Vụ', Email: 'giaovu@qlsv.edu.vn', RoleCode: 'giaovu' },
  { Username: 'giangvien', Password: 'Giangvien@123', FullName: 'Lê Văn Giảng', Email: 'giangvien@qlsv.edu.vn', RoleCode: 'giangvien' },
  { Username: 'viewer', Password: 'Viewer@123', FullName: 'Phạm Người Xem', Email: 'viewer@qlsv.edu.vn', RoleCode: 'viewer' },
];

const MAJORS = {
  CNTT: 'Công nghệ thông tin',
  KTPM: 'Kỹ thuật phần mềm',
  HTTT: 'Hệ thống thông tin',
  QTKD: 'Quản trị kinh doanh',
  KHMT: 'Khoa học máy tính',
  ATTT: 'An toàn thông tin',
  MKT: 'Marketing',
};

// [FullName, Gender, DateOfBirth, ClassName, emailUser|null, Phone|null, Address, GPA, Description|null]
const STUDENTS = [
  ['Nguyễn Văn An', 'Nam', '2000-03-15', 'CNTT-K18A', 'an.nv', '0901234561', 'Quận 1, TP. Hồ Chí Minh', 3.45, 'Lớp trưởng lớp CNTT-K18A'],
  ['Trần Thị Bích Ngọc', 'Nữ', '2000-07-22', 'CNTT-K18A', 'ngoc.ttb', '0912345672', 'Cầu Giấy, Hà Nội', 3.72, null],
  ['Lê Hoàng Long', 'Nam', '2000-11-05', 'CNTT-K18A', null, '0987654323', 'Hải Châu, Đà Nẵng', 2.85, null],
  ['Phạm Minh Châu', 'Nữ', '2000-01-30', 'CNTT-K18A', 'chau.pm', null, 'Ninh Kiều, Cần Thơ', 3.1, null],
  ['Hoàng Đức Hải', 'Nam', '2000-09-12', 'CNTT-K18B', 'hai.hd', '0938123455', 'Biên Hòa, Đồng Nai', 2.64, 'Đang nợ môn Cấu trúc dữ liệu và giải thuật'],
  ['Vũ Thu Hằng', 'Nữ', '2000-04-18', 'CNTT-K18B', 'hang.vt', '0977456126', 'Thủ Dầu Một, Bình Dương', 3.88, 'Học bổng loại giỏi học kỳ 2'],
  ['Đặng Quốc Dũng', 'Nam', '2000-12-01', 'CNTT-K18B', 'dung.dq', '0909876547', 'Bình Thạnh, TP. Hồ Chí Minh', 3.02, null],
  ['Bùi Thị Mai', 'Nữ', '2000-06-25', 'CNTT-K18B', null, '0918765438', 'Nha Trang, Khánh Hòa', 2.47, null],
  ['Đỗ Thanh Phong', 'Nam', '2001-02-14', 'KTPM-K19A', 'phong.dt', '0965432109', 'Quận 7, TP. Hồ Chí Minh', 3.56, 'Thành viên CLB Lập trình'],
  ['Hồ Ngọc Lan', 'Nữ', '2001-08-09', 'KTPM-K19A', 'lan.hn', '0932109870', 'Đống Đa, Hà Nội', 3.91, null],
  ['Ngô Gia Huy', 'Nam', '2001-05-03', 'KTPM-K19A', 'huy.ng', null, 'TP. Huế, Thừa Thiên Huế', 2.98, null],
  ['Dương Thị Thảo', 'Nữ', '2001-10-27', 'KTPM-K19A', 'thao.dt', '0945678901', 'Long Xuyên, An Giang', 3.33, null],
  ['Lý Minh Quân', 'Nam', '2001-03-21', 'KTPM-K19A', 'quan.lm', '0923456782', 'Gò Vấp, TP. Hồ Chí Minh', 2.71, null],
  ['Nguyễn Thị Quỳnh', 'Nữ', '2001-12-11', 'QTKD-K19B', 'quynh.nt', '0981234563', 'TP. Vinh, Nghệ An', 3.24, null],
  ['Trần Văn Sơn', 'Nam', '2001-07-07', 'QTKD-K19B', 'son.tv', '0903456784', 'Hạ Long, Quảng Ninh', 2.56, null],
  ['Phan Thanh Tâm', 'Khác', '2001-09-19', 'QTKD-K19B', 'tam.pt', '0914567895', 'Quy Nhơn, Bình Định', 3.15, null],
  ['Võ Anh Tuấn', 'Nam', '2001-01-08', 'QTKD-K19B', 'tuan.va', '0976543216', 'Rạch Giá, Kiên Giang', 2.89, 'Cán sự lớp'],
  ['Huỳnh Thị Uyên', 'Nữ', '2002-04-02', 'HTTT-K20A', 'uyen.ht', '0937654327', 'Quận 3, TP. Hồ Chí Minh', 3.67, null],
  ['Nguyễn Quang Vinh', 'Nam', '2002-06-16', 'HTTT-K20A', 'vinh.nq', '0968765438', 'Thanh Xuân, Hà Nội', 3.05, null],
  ['Lê Thị Hải Yến', 'Nữ', '2002-02-28', 'HTTT-K20A', 'yen.lth', null, 'Sơn Trà, Đà Nẵng', 3.79, null],
  ['Phạm Văn Nam', 'Nam', '2002-11-23', 'HTTT-K20A', 'nam.pv', '0949876549', 'Buôn Ma Thuột, Đắk Lắk', 2.38, null],
  ['Trần Bảo Ngọc', 'Nữ', '2002-08-14', 'HTTT-K20A', 'ngoc.tb', '0921987650', 'Mỹ Tho, Tiền Giang', 3.5, null],
  ['Đặng Thị Hà', 'Nữ', '2002-05-05', 'KHMT-K20B', 'ha.dt', '0982345671', 'Hai Bà Trưng, Hà Nội', 3.83, 'Giải Nhì Olympic Tin học sinh viên'],
  ['Bùi Minh Khoa', 'Nam', '2002-10-10', 'KHMT-K20B', 'khoa.bm', '0904567892', 'TP. Thủ Đức, TP. Hồ Chí Minh', 3.27, null],
  ['Hoàng Thị Thu Trang', 'Nữ', '2002-03-17', 'KHMT-K20B', 'trang.htt', '0915678903', 'Lê Chân, Hải Phòng', 2.93, null],
  ['Vũ Đức Thắng', 'Nam', '2002-12-29', 'KHMT-K20B', 'thang.vd', null, 'TP. Nam Định, Nam Định', 3.41, null],
  ['Ngô Thanh Hương', 'Nữ', '2003-01-20', 'ATTT-K21A', 'huong.nt', '0939876544', 'Pleiku, Gia Lai', 3.6, null],
  ['Đỗ Quốc Bảo', 'Nam', '2003-07-04', 'ATTT-K21A', 'bao.dq', '0961234565', 'Vũng Tàu, Bà Rịa - Vũng Tàu', 2.75, null],
  ['Lý Thị Kim Chi', 'Nữ', '2003-09-26', 'ATTT-K21A', 'chi.ltk', '0942345676', 'TP. Cà Mau, Cà Mau', 3.12, null],
  ['Phan Văn Đạt', 'Nam', '2003-04-13', 'ATTT-K21A', 'dat.pv', '0924567897', 'TP. Thái Nguyên, Thái Nguyên', 2.2, 'Cần bổ sung hồ sơ nhập học'],
  ['Nguyễn Hoàng Phúc', 'Nam', '2003-06-01', 'ATTT-K21A', 'phuc.nh', '0985678908', 'TP. Bắc Ninh, Bắc Ninh', 3.48, null],
  ['Trương Thị Lan Anh', 'Nữ', '2003-11-11', 'MKT-K21B', 'anh.ttl', '0906789019', 'Quận 10, TP. Hồ Chí Minh', 3.36, null],
  ['Võ Minh Triết', 'Nam', '2003-02-07', 'MKT-K21B', 'triet.vm', '0917890120', 'Tân An, Long An', 2.82, null],
  ['Huỳnh Ngọc Diễm', 'Nữ', '2003-08-30', 'MKT-K21B', 'diem.hn', null, 'TP. Bến Tre, Bến Tre', 3.95, 'Thủ khoa đầu vào khóa 21'],
  ['Đinh Công Minh', 'Nam', '2003-05-24', 'MKT-K21B', 'minh.dc', '0978901231', 'Ba Đình, Hà Nội', 2.66, null],
  ['Lâm Thị Phương', 'Nữ', '2003-10-15', 'MKT-K21B', 'phuong.lt', '0930123452', 'TP. Sóc Trăng, Sóc Trăng', 3.19, null],
];

/** Inserts/updates catalog permissions and removes codes that are no longer in the catalog. */
function syncPermissionCatalog(db) {
  const upsert = db.prepare(`
    INSERT INTO Permissions (Code, Module, Action, Name) VALUES (?, ?, ?, ?)
    ON CONFLICT(Code) DO UPDATE SET Module = excluded.Module, Action = excluded.Action, Name = excluded.Name
  `);
  for (const p of PERMISSIONS) upsert.run(p.code, p.module, p.action, p.name);

  const known = new Set(ALL_PERMISSION_CODES);
  const remove = db.prepare('DELETE FROM Permissions WHERE Code = ?');
  for (const { Code } of db.prepare('SELECT Code FROM Permissions').all()) {
    if (!known.has(Code)) remove.run(Code);
  }
}

/** System roles always own every permission (kept in sync when the catalog grows). */
function ensureSystemRolePermissions(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO RolePermissions (RoleID, PermissionCode) VALUES (?, ?)');
  for (const { RoleID } of db.prepare('SELECT RoleID FROM Roles WHERE IsSystem = 1').all()) {
    for (const code of ALL_PERMISSION_CODES) insert.run(RoleID, code);
  }
}

function seedRolesAndUsers(db, now) {
  const insertRole = db.prepare(`
    INSERT INTO Roles (Code, Name, Description, IsSystem, CreateDate, UpdateDate) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertRolePermission = db.prepare('INSERT INTO RolePermissions (RoleID, PermissionCode) VALUES (?, ?)');
  const roleIds = new Map();
  for (const role of ROLES) {
    const { lastInsertRowid } = insertRole.run(role.Code, role.Name, role.Description, role.IsSystem, now, now);
    const roleId = Number(lastInsertRowid);
    roleIds.set(role.Code, roleId);
    for (const code of role.Permissions) insertRolePermission.run(roleId, code);
  }

  const insertUser = db.prepare(`
    INSERT INTO Users (Username, PasswordHash, FullName, Email, RoleID, IsActive, LastLoginDate, CreateDate, UpdateDate)
    VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?)
  `);
  for (const user of USERS) {
    insertUser.run(user.Username, hashPasswordSync(user.Password), user.FullName, user.Email, roleIds.get(user.RoleCode), now, now);
  }
}

function seedStudents(db, now) {
  const insert = db.prepare(`
    INSERT INTO Students (FullName, PathImage, Gender, DateOfBirth, ClassName, Major, Email, Phone, Address, GPA, Description,
                          CreateDate, UpdateDate, SearchText)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [FullName, Gender, DateOfBirth, ClassName, emailUser, Phone, Address, GPA, Description] of STUDENTS) {
    const student = {
      FullName,
      Gender,
      DateOfBirth,
      ClassName,
      Major: MAJORS[ClassName.split('-')[0]],
      Email: emailUser ? `${emailUser}@sv.qlsv.edu.vn` : null,
      Phone,
      Address,
      GPA,
      Description,
    };
    insert.run(
      student.FullName,
      student.Gender,
      student.DateOfBirth,
      student.ClassName,
      student.Major,
      student.Email,
      student.Phone,
      student.Address,
      student.GPA,
      student.Description,
      now,
      now,
      buildStudentSearchText(student),
    );
  }
}

/**
 * Syncs the permission catalog; on an empty database (no roles yet) seeds roles, users and students.
 * Must run inside a transaction (see db/index.js).
 */
function seedDatabase(db, { now = new Date().toISOString() } = {}) {
  syncPermissionCatalog(db);
  const isEmpty = db.prepare('SELECT COUNT(*) AS n FROM Roles').get().n === 0;
  if (isEmpty) {
    seedRolesAndUsers(db, now);
    if (db.prepare('SELECT COUNT(*) AS n FROM Students').get().n === 0) seedStudents(db, now);
  }
  ensureSystemRolePermissions(db);
  return { seeded: isEmpty };
}

module.exports = { seedDatabase, syncPermissionCatalog, ROLES, USERS, STUDENTS };
