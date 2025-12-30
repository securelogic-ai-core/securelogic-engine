export type Customer = {
  customerId: string;
  name: string;
  licenseTier: "CORE" | "PRO" | "ENTERPRISE";
  createdAt: string;
};
