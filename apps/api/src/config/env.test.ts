import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  WEB_ORIGINS: 'http://localhost:5173, https://app.example.com',
  APP_BASE_URL: 'http://localhost:5173',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'PM <no-reply@example.com>',
  S3_BUCKET: 'pm-attachments',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('loadEnv', () => {
  it('parses and applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.WEB_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('reports invalid variable names without echoing secret values', () => {
    const run = () => loadEnv({ ...valid, DATABASE_URL: 'secret-not-a-url' });
    expect(run).toThrow(/DATABASE_URL/);
    expect(run).not.toThrow(/secret-not-a-url/);
  });
});
