# Classification Configuration

## Purpose

The classification configuration defines the labels and deterministic conditions used by the second classification stage. It specifies **which labels exist**, **what each label means**, and **which pre-filled questionnaire answers support each label**.

It does not:

- extract facts from source documents;
- define questionnaire questions or applicability logic;
- calculate `answerStrength`;
- calculate confidence or completeness scores;
- aggregate risk labels into a final hierarchy such as `PROHIBITED > HIGH_RISK > MINIMAL`; or
- define the classification output format.

Those processing rules belong to the classification system prompt or to a downstream deterministic aggregation layer.

---

## Root Structure

```json
{
  "schemaVersion": "1.0",
  "classificationConfigId": "ai-act-label-classification",
  "version": "1.0.0",
  "title": "AI System Risk & Role Classification",
  "defaultLanguage": "en",
  "questionnaireId": "ai-questionnaire",
  "questionnaireVersion": "1.0.0",
  "riskLabels": [],
  "roleLabels": []
}
```

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `schemaVersion` | string | Yes | Version of the classification configuration schema. |
| `classificationConfigId` | string | Yes | Stable identifier of the classification configuration. |
| `version` | string | Yes | Version of the classification content. |
| `title` | string | No | Human-readable title. |
| `defaultLanguage` | string | No | Default language, for example `en`. |
| `questionnaireId` | string | Yes | Identifier of the questionnaire whose results are evaluated. |
| `questionnaireVersion` | string | Yes | Compatible questionnaire version. |
| `riskLabels` | array | Yes | Independently evaluated risk-related labels. |
| `roleLabels` | array | Yes | Independently evaluated actor-role labels. |

The values of `questionnaireId` and `questionnaireVersion` should match the questionnaire used to produce the pre-filled questionnaire result.

---

## Label Structure

Risk and role labels use the same basic structure.

```json
{
  "id": "HIGH_RISK",
  "activate": true,
  "definition": "The AI system meets at least one configured high-risk condition.",
  "rules": [
    {
      "id": "ANNEX_I_PRODUCT_OR_SAFETY_COMPONENT",
      "when": {
        "questionId": "High_Risk_1",
        "operator": "CONTAINS",
        "value": "MEDICAL_DEVICES"
      }
    }
  ]
}
```

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `id` | string | Yes | Unique label identifier. |
| `activate` | boolean | Yes | Determines whether the label is evaluated. |
| `definition` | string | Yes | Human-readable definition of the label. |
| `rules` | array | Yes | Deterministic rules that can support the label. |

### `activate`

```text
true
→ evaluate the label

false
→ do not evaluate the label
```

`activate` does not affect other labels and does not imply that the label applies or does not apply.

A deactivated label may have an empty `rules` array. In the current configuration, `DISTRIBUTOR` is deactivated because the questionnaire contains no distributor-specific question.

### `definition`

`definition` explains the business meaning of the label. It gives the classification stage semantic context for explanations and result presentation.

Rules:

- Keep the definition independent from a specific assessed AI system.
- Do not include processing instructions, scoring formulas, or confidence thresholds.
- Do not contradict the configured rules.
- Use the same terminology as the classification domain and user interface.

---

## Rule Structure

A rule defines one deterministic route by which a label may apply.

```json
{
  "id": "DEPLOYER_ROLE",
  "when": {
    "questionId": "Role_3",
    "operator": "EQUALS",
    "value": "YES"
  }
}
```

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `id` | string | Yes | Unique rule identifier within the configuration. |
| `when` | condition or condition group | Yes | Complete deterministic condition for the rule. |

The classification system prompt defines how multiple rules within one label are combined. The intended processing model is that rules are alternative routes: satisfying at least one rule supports the label.

The configuration does not use rule fields such as:

- `effect`;
- `QUALIFY`;
- `EXCLUDE`;
- `priority`;
- `target`; or
- `override`.

Exceptions must be incorporated directly into the relevant `when` expression.

---

## Conditions and Operators

