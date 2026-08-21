# CreditSense v2.1 — System Documentation

**System Name**: CreditSense  
**Version**: 2.1  
**Developer**: Acme Financial Technologies Ltd.  
**Document status**: Internal — Technical Documentation (EU AI Act Annex IV)  
**Last updated**: 2025-01-15  

---

## 1. Purpose and Intended Use

CreditSense is an AI-assisted creditworthiness scoring system designed for use by retail banking institutions. The system takes a structured financial profile of a loan applicant and produces a numerical creditworthiness score (0–1000) together with a binary recommendation (Approve / Refer for manual review / Decline) for consumer loan applications.

The system is intended to be used as a **decision-support tool** by trained loan officers and credit analysts at retail banking branches and call centres. The final lending decision in all cases remains with the human loan officer, who may accept, override, or disregard the system's recommendation. CreditSense is not authorised for use in fully automated, no-human-review decision flows.

CreditSense is classified as a high-risk AI system under **Annex III, point 5(b)** of Regulation (EU) 2024/1689 (EU AI Act), as it is used to evaluate the creditworthiness of natural persons and to determine their access to financial resources.

---

## 2. Technical Architecture and Approach

### 2.1 Model Architecture

CreditSense uses a **gradient boosting classifier** (XGBoost v2.0) trained to predict the probability that an applicant will default on a loan within 24 months of origination. The model outputs a calibrated probability score, which is linearly transformed to the 0–1000 score range.

The model takes **47 structured input features** derived from the applicant's financial profile and transaction history. No free-text fields, images, or unstructured data are used as inputs.

### 2.2 Feature Groups

| Feature group | Number of features | Description |
|---|---|---|
| Income and employment | 8 | Gross income, employment type, tenure, sector |
| Existing debt obligations | 7 | Total existing debt, monthly commitments, debt-to-income ratio |
| Transaction behaviour | 18 | Monthly transaction patterns, spending categories, overdraft usage over 24 months |
| Credit bureau data | 9 | Credit score from bureau, number of accounts, adverse events, age of oldest account |
| Application characteristics | 5 | Loan amount, requested term, purpose of loan, channel |

**Protected attributes excluded**: Race, ethnicity, religion, nationality, gender, sexual orientation, disability status, and age are **not used as direct model inputs**. Postcode is included as a feature but is monitored for proxy discrimination risk (see Section 5).

### 2.3 Explainability

SHAP (SHapley Additive exPlanations) values are computed at inference time for every application. The top 5 features contributing positively and negatively to the score are surfaced to the loan officer via the dashboard interface. This satisfies the explanation requirement under Art. 13 of the EU AI Act and supports the right to explanation under GDPR Art. 22(3).

### 2.4 Model Card Summary

- **Algorithm**: XGBoost 2.0, gradient boosted trees
- **Training objective**: Binary cross-entropy (default prediction)
- **Calibration method**: Isotonic regression (post-hoc)
- **Training set size**: 800,000 historical loan applications (5-year window, 2018–2023)
- **Evaluation set size**: 120,000 applications (held-out, same period)
- **Overall AUC-ROC**: 0.81
- **Overall Gini coefficient**: 0.62
- **Inference latency (p99)**: 45ms

---

## 3. Data and Training

### 3.1 Training Data Sources

Training data is sourced exclusively from the internal loan book of the deploying institution, covering consumer loan applications submitted between January 2018 and December 2023. Ground truth labels are derived from actual loan outcomes: default is defined as 90+ days past due within 24 months of origination.

No third-party training data or synthetic data is used in the base model. Credit bureau data is retrieved in real time at inference; no bureau data is stored in the training dataset beyond derived features.

### 3.2 Known Data Limitations

- **Historical bias risk**: The training data reflects historical lending decisions made by human loan officers, which may themselves contain implicit biases. Applicants who were declined in the historical period have no outcome data, creating selection bias (credit scoring variant of the "rejected applicant problem").
- **Temporal coverage**: The training window (2018–2023) includes the COVID-19 period (2020–2021), during which default patterns were materially affected by government support measures. The model may not generalise well to conditions resembling either pre-COVID norms or a post-COVID tightening cycle.
- **Proxy discrimination**: Postcode and employment sector are included as features and are known to be statistically correlated with ethnicity and socioeconomic status in the UK context. A proxy discrimination analysis is conducted at each model retraining cycle (see Section 5).

