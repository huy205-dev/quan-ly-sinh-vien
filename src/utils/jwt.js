'use strict';

/**
 * Minimal JSON Web Token (HS256 only), written with node:crypto.
 */
const crypto = require('node:crypto');

const HEADER = Object.freeze({ alg: 'HS256', typ: 'JWT' });
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

class JwtError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'JwtError';
    this.reason = reason; // 'invalid' | 'expired'
  }
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function hmac(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/** Signs `payload` adding iat/exp (seconds). */
function signJwt(payload, secret, { expiresInSeconds }) {
  if (!secret) throw new Error('JWT secret is required');
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat, exp: iat + expiresInSeconds };
  const unsigned = `${base64UrlJson(HEADER)}.${base64UrlJson(body)}`;
  return `${unsigned}.${hmac(unsigned, secret)}`;
}

function decodeSegment(segment) {
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Verifies signature (timing-safe), algorithm and expiry. Returns the payload or throws JwtError.
 */
function verifyJwt(token, secret, { nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (typeof token !== 'string' || token.length > 4096) throw new JwtError('invalid', 'Malformed token');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => SEGMENT_RE.test(p))) {
    throw new JwtError('invalid', 'Malformed token');
  }
  const [encodedHeader, encodedPayload, signature] = parts;

  const header = decodeSegment(encodedHeader);
  if (!header || header.alg !== 'HS256') throw new JwtError('invalid', 'Unsupported token algorithm');

  const expected = Buffer.from(hmac(`${encodedHeader}.${encodedPayload}`, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new JwtError('invalid', 'Invalid token signature');
  }

  const payload = decodeSegment(encodedPayload);
  if (!payload) throw new JwtError('invalid', 'Malformed token payload');
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    throw new JwtError('expired', 'Token expired');
  }
  return payload;
}

module.exports = { signJwt, verifyJwt, JwtError };
