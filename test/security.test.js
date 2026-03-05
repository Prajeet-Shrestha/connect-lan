const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { safePath, sanitizeFilename, isLanOrigin } = require('../src/security');

// ─── safePath ─────────────────────────────────────────
// Signature: safePath(userPath, rootDir) → resolved path or null

describe('safePath', () => {
  const root = os.tmpdir(); // Use a real directory that exists

  it('resolves a simple filename within root', () => {
    const result = safePath('file.txt', root);
    assert.equal(result, path.resolve(root, 'file.txt'));
  });

  it('resolves a subdirectory path', () => {
    const result = safePath('sub/dir/file.txt', root);
    assert.equal(result, path.resolve(root, 'sub/dir/file.txt'));
  });

  it('returns null for path traversal with ../', () => {
    const result = safePath('../../../../etc/passwd', root);
    assert.equal(result, null);
  });

  it('strips null bytes', () => {
    const result = safePath('file\x00.txt', root);
    assert.notEqual(result, null);
    assert.ok(!result.includes('\x00'));
  });

  it('returns root for empty/null input', () => {
    const result = safePath('', root);
    assert.equal(result, root);
    const result2 = safePath(null, root);
    assert.equal(result2, root);
  });
});

// ─── sanitizeFilename ─────────────────────────────────

describe('sanitizeFilename', () => {
  it('removes path traversal sequences', () => {
    const result = sanitizeFilename('../../etc/passwd');
    // ../ is stripped, leaving etc/passwd
    assert.ok(!result.includes('..'));
  });

  it('replaces dangerous characters with underscores', () => {
    const result = sanitizeFilename('<script>alert</script>');
    assert.ok(!result.includes('<'));
    assert.ok(!result.includes('>'));
    assert.equal(result, '_script_alert_/script_');
  });

  it('strips null bytes', () => {
    assert.equal(sanitizeFilename('file\x00.txt'), 'file.txt');
  });

  it('preserves normal filenames', () => {
    assert.equal(sanitizeFilename('photo.jpg'), 'photo.jpg');
  });

  it('preserves filenames with spaces', () => {
    assert.equal(sanitizeFilename('my file (1).pdf'), 'my file (1).pdf');
  });

  it('trims whitespace', () => {
    assert.equal(sanitizeFilename('  hello.txt  '), 'hello.txt');
  });
});

// ─── isLanOrigin (CORS validator) ─────────────────────

describe('isLanOrigin', () => {
  // Should ALLOW
  it('allows http://localhost:3000', () => {
    assert.equal(isLanOrigin('http://localhost:3000'), true);
  });

  it('allows https://localhost:51337', () => {
    assert.equal(isLanOrigin('https://localhost:51337'), true);
  });

  it('allows http://127.0.0.1:3000', () => {
    assert.equal(isLanOrigin('http://127.0.0.1:3000'), true);
  });

  it('allows 192.168.x.x (RFC-1918)', () => {
    assert.equal(isLanOrigin('https://192.168.1.5:3000'), true);
  });

  it('allows 10.x.x.x (RFC-1918)', () => {
    assert.equal(isLanOrigin('http://10.0.0.1:3000'), true);
  });

  it('allows 172.16.x.x (RFC-1918)', () => {
    assert.equal(isLanOrigin('http://172.16.0.1:3000'), true);
  });

  it('allows 172.31.x.x (RFC-1918 upper bound)', () => {
    assert.equal(isLanOrigin('http://172.31.255.255:3000'), true);
  });

  it('allows 169.254.x.x (link-local)', () => {
    assert.equal(isLanOrigin('http://169.254.1.1:3000'), true);
  });

  // Should REJECT
  it('rejects null origin', () => {
    assert.equal(isLanOrigin('null'), false);
  });

  it('rejects empty string', () => {
    assert.equal(isLanOrigin(''), false);
  });

  it('rejects undefined', () => {
    assert.equal(isLanOrigin(undefined), false);
  });

  it('rejects public IP (8.8.8.8)', () => {
    assert.equal(isLanOrigin('http://8.8.8.8'), false);
  });

  it('rejects external domain', () => {
    assert.equal(isLanOrigin('http://evil.com'), false);
  });

  it('rejects domain spoofing (192.168.1.5.evil.com)', () => {
    assert.equal(isLanOrigin('http://192.168.1.5.evil.com:3000'), false);
  });

  it('rejects 172.15.x.x (below RFC-1918 range)', () => {
    assert.equal(isLanOrigin('http://172.15.0.1:3000'), false);
  });

  it('rejects 172.32.x.x (above RFC-1918 range)', () => {
    assert.equal(isLanOrigin('http://172.32.0.1:3000'), false);
  });

  it('rejects malformed URL', () => {
    assert.equal(isLanOrigin('not-a-url'), false);
  });
});
