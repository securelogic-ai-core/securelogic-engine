import type { Metadata } from "next";
import { SecurityPage } from "@/components/SecurityPage";

export const metadata: Metadata = {
  title: "Security",
  description:
    "Security at SecureLogic AI — how we protect customer data, our architecture, controls, and compliance posture.",
};

export default function SecurityPageRoute() {
  return <SecurityPage />;
}
