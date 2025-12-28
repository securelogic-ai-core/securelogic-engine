if (process.env.NODE_ENV !== "production") {
  throw new Error("Enterprise runtime must run in production mode");
}
