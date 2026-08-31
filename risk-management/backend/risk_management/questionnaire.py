from __future__ import annotations

import json
import os
import re
import uuid
from typing import Optional

from pydantic import BaseModel

from risk_management.models import (
    LikelihoodLevel,
    MitigationHierarchyLevel,
    Risk,
    RiskSource,
    SeverityLevel,
    TaxonomyMapping,
)

# ---------------------------------------------------------------------------
# Questionnaire definition
# ---------------------------------------------------------------------------

QUESTIONNAIRE: list[dict] = [
    {
        "id": "q_bias",
        "category": "bias",
        "question": "Does the system make decisions that affect different groups of people (e.g. recruitment, credit scoring, access to services)?",
        "hint": "Relates to Art. 10(2)(f) AI Act and NIST AI RMF GOVERN 6.1",
        "taxonomy_ai_act": "Art. 10(2)(f)",
        "taxonomy_nist": "GOVERN 6.1",
        "default_severity": "high",
        "default_likelihood": "likely",
        "default_mitigation": "reduce",
    },
    {
        "id": "q_data_bias",
        "category": "bias",
        "question": "Could the training data contain historical biases or under-represented groups?",
        "hint": "E.g. historical employment data, credit scores, recidivism records.",
        "taxonomy_ai_act": "Art. 10(2)(f)",
        "taxonomy_nist": "MAP 1.5",
        "default_severity": "high",
        "default_likelihood": "possible",
        "default_mitigation": "reduce",
    },
    {
        "id": "q_explainability",
        "category": "transparency",
        "question": "Do users or affected persons need an explanation of why the system made a particular decision?",
        "hint": "Explainability requirement stems from Art. 13 AI Act and GDPR Art. 22.",
        "taxonomy_ai_act": "Art. 13",
        "taxonomy_nist": "MANAGE 2.2",
        "default_severity": "medium",
        "default_likelihood": "likely",
        "default_mitigation": "inform",
    },
    {
        "id": "q_transparency_external",
        "category": "transparency",
        "question": "Are affected persons aware that a decision was made or assisted by an AI system?",
        "hint": "Art. 50 AI Act imposes an obligation to inform about interaction with an AI system.",
        "taxonomy_ai_act": "Art. 50",
        "taxonomy_nist": "GOVERN 1.1",
        "default_severity": "medium",
        "default_likelihood": "possible",
        "default_mitigation": "inform",
    },
    {
        "id": "q_privacy",
        "category": "privacy",
        "question": "Does the system process personal or sensitive data (health, biometrics, finances, location)?",
        "hint": "GDPR Art. 9 and GDPR Art. 22. Requires a DPIA if processing special category data.",
        "taxonomy_ai_act": "Art. 10(5)",
        "taxonomy_nist": "MAP 5.1",
        "default_severity": "high",
        "default_likelihood": "likely",
        "default_mitigation": "mitigate",
    },
    {
        "id": "q_data_minimization",
        "category": "privacy",
        "question": "Does the system collect more data than is necessary to fulfil its purpose?",
        "hint": "Data minimisation principle (GDPR Art. 5(1)(c)) and Art. 10(3) AI Act.",
        "taxonomy_ai_act": "Art. 10(3)",
        "taxonomy_nist": "MAP 5.1",
        "default_severity": "medium",
        "default_likelihood": "possible",
        "default_mitigation": "eliminate",
    },
    {
        "id": "q_robustness",
        "category": "reliability",
        "question": "Could an incorrect or uncertain decision by the system cause real harm (health, financial, legal)?",
        "hint": "Art. 9(2)(b) requires analysis of erroneous decision scenarios.",
        "taxonomy_ai_act": "Art. 9(2)(b)",
        "taxonomy_nist": "MANAGE 3.1",
        "default_severity": "critical",
        "default_likelihood": "possible",
        "default_mitigation": "mitigate",
    },
    {
        "id": "q_degradation",
        "category": "reliability",
        "question": "Could the system's performance degrade over time (model drift, data distribution shift)?",
        "hint": "Art. 9(2)(c) requires post-deployment monitoring.",
        "taxonomy_ai_act": "Art. 9(2)(c)",
        "taxonomy_nist": "MANAGE 4.1",
        "default_severity": "medium",
        "default_likelihood": "likely",
        "default_mitigation": "mitigate",
    },
    {
        "id": "q_human_agency",
        "category": "human_oversight",
        "question": "Is it possible for a human to challenge or override the system's decision?",
        "hint": "Art. 14 AI Act requires human oversight measures for high-risk systems.",
        "taxonomy_ai_act": "Art. 14",
        "taxonomy_nist": "GOVERN 6.2",
        "default_severity": "high",
        "default_likelihood": "possible",
        "default_mitigation": "reduce",
    },
    {
        "id": "q_vulnerable",
        "category": "human_oversight",
        "question": "Could the system affect vulnerable groups (children, elderly, persons with disabilities, minorities)?",
        "hint": "Art. 9(9) AI Act requires special attention for vulnerable groups.",
        "taxonomy_ai_act": "Art. 9(9)",
        "taxonomy_nist": "MAP 1.5",
        "default_severity": "high",
        "default_likelihood": "possible",
        "default_mitigation": "reduce",
    },
    {
        "id": "q_security",
        "category": "security",
        "question": "Is the system publicly accessible or exposed via an API, making it susceptible to adversarial attacks or data injection?",
        "hint": "OWASP LLM Top 10: prompt injection, model inversion. Art. 15 AI Act — cybersecurity.",
        "taxonomy_ai_act": "Art. 15",
        "taxonomy_nist": "MANAGE 2.4",
        "default_severity": "high",
        "default_likelihood": "possible",
        "default_mitigation": "reduce",
    },
    {
        "id": "q_governance",
        "category": "governance",
        "question": "Has accountability been defined (owner, roles, processes) for the AI system's decisions?",
        "hint": "Art. 9(1) and Art. 17 AI Act require a quality management system and clear accountability.",
        "taxonomy_ai_act": "Art. 17",
        "taxonomy_nist": "GOVERN 1.2",
        "default_severity": "medium",
        "default_likelihood": "likely",
        "default_mitigation": "mitigate",
    },
    {
        "id": "q_audit",
        "category": "governance",
        "question": "Are the system's decisions logged in a way that enables subsequent audit?",
        "hint": "Art. 12 AI Act requires log retention for high-risk AI systems.",
        "taxonomy_ai_act": "Art. 12",
        "taxonomy_nist": "GOVERN 1.4",
        "default_severity": "medium",
        "default_likelihood": "possible",
        "default_mitigation": "mitigate",
    },
]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class QuestionnaireAnswer(BaseModel):
    question_id: str
    answer: bool  # True = yes (risk present), False = no
    justification: str = ""
    confidence: str = "medium"  # "high" | "medium" | "low"
    # Human overrides for risk attributes (applied on top of defaults)
    severity_override: Optional[str] = None
    likelihood_override: Optional[str] = None
    mitigation_override: Optional[str] = None


