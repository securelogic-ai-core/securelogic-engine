export type EngineInput = {
  client: {
    name: string;
    industry: string;
    assessmentType: string;
    scope: string;
  };

  context: {
    regulated: boolean;
    safetyCritical: boolean;
    handlesPII: boolean;
    scale: "Small" | "Medium" | "Enterprise";
  };

  answers: Record<string, boolean>;
};
