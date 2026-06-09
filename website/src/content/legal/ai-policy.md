---
title: AI Transparency & Responsible Use Policy
slug: ai-policy
effectiveDate: "[INSERT DATE]"
lastUpdated: "[INSERT DATE]"
version: "1.0"
description: "AI Transparency and Responsible Use Policy for SecureLogic AI — how we use artificial intelligence, the principles that guide our use, and customer rights regarding AI features."
---

# AI Transparency & Responsible Use Policy

**Version 1.0 | Effective Date: [INSERT DATE] | Last Updated: [INSERT DATE]**

---

## Table of Contents

1. [Purpose](#purpose)
2. [Scope](#scope)
3. [Definitions](#definitions)
4. [Our Approach to AI](#our-approach-to-ai)
5. [Guiding Principles](#guiding-principles)
6. [Where AI Is Used Within the Services](#where-ai-is-used-within-the-services)
7. [AI Service Providers](#ai-service-providers)
8. [Customer Content Processing](#customer-content-processing)
9. [Model Training Commitments](#model-training-commitments)
10. [Human Oversight](#human-oversight)
11. [AI Limitations and Risks](#ai-limitations-and-risks)
12. [Prohibited and High-Risk Uses of AI Outputs](#prohibited-and-high-risk-uses-of-ai-outputs)
13. [Customer Rights Regarding AI](#customer-rights-regarding-ai)
14. [Security of AI-Assisted Features](#security-of-ai-assisted-features)
15. [Governance and Oversight](#governance-and-oversight)
16. [AI Incident Response](#ai-incident-response)
17. [Customer Responsibilities](#customer-responsibilities)
18. [AI-Generated Content Labeling](#ai-generated-content-labeling)
19. [Customer Use of the Platform for AI Governance](#customer-use-of-the-platform-for-ai-governance)
20. [Customer Feedback](#customer-feedback)
21. [Policy Updates](#policy-updates)
22. [Relationship to Other Agreements](#relationship-to-other-agreements)
23. [Contact Information](#contact-information)
24. [Effective Date](#effective-date)

---

Threat Loom, LLC, doing business as SecureLogic AI ("SecureLogic AI," "Company," "we," "our," or "us"), is committed to the responsible, transparent, and trustworthy use of artificial intelligence technologies.

This AI Transparency and Responsible Use Policy ("AI Policy") describes how SecureLogic AI uses artificial intelligence in our products and services, the principles that guide our use, the limitations and risks of AI-assisted functionality, the rights and responsibilities of our customers, and how we work to maintain meaningful human oversight.

This AI Policy supplements (and does not replace) the SecureLogic AI Terms of Service and Privacy Policy. Capitalized terms not defined here have the meanings given to them in the Terms of Service and Privacy Policy.

## 1. Purpose

The purposes of this AI Policy are to:

- Promote transparency regarding SecureLogic AI's use of artificial intelligence technologies;
- Establish principles for responsible and trustworthy AI use within our platform;
- Describe the capabilities, limitations, and risks of AI-assisted functionality;
- Explain customer responsibilities when using AI-assisted features;
- Support customer due diligence, AI vendor risk assessments, and regulatory compliance activities;
- Demonstrate our alignment with recognized AI governance frameworks, including the NIST AI Risk Management Framework.

## 2. Scope

This AI Policy applies to:

- The SecureLogic AI website and customer portal;
- Subscription Services, including the Intelligence Brief;
- Professional Services, including Audit Sprint engagements and advisory work;
- AI-assisted analysis, document review, transcription, summarization, and content generation features within the Services;
- Reporting, dashboards, and Deliverables generated with the assistance of AI;
- Future AI-enabled products, features, and services we may release.

This AI Policy does not apply to AI technologies operated independently by third parties that you may access from links within the Services. Those technologies are governed by their own terms and policies.

## 3. Definitions

For purposes of this AI Policy:

**"Artificial Intelligence" or "AI"** means computer systems that perform tasks typically associated with human cognition, including pattern recognition, language understanding and generation, summarization, classification, prediction, and decision support. Within SecureLogic AI, "AI" refers principally to large language models (LLMs), speech-to-text models, and related machine learning systems used to assist with text generation, document analysis, and transcription.

**"AI Output"** means content, summaries, classifications, scores, recommendations, transcriptions, or other results produced by AI technologies within the Services.

**"AI Provider"** means a third-party provider of AI technologies (such as Anthropic, PBC or OpenAI, OpenAI Global, LLC) that processes data on behalf of SecureLogic AI to deliver AI-assisted functionality.

**"Foundation Model"** means a general-purpose AI model trained on broad data that can be adapted for a wide range of downstream tasks, including large language models such as those operated by Anthropic and OpenAI.

**"Hallucination"** means an AI Output that appears coherent and authoritative but is factually incorrect, fabricated, inconsistent with the source material, or otherwise unreliable.

**"Human Review"** means meaningful evaluation of AI Outputs by a qualified human, with the authority and ability to accept, modify, reject, or override the AI Output before action is taken.

## 4. Our Approach to AI

SecureLogic AI uses artificial intelligence as a tool to support human decision-making — not as a replacement for human judgment. Our platform is designed to make compliance, risk management, vendor assurance, and governance work more efficient and more thorough, while keeping qualified humans in the position of authority over consequential decisions.

We adopt the position that AI is most valuable when it is transparent about what it is doing, accountable for its outputs, and bounded by appropriate human oversight. This AI Policy is one expression of that commitment.

## 5. Guiding Principles

The following principles guide our use of artificial intelligence:

### 5.1 Transparency

We disclose what AI does within the Services, which AI providers we use, what data flows to those providers, and what limitations and risks AI Outputs carry. Customers should not encounter AI capabilities that have not been disclosed in this AI Policy, the Privacy Policy, or related documentation.

### 5.2 Human Oversight

AI Outputs within the Services are advisory. The Services are designed so that consequential decisions — including compliance determinations, regulatory filings, vendor approval or rejection, control attestations, and similar actions — remain with qualified humans who exercise independent judgment.

### 5.3 Accountability

SecureLogic AI accepts responsibility for the design and operation of AI-assisted functionality within our Services. Where AI is used, we identify a responsible party within SecureLogic AI accountable for monitoring outcomes, addressing issues, and maintaining alignment with this AI Policy.

### 5.4 Privacy by Design

We minimize the personal information transmitted to AI Providers, limit AI processing to what is reasonably necessary to provide requested functionality, and contractually require AI Providers to apply appropriate safeguards. Detailed data handling practices are described in our Privacy Policy.

### 5.5 Security

AI-assisted functionality operates within the same security perimeter as the rest of the Services, including encryption in transit, role-based access controls, security monitoring, and AI Provider due diligence.

### 5.6 Customer Control

Customers retain ownership of Customer Content submitted to the Services. Customer Content is not used to train SecureLogic AI's proprietary models or to train foundation models operated by AI Providers, as further described in Section 9 (Model Training Commitments).

### 5.7 Continuous Improvement

AI technologies, the laws governing AI, and the best practices for responsible AI use are evolving rapidly. We monitor these developments and update our practices and this AI Policy as needed.

## 6. Where AI Is Used Within the Services

This Section describes how AI is used within specific features of the Services. We disclose this at a feature level so that customers can understand exactly where AI is involved, which AI Provider supports each feature, and what categories of data flow through AI processing.

| Feature | AI Provider | Purpose | Data Processed |
|---|---|---|---|
| Conversational Assistance ("Ask") | Anthropic (Claude) | Natural-language queries and answers about Customer Content and platform state | Customer prompts plus contextual data such as vendor names, risk titles, control descriptions, owner identifiers, and treatment plans |
| Document Extraction (Vendor Assurance) | Anthropic (Claude) | Extraction of structured information from uploaded SOC reports, BAAs, and other vendor assurance documents | Text content of customer-uploaded PDFs |
| CUEC Matching | Anthropic (Claude) | Matching Complementary User Entity Controls from vendor documents to customer controls | Extracted CUEC text and Customer control descriptions |
| Intelligence Brief Generation | Anthropic (Claude) | Synthesis of threat intelligence into customer-facing narrative briefs | Public threat-intelligence signals (CISA, NVD, MITRE, vendor advisories). No customer-identifying data. |
| Voice Input Transcription | OpenAI (Whisper) | Conversion of voice and audio inputs to text within voice-enabled features | Audio recordings submitted by Customer |
| Recommendation and Summary Generation | Anthropic (Claude) | Generation of risk-narrative summaries, recommended actions, and similar AI-assisted content | Customer Content reasonably necessary to produce the summary or recommendation |

This list is current as of the Effective Date of this AI Policy. We update this list as AI-assisted features are added, modified, or retired. Material changes will be communicated as described in Section 21 (Policy Updates).

## 7. AI Service Providers

### 7.1 Current AI Providers

SecureLogic AI utilizes artificial intelligence technologies provided by the following AI Providers:

- Anthropic, PBC — large language model (LLM) services using the Claude family of models, supporting conversational assistance, document extraction, summarization, and content generation;
- OpenAI, OpenAI Global, LLC — speech-to-text transcription using the Whisper model family, supporting voice-enabled features within the Services.

### 7.2 Provider Selection Criteria

We evaluate prospective AI Providers against criteria that may include:

- Published safety research, alignment efforts, and responsible scaling commitments;
- Documented data handling and retention practices, including support for zero-retention configurations and contractual commitments not to use customer data for foundation model training;
- Security posture, including independent security attestations where available;
- Operational reliability, model capability for the relevant task, and observable model behavior in production-similar conditions;
- Compliance posture relative to applicable laws, regulations, and emerging AI governance frameworks;
- Commercial terms, including transparency about model versioning, deprecation, and incident communications.

### 7.3 Changes to AI Providers

AI Provider relationships and the specific models used may evolve. Material changes — including the addition or removal of an AI Provider, or a substantial change in the categories of data transmitted to an AI Provider — will be reflected in updates to this AI Policy and, where applicable, the Privacy Policy.

## 8. Customer Content Processing

To deliver AI-assisted functionality, the Services may transmit Customer Content to AI Providers for processing. We seek to:

- Limit transmission to data reasonably necessary for the requested AI-assisted functionality;
- Avoid transmitting categories of data not required for the task at hand;
- Decline to incorporate Customer Content into Intelligence Brief generation or other broadly distributed outputs;
- Avoid persisting AI Outputs beyond what is reasonably necessary to deliver requested features.

Customers control what Customer Content they submit to the Services. Customers are responsible for ensuring that submitted content complies with our Terms of Service, including the Prohibited Data restrictions described in Section 19 of the Terms of Service. Submission of Prohibited Data — such as Protected Health Information, Social Security Numbers, biometric data, or other restricted categories — to AI-assisted features is expressly prohibited.

## 9. Model Training Commitments

SecureLogic AI makes the following commitments regarding training of artificial intelligence models:

### 9.1 No Use of Customer Content for SecureLogic AI Models

We do not use Customer Content to train, fine-tune, retrain, or otherwise develop any proprietary AI models operated by SecureLogic AI.

### 9.2 No Submission of Customer Content for Foundation Model Training

We do not intentionally submit Customer Content to Anthropic, OpenAI, or any other AI Provider for the purpose of training, retraining, or improving the AI Provider's foundation models. We select AI Providers and configurations to prevent such use, including by relying on commercial API tiers and contractual commitments that exclude customer data from training pipelines.

### 9.3 De-Identified and Aggregated Information

As described in our Privacy Policy, we may create aggregated, de-identified, and anonymized information derived from operational data that cannot reasonably be linked to an individual or organization. Such information may be used to evaluate, monitor, and improve the quality, reliability, and safety of AI-assisted features.

## 10. Human Oversight

### 10.1 Advisory Nature of AI Outputs

AI Outputs within the Services are advisory. AI Outputs are intended to support — not replace — human judgment by qualified personnel. Customers should review AI Outputs before relying upon them for consequential decisions.

### 10.2 No Autonomous Consequential Decisions

The Services do not, and are not designed to, make autonomous decisions producing legal or similarly significant effects on individuals without human involvement. Risk scores, posture scores, control assessments, and similar outputs are surfaced to Customer personnel to inform human decision-making rather than to authorize automated action.

### 10.3 SecureLogic AI Personnel Review

Authorized SecureLogic AI personnel may review submitted information and AI Outputs as reasonably necessary to deliver Services, generate Deliverables, validate results, improve service quality, investigate suspected issues, provide customer support, maintain security, and comply with legal obligations. Personnel access is subject to confidentiality obligations, role-based access controls, and the safeguards described in our Privacy Policy.

### 10.4 Customer-Side Human Review

Customers are responsible for ensuring that their personnel review AI Outputs before relying upon them, particularly where outputs may inform compliance determinations, regulatory submissions, vendor approval decisions, control attestations, or similar consequential actions.

## 11. AI Limitations and Risks

### 11.1 Inherent Limitations

Artificial intelligence technologies, including those used within the Services, may produce outputs that are inaccurate, incomplete, inconsistent, outdated, misleading, or biased. AI Outputs may not reflect the most recent legal, regulatory, technical, or industry developments. Customers should not rely upon AI Outputs as definitive without independent review and verification.

### 11.2 Hallucinations

Large language models, including those used by the Services, may generate Hallucinations — outputs that appear coherent and authoritative but are factually incorrect, fabricated, or inconsistent with the source material. Hallucinations may include invented citations, fabricated quotations, incorrect references to standards or regulations, and confabulated facts. The Services apply prompt engineering, retrieval grounding, and other engineering controls to reduce the frequency of Hallucinations, but no control eliminates this risk entirely. Customers should treat AI Outputs as draft material requiring verification.

### 11.3 Bias and Fairness

AI systems may produce outputs influenced by the data they were trained on, the configurations used to deploy them, the prompts they receive, and the contexts in which they operate. We acknowledge that biases may be present in the underlying models we use and in the AI Outputs they generate. We rely on bias evaluations and safety research published by our AI Providers, design our prompts and use cases to reduce the likelihood of biased outputs in high-stakes contexts, and emphasize human oversight as a primary safeguard against the operational impact of bias.

### 11.4 Prompt Injection and Adversarial Inputs

Large language models can be susceptible to prompt injection, in which adversarial inputs embedded in user-submitted content cause the model to ignore its instructions or produce unexpected outputs. We apply input validation, context segregation, and provider-side controls to reduce this risk, but no control eliminates it entirely. Customers should not assume that AI Outputs are immune from manipulation by adversarial inputs embedded in Customer Content or external sources.

### 11.5 Currency and Source Material

AI Outputs may reflect training data that is months or years out of date. Threat intelligence and regulatory content used within the Services is sourced from third-party feeds that are themselves subject to delay, error, or incompleteness. The Services should not be treated as a complete or real-time source of legal, regulatory, or threat intelligence information.

### 11.6 Model Versioning and Behavior Drift

AI Providers may update, retrain, or replace the models underlying their services. Such changes may affect the quality, behavior, or characteristics of AI Outputs. We monitor for material changes in AI Provider model behavior and adjust our use of AI services as needed.

## 12. Prohibited and High-Risk Uses of AI Outputs

Customers shall not rely upon AI Outputs as a sole or primary basis for, and the Services are not designed or warranted for use in:

- Legal advice, regulatory determinations, or judicial submissions (engage qualified legal counsel);
- Final compliance certifications, attestations, or audit opinions (engage qualified auditors or attestation firms);
- Medical, clinical, or diagnostic decisions (engage qualified medical professionals);
- Emergency response or life-safety decisions;
- Decisions producing legal or similarly significant effects on individuals — such as employment, credit, housing, insurance, or government benefits decisions — without meaningful human review;
- Decisions about access to essential services for individuals;
- Surveillance of individuals or monitoring of protected activity;
- Generation of content intended to deceive, including misrepresentation of human authorship of AI-generated material in contexts where such disclosure is legally or ethically required.

AI Outputs within the Services are intended to inform — not to replace — qualified human professionals in these and other high-stakes contexts.

## 13. Customer Rights Regarding AI

Customers and Authorized Users have the following rights with respect to AI-assisted functionality within the Services:

### 13.1 Right to Know

Customers have the right to know when AI is being used to generate an output they receive from the Services. AI-assisted features are disclosed in this AI Policy and, where reasonably practicable, AI-generated content within the Services is labeled or otherwise identified as AI-assisted.

### 13.2 Right to Request Human Review

Customers may request human review by SecureLogic AI personnel of any AI Output they believe to be inaccurate, biased, or otherwise problematic. Requests may be submitted to ai@securelogicai.com.

### 13.3 Right to Challenge AI-Derived Determinations

To the extent the Services produce AI-derived scores, classifications, or determinations that materially affect Customer's use of the Services, Customer may request that SecureLogic AI explain the basis of the determination, review the inputs that produced it, and consider a correction.

### 13.4 Right to Reasonable Opt-Out

Where commercially reasonable, Customers may request that specific AI-assisted features be disabled for their Account or organization. Some Services are AI-native and cannot be provided without AI processing; in such cases, SecureLogic AI will explain available alternatives or limitations.

### 13.5 Coordination with Privacy Rights

Privacy rights regarding personal information processed by AI-assisted features — including rights of access, correction, deletion, portability, and objection — are described in our Privacy Policy. Requests should be submitted to privacy@securelogicai.com.

## 14. Security of AI-Assisted Features

AI-assisted features operate within SecureLogic AI's broader security program, as further described in our Privacy Policy and Security documentation. Security measures applied to AI-assisted features include:

- Encryption of data in transit between SecureLogic AI and AI Providers;
- Role-based access controls limiting which personnel may interact with AI-assisted features and AI Provider interfaces;
- Logging and monitoring of AI Provider interactions, including detection of anomalous usage patterns;
- Vendor due diligence on AI Providers, including review of their security attestations and data handling practices;
- Application of secret-scrubbing controls to prevent secrets, credentials, and sensitive identifiers from being unintentionally transmitted to AI Providers;
- Configuration of AI Provider services to use commercial API tiers with retention and training restrictions, where available.

## 15. Governance and Oversight

### 15.1 Internal Governance

SecureLogic AI maintains internal responsibility for the design, operation, and oversight of AI-assisted functionality. Governance activities may include vendor evaluations, security reviews, privacy reviews, AI Provider model-change monitoring, AI risk assessments, periodic review of this AI Policy, and improvement initiatives based on operational experience and customer feedback.

### 15.2 Alignment with the NIST AI Risk Management Framework

This AI Policy and the underlying practices it describes are designed in alignment with the National Institute of Standards and Technology Artificial Intelligence Risk Management Framework (NIST AI RMF 1.0). The four functions of the NIST AI RMF — Govern, Map, Measure, and Manage — are addressed as follows:

- **Govern:** SecureLogic AI accepts accountability for AI-assisted functionality, maintains this AI Policy and related internal policies, and assigns internal responsibility for AI governance activities.
- **Map:** SecureLogic AI documents where AI is used within the Services (see Section 6), what data flows to AI Providers, what AI Providers we rely on, and the intended purpose and limitations of each AI-assisted feature.
- **Measure:** SecureLogic AI monitors the operation of AI-assisted features, evaluates AI Provider behavior and incident communications, reviews customer feedback, and assesses outcomes to identify quality, reliability, and safety concerns.
- **Manage:** SecureLogic AI maintains an incident response process for AI issues (see Section 16), updates its AI practices in response to monitoring and feedback, and discontinues or reconfigures AI-assisted features that present unacceptable risk.

### 15.3 Alignment with Other Frameworks

We monitor and consider additional AI governance frameworks where they apply to our customers' or our own operations, including the OECD Principles on AI, sector-specific guidance from U.S. federal and state authorities, and the European Union Artificial Intelligence Act, particularly its transparency obligations applicable to general-purpose AI systems. As our customer base and our regulatory environment evolve, we adjust our practices accordingly.

## 16. AI Incident Response

### 16.1 Reporting an AI Issue

Customers, Authorized Users, and third parties may report suspected AI-related issues — including significant output errors, suspected bias, suspected hallucinations, reliability concerns, security concerns, or potential misuse — by contacting ai@securelogicai.com. Reports may also be submitted through customer support channels.

### 16.2 Triage and Response

Reported issues are triaged based on potential impact. SecureLogic AI commits to:

- Acknowledging receipt of AI-issue reports within five (5) business days for non-critical issues;
- Acknowledging receipt of AI-issue reports within one (1) business day for issues posing potential security, privacy, or significant operational impact;
- Investigating reported issues and providing a substantive response or status update within thirty (30) days, subject to reasonable extension where investigation requires additional time.

### 16.3 Remediation

Where investigation identifies an issue requiring remediation, SecureLogic AI may take actions including prompt-engineering changes, configuration adjustments, AI Provider escalation, feature suspension or modification, customer notification, and updates to this AI Policy. Material incidents will be disclosed to affected Customers in accordance with applicable law and our agreements.

### 16.4 No Confidentiality on Receipt

Submission of an AI-issue report does not create a confidential or legal relationship between the reporter and SecureLogic AI. SecureLogic AI may share reports with AI Providers, security partners, legal advisors, and regulators as necessary to investigate or address the underlying issue.

## 17. Customer Responsibilities

Customer responsibilities when using AI-assisted features of the Services include:

- Reviewing AI Outputs before relying upon them, particularly for consequential decisions;
- Exercising independent professional judgment in compliance, risk, vendor, and governance activities;
- Ensuring submitted content does not include Prohibited Data as defined in the Terms of Service;
- Maintaining confidentiality of credentials and other security obligations described in the Terms of Service and Privacy Policy;
- Using AI-assisted features in compliance with applicable laws, regulations, and agreements, including any AI-specific obligations that may apply to Customer's industry or jurisdiction;
- Communicating AI use disclosures to Customer's own end users, employees, or other affected parties where required by applicable law;
- Reporting suspected AI issues as described in Section 16.

## 18. AI-Generated Content Labeling

Where reasonably practicable, the Services label or otherwise identify content that has been generated or substantially produced with the assistance of AI. Labeling may take the form of in-platform indicators, document footers in Deliverables, metadata, or descriptive text accompanying AI-generated outputs.

Customers who incorporate AI-assisted outputs into their own communications, deliverables, or filings are responsible for any disclosure obligations applicable to such use under their own legal, regulatory, contractual, or ethical obligations.

## 19. Customer Use of the Platform for AI Governance

The Services include functionality that supports Customer's own AI governance activities, including a NIST AI Risk Management Framework template and related controls and obligations. We recognize that customers who use the Services for AI governance reasonably expect SecureLogic AI itself to operate with consistent rigor.

This AI Policy reflects that commitment. Where Customers identify gaps between this AI Policy and the standards their organization seeks to apply to AI vendors, we welcome feedback and will engage in good faith to address material concerns.

## 20. Customer Feedback

Customer feedback on AI-assisted features — including observations regarding accuracy, usefulness, bias, transparency, or risk — is welcomed and may be used to improve the Services, refine our use of AI, update this AI Policy, and inform our governance practices. Feedback may be submitted through customer support channels or directly to ai@securelogicai.com.

## 21. Policy Updates

We may update this AI Policy from time to time to reflect changes in our use of AI, our AI Providers, applicable law, industry practice, or other factors. When we make material changes, we will provide notice by:

- Updating the "Last Updated" date at the top of this AI Policy;
- Posting a notice within the Services or on our website;
- Sending an email to the address associated with Customer Accounts, where appropriate;
- Other reasonable means of notice.

Updated versions of this AI Policy become effective upon publication unless otherwise stated. Continued use of the Services following the effective date of an updated AI Policy constitutes acceptance of the updated AI Policy.

## 22. Relationship to Other Agreements

This AI Policy supplements, and does not replace or modify, the SecureLogic AI Terms of Service, Privacy Policy, and any other agreements between SecureLogic AI and the Customer. In the event of a conflict between this AI Policy and the Terms of Service, the Terms of Service shall control. In the event of a conflict between this AI Policy and the Privacy Policy with respect to processing of personal information, the Privacy Policy shall control.

## 23. Contact Information

Questions, concerns, feedback, or reports related to this AI Policy or to AI-assisted functionality within the Services may be directed to:

> Threat Loom, LLC
> Doing business as: SecureLogic AI
> 44 Apple Street, First Floor
> Tinton Falls, New Jersey 07724
> United States

- AI governance and AI-issue inquiries: ai@securelogicai.com
- Privacy inquiries: privacy@securelogicai.com
- Legal inquiries: legal@securelogicai.com
- Security inquiries: security@securelogicai.com

## 24. Effective Date

This AI Policy is effective as of the Effective Date identified at the top of this document and remains in effect until replaced by a revised version. Prior versions of this AI Policy are archived and may be requested by contacting ai@securelogicai.com.

---

*© 2026 Threat Loom, LLC d/b/a SecureLogic AI. All rights reserved.*