class QuestionnaireResult(BaseModel):
    risks: list[Risk]
    answers: list[QuestionnaireAnswer]
    backend_used: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _question_by_id(qid: str) -> dict | None:
    for q in QUESTIONNAIRE:
        if q["id"] == qid:
            return q
    return None


def answers_to_risks(answers: list[QuestionnaireAnswer]) -> list[Risk]:
    """Convert answered questionnaire into Risk objects. Only 'yes' answers produce risks."""
    risks: list[Risk] = []
    for ans in answers:
        if not ans.answer:
            continue
        q = _question_by_id(ans.question_id)
        if q is None:
            continue

        sev_str = ans.severity_override or q["default_severity"]
        lik_str = ans.likelihood_override or q["default_likelihood"]
        mit_str = ans.mitigation_override or q["default_mitigation"]

        try:
            severity = SeverityLevel(sev_str)
        except ValueError:
            severity = SeverityLevel.MEDIUM
        try:
            likelihood = LikelihoodLevel(lik_str)
        except ValueError:
            likelihood = LikelihoodLevel.POSSIBLE
        try:
            suggested_mitigation = MitigationHierarchyLevel(mit_str)
        except ValueError:
            suggested_mitigation = MitigationHierarchyLevel.MITIGATE

        mappings: list[TaxonomyMapping] = []
        if q.get("taxonomy_ai_act"):
            mappings.append(TaxonomyMapping(taxonomy="AI_Act", category=q["taxonomy_ai_act"]))
        if q.get("taxonomy_nist"):
            mappings.append(TaxonomyMapping(taxonomy="NIST_AI_RMF", category=q["taxonomy_nist"]))

        risk = Risk(
            id=f"RISK-{uuid.uuid4().hex[:6].upper()}",
            title=_risk_title_from_question(q),
            description=_risk_description(q, ans),
            category=q["category"],
            source=RiskSource.QUESTIONNAIRE,
            taxonomy_mappings=mappings,
            default_severity=severity,
            severity=severity,
            likelihood=likelihood,
            suggested_mitigation_id=suggested_mitigation.value,
            questionnaire_question_id=q["id"],
            article_9_step="9(2)(a)",
            affects_vulnerable_groups=(q["category"] in ("bias", "human_oversight")),
        )
        risks.append(risk)
    return risks