A condition compares an answer value from the pre-filled questionnaire with one or more configured values.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `questionId` | string | Yes | Identifier of the questionnaire question to evaluate. |
| `operator` | string enum | Yes | Comparison operator. |
| `value` | string | Depending on operator | Single expected value. |
| `values` | array of strings | Depending on operator | Set of expected values. |

Supported operators:

| Operator | Operand | Meaning |
|---|---|---|
| `EQUALS` | `value` | Scalar questionnaire answer equals the expected value. |
| `NOT_EQUALS` | `value` | Scalar questionnaire answer differs from the expected value. |
| `IN` | `values` | Scalar questionnaire answer is included in the expected set. |
| `NOT_IN` | `values` | Scalar questionnaire answer is not included in the expected set. |
| `CONTAINS` | `value` | A MULTISELECT questionnaire answer contains the expected option value. |

### Operand Rules

Use:

```json
{
  "operator": "EQUALS",
  "value": "YES"
}
```

Use:

```json
{
  "operator": "IN",
  "values": [
    "YES",
    "PARTIALLY"
  ]
}
```

Do not use an array under `value` for `IN` or `NOT_IN`.

Incorrect:

```json
{
  "operator": "IN",
  "value": [
    "NO",
    "PARTIALLY"
  ]
}
```

Correct:

```json
{
  "operator": "IN",
  "values": [
    "NO",
    "PARTIALLY"
  ]
}
```

---

## Condition Groups

Conditions may be combined recursively with `all` and `any`.

### `all`

Every member must be satisfied.

```json
{
  "all": [
    {
      "questionId": "Prohibited_4",
      "operator": "IN",
      "values": [
        "YES",
        "PARTIALLY"
      ]
    },
    {
      "questionId": "Prohibited_5",
      "operator": "IN",
      "values": [
        "YES",
        "PARTIALLY"
      ]
    },
    {
      "questionId": "Prohibited_6",
      "operator": "IN",
      "values": [
        "YES",
        "PARTIALLY"
      ]
    }
  ]
}
```

Equivalent logic:

```text
Prohibited_4 IN {YES, PARTIALLY}
AND
Prohibited_5 IN {YES, PARTIALLY}
AND
Prohibited_6 IN {YES, PARTIALLY}
```

### `any`

At least one member must be satisfied.

```json
{
  "any": [
    {
      "questionId": "Role_4",
      "operator": "EQUALS",
      "value": "YES"
    },
    {
      "questionId": "Role_5",
      "operator": "EQUALS",
      "value": "YES"
    },
    {
      "questionId": "Role_6",
      "operator": "EQUALS",
      "value": "YES"
    },
    {
      "questionId": "Role_7",
      "operator": "EQUALS",
      "value": "YES"
    }
  ]
}
```

Equivalent logic:

```text
Role_4 = YES
OR Role_5 = YES
OR Role_6 = YES
OR Role_7 = YES
```

### Nested Groups

`all` and `any` may be nested recursively.

```json
{
  "all": [
    {
      "questionId": "Prohibited_9",
      "operator": "IN",
      "values": [
        "YES",
        "PARTIALLY"
      ]
    },
    {
      "any": [
        {
          "questionId": "Prohibited_10",
          "operator": "IN",
          "values": [
            "NO",
            "PARTIALLY"
          ]
        },
        {
          "questionId": "Prohibited_11",
          "operator": "IN",
          "values": [
            "NO",
            "PARTIALLY"
          ]
        }
      ]
    }
  ]
}
```

A condition group must contain either `all` or `any`, never both at the same level.

---

## Risk Labels

`riskLabels` contains the independent label definitions used for risk-related evaluation.

The current configuration contains:

- `PROHIBITED`;
- `HIGH_RISK`; and
- `TRANSPARENCY`.

`MINIMAL` is intentionally not configured as a rule-based label. It is derived later by deterministic application logic when neither `PROHIBITED` nor `HIGH_RISK` applies, subject to unresolved or potential higher-risk results.

