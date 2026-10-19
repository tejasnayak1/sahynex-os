// Test environment: dedicated database, deterministic secrets, local storage in a temp dir.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/sahynex_test';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-0123';
process.env.STORAGE_DIR = process.env.TEST_STORAGE_DIR ?? '/tmp/sahynex-test-storage';
process.env.MONITOR_ALLOW_PRIVATE = 'true';
process.env.APP_TIMEZONE = 'Asia/Kolkata';
delete process.env.SMTP_HOST;
