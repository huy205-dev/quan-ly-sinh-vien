'use strict';

const { STUDENT_PAGE_SIZES, COPY_SUFFIX, LIMITS } = require('../constants/student');
const { transaction } = require('../db');
const { validationError, notFound } = require('../utils/http-error');
const { buildStudentSearchText, truncateChars, charLength } = require('../utils/text');
const { nowIso, todayIn } = require('../utils/date');
const { parseId, parseIdList, parseBoolean, validateStudent } = require('../utils/validators');
const { parsePageNumber, parsePageSizeFromList, resolvePage, parseSearchQuery } = require('../utils/pagination');
const { toStudentDto } = require('./mappers');

const NOT_FOUND_MESSAGE = 'Không tìm thấy sinh viên.';
const MAX_IDS_IN_MESSAGE = 10;

/** FullName + " (bản sao)", truncating the base so the result stays within 100 characters. */
function copyName(fullName) {
  const maxBase = LIMITS.FullName.max - charLength(COPY_SUFFIX);
  return `${truncateChars(fullName, maxBase).trimEnd()}${COPY_SUFFIX}`;
}

function missingIdsError(missing, actionLabel) {
  const shown = missing.slice(0, MAX_IDS_IN_MESSAGE).join(', ');
  const more = missing.length > MAX_IDS_IN_MESSAGE ? ` và ${missing.length - MAX_IDS_IN_MESSAGE} ID khác` : '';
  return notFound(
    `Không tìm thấy ${missing.length} sinh viên (ID: ${shown}${more}). Không có bản ghi nào được ${actionLabel}.`,
    missing.slice(0, 100).map((id) => ({ field: 'ids', message: `Không tìm thấy sinh viên có ID ${id}.` })),
  );
}

function createStudentService({ db, studentRepository, imageService, config }) {
  const repo = studentRepository;

  function requireId(value) {
    const id = parseId(value);
    if (!id) throw notFound(NOT_FOUND_MESSAGE);
    return id;
  }

  function validate(body) {
    const { value, errors } = validateStudent(body, { today: todayIn(config.timeZone) });
    if (errors.length > 0) throw validationError(errors);
    return value;
  }

  function toRecord(value, extra) {
    return { ...value, ...extra, SearchText: buildStudentSearchText(value) };
  }

  function readIds(body) {
    const { ids, errors } = parseIdList(body ? body.ids : undefined, { max: config.limits.bulkMaxIds });
    if (errors.length > 0) throw validationError(errors);
    return ids;
  }

  /** GET /api/students — paged list, newest first, page clamped to the last valid page. */
  function list(query = {}) {
    const q = parseSearchQuery(query.q, config.limits.searchMaxLength);
    const pageSize = parsePageSizeFromList(query.pageSize, STUDENT_PAGE_SIZES);
    const total = repo.count({ q });
    const paging = resolvePage({ page: parsePageNumber(query.page), pageSize, total });
    const items = repo.findPage({ q, limit: pageSize, offset: paging.offset }).map(toStudentDto);
    return { items, page: paging.page, pageSize, total, totalPages: paging.totalPages };
  }

  function getById(idParam) {
    const row = repo.findById(requireId(idParam));
    if (!row) throw notFound(NOT_FOUND_MESSAGE);
    return toStudentDto(row);
  }

  async function create(body, file) {
    const value = validate(body);
    const image = file ? imageService.inspect(file) : null;
    const savedImage = image ? await imageService.save(image) : null;
    try {
      const now = nowIso();
      const id = repo.insert(toRecord(value, { PathImage: savedImage, CreateDate: now, UpdateDate: now }));
      return toStudentDto(repo.findById(id));
    } catch (err) {
      if (savedImage) await imageService.discard(savedImage);
      throw err;
    }
  }

  /**
   * PUT replaces every editable field. Image: a new file replaces it, removeImage=1 clears it,
   * otherwise the current PathImage is kept.
   */
  async function update(idParam, body, file) {
    const id = requireId(idParam);
    const existing = repo.findById(id);
    if (!existing) throw notFound(NOT_FOUND_MESSAGE);
    const value = validate(body);
    const image = file ? imageService.inspect(file) : null;

    let pathImage = existing.PathImage ?? null;
    let savedImage = null;
    if (image) {
      savedImage = await imageService.save(image);
      pathImage = savedImage;
    } else if (parseBoolean(body ? body.removeImage : undefined) === true) {
      pathImage = null;
    }

    try {
      const changes = repo.update(id, toRecord(value, { PathImage: pathImage, UpdateDate: nowIso() }));
      if (changes === 0) throw notFound(NOT_FOUND_MESSAGE);
      return toStudentDto(repo.findById(id));
    } catch (err) {
      if (savedImage) await imageService.discard(savedImage);
      throw err;
    }
  }

  function remove(idParam) {
    if (repo.deleteById(requireId(idParam)) === 0) throw notFound(NOT_FOUND_MESSAGE);
    return { deleted: 1 };
  }

  /** All-or-nothing: any missing id → 404 and the transaction is rolled back. */
  function bulkDelete(body) {
    const ids = readIds(body);
    return transaction(db, () => {
      const missing = [];
      let deleted = 0;
      for (const id of ids) {
        if (repo.deleteById(id) === 0) missing.push(id);
        else deleted += 1;
      }
      if (missing.length > 0) throw missingIdsError(missing, 'xóa');
      return { deleted };
    });
  }

  /** Copies with new IDs/dates, FullName + " (bản sao)", same PathImage. All-or-nothing. */
  function bulkCopy(body) {
    const ids = readIds(body);
    const items = transaction(db, () => {
      const sources = ids.map((id) => repo.findById(id));
      const missing = ids.filter((id, index) => !sources[index]);
      if (missing.length > 0) throw missingIdsError(missing, 'sao chép');

      const now = nowIso();
      return sources.map((source) => {
        const copy = {
          FullName: copyName(source.FullName),
          Gender: source.Gender,
          DateOfBirth: source.DateOfBirth,
          ClassName: source.ClassName,
          Major: source.Major,
          Email: source.Email,
          Phone: source.Phone,
          Address: source.Address,
          GPA: source.GPA,
          Description: source.Description,
        };
        const newId = repo.insert(toRecord(copy, { PathImage: source.PathImage, CreateDate: now, UpdateDate: now }));
        return toStudentDto(repo.findById(newId));
      });
    });
    return { copied: items.length, items };
  }

  return { list, getById, create, update, remove, bulkDelete, bulkCopy };
}

module.exports = { createStudentService, copyName };
