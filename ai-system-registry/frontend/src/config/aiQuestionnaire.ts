import questionnaireJson from "@questionnaire";

export type QuestionType = "PREDEFINED" | "MULTISELECT" | "DESCRIPTIVE";

export interface MultiselectOption {
  value: string;
  code: string;
  label: string;
}

/** A single leaf condition inside an appliesWhen node. */
export interface AppliesWhenCondition {
  questionId: string;
  operator: "CONTAINS" | "IN" | "EQUALS";
  value?: string;
  values?: string[];
}

/** An appliesWhen node: either 'all' (AND) or 'any' (OR) over sub-conditions.
 *  Sub-conditions may themselves be nested nodes or leaf conditions. */
export interface AppliesWhenNode {
  all?: (AppliesWhenNode | AppliesWhenCondition)[];
  any?: (AppliesWhenNode | AppliesWhenCondition)[];
}

export interface AiQuestionDef {
  id: string;
  question: string;
  category: string;
  type: QuestionType;
  allowedAnswers: string[] | MultiselectOption[];
  appliesWhen?: AppliesWhenNode;
}

const rawQuestions = (questionnaireJson as { questions: AiQuestionDef[] }).questions;

export const AI_QUESTIONS: AiQuestionDef[] = rawQuestions;

export const AI_SECTIONS: { key: string; label: string; questionIds: string[] }[] =
  AI_QUESTIONS.reduce(
    (acc, q) => {
      const sec = acc.find((s) => s.key === q.category);
      if (sec) sec.questionIds.push(q.id);
      else acc.push({ key: q.category, label: q.category, questionIds: [q.id] });
      return acc;
    },
    [] as { key: string; label: string; questionIds: string[] }[],
  );

export const ORDERED_QUESTION_IDS: string[] = AI_QUESTIONS.map((q) => q.id);

export const QUESTION_DEF_BY_ID: Record<string, AiQuestionDef> = Object.fromEntries(
  AI_QUESTIONS.map((q) => [q.id, q]),
);

export function isPredefined(def: AiQuestionDef): def is AiQuestionDef & { allowedAnswers: string[] } {
  return def.type === "PREDEFINED";
}

export function isMultiselect(
  def: AiQuestionDef,
): def is AiQuestionDef & { allowedAnswers: MultiselectOption[] } {
  return def.type === "MULTISELECT";
}

// ---------------------------------------------------------------------------
// Gating evaluation
// ---------------------------------------------------------------------------

function isConditionNode(c: AppliesWhenNode | AppliesWhenCondition): c is AppliesWhenNode {
  return "all" in c || "any" in c;
}

function evaluateLeaf(cond: AppliesWhenCondition, answers: Record<string, string | null>): boolean {
  const raw = answers[cond.questionId] ?? null;
  switch (cond.operator) {
    case "CONTAINS": {
      let selected: string[] = [];
      try {
        selected = JSON.parse(raw || "[]") as string[];
      } catch {
        selected = [];
      }
      return selected.includes(cond.value ?? "");
    }
    case "IN":
      return (cond.values ?? []).includes(raw ?? "");
    case "EQUALS":
      return (raw ?? "") === (cond.value ?? "");
    default:
      return false;
  }
}

function evaluateNode(node: AppliesWhenNode, answers: Record<string, string | null>): boolean {
  if (node.all) {
    return node.all.every((c) =>
      isConditionNode(c) ? evaluateNode(c, answers) : evaluateLeaf(c, answers),
    );
  }
  if (node.any) {
    return node.any.some((c) =>
      isConditionNode(c) ? evaluateNode(c, answers) : evaluateLeaf(c, answers),
    );
  }
  return false;
}

/**
 * Returns true when a question is currently locked by its appliesWhen gate.
 *
 * Recursive: if a dependency question is itself gated-out, its answer is
 * treated as null regardless of what is stored — so the full chain propagates
 * (e.g. High_Risk_32 → High_Risk_31 → High_Risk_3..30 → High_Risk_2).
 *
 * answers: Record<questionId, raw answer string or null>
 * For MULTISELECT questions the value is a JSON-serialised string array.
 */
export function isGated(
  questionId: string,
  answers: Record<string, string | null>,
  _seen: Set<string> = new Set(),
): boolean {
  if (_seen.has(questionId)) return true; // cycle — treat as gated (fail-safe)
  const def = QUESTION_DEF_BY_ID[questionId];
  if (!def?.appliesWhen) return false;

  const seen = new Set(_seen).add(questionId);

  // Collect all dependency question IDs referenced in this node.
  function collectDepIds(node: AppliesWhenNode): string[] {
    const ids: string[] = [];
    for (const c of [...(node.all ?? []), ...(node.any ?? [])]) {
      if (isConditionNode(c)) ids.push(...collectDepIds(c));
      else ids.push(c.questionId);
    }
    return ids;
  }

  // For each dependency, if it is itself gated-out substitute null so the
  // condition correctly fails downstream.
  const maskedAnswers: Record<string, string | null> = { ...answers };
  for (const depId of collectDepIds(def.appliesWhen)) {
    if (isGated(depId, answers, seen)) {
      maskedAnswers[depId] = null;
    }
  }

  return !evaluateNode(def.appliesWhen, maskedAnswers);
}
