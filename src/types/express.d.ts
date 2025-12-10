import "express";

declare module "express-serve-static-core" {
  interface Request {
    apiKey?: string;
    apiTier?: "free" | "pro" | "enterprise";
  }
}
