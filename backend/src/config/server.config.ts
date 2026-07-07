import dotenv from 'dotenv';

dotenv.config();

/**
 * 서버 설정 상수
 */
export const SERVER_CONFIG = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_ID: process.env.APP_ID || 'mazicalign-app',
} as const;
