# System Card: Retail Credit Risk Scorer

**System ID:** SYS-TBCREDIT  
**Version:** 3.4  
**Owner:** Credit Risk — Model Risk Management  
**Last updated:** 2024-10-01

---

## 1. Purpose and Scope

The Retail Credit Risk Scorer (RCRS) is an ML-based system deployed by the bank's retail credit division. It assesses the creditworthiness of personal loan applicants by producing a risk score that feeds directly into the loan approval workflow.

**In scope:**  
- Producing a credit risk score (0–1000) for personal loan applications  
- Triggering automated approval or rejection for loan amounts below €25 000  
- Providing the score as input to human underwriter decisions for loans above €25 000  

**Out of scope:**  
- Mortgage decisions  
- Business/corporate loans  
- Fraud detection (handled by a separate, independent system)  

---

## 2. Intended Use

When a customer applies for a personal loan via the bank's mobile app or branch:

1. Application data is submitted to the RCRS API.  
2. The model produces a score on a 0–1000 scale, where higher scores indicate lower credit risk.  
3. **Automated path (loans < €25 000):** The score is compared to a threshold. Above-threshold → automated approval; below-threshold → automated rejection. The applicant receives an explanation letter.  
4. **Human review path (loans ≥ €25 000):** The score and supporting data are presented to a human underwriter, who makes the final decision.  

---

## 3. Affected Persons

- **Retail banking customers** — individuals applying for personal loans. Adverse automated decisions (rejection) directly affect access to credit, a service classified as essential under EU AI Act Annex III, point 5.  
- **Human underwriters** — receive the score as a decision-support input for larger loans. They are not obligated to follow the score.  
- **Applicants of record** — may request a manual review of any adverse automated decision within 30 days.

---

## 4. Data and Inputs

| Input | Format | Source |
|---|---|---|
| Credit bureau score | Numeric | Third-party credit bureau API |
| Income verification | Numeric / categorical | Application form + payroll verification |
| Employment status | Categorical | Application form |
| Existing debt obligations | Numeric | Credit bureau + bank internal |
| Repayment history (bank) | Time series | Bank core banking system |
| Loan amount requested | Numeric | Application form |

**Personal data classification:** All input data is personal financial data subject to GDPR and bank secrecy obligations. Special-category data (health, ethnicity, religion) is explicitly excluded by the data pipeline. Age is excluded post-fairness review (2023); loan purpose category is included only as a binary "consumer/consolidation" flag.

---

## 5. Model and Technical Architecture

- **Model type:** Gradient-boosted ensemble (XGBoost), trained on historical loan application and outcome data.  
- **Training data:** 2.4 million anonymised loan applications from 2015–2023, with 18-month repayment outcomes.  
- **Training compute:** Estimated well below 10²⁵ FLOPs (not GPAI-systemic by any measure).  
- **Deployment:** Batch and real-time scoring via an internal REST API. P95 latency < 150 ms.  
- **Organisation role:** The bank is the **provider** — it trained the model on proprietary data and deploys it under its own name for its own operational use.

---

## 6. Oversight and Human Control

| Mechanism | Details |
|---|---|
| Human underwriter | Mandatory human review for all loans ≥ €25 000 |
| Adverse decision explanation | Automated letter stating the primary negative factors driving rejection |
| Manual review right | Any applicant may request a manual review within 30 days of an adverse decision |
| Quarterly fairness audit | Statistical analysis of score distributions and rejection rates across demographic groups |
| Model risk committee | Quarterly review of model performance metrics (Gini, PSI, KS). Drift > 5% PSI triggers immediate review |
| Override logging | All underwriter overrides of the score recommendation are logged for subsequent model calibration |

---

## 7. Deployment Context

- **Environment:** Internal decisioning microservice, integrated with the bank's core banking platform via internal REST API. Not accessible externally.  
- **Geographic scope:** Germany, Austria, Netherlands — all EU jurisdictions.  
- **Market placement:** Internal deployment only; not sold or licensed to third parties.  
- **Regulatory context:** Subject to EU AI Act Annex III (point 5 — access to essential private financial services), EBA Guidelines on Internal Governance, and GDPR Article 22 (automated individual decision-making rights).

---

## 8. Limitations and Known Risks

- **Model drift:** Economic shifts (e.g., rapid inflation, sectoral layoffs) can degrade score calibration. Monthly PSI monitoring is the primary detection mechanism.  
- **Thin-file applicants:** Customers with limited credit history receive scores with lower confidence; the model flags this and the underwriter path is recommended for borderline thin-file cases regardless of loan amount.  
- **Fairness:** Despite exclusion of protected attributes, proxy effects via correlated features (e.g., postcode → ethnicity) remain a risk. Quarterly fairness audit addresses this but cannot fully eliminate it.  
- **Data quality:** Errors in credit bureau data are outside the bank's control; applicants are informed of their right to dispute bureau data.
