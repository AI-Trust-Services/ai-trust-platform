# System Card: Internal Knowledge Assistant

**System ID:** SYS-TBCHATBOT  
**Version:** 2.1  
**Owner:** IT — Digital Workplace Team  
**Last updated:** 2024-09-15

---

## 1. Purpose and Scope

The Internal Knowledge Assistant (IKA) is a conversational AI tool available on the company intranet. It helps employees quickly find information from internal documentation without having to search Confluence or SharePoint manually.

**In scope:**  
- Answering employee questions about HR policies, IT procedures, and company guidelines  
- Retrieving relevant passages from indexed internal documentation  
- Generating natural-language synthesised responses  

**Out of scope:**  
- Making HR decisions (approvals, performance evaluations, disciplinary actions)  
- Accessing personal employee data  
- Communicating externally or to customers  

---

## 2. Intended Use

An employee types a question in natural language. The system:

1. Retrieves the most relevant passages from the internal document index using dense vector search.  
2. Passes the retrieved passages and the question to a hosted LLM (accessed via API) with a retrieval-augmented prompt.  
3. Returns a synthesised natural-language answer with inline references to the source documents.  

The response is informational only. No HR, payroll, IT permission, or compliance action is triggered by the system.

---

## 3. Affected Persons

- **Employees** — approximately 5 000 full-time employees on the corporate network or VPN. Use is voluntary; employees who prefer to contact HR or IT directly are not required to use the assistant.  
- **HR and IT teams** — indirectly, as source-document owners; their policies and procedures are indexed and retrieved.

---

## 4. Data and Inputs

| Input | Format | Source |
|---|---|---|
| Employee query | Free text | Employee chat interface |
| Policy documents | PDF, Markdown | HR SharePoint, IT Confluence |
| IT runbooks | Markdown | IT GitLab |
| Company handbook | PDF | HR SharePoint |

**Personal data:** Employee queries are processed in session and not stored beyond 24 hours for diagnostic logging. No persistent personal profile is built. Queries containing personal identifiers (e.g., employee IDs) are handled in-session and not indexed.

---

## 5. Model and Technical Architecture

- **Retrieval layer:** Hybrid dense + full-text search over a vector index built from internal documents. Re-indexed nightly.  
- **Generation layer:** Third-party hosted LLM accessed via REST API. The organisation is a **deployer**, not a provider or trainer of the LLM.  
- **Prompt construction:** Retrieved passages are prepended to the system prompt as context; the employee question is the user turn. No fine-tuning of the LLM is performed.  
- **Response quality:** Responses include inline citations (document name + section) so employees can verify the source.

---

## 6. Oversight and Human Control

| Mechanism | Details |
|---|---|
| Source citations | Every response cites its source documents; employees can verify and escalate |
| Direct escalation | Employees can always contact HR or IT directly; the assistant provides contact links |
| Feedback | Employees can flag inaccurate responses via a thumbs-down button |
| Quarterly audit | Content quality and response accuracy audited quarterly by HR/IT document owners |
| Document refresh | Source index re-built nightly; major policy changes trigger an immediate re-index |

---

## 7. Deployment Context

- **Environment:** Intranet web application; accessible only on the corporate network or via VPN.  
- **External access:** None — not exposed to the public internet or to customers.  
- **LLM provider:** Third-party SaaS provider; data processing agreement in place.  
- **Geographic scope:** EU employees only (data residency requirement enforced in DPA).

---

## 8. Limitations and Known Risks

- **Hallucination risk:** As with all RAG systems, the LLM may occasionally synthesise plausible-sounding but incorrect answers not fully supported by the retrieved context. Inline source citations allow employees to detect this.  
- **Index freshness:** Policies updated between nightly re-index cycles may not be reflected immediately.  
- **Query ambiguity:** Very short or ambiguous queries may retrieve off-topic passages; employees are encouraged to ask specific questions.  
- **Language:** System is optimised for German and English; performance in other languages is untested.
