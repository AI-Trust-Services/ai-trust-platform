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
        "question": "Czy system podejmuje decyzje wpływające na różne grupy ludzi (np. rekrutacja, kredyty, dostęp do usług)?",
        "hint": "Dotyczy Art. 10(2)(f) AI Act oraz NIST AI RMF GOVERN 6.1",
        "taxonomy_ai_act": "Art. 10(2)(f)",
        "taxonomy_nist": "GOVERN 6.1",
        "default_severity": "high",
        "default_likelihood": "likely",
        "default_mitigation": "reduce",
    },
    {
        "id": "q_data_bias",
        "category": "bias",
        "question": "Czy dane treningowe mogły zawierać historyczne uprzedzenia lub niedoreprezentowane grupy?",
        "hint": "Np. danych historycznych dot. zatrudnienia, ocen kredytowych, recydywy.",
        "taxonomy_ai_act": "Art. 10(2)(f)",
        "taxonomy_nist": "MAP 1.5",
        "default_severity": "high",
        "default_likelihood": "possible",
        "default_mitigation": "reduce",
    },
    {
        "id": "q_explainability",
        "category": "transparency",
        "question": "Czy użytkownicy lub osoby dotknięte decyzją potrzebują wyjaśnienia dlaczego system podjął daną decyzję?",
        "hint": "Wymóg wyjaśnialności wynika z Art. 13 AI Act i GDPR Art. 22.",
        "taxonomy_ai_act": "Art. 13",
        "taxonomy_nist": "MANAGE 2.2",
        "default_severity": "medium",
        "default_likelihood": "likely",
        "default_mitigation": "inform",
    },
    {
        "id": "q_transparency_external",
        "category": "transparency",
        "question": "Czy osoby dotknięte wiedzą, że decyzja była podejmowana lub wspomagana przez AI?",
        "hint": "Art. 50 AI Act nakłada obowiązek informowania o interakcji z systemem AI.",
        "taxonomy_ai_act": "Art. 50",
        "taxonomy_nist": "GOVERN 1.1",
        "default_severity": "medium",
        "default_likelihood": "possible",
        "default_mitigation": "inform",
    },
    {
        "id": "q_privacy",
        "category": "privacy",
        "question": "Czy system przetwarza dane osobowe lub wrażliwe (zdrowie, biometria, finanse, lokalizacja)?",
        "hint": "GDPR Art. 9 i GDPR Art. 22. Wymaga DPIA jeśli przetwarza dane szczególne.",
        "taxonomy_ai_act": "Art. 10(5)",
        "taxonomy_nist": "MAP 5.1",
        "default_severity": "high",
        "default_likelihood": "likely",
        "default_mitigation": "mitigate",
    },
    {
        "id": "q_data_minimization",
        "category": "privacy",
        "question": "Czy system zbiera więcej danych niż jest to konieczne do realizacji celu?",
        "hint": "Zasada minimalizacji danych (GDPR Art. 5(1)(c)) i Art. 10(3) AI Act.",
        "taxonomy_ai_act": "Art. 10(3)",
        "taxonomy_nist": "MAP 5.1",
        "default_severity": "medium",
        "default_likelihood": "possible",
        "default_mitigation": "eliminate",
    },
    {
        "id": "q_robustness",
        "category": "reliability",
        "question": "Czy błędna lub niepewna decyzja systemu może wyrządzić realną szkodę (zdrowotną, finansową, prawną)?",
        "hint": "Art. 9(2)(b) wymaga analizy scenariuszy błędnych decyzji.",
        "taxonomy_ai_act": "Art. 9(2)(b)",
        "taxonomy_nist": "MANAGE 3.1",
        "default_severity": "critical",
        "default_likelihood": "possible",
        "default_mitigation": "mitigate",
    },
    {
        "id": "q_degradation",
        "category": "reliability",
        "question": "Czy działanie systemu może się pogorszyć w czasie (dryfowanie modelu, zmiany w danych)?",
        "hint": "Art. 9(2)(c) wymaga monitoringu po wdrożeniu (post-market monitoring).",
        "taxonomy_ai_act": "Art. 9(2)(c)",
        "taxonomy_nist": "MANAGE 4.1",
        "default_severity": "medium",
        "default_likelihood": "likely",
        "default_mitigation": "mitigate",
    },
    {
        "id": "q_human_agency",
        "category": "human_oversight",
        "question": "Czy istnieje możliwość podważenia lub nadpisania decyzji systemu przez człowieka?",
        "hint": "Art. 14 AI Act wymaga środków nadzoru ludzkiego dla systemów wysokiego ryzyka.",
        "taxonomy_ai_act": "Art. 14",
        "taxonomy_nist": "GOVERN 6.2",
        "default_severity": "high",
        "default_likelihood": "possible",
        "default_mitigation": "reduce",
    },
    {
        "id": "q_vulnerable",
        "category": "human_oversight",
        "question": "Czy system może mieć wpływ na grupy wrażliwe (dzieci, osoby starsze, osoby z niepełnosprawnościami, mniejszości)?",
        "hint": "Art. 9(9) AI Act wymaga szczególnej uwagi dla grup wrażliwych.",
        "taxonomy_ai_act": "Art. 9(9)",
        "taxonomy_nist": "MAP 1.5",
        "default_severity": "high",
        "default_likelihood": "possible",
        "default_mitigation": "reduce",
    },
    {
        "id": "q_security",
        "category": "security",
        "question": "Czy system jest dostępny publicznie lub przez API, narażając go na ataki adversarialne lub wstrzykiwanie danych?",
        "hint": "OWASP LLM Top 10: prompt injection, model inversion. Art. 15 AI Act — cyberbezpieczeństwo.",
        "taxonomy_ai_act": "Art. 15",
        "taxonomy_nist": "MANAGE 2.4",
        "default_severity": "high",
        "default_likelihood": "possible",
        "default_mitigation": "reduce",
    },
    {
        "id": "q_governance",
        "category": "governance",
        "question": "Czy zdefiniowano odpowiedzialność (właściciela, role, procesy) za decyzje systemu AI?",
        "hint": "Art. 9(1) i Art. 17 AI Act wymagają systemu zarządzania jakością i odpowiedzialności.",
        "taxonomy_ai_act": "Art. 17",
        "taxonomy_nist": "GOVERN 1.2",
        "default_severity": "medium",
        "default_likelihood": "likely",
        "default_mitigation": "mitigate",
    },
    {
        "id": "q_audit",
        "category": "governance",
        "question": "Czy decyzje systemu są rejestrowane w sposób umożliwiający późniejszy audyt?",
        "hint": "Art. 12 AI Act wymaga przechowywania logów dla systemów wysokiego ryzyka.",
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
        "q_bias": "Ryzyko dyskryminacji algorytmicznej",
        "q_data_bias": "Uprzedzenia w danych treningowych",
        "q_explainability": "Brak wyjaśnialności decyzji",
        "q_transparency_external": "Brak informowania o roli AI",
        "q_privacy": "Ryzyko naruszenia prywatności",
        "q_data_minimization": "Nadmierne zbieranie danych",
        "q_robustness": "Ryzyko szkody wynikającej z błędnej decyzji",
        "q_degradation": "Degradacja jakości modelu w czasie",
        "q_human_agency": "Brak mechanizmów nadzoru ludzkiego",
        "q_vulnerable": "Wpływ na grupy wrażliwe",
        "q_security": "Zagrożenia bezpieczeństwa i ataki adversarialne",
        "q_governance": "Brak zdefiniowanej odpowiedzialności za AI",
        "q_audit": "Brak ścieżki audytu decyzji",
    }
    return titles.get(q["id"], q["question"][:60])