The hierarchy and final aggregated risk classification are outside this configuration.

### `PROHIBITED`

`PROHIBITED` contains separate rules for the configured prohibited-practice routes. Examples include:

- sensitive biometric categorisation;
- manipulative or deceptive techniques;
- exploitation of vulnerability;
- social scoring;
- real-time remote biometric identification;
- criminal-risk assessment;
- untargeted facial image scraping;
- emotion recognition in work or education;
- non-consensual intimate content; and
- child abuse material.

Each rule must include the complete positive condition under which that route supports the label, including relevant exception questions.

### `HIGH_RISK`

All configured high-risk categories are consolidated into the single `HIGH_RISK` label.

The current configuration contains two routes:

1. `ANNEX_I_PRODUCT_OR_SAFETY_COMPONENT`
2. `ANNEX_III_USE_CASE`

#### Annex I Route

The Annex I rule evaluates whether `High_Risk_1` contains at least one configured Annex I option.

```json
{
  "questionId": "High_Risk_1",
  "operator": "CONTAINS",
  "value": "MEDICAL_DEVICES"
}
```

The rule contains one `CONTAINS` condition per supported Annex I option, combined with `any`.

#### Annex III Route

The Annex III rule incorporates the complete positive high-risk condition, including the configured exception path.

Conceptually:

```text
At least one High_Risk_3–High_Risk_30 answer is YES or PARTIALLY
AND
(
  High_Risk_31 is YES or PARTIALLY
  OR High_Risk_32 is YES or PARTIALLY
  OR
  (
    High_Risk_31 = NO
    AND High_Risk_32 = NO
    AND High_Risk_33–High_Risk_36 do not fully establish an exception
  )
)
```

The exact configured values under `High_Risk_33`–`High_Risk_36` determine whether the exception route is considered established or not established.

### `TRANSPARENCY`

`TRANSPARENCY` is evaluated independently from the base risk labels. It may later be presented alongside a non-prohibited base risk classification, but that aggregation behavior is not part of this configuration.

The current rules cover:

- interaction with natural persons;
- synthetic content;
- deepfakes;
- public-interest text without a fully established editorial-control exception;
- emotion recognition or biometric categorisation; and
- high-risk decisions or decision support concerning individuals.

---

## Role Labels

`roleLabels` contains actor-role conditions. Every active role is evaluated independently, and several roles may apply to the same natural or legal person.

The current role labels are:

- `PROVIDER`;
- `DEPLOYER`;
- `IMPORTER`;
- `DISTRIBUTOR`; and
- `AUTHORISED_REPRESENTATIVE`.

### Provider

The `PROVIDER` label uses an `any` group over `Role_4` through `Role_7`.

```text
Role_4 = YES
OR Role_5 = YES
OR Role_6 = YES
OR Role_7 = YES
→ PROVIDER
```

### Deployer

```text
Role_3 = YES
→ DEPLOYER
```

### Importer

```text
Role_2 = YES
→ IMPORTER
```

### Distributor

`DISTRIBUTOR` is currently deactivated and has no rules because the current questionnaire contains no distributor-specific question.

```json
{
  "id": "DISTRIBUTOR",
  "activate": false,
  "definition": "...",
  "rules": []
}
```

### Authorised Representative

```text
Role_1 = YES
→ AUTHORISED_REPRESENTATIVE
```

---

## Relationship to the Pre-Filled Questionnaire

The classification configuration is evaluated against the output of the questionnaire pre-fill stage.

The pre-filled questionnaire returns answer items with:

```json
{
  "value": "string",
  "answerStrength": "STRONG | MODERATE | LOW | null",
  "reason": "string or null"
}
```

The classification configuration only defines the expected values and logical conditions. It does not define how `answerStrength`, `CONFLICT`, or `NOT_ENOUGH_INFORMATION` affect rule evaluation. That behavior belongs to the classification system prompt.

---

## Architectural Boundaries

