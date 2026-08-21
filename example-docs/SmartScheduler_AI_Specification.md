# SmartScheduler AI
## Intelligent Meeting Optimization Assistant

### 1. System Overview

SmartScheduler AI is a productivity assistant that analyzes calendar availability, meeting patterns, and team preferences to suggest optimal meeting times. The system uses machine learning to reduce scheduling conflicts and improve time management across the organization.

| Field | Value |
|-------|-------|
| **System Name** | SmartScheduler AI - Meeting Optimization |
| **Version** | 1.4.2 |
| **Provider** | SAP Collaboration Hub |
| **Department** | IT Operations |
| **Business Unit** | Corporate IT |
| **Lifecycle Stage** | Production |

### 2. Intended Purpose

The system is designed to:

* Analyze calendar availability across multiple participants
* Suggest optimal meeting times based on preferences and time zones
* Detect scheduling conflicts and propose alternatives
* Learn from user scheduling behavior to improve suggestions
* Estimate meeting duration based on agenda and attendees
* Optimize room booking and resource allocation

### 3. Technical Architecture

| Field | Value |
|-------|-------|
| **Base Model** | Custom LSTM with decision tree ensemble |
| **Fine-tuning** | Training on 500K scheduling decisions |
| **Training Compute** | 1.2 x 10^20 FLOPs |
| **Inference Endpoint** | https://scheduler.collab.example.com/api |

### 4. EU AI Act Classification

This system falls under **Minimal-Risk** classification per EU AI Act. The system does not involve high-risk applications, prohibited practices, biometric identification, or critical infrastructure. No specific regulatory obligations beyond general product safety rules.

| Field | Value |
|-------|-------|
| **Risk Category** | Minimal-Risk |
| **Annex III Area** | Not applicable |
| **Is GPAI** | No - narrow task-specific AI |
| **Is Chatbot** | No |
| **Generates Synthetic Content** | No |
| **Biometric Processing** | No |
| **Critical Infrastructure** | No |

### 5. Human Oversight

Users can accept or reject all scheduling suggestions. The system does not automatically book meetings without user confirmation. Calendar data access limited to availability information only. Users control sharing preferences and can disable AI suggestions.

### 6. Contacts

| Role | Contact |
|------|---------|
| **Business Owner** | Mark Johnson (VP Collaboration Tools) |
| **Technical Owner** | Sophie Laurent (Productivity AI Engineer) |