def _risk_title_from_question(q: dict) -> str:
    titles = {
        "q_bias": "Risk of algorithmic discrimination",
        "q_data_bias": "Bias in training data",
        "q_explainability": "Lack of decision explainability",
        "q_transparency_external": "Failure to disclose AI involvement",
        "q_privacy": "Risk of privacy violation",
        "q_data_minimization": "Excessive data collection",
        "q_robustness": "Risk of harm from erroneous decision",
        "q_degradation": "Model quality degradation over time",
        "q_human_agency": "Lack of human oversight mechanisms",
        "q_vulnerable": "Impact on vulnerable groups",
        "q_security": "Security threats and adversarial attacks",
        "q_governance": "Undefined accountability for AI decisions",
        "q_audit": "Lack of decision audit trail",
    }
    return titles.get(q["id"], q["question"][:60])


def _risk_description(q: dict, ans: QuestionnaireAnswer) -> str:
    base = q.get("hint", q["question"])
    if ans.justification:
        return f"{base} Justification: {ans.justification}"
    return base


# ---------------------------------------------------------------------------
# AI-assisted questionnaire filling
# ---------------------------------------------------------------------------

_AI_FILL_SYSTEM_PROMPT = """You are an AI risk management expert specialising in EU AI Act Art. 9.
Your task is to answer questionnaire questions about the risks of an AI system.
For each question, assess based on the system description whether the risk is present (answer: true/false).
Provide a brief justification referencing the documentation, code, or system description.
Respond ONLY with valid JSON. No explanations, no markdown, no additional text.
Response format — array of objects:
[
  {
    "question_id": "q_bias",
    "answer": true,
    "justification": "Quote from documentation or code justifying the answer.",
    "confidence": "high",
    "severity_override": null,
    "likelihood_override": null,
    "mitigation_override": null
  }
]
The *_override fields may be null (defaults are used) or one of:
- severity_override: "critical" | "high" | "medium" | "low"
- likelihood_override: "very_likely" | "likely" | "possible" | "unlikely"
- mitigation_override: "eliminate" | "reduce" | "mitigate" | "inform"
"""

_AI_FILL_USER_TEMPLATE = """Based on the following AI system description, answer all questionnaire questions.

System name: {name}
Annex III category: {annex_iii_category}
Intended purpose: {intended_purpose}
Deployment context: {deployment_context}
AI techniques: {ai_techniques}
Data inputs: {data_inputs}

System description:
{system_description}

{source_code_section}

Questionnaire questions:
{questions_json}

Return a JSON array with answers to ALL {question_count} questions. JSON only."""


_SINGLE_Q_SYSTEM_PROMPT = """You are an AI risk management expert specialising in EU AI Act Art. 9.
Answer a single questionnaire question about the risk of an AI system.
Respond ONLY with valid JSON. No explanations, no markdown.
Format:
{
  "question_id": "<question id>",
  "answer": true/false,
  "justification": "Brief justification referencing the documentation or code.",
  "confidence": "high" | "medium" | "low",
  "severity_override": null,
  "likelihood_override": null,
  "mitigation_override": null
}
"""

_SINGLE_Q_USER_TEMPLATE = """AI system: {name} ({annex_iii_category})
Intended purpose: {intended_purpose}
Deployment context: {deployment_context}
AI techniques: {ai_techniques}
Data inputs: {data_inputs}

System description:
{system_description}

{source_code_section}

Question (id: {question_id}):
{question}

Hint: {hint}

Respond with JSON."""


