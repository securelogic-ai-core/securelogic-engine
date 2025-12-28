import type { SecretProvider } from "./SecretProvider";

export class EnvSecretProvider implements SecretProvider {
  async getSecret(name: string): Promise<string> {
    const value = process.env[name];
    if (!value) {
      throw new Error(`SECRET_NOT_FOUND:${name}`);
    }
    return value;
  }
}
