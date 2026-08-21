# HireFilter v1.4 — System Documentation

**System Name**: HireFilter  
**Version**: 1.4  
**Developer**: TalentStream Software GmbH  
**Document status**: Internal — Technical Documentation (EU AI Act Annex IV)  
**Last updated**: 2025-01-15  

---

## 1. Purpose and Intended Use

HireFilter is an AI-powered candidate screening and ranking system designed for use by corporate HR teams in high-volume recruitment processes. The system processes job applications submitted via an applicant tracking system (ATS), extracts structured candidate information from CVs and cover letters using natural language processing, and ranks candidates against a job description to produce a shortlist for human review.

The system is intended to assist **HR managers and talent acquisition specialists** in managing large application volumes (typically 100–500 applications per role). Its output is a ranked list of candidates. HR staff are expected to review the top-ranked candidates and make their own independent assessment before advancing applicants to telephone screening. The system does not make hiring decisions and is not used for final selection.

HireFilter is classified as a high-risk AI system under **Annex III, point 4(a)** of Regulation (EU) 2024/1689 (EU AI Act), as it is used for recruitment, selection, and shortlisting of natural persons in employment contexts.

---

## 2. Technical Architecture and Approach

### 2.1 System Pipeline

HireFilter operates as a two-stage pipeline:

**Stage 1 — Structured extraction (NLP)**  
A fine-tuned named entity recognition (NER) model (based on spaCy's `en_core_web_trf` transformer backbone, fine-tuned on 50,000 annotated CVs) extracts structured fields from unstructured CV text:

| Extracted field | Notes |
|---|---|
| Education (institution, degree, grade) | Normalised to qualification level taxonomy |
| Work experience (employer, role title, tenure) | Parsed to structured job history |
| Skills (technical, soft, certifications) | Matched to skills ontology of 4,200 terms |
| Employment gaps | Flagged but not scored negatively (v1.4 fix — see Section 6) |
| Languages | Detected from CV content |

**Stage 2 — Relevance ranking (gradient boosting)**  
A gradient boosting ranker (LightGBM) trained on historical hiring decisions (hired vs. rejected) at the client organisation scores each candidate against the job description. Job description features are encoded using sentence embeddings (sentence-transformers `all-MiniLM-L6-v2`, Apache-2.0).

The ranker produces a relevance score (0–100) for each applicant. The top-N candidates (configurable, default: 20) are presented to the HR team in the HireFilter dashboard with their ranking score and the top-3 contributing factors.

### 2.2 Model Card Summary

- **Stage 1 NER**: spaCy transformer fine-tune, F1 (entity-level) 0.87
- **Stage 2 ranker**: LightGBM, NDCG@20 = 0.74 on held-out evaluation set
- **Training data size**: 3 years of hiring decisions from 3 corporate clients (approx. 180,000 application-outcome pairs)
- **Embedding model**: sentence-transformers `all-MiniLM-L6-v2`
- **Inference latency (per application)**: ~120ms

---

## 3. Data and Training

### 3.1 Training Data Sources

The Stage 2 ranker is trained on historical hiring data provided by three enterprise clients under data processing agreements. Each client provided:
- Anonymised CV extracts (structured, post-Stage 1 extraction)
- Job descriptions for each role
- Binary outcome labels (advanced to interview / not advanced)

Data spans 2021–2024 across the following sectors: technology, financial services, and professional services. All training data was pseudonymised prior to use. A Data Protection Impact Assessment (DPIA) was conducted and completed prior to training data collection.

### 3.2 Known Data Limitations

- **Historical bias**: The three client organisations' historical hiring decisions reflect predominantly white male hiring outcomes in technical roles (based on voluntary diversity disclosure data provided by clients for bias audit purposes). The ranker trained on this data has been shown to produce lower scores for women applicants in technical roles in the pre-v1.4 audit.
- **Sector and role coverage**: The training data covers primarily graduate and mid-level roles in the three client sectors. Performance on senior, part-time, or non-standard roles has not been validated.
- **Non-English CVs**: Stage 1 NER was trained exclusively on English-language CVs. Performance on CVs in other languages (e.g., French, German) is significantly degraded. The system displays a warning when non-English content is detected but does not reject the application.
- **CV format dependency**: Stage 1 extraction performance degrades on non-standard CV formats (e.g., creative layouts, infographic CVs, heavily formatted PDFs). Extraction failures result in sparse feature vectors, which the Stage 2 ranker may score conservatively.

### 3.3 Bias Audit (Pre-deployment v1.4)

A structured bias audit was conducted prior to the v1.4 release by TalentStream's internal data science team:

- **Gender gap**: Female candidates in technical roles scored on average 4.3 points lower (on the 0–100 scale) than male candidates with equivalent qualifications in the v1.3 model. This was partially addressed in v1.4 by re-weighting training samples for underrepresented groups. The residual gap after re-weighting was 1.8 points (within the accepted threshold of 2.0 points).
- **Employment gap penalty**: v1.3 scored employment gap periods negatively due to a training data artefact (candidates returning from career breaks were less likely to be advanced in the historical data). v1.4 removes employment gap duration as a feature entirely.
- **Residual risk**: A residual bias risk for gender in technical roles remains. HR teams are informed of this in the system's operator guide.

---

## 4. Deployment Context

### 4.1 Operational Environment

HireFilter is deployed as a **multi-tenant SaaS product**. Each client organisation is a separate tenant with data isolation enforced at the application layer. HR teams access the system via a web interface. The system integrates with ATS platforms via a webhook API.

HireFilter processes applications from across the European Union. The system is hosted on EU-based cloud infrastructure (Frankfurt region) to satisfy GDPR data residency requirements.

### 4.2 Regulatory Context

- **EU AI Act 2024/1689** (Annex III point 4(a), Art. 9, Art. 13, Art. 14, Art. 15)
- **GDPR** (Art. 6 — lawful basis: legitimate interest, supported by DPIA; Art. 22 — human review in place)
- **EU Equal Treatment Directives** (2000/43/EC, 2006/54/EC)

GDPR lawful basis: **Legitimate interest** (Art. 6(1)(f)). Candidates are informed of automated screening in the job advertisement and privacy notice. A DPIA was completed and is reviewed annually.

### 4.3 Intended Users

- **HR managers**: Primary users; review ranked shortlists and make interview decisions
- **Talent acquisition specialists**: Configure job descriptions, review rankings, manage candidate pipeline
- **Hiring managers**: Optional access to shortlist for input into interview decision

Candidates do not interact directly with HireFilter. They submit applications through the normal ATS interface.

---

## 5. Human Oversight

### 5.1 Human Review of Shortlist

HR staff review the top-ranked candidates presented by HireFilter and are not bound by the system's ranking. The system explicitly surfaces its ranking score and top-3 contributing factors for each candidate to support informed, independent review.

HR managers are trained (as part of onboarding) that the system's ranking reflects historical patterns in similar roles and may not capture all aspects of candidate suitability, including soft skills, cultural fit, and diversity considerations.

### 5.2 Override and Inclusion Controls

HR managers can use two override controls:
- **Override-include**: Flag a candidate outside the top-20 for inclusion in the review shortlist (bypasses ranking threshold)
- **Override-exclude**: Remove a candidate from the shortlist despite a high ranking score

All override actions are logged with a timestamp and user ID. Override patterns are reviewed quarterly by TalentStream's trust and safety team to detect anomalous use.

### 5.3 Audit Log

All ranking decisions are retained in an audit log for 12 months (minimum required retention under TalentStream's data retention policy, reviewed against sector requirements). The log includes: job ID, application ID (pseudonymised), ranking score, top-3 features, HR manager ID, final advancement decision.

---

## 6. Known Limitations and Residual Risks

- **Non-English CVs**: Performance is not validated for CVs in languages other than English. A warning is displayed, but the application is not rejected. HR teams should exercise additional care for non-English applications.
- **Non-standard CV formats**: Extraction failures on heavily formatted CVs may result in unfairly low scores. HR teams are advised to review original CV documents for low-scoring candidates before making shortlisting decisions.
- **Residual gender bias (technical roles)**: A 1.8-point average score gap for women in technical roles remains after v1.4 re-weighting. This is within the TalentStream acceptance threshold but is a known residual risk documented in the model card and operator guide.
- **Training data sector coverage**: Performance has not been validated for roles significantly different from the training distribution (e.g., blue-collar roles, part-time roles, senior executive roles). Deployer clients are contractually required to validate performance before applying HireFilter to role types not covered in the agreed scope.
- **Post-market monitoring**: Real-time bias monitoring in production is not yet implemented. Quarterly aggregated bias reports are provided to enterprise clients. Automated real-time drift detection is on the v2.0 roadmap.

---

*This document is prepared in partial fulfilment of EU AI Act Annex IV technical documentation requirements. It should be read alongside the full model card, bias audit report, DPIA, and risk register maintained in the TalentStream Software GmbH AI Governance Repository.*