def _risk_description(q: dict, ans: QuestionnaireAnswer) -> str:
    base = q.get("hint", q["question"])
    if ans.justification:
        return f"{base} Uzasadnienie: {ans.justification}"
    return base


# ---------------------------------------------------------------------------
# AI-assisted questionnaire filling
# ---------------------------------------------------------------------------

_AI_FILL_SYSTEM_PROMPT = """Jesteś ekspertem ds. zarządzania ryzykiem AI zgodnie z EU AI Act Art. 9.
Twoim zadaniem jest odpowiedź na pytania kwestionariusza dotyczącego ryzyk systemu AI.
Dla każdego pytania oceń na podstawie opisu systemu czy ryzyko jest obecne (answer: true/false).
Podaj krótkie uzasadnienie z odwołaniem do dokumentacji, kodu lub opisu systemu.
Odpowiadaj WYŁĄCZNIE poprawnym JSON-em. Bez wyjaśnień, bez markdown, bez dodatkowego tekstu.
Format odpowiedzi — tablica obiektów:
[
  {
    "question_id": "q_bias",
    "answer": true,
    "justification": "Cytat z dokumentacji lub kodu uzasadniający odpowiedź.",
    "confidence": "high",
    "severity_override": null,
    "likelihood_override": null,
    "mitigation_override": null
  }
]
Pola *_override mogą być null (wtedy użyte są wartości domyślne) lub jedną z wartości:
- severity_override: "critical" | "high" | "medium" | "low"
- likelihood_override: "very_likely" | "likely" | "possible" | "unlikely"
- mitigation_override: "eliminate" | "reduce" | "mitigate" | "inform"
"""

_AI_FILL_USER_TEMPLATE = """Na podstawie poniższego opisu systemu AI odpowiedz na wszystkie pytania kwestionariusza.

Nazwa systemu: {name}
Kategoria Annex III: {annex_iii_category}
Przeznaczenie: {intended_purpose}
Kontekst wdrożenia: {deployment_context}
Techniki AI: {ai_techniques}
Dane wejściowe: {data_inputs}

Opis systemu:
{system_description}

{source_code_section}

Pytania kwestionariusza:
{questions_json}

Zwróć tablicę JSON z odpowiedziami na WSZYSTKIE {question_count} pytania. Tylko JSON."""


_SINGLE_Q_SYSTEM_PROMPT = """Jesteś ekspertem ds. zarządzania ryzykiem AI zgodnie z EU AI Act Art. 9.
Odpowiedz na jedno pytanie kwestionariusza dotyczące ryzyka systemu AI.
Odpowiadaj WYŁĄCZNIE poprawnym JSON-em. Bez wyjaśnień, bez markdown.
Format:
{
  "question_id": "<id pytania>",
  "answer": true/false,
  "justification": "Krótkie uzasadnienie z odwołaniem do dokumentacji lub kodu.",
  "confidence": "high" | "medium" | "low",
  "severity_override": null,
  "likelihood_override": null,
  "mitigation_override": null
}
"""

_SINGLE_Q_USER_TEMPLATE = """System AI: {name} ({annex_iii_category})
Przeznaczenie: {intended_purpose}
Kontekst: {deployment_context}
Techniki AI: {ai_techniques}
Dane wejściowe: {data_inputs}

Opis systemu:
{system_description}

{source_code_section}

Pytanie (id: {question_id}):
{question}

Wskazówka: {hint}

Odpowiedz JSON-em."""


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
            source_code_section = f"Fragment kodu:\n```\n{source_code[:1500]}\n```"

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
            source_code_section = f"Fragment kodu źródłowego:\n```\n{source_code[:2000]}\n```"

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
