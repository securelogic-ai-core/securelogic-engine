/**
 * B2B AI Tooling industry starter template.
 *
 * Source: curation appendix (Package 5 spec, 2026-05-05). Verbatim.
 *
 * needs_review entries:
 *   - EU AI Act Articles 8-22 (Digital Omnibus deferral uncertainty)
 *   - Colorado AI Act (effective February 2026; coverage interpretation
 *     evolving)
 *
 * v1 ai_systems is empty by design: the foundation model providers
 * (OpenAI, Anthropic, etc.) are vendors of the customer's AI features,
 * not ai_systems entries. ai_systems represents the customer's OWN
 * AI features and is populated manually after template load.
 */

import { composeTemplateDescription, type Template } from "./types.js";

// Curator-authored. Counts are NOT in these strings — they're appended
// by the description getter from the array lengths at access time.
const INTRO =
  "For companies building AI products for business customers — " +
  "LLM applications, AI agents, AI-augmented SaaS.";
const FRAMEWORKS_FOCUS = "aligned to NIST AI RMF and ISO 42001";

export const B2B_AI_TEMPLATE: Template = {
  id: "b2b-ai",
  name: "B2B AI Tooling",
  get description(): string {
    return composeTemplateDescription({
      intro: INTRO,
      vendorCount:     this.vendors.length,
      obligationCount: this.obligations.length,
      controlCount:    this.controls.length,
      frameworksFocus: FRAMEWORKS_FOCUS,
    });
  },
  version: "1.0.1",
  last_reviewed_at: "2026-05-05",

  ai_systems: [],

  vendors: [
    // Foundation model providers (criticality: critical,
    // processes_ai_inference: true)
    {
      id: "b2b-ai:vendor:openai",
      name: "OpenAI",
      criticality: "critical",
      category: "foundation_model",
      description: "Foundation model provider.",
      flags: { processes_ai_inference: true },
    },
    {
      id: "b2b-ai:vendor:anthropic",
      name: "Anthropic",
      criticality: "critical",
      category: "foundation_model",
      description: "Foundation model provider.",
      flags: { processes_ai_inference: true },
    },
    {
      id: "b2b-ai:vendor:google-gemini",
      name: "Google (Gemini)",
      criticality: "critical",
      category: "foundation_model",
      description: "Foundation model provider.",
      flags: { processes_ai_inference: true },
    },
    {
      id: "b2b-ai:vendor:mistral",
      name: "Mistral",
      criticality: "critical",
      category: "foundation_model",
      description: "Foundation model provider.",
      flags: { processes_ai_inference: true },
    },
    {
      id: "b2b-ai:vendor:cohere",
      name: "Cohere",
      criticality: "critical",
      category: "foundation_model",
      description: "Foundation model provider.",
      flags: { processes_ai_inference: true },
    },
    {
      id: "b2b-ai:vendor:meta-llama-hosting",
      name: "Meta (Llama hosting)",
      criticality: "critical",
      category: "foundation_model",
      description: "Foundation model provider.",
      flags: { processes_ai_inference: true },
    },

    // Inference infrastructure (criticality: critical)
    {
      id: "b2b-ai:vendor:aws-bedrock",
      name: "AWS Bedrock",
      criticality: "critical",
      category: "inference_infrastructure",
      description: "Managed inference platform.",
    },
    {
      id: "b2b-ai:vendor:azure-openai-service",
      name: "Azure OpenAI Service",
      criticality: "critical",
      category: "inference_infrastructure",
      description: "Managed inference platform.",
    },
    {
      id: "b2b-ai:vendor:together-ai",
      name: "Together.ai",
      criticality: "critical",
      category: "inference_infrastructure",
      description: "Inference platform for open-source models.",
    },
    {
      id: "b2b-ai:vendor:fireworks",
      name: "Fireworks",
      criticality: "critical",
      category: "inference_infrastructure",
      description: "Inference platform for open-source models.",
    },
    {
      id: "b2b-ai:vendor:replicate",
      name: "Replicate",
      criticality: "critical",
      category: "inference_infrastructure",
      description: "Model hosting and inference.",
    },
    {
      id: "b2b-ai:vendor:modal",
      name: "Modal",
      criticality: "critical",
      category: "inference_infrastructure",
      description: "Serverless GPU compute.",
    },

    // Vector databases (criticality: high)
    {
      id: "b2b-ai:vendor:pinecone",
      name: "Pinecone",
      criticality: "high",
      category: "vector_database",
      description: "Vector database.",
    },
    {
      id: "b2b-ai:vendor:weaviate",
      name: "Weaviate",
      criticality: "high",
      category: "vector_database",
      description: "Vector database.",
    },
    {
      id: "b2b-ai:vendor:qdrant",
      name: "Qdrant",
      criticality: "high",
      category: "vector_database",
      description: "Vector database.",
    },
    {
      id: "b2b-ai:vendor:chroma",
      name: "Chroma",
      criticality: "high",
      category: "vector_database",
      description: "Vector database.",
    },

    // Cloud (criticality: critical)
    {
      id: "b2b-ai:vendor:aws",
      name: "AWS",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "Cloud infrastructure provider.",
    },
    {
      id: "b2b-ai:vendor:azure",
      name: "Azure",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "Cloud infrastructure provider.",
    },
    {
      id: "b2b-ai:vendor:gcp",
      name: "GCP",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "Cloud infrastructure provider.",
    },
    {
      id: "b2b-ai:vendor:cloudflare",
      name: "Cloudflare",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "CDN, edge compute, AI gateway.",
    },

    // Observability/eval (criticality: high)
    {
      id: "b2b-ai:vendor:langfuse",
      name: "Langfuse",
      criticality: "high",
      category: "ai_observability",
      description: "LLM observability and tracing.",
    },
    {
      id: "b2b-ai:vendor:helicone",
      name: "Helicone",
      criticality: "high",
      category: "ai_observability",
      description: "LLM observability and analytics.",
    },
    {
      id: "b2b-ai:vendor:braintrust",
      name: "Braintrust",
      criticality: "high",
      category: "ai_observability",
      description: "LLM evaluation platform.",
    },
    {
      id: "b2b-ai:vendor:langsmith",
      name: "LangSmith",
      criticality: "high",
      category: "ai_observability",
      description: "LangChain observability and evaluation.",
    },

    // Data labeling (criticality: medium)
    {
      id: "b2b-ai:vendor:scale-ai",
      name: "Scale AI",
      criticality: "medium",
      category: "data_labeling",
      description: "Data labeling and evaluation services.",
    },
    {
      id: "b2b-ai:vendor:surge",
      name: "Surge",
      criticality: "medium",
      category: "data_labeling",
      description: "Data labeling services.",
    },
    {
      id: "b2b-ai:vendor:snorkel",
      name: "Snorkel",
      criticality: "medium",
      category: "data_labeling",
      description: "Programmatic data labeling.",
    },

    // Identity & productivity (criticality: medium)
    {
      id: "b2b-ai:vendor:okta",
      name: "Okta",
      criticality: "medium",
      category: "identity_management",
      description: "Identity provider, SSO, MFA.",
    },
    {
      id: "b2b-ai:vendor:google-workspace",
      name: "Google Workspace",
      criticality: "medium",
      category: "productivity_collaboration",
      description: "Email, docs, drive.",
    },
    {
      id: "b2b-ai:vendor:microsoft-365",
      name: "Microsoft 365",
      criticality: "medium",
      category: "productivity_collaboration",
      description: "Email, docs, drive.",
    },
    {
      id: "b2b-ai:vendor:slack",
      name: "Slack",
      criticality: "medium",
      category: "productivity_collaboration",
      description: "Team messaging.",
    },

    // Engineering (criticality: medium)
    {
      id: "b2b-ai:vendor:github",
      name: "GitHub",
      criticality: "medium",
      category: "engineering_tooling",
      description: "Source code management.",
    },
    {
      id: "b2b-ai:vendor:vercel",
      name: "Vercel",
      criticality: "medium",
      category: "engineering_tooling",
      description: "Frontend hosting platform.",
    },
    {
      id: "b2b-ai:vendor:datadog",
      name: "Datadog",
      criticality: "medium",
      category: "engineering_tooling",
      description: "Observability platform.",
    },
  ],

  obligations: [
    {
      id: "b2b-ai:obligation:eu-ai-act-article-5",
      regulation_name: "EU AI Act — Article 5 (prohibited practices)",
      jurisdiction: "European Union",
      priority: "immediate",
      description:
        "Prohibited AI practices in effect since 2 February 2025.",
    },
    {
      id: "b2b-ai:obligation:eu-ai-act-article-50",
      regulation_name: "EU AI Act — Article 50 (transparency obligations)",
      jurisdiction: "European Union",
      priority: "immediate",
      description:
        "Chatbot disclosure, AI-generated content labeling. Effective 2 August 2026.",
    },
    {
      id: "b2b-ai:obligation:eu-ai-act-articles-8-22",
      regulation_name: "EU AI Act — Articles 8-22 (high-risk system obligations)",
      jurisdiction: "European Union",
      priority: "near_term",
      description:
        "Applies if Annex III applicable. Originally effective 2 August 2026; potentially deferred to December 2027 via proposed Digital Omnibus package (under negotiation as of May 2026).",
      needs_review: true,
    },
    {
      id: "b2b-ai:obligation:eu-ai-act-articles-53-55",
      regulation_name: "EU AI Act — Articles 53-55 (GPAI model obligations)",
      jurisdiction: "European Union",
      priority: "near_term",
      description:
        "Applies to providers of general-purpose AI models. Effective 2 August 2025.",
    },
    {
      id: "b2b-ai:obligation:gdpr",
      regulation_name: "GDPR",
      jurisdiction: "European Union",
      priority: "immediate",
      description:
        "Including Article 22 automated decision-making provisions.",
    },
    {
      id: "b2b-ai:obligation:nist-ai-rmf",
      regulation_name: "NIST AI Risk Management Framework",
      jurisdiction: "Industry framework (US)",
      priority: "near_term",
      description:
        "Voluntary framework increasingly contractually required by enterprise customers.",
    },
    {
      id: "b2b-ai:obligation:eeoc-ai-employment",
      regulation_name: "EEOC guidance on AI in employment decisions",
      jurisdiction: "US Federal",
      priority: "planned",
      description:
        "Applies if AI used in HR decisions. EEOC enforces existing anti-discrimination law against AI-driven decisions.",
    },
    {
      id: "b2b-ai:obligation:colorado-ai-act",
      regulation_name: "Colorado AI Act",
      jurisdiction: "Colorado, US",
      priority: "immediate",
      description:
        "Effective February 2026. Applies to high-risk AI systems affecting Colorado consumers.",
      needs_review: true,
    },
    {
      id: "b2b-ai:obligation:nyc-local-law-144",
      regulation_name: "NYC Local Law 144",
      jurisdiction: "New York City, US",
      priority: "near_term",
      description:
        "Automated employment decision tools. Bias audit and notification requirements.",
    },
    {
      id: "b2b-ai:obligation:california-ab-2013",
      regulation_name: "California AB 2013",
      jurisdiction: "California, US",
      priority: "planned",
      description:
        "AI training data transparency requirements for generative AI providers.",
    },
    {
      id: "b2b-ai:obligation:iso-iec-42001-2023",
      regulation_name: "ISO/IEC 42001:2023",
      jurisdiction: "International standard",
      priority: "planned",
      description:
        "AI management systems standard. Increasingly cited in enterprise AI procurement.",
    },
    {
      id: "b2b-ai:obligation:iso-iec-23894-2023",
      regulation_name: "ISO/IEC 23894:2023",
      jurisdiction: "International standard",
      priority: "planned",
      description: "AI risk management standard.",
    },
    {
      id: "b2b-ai:obligation:soc2-type-ii",
      regulation_name: "SOC 2 Type II",
      jurisdiction: "Industry framework",
      priority: "immediate",
      description:
        "AICPA Trust Services Criteria. Standard enterprise SaaS expectation.",
    },
  ],

  controls: [
    // Govern (NIST AI RMF)
    {
      id: "b2b-ai:control:ai-use-policy",
      name: "AI use policy with prohibited use cases",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:ai-governance-committee",
      name: "AI governance committee with cross-functional membership",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:ai-risk-register",
      name: "AI risk register with severity classification",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:ai-incident-response",
      name: "AI incident response procedure (separate from general security incident response)",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:foundation-model-vendor-dd",
      name: "Foundation model vendor due diligence procedure",
      description: "",
      framework_ref: "nist-ai-rmf",
    },

    // Map
    {
      id: "b2b-ai:control:ai-system-inventory",
      name: "AI system inventory (foundation models, deployment context, data flows)",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:eu-ai-act-risk-classification",
      name: "Risk classification per system mapping to EU AI Act risk tiers if EU exposure",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:data-lineage-tracking",
      name: "Data lineage tracking for training data and inference inputs",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:stakeholder-impact-assessment",
      name: "Stakeholder impact assessment for each customer-facing AI feature",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:use-case-scoping-doc",
      name: "Use-case scoping document per AI feature",
      description: "",
      framework_ref: "nist-ai-rmf",
    },

    // Measure
    {
      id: "b2b-ai:control:pre-deployment-eval-bias",
      name: "Pre-deployment evaluation including bias testing across protected categories",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:red-teaming-prompt-injection",
      name: "Red-teaming for safety and prompt injection",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:performance-benchmarking",
      name: "Performance benchmarking against intended use case",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:hallucination-rate-measurement",
      name: "Hallucination rate measurement on representative test sets",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:drift-detection",
      name: "Drift detection on production traffic",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:adversarial-testing-gpai",
      name: "Adversarial testing (for GPAI per AI Act Article 55 if applicable)",
      description: "",
      framework_ref: "eu-ai-act",
    },

    // Manage
    {
      id: "b2b-ai:control:human-oversight-high-risk",
      name: "Human oversight controls per high-risk system (per AI Act Article 14 if applicable)",
      description: "",
      framework_ref: "eu-ai-act",
    },
    {
      id: "b2b-ai:control:inference-io-logging",
      name: "Logging of inference inputs and outputs (with PII handling)",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:output-filtering-safety",
      name: "Output filtering for safety violations",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:ai-disclosure-article-50",
      name: "Customer-facing transparency: AI disclosure (per AI Act Article 50)",
      description: "",
      framework_ref: "eu-ai-act",
    },
    {
      id: "b2b-ai:control:synthetic-media-labeling",
      name: "AI-generated content labeling for synthetic media",
      description: "",
      framework_ref: "eu-ai-act",
    },
    {
      id: "b2b-ai:control:model-versioning-rollback",
      name: "Model versioning and rollback procedures",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:vendor-model-dependency-tracking",
      name: "Vendor model dependency tracking",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:ongoing-monitoring-alerts",
      name: "Ongoing monitoring with alert thresholds",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:serious-incident-reporting",
      name: "Serious incident reporting procedure (per AI Act Article 73 if applicable)",
      description: "",
      framework_ref: "eu-ai-act",
    },

    // Foundational security
    {
      id: "b2b-ai:control:data-encryption-at-rest-in-transit",
      name: "Data encryption at rest and in transit",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:training-dataset-access-controls",
      name: "Access controls on training datasets",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:prompt-injection-defense",
      name: "Prompt injection defense",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:api-key-rotation",
      name: "API key rotation and management",
      description: "",
      framework_ref: "nist-ai-rmf",
    },
    {
      id: "b2b-ai:control:audit-logging-model-access",
      name: "Audit logging of model access",
      description: "",
      framework_ref: "nist-ai-rmf",
    },

    // Documentation
    {
      id: "b2b-ai:control:tech-doc-annex-iv",
      name: "Technical documentation per AI Act Annex IV (system purpose, capabilities, limitations, training data summary)",
      description: "",
      framework_ref: "eu-ai-act",
    },
    {
      id: "b2b-ai:control:conformity-assessment-records",
      name: "Conformity assessment records (high-risk systems)",
      description: "",
      framework_ref: "eu-ai-act",
    },
    {
      id: "b2b-ai:control:post-market-monitoring-records",
      name: "Post-market monitoring records",
      description: "",
      framework_ref: "iso-42001",
    },
    {
      id: "b2b-ai:control:dpia-ai-systems",
      name: "DPIA for AI systems processing personal data",
      description: "",
      framework_ref: "iso-42001",
    },
    {
      id: "b2b-ai:control:fria",
      name: "Fundamental Rights Impact Assessment (FRIA) where required",
      description: "",
      framework_ref: "eu-ai-act",
    },
    {
      id: "b2b-ai:control:model-cards",
      name: "Model cards for production models",
      description: "",
      framework_ref: "iso-42001",
    },
  ],
};
