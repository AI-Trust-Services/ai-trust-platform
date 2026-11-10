import questionnaireJson from "@questionnaire";

export type QuestionType = "PREDEFINED" | "MULTISELECT" | "DESCRIPTIVE";

export interface MultiselectOption {
  value: string;
  code: string;
  label: string;
}

export interface AiQuestionDef {
  id: string;
  question: string;
  category: string;
  type: QuestionType;
  allowedAnswers: string[] | MultiselectOption[];
  appliesWhen?: unknown;
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
