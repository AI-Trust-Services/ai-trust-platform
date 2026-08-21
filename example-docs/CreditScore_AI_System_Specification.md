# CreditScore AI Plus
## Intelligent Credit Assessment System

### 1. System Overview

CreditScore AI Plus is an automated credit risk assessment system that evaluates loan applications and determines creditworthiness by analyzing financial history, income patterns, and behavioral data. The system provides risk scores and lending recommendations to support financial decision-making.

| Field | Value |
|-------|-------|
| **System Name** | CreditScore AI Plus - Credit Assessment |
| **Version** | 3.2.1 |
| **Provider** | SAP Financial Services |
| **Department** | Risk Management |
| **Business Unit** | Corporate Banking |
| **Lifecycle Stage** | Production |

### 2. Intended Purpose

The system is designed to:

* Analyze credit applications and financial documents automatically
* Calculate credit risk scores based on historical data and predictive models
* Assess repayment probability using income analysis and spending patterns
* Generate lending recommendations with risk-adjusted interest rates
* Flag high-risk applications for manual review
* Provide transparency reports showing key decision factors

### 3. Technical Architecture

| Field | Value |
|-------|-------|
| **Base Model** | GPT-4 (OpenAI) with custom financial layer |
| **Fine-tuning** | Custom training on 2M credit decisions |
| **Training Compute** | 5.8 x 10^22 FLOPs |
| **Inference Endpoint** | https://creditscore.finance.example.com/api |

### 4. EU AI Act Classification

This system falls under **High-Risk** classification per EU AI Act Article 6(2) and Annex III, Area 5(b) - AI systems intended to evaluate the creditworthiness of natural persons.

| Field | Value |
|-------|-------|
| **Risk Category** | High-Risk (Annex III) |
| **Annex III Area** | 5(b) - Creditworthiness assessment |
| **Is GPAI** | No - Domain-specific application |
| **Is Chatbot** | No |
| **Generates Synthetic Content** | No |
| **Biometric Processing** | No |
| **Critical Infrastructure** | No |

### 5. Human Oversight

All credit decisions above €50,000 require human approval. Risk scores are advisory only; final lending decisions remain with qualified loan officers. Applicants have the right to request human review of any automated decision.

### 6. Contacts

| Role | Contact |
|------|---------|
| **Business Owner** | Sarah Fischer (Head of Risk Management) |
| **Technical Owner** | Andreas Müller (ML Engineering Manager) |
