import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Set on login; `requireAuth` treats its presence as "authenticated". */
    userId?: number;
  }
}