```text
Questionnaire Configuration
→ defines questions and questionnaire applicability

Questionnaire Pre-Fill Prompt
→ evaluates evidence and produces questionnaire answers

Classification Configuration
→ defines labels and deterministic label conditions

Classification Prompt
→ evaluates rules, answerStrength, confidence, completeness and explanations

Application / Domain Layer
→ derives the final aggregated risk classification

UI
→ presents label evaluations and the aggregated result
```

The classification configuration must not contain:

- source evidence;
- questionnaire question text;
- confidence formulas;
- completeness formulas;
- score mappings;
- label aggregation or risk hierarchy;
- presentation logic; or
- free-form legal reasoning outside the configured label definitions and conditions.

---

## Validation Rules

A valid classification configuration should satisfy all of the following:

1. `schemaVersion`, `classificationConfigId`, `version`, `questionnaireId`, and `questionnaireVersion` are present.
2. `riskLabels` and `roleLabels` are arrays.
3. Every label has a unique `id`.
4. Every label contains `activate`, `definition`, and `rules`.
5. `activate` is boolean.
6. Every active label has at least one rule, unless the absence of rules is explicitly intended and handled externally.
7. Every rule has a unique `id` and one `when` expression.
8. Every referenced `questionId` exists in the compatible questionnaire version.
9. Every condition value is a configured answer or option value of the referenced question.
10. `EQUALS` and `NOT_EQUALS` use `value`.
11. `IN` and `NOT_IN` use `values`.
12. `CONTAINS` uses `value` and references a MULTISELECT question.
13. Condition groups contain either `all` or `any`, never both at the same level.
14. `all` and `any` arrays are non-empty.
15. Conditions do not reference `CONFLICT` or `NOT_ENOUGH_INFORMATION` as configured answer values.
16. The configuration contains no confidence, completeness, hierarchy, aggregation, effect, priority, or presentation logic.
17. Label definitions do not contradict their rules.
18. Exceptions are expressed directly inside the corresponding positive `when` condition.
19. All IDs use stable, implementation-safe values.
20. The JSON document is syntactically valid and contains no duplicate keys.

---

## Recommended Validation Workflow

Before releasing a new classification configuration version:

1. Validate the JSON syntax.
2. Validate the configuration against a JSON Schema.
3. Verify `questionnaireId` and `questionnaireVersion` compatibility.
4. Verify every question reference and expected value against the questionnaire.
5. Test each rule with at least:
   - one matching result;
   - one non-matching result;
   - one `LOW` result;
   - one `NOT_ENOUGH_INFORMATION` result; and
   - one `CONFLICT` result.
6. Test nested `all` and `any` conditions.
7. Test every deactivated label.
8. Test provider-role combinations and parallel actor roles.
9. Test Annex III exception scenarios.
10. Verify that downstream aggregation remains outside the configuration.

---

## Minimal Example

```json
{
  "schemaVersion": "1.0",
  "classificationConfigId": "example-classification",
  "version": "1.0.0",
  "title": "Example Classification",
  "defaultLanguage": "en",
  "questionnaireId": "example-questionnaire",
  "questionnaireVersion": "1.0.0",
  "riskLabels": [
    {
      "id": "HIGH_RISK",
      "activate": true,
      "definition": "The AI system meets at least one configured high-risk condition.",
      "rules": [
        {
          "id": "EXAMPLE_HIGH_RISK_RULE",
          "when": {
            "questionId": "Q_HIGH_RISK",
            "operator": "IN",
            "values": [
              "YES",
              "PARTIALLY"
            ]
          }
        }
      ]
    }
  ],
  "roleLabels": [
    {
      "id": "DEPLOYER",
      "activate": true,
      "definition": "A natural or legal person that uses the AI system under its own responsibility.",
      "rules": [
        {
          "id": "DEPLOYER_RULE",
          "when": {
            "questionId": "Q_DEPLOYER",
            "operator": "EQUALS",
            "value": "YES"
          }
        }
      ]
    }
  ]
}
```
