import type { ProcurementProvider } from "./ProcurementProvider";

class Registry {
  private providers: ProcurementProvider[] = [];

  register(provider: ProcurementProvider) {
    this.providers.push(provider);
  }

  resolve(serviceCode: string): ProcurementProvider | undefined {
    return this.providers.find(p => p.supports(serviceCode));
  }
}

export const ProcurementRegistry = new Registry();
