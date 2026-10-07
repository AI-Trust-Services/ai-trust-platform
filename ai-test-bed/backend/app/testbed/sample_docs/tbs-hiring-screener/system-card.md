# System Card: Automated Hiring Screener

**System ID:** SYS-TBHIRING  
**Version:** 1.0  
**Owner:** HR Technology Team  
**Last updated:** 2024-11-01

---

## 1. Purpose and Scope

The Automated Hiring Screener (AHS) is an AI-assisted recruitment tool deployed internally by the HR department. Its sole purpose is to reduce manual effort in the initial screening of incoming job applications for high-volume open roles across all departments.

**In scope:**  
- Parsing and structuring incoming CV documents (PDF, DOCX)  
- Scoring candidates against a job description using semantic similarity  
- Producing a ranked shortlist for recruiter review  

**Out of scope:**  
- Making final hiring decisions  
- Communicating with candidates  
- Accessing social media profiles without explicit candidate consent  

---

## 2. Intended Use

Recruiters upload a batch of CVs alongside a job description. The system:

1. Extracts structured signals from each CV: skills, years of experience, education level, and job-title history.  
2. Computes a semantic similarity score between the candidate profile and the job description using a fine-tuned transformer model.  
3. Returns a ranked list of all candidates, highlighting the top 20 as the primary review shortlist.  

A human recruiter reviews the top-20 before any candidate is contacted. No offer, rejection, or interview invitation is generated automatically.

---

## 3. Affected Persons

- **Job applicants** — external individuals who submitted CVs through the corporate careers portal. They are not informed in real time that an AI system is used for initial screening; a general disclosure is included in the job posting footer.  
- **Hiring managers** — internal employees who receive the recruiter-curated shortlist; they do not interact directly with the AI system.

---

## 4. Data and Inputs

| Input | Format | Source |
|---|---|---|
| CV document | PDF or DOCX | Candidate upload via careers portal |
| Job description | Plain text | Recruiter entry in the HR portal |
| Psychometric assessment (optional) | Structured JSON | Third-party assessment platform API |

**Special-category data:** None ingested by design. The extraction pipeline explicitly skips fields that indicate ethnicity, disability, health status, or religion. The model was not trained on special-category attributes.

---

## 5. Model and Technical Architecture

- **Model type:** Transformer-based encoder (sentence-transformers), fine-tuned for semantic similarity between CV text and job description text.  
- **Training data:** A proprietary anonymised dataset of 150 000 historical CV–job-description pairs from 2018–2023, with positive/negative labels based on recruiter shortlisting decisions after manual review.  
- **Training compute:** Estimated < 10²³ FLOPs (well below the GPAI systemic-risk threshold).  
- **Inference:** Batch mode only — no real-time single-CV scoring during the application process. Scores are computed when the recruiter triggers a batch run.  
- **Output:** A ranked list with numeric similarity scores (0–1 scale) and extracted skill keywords.

---

## 6. Oversight and Human Control

| Mechanism | Details |
|---|---|
| Recruiter review | Every shortlist is reviewed by a human recruiter before any candidate is contacted |
| Rejection explanation | Rejected applicants at the shortlisting stage can request a manual review within 30 days |
| Audit trail | All batch runs are logged with the job ID, recruiter ID, model version, and timestamp |
| Bias monitoring | Quarterly fairness audit checks shortlist demographic composition against applicant pool |
| Override | Recruiter can add or remove any candidate from the final shortlist before proceeding |

---

## 7. Deployment Context

- **Environment:** On-premise HR portal, accessible only to credentialed recruiters and HR business partners.  
- **Geographic scope:** EU (Germany, Netherlands) only.  
- **Market placement:** Internal deployment only; system is not placed on the EU market or made available to third parties.  
- **Maintenance:** Model retrained annually on refreshed anonymised data. Significant accuracy drops trigger an emergency review.

---

## 8. Limitations and Known Risks

- **CV format sensitivity:** CVs in non-standard formats (e.g., heavily graphical PDFs, tables) may produce lower-quality extractions.  
- **Language:** System performs best on German and English CVs; performance on other languages is untested.  
- **Job description quality:** Very short or generic job descriptions reduce score discrimination and increase shortlist noise.  
- **Historical bias:** Training data reflects past recruiter decisions, which may embed historical biases. The quarterly fairness audit is the primary mitigation.
