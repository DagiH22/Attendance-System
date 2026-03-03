// Augmentations and quick module declarations to avoid missing-type errors
// Recommended: install @types packages, but this file prevents immediate TS errors

declare module "bcrypt";
declare module "jsonwebtoken";

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: "development" | "production" | "test";
    PORT?: string;
    DATABASE_URL?: string;
    SHADOW_DATABASE_URL?: string;
    JWT_SECRET?: string;
  }
}

declare namespace Express {
  export interface Request {
    // populated by auth middleware when a valid JWT is provided
    admin?: {
      id: string;
      email: string;
      role?: string;
    };
  }
}