### 3.3 Data Minimisation

A feature ablation study was conducted to assess the contribution of each feature to model performance. Features whose removal caused a Gini coefficient reduction of less than 0.002 were excluded. Documentation of the ablation results is maintained in the model card repository.

---

## 4. Deployment Context

### 4.1 Operational Environment

CreditSense is deployed as an **internal REST API** hosted on the institution's private cloud infrastructure. Loan officers access the system via a **browser-based decision-support dashboard**, which presents the score, recommendation, and SHAP explanations alongside the applicant's full profile.

The system currently processes approximately **3,000 loan applications per month** across 12 branch locations and the central telephone lending team.

### 4.2 Regulatory Context

The deploying institution operates in the United Kingdom and the European Union. The system is subject to:

- **EU AI Act 2024/1689** (Annex III, Art. 9, Art. 13, Art. 14, Art. 15)
- **UK FCA Consumer Duty** (PS22/9)
- **GDPR / UK GDPR** (Art. 22 — automated decision-making)
- **Equal Credit Opportunity principles** (UK Equality Act 2010)

### 4.3 Intended Users

The system is intended for use only by trained credit professionals:
- Loan officers at retail banking branches
- Branch managers reviewing escalated cases
- Central credit risk team (monitoring and audit)

Consumer applicants do not interact directly with the system. They receive a decision notice generated by the officer, which includes a plain-language summary of the key factors.

---

## 5. Human Oversight

### 5.1 Override Mechanism

Loan officers are explicitly trained that the system's recommendation is advisory. All override decisions (accepting a Decline recommendation or declining an Approve recommendation) are logged in the audit trail, including the officer's stated reason (structured categories + free text).

Override rates are reviewed monthly by the credit risk team to detect patterns suggestive of systematic over-reliance or inconsistent application.

### 5.2 Mandatory Manual Review Triggers

The following case types are automatically routed to a senior officer for mandatory manual review, regardless of the system's recommendation:

- Applicant indicates a disability or vulnerability (flagged during application intake)
- Score within 50 points of the Approve/Decline threshold (borderline cases)
- First-time applicants with fewer than 6 months of transaction history
- Loan amount exceeding £50,000

### 5.3 Audit and Monitoring

A **quarterly fairness audit** is conducted by the credit risk analytics team. This includes:
- Approval rate disaggregated by gender, age band, and geographic proxy for ethnicity (LSOA deprivation decile)
- Override rate disaggregated by the same dimensions
- Performance metrics (default rates by approved cohort) where sufficient outcome data is available

Results are reviewed by the model governance committee and trigger a model review if any protected-group approval rate gap exceeds 5 percentage points.

---

## 6. Known Limitations and Residual Risks

- **Thin credit file applicants**: Model reliability is materially lower for applicants with fewer than 12 months of transaction history (e.g., recent graduates, recent migrants). These cases are flagged and routed to mandatory manual review.
- **Proxy discrimination**: Despite the exclusion of direct protected attributes, postcode and employment sector may act as proxies. The quarterly audit is the primary control for detecting this. A full proxy discrimination mitigation (e.g., adversarial debiasing) has not yet been applied and is planned for v3.0.
- **Post-market monitoring**: A real-time model performance dashboard is under development. Monthly ground truth labels (loan outcomes) are currently reviewed manually with a 90-day lag. Automated drift alerting is not yet in place.
- **SHAP explanation fidelity**: SHAP values are computed using a TreeExplainer approximation. In rare cases (estimated <0.5% of inferences) the explanation may not accurately reflect the model's reasoning path.

---

*This document is prepared in partial fulfilment of EU AI Act Annex IV technical documentation requirements. It should be read alongside the full model card, data lineage documentation, and risk register maintained in the Acme Financial Technologies Ltd. AI Governance Repository.*