class AIQuestionnaireAssistant:
    """Fills the questionnaire using an LLM. Falls back to all-false on error."""

    def __init__(self, llm_client):
        self._llm = llm_client

    def fill_single(
        self,
        question_id: str,
        system_description: str,
        metadata,
        source_code: str = "",
    ) -> "QuestionnaireAnswer":
        """Fill a single question. Used for streaming one-by-one filling."""
        from risk_management.llm_client import LLMDisabledError, LLMUnavailableError

        q = _question_by_id(question_id)
        if q is None:
            return QuestionnaireAnswer(question_id=question_id, answer=False, justification="", confidence="low")

        source_code_section = ""
        if source_code.strip():
            source_code_section = f"Source code excerpt:\n```\n{source_code[:1500]}\n```"

        user_prompt = _SINGLE_Q_USER_TEMPLATE.format(
            name=metadata.name,
            annex_iii_category=metadata.annex_iii_category.value,
            intended_purpose=metadata.intended_purpose,
            deployment_context=metadata.deployment_context,
            ai_techniques=", ".join(metadata.ai_techniques) if metadata.ai_techniques else "—",
            data_inputs=", ".join(metadata.data_inputs) if metadata.data_inputs else "—",
            system_description=system_description[:2000],
            source_code_section=source_code_section,
            question_id=q["id"],
            question=q["question"],
            hint=q.get("hint", ""),
        )

        try:
            response = self._llm.complete(_SINGLE_Q_SYSTEM_PROMPT, user_prompt)
            raw = self._parse_single(response.content, question_id)
            return QuestionnaireAnswer(
                question_id=question_id,
                answer=bool(raw.get("answer", False)),
                justification=str(raw.get("justification", ""))[:500],
                confidence=raw.get("confidence", "medium") if raw.get("confidence") in ("high", "medium", "low") else "medium",
                severity_override=raw.get("severity_override") or None,
                likelihood_override=raw.get("likelihood_override") or None,
                mitigation_override=raw.get("mitigation_override") or None,
            )
        except (LLMDisabledError, LLMUnavailableError, ValueError):
            return QuestionnaireAnswer(question_id=question_id, answer=False, justification="", confidence="low")

    def _parse_single(self, content: str, question_id: str) -> dict:
        content = re.sub(r"```(?:json)?\s*", "", content).strip()
        try:
            data = json.loads(content)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
        raise ValueError(f"Invalid JSON for question {question_id}")

    def fill(
        self,
        system_description: str,
        metadata,
        source_code: str = "",
    ) -> list[QuestionnaireAnswer]:
        from risk_management.llm_client import LLMDisabledError, LLMUnavailableError

        questions_for_prompt = [
            {"id": q["id"], "question": q["question"], "hint": q.get("hint", "")}
            for q in QUESTIONNAIRE
        ]

        source_code_section = ""
        if source_code.strip():
            source_code_section = f"Source code excerpt:\n```\n{source_code[:2000]}\n```"

        user_prompt = _AI_FILL_USER_TEMPLATE.format(
            name=metadata.name,
            annex_iii_category=metadata.annex_iii_category.value,
            intended_purpose=metadata.intended_purpose,
            deployment_context=metadata.deployment_context,
            ai_techniques=", ".join(metadata.ai_techniques) if metadata.ai_techniques else "—",
            data_inputs=", ".join(metadata.data_inputs) if metadata.data_inputs else "—",
            system_description=system_description[:3000],
            source_code_section=source_code_section,
            questions_json=json.dumps(questions_for_prompt, ensure_ascii=False, indent=2),
            question_count=len(QUESTIONNAIRE),
        )

        try:
            response = self._llm.complete(_AI_FILL_SYSTEM_PROMPT, user_prompt)
            raw = self._parse_response(response.content)
            return self._validate_answers(raw)
        except (LLMDisabledError, LLMUnavailableError, ValueError):
            return self._default_answers()

    def _parse_response(self, content: str) -> list[dict]:
        content = re.sub(r"```(?:json)?\s*", "", content).strip()
        try:
            data = json.loads(content)
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass
        # Try to find JSON array in the response
        m = re.search(r"\[.*\]", content, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
        raise ValueError("LLM did not return a valid JSON array")

    def _validate_answers(self, raw: list[dict]) -> list[QuestionnaireAnswer]:
        known_ids = {q["id"] for q in QUESTIONNAIRE}
        answers: list[QuestionnaireAnswer] = []
        answered_ids: set[str] = set()

        for item in raw:
            qid = item.get("question_id", "")
            if qid not in known_ids:
                continue
            answered_ids.add(qid)
            answers.append(QuestionnaireAnswer(
                question_id=qid,
                answer=bool(item.get("answer", False)),
                justification=str(item.get("justification", ""))[:500],
                confidence=item.get("confidence", "medium") if item.get("confidence") in ("high", "medium", "low") else "medium",
                severity_override=item.get("severity_override") or None,
                likelihood_override=item.get("likelihood_override") or None,
                mitigation_override=item.get("mitigation_override") or None,
            ))

        # Fill in missing questions with False
        for q in QUESTIONNAIRE:
            if q["id"] not in answered_ids:
                answers.append(QuestionnaireAnswer(
                    question_id=q["id"],
                    answer=False,
                    justification="",
                    confidence="low",
                ))

        return answers

    def _default_answers(self) -> list[QuestionnaireAnswer]:
        return [
            QuestionnaireAnswer(question_id=q["id"], answer=False, justification="", confidence="low")
            for q in QUESTIONNAIRE
        ]
