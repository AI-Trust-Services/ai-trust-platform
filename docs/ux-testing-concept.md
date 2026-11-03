# AI-Powered Role-Based UX Testing

**Concept Paper for AI Trust Platform**

---

**Author:** AI Trust Platform Team  
**Date:** October 2026  
**Status:** Proposal for Review  
**Target Audience:** Development Team

---

## Executive Summary

This paper proposes an **AI-powered UX testing approach** that evaluates the AI Trust Platform from the perspective of different user roles. Unlike traditional testing that checks "does it work?", this approach asks "does it work *well* for this type of user?"

**Key benefits:**
- Catches UX issues that functional tests miss
- Validates that each role can complete their tasks efficiently
- Zero licensing cost (open-source tools + pay-per-use AI)
- Integrates with our existing Playwright test infrastructure

**Estimated effort:** 2–3 days to MVP, runs in CI thereafter

---

## 1. The Problem

### 1.1 What We Test Today

Our current test suite covers:
- ✅ Unit tests (business logic)
- ✅ E2E tests (happy paths work)
- ✅ Integration tests (services communicate correctly)

### 1.2 What We Don't Test

- ❌ Can a Compliance Officer find the "Create Assessment" button quickly?
- ❌ Does the Executive dashboard convey status without reading details?
- ❌ Is the Auditor's view clearly read-only?
- ❌ Does terminology make sense to a Business Owner (low technical level)?
- ❌ Are there too many clicks for common tasks?
- ❌ Is information hierarchy aligned with role priorities?

### 1.3 Why This Matters

The platform serves **6 distinct roles** with different:
- Technical expertise levels
- Primary tasks
- Information needs
- Time constraints

A screen that works perfectly for an AI Engineer may be overwhelming for an Executive or confusing for a Business Owner.

**Current gap:** We rely on manual review and user feedback to catch these issues — reactive, not proactive.

---

## 2. Proposed Solution

### 2.1 Core Idea

Use **multimodal AI (Claude/GPT-4)** to evaluate each screen from a specific role's perspective, asking:

> "You are a [ROLE] with [TECHNICAL_LEVEL] expertise.
> Your primary tasks are [TASKS].
> Looking at this screen, can you complete your goals efficiently?
> What would confuse you or slow you down?"

### 2.2 Two Testing Modes

| Mode | When | How |
|------|------|-----|
| **Automated (CI)** | Every PR / nightly | Playwright captures screenshots → AI evaluates → Report generated |
| **Interactive (Manual)** | Exploratory testing | Tampermonkey script in browser → Real-time AI feedback |

### 2.3 What Gets Evaluated

For each role, the AI assesses:

1. **Task Completion** — Can the user find and complete their primary tasks?
2. **Information Hierarchy** — Is the most important information prominent?
3. **Cognitive Load** — Is there too much to process for this role's expertise?
4. **Terminology** — Do the words make sense to this user type?
5. **Navigation Efficiency** — How many clicks to reach common goals?
6. **Accessibility** — Can this be used under time pressure or with assistive tech?

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AUTOMATED MODE (CI)                              │
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │  Playwright  │───▶│  Screenshot  │───▶│  Claude API  │               │
│  │  Test Runner │    │  + DOM State │    │  (Analysis)  │               │
│  └──────────────┘    └──────────────┘    └──────┬───────┘               │
│         │                                        │                       │
│         │ For each role:                         ▼                       │
│         │ • Login as role                 ┌──────────────┐               │
│         │ • Navigate key flows            │   Markdown   │               │
│         │ • Capture at each step          │    Report    │               │
│         │                                 └──────────────┘               │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                       INTERACTIVE MODE (Manual)                          │
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │  Tampermonkey│───▶│  Captures    │───▶│  Claude API  │               │
│  │  Script      │    │  • DOM       │    │  (Analysis)  │               │
│  │  (In-Browser)│    │  • Screenshot│    │              │               │
│  └──────────────┘    │  • Clicks    │    └──────┬───────┘               │
│                      └──────────────┘           │                       │
│         ▲                                       ▼                       │
│         │                              ┌──────────────┐                 │
│         │ Tester selects role          │   Overlay    │                 │
│         │ and clicks "Analyze"         │   Feedback   │                 │
│         │                              └──────────────┘                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Role Definitions

Each role is configured with context that shapes the AI evaluation:

| Role | Technical Level | Primary Tasks | UX Expectations |
|------|-----------------|---------------|-----------------|
| **Platform Administrator** | High | Manage users, configure settings, assign roles | Power-user UI, bulk actions, full access |
| **AI Engineer** | High | Register systems, monitor metrics, analyze traces | Technical detail, API docs, efficient workflows |
| **AI Compliance Officer** | Medium | Create assessments, track obligations, review evidence | Clear status, deadline visibility, audit-ready |
| **Business Owner** | Low | View risk posture, understand compliance status | Executive summaries, minimal jargon, visual indicators |
| **Auditor** | Medium | Review audit logs, verify evidence, export reports | Read-only clarity, complete trail, export tools |
| **Executive** | Low | View overall status, identify critical issues | Dashboard KPIs, traffic lights, minimal clicks |

---

## 5. Technology Stack

### 5.1 Tools Selected

| Tool | Purpose | License | Cost |
|------|---------|---------|------|
| **Playwright** | Browser automation, screenshots | Apache 2.0 | $0 |
| **axe-core** | Accessibility rule checking | MPL 2.0 | $0 |
| **html2canvas** | In-browser screenshot capture | MIT | $0 |
| **Claude API** | Multimodal AI analysis | Usage-based | ~$0.01–0.05/page |

### 5.2 Why Not Commercial Tools?

| Tool | Why Not |
|------|---------|
| Applitools Eyes | $449+/month, checkpoint limits |
| Percy | $399+/month, per-screenshot pricing |
| Chromatic | Good for Storybook only, not full-page UX |
| Testim/Mabl | Focus on functional testing, not role-based UX |

### 5.3 Why Claude API?

- **Multimodal** — Can analyze screenshots + DOM together
- **Instruction-following** — Reliably adopts role personas
- **Cost-effective** — ~$0.01–0.05 per page analysis
- **Swappable** — Can switch to GPT-4, Gemini, or local models

---

## 6. Implementation

### 6.1 Phase 1: Tampermonkey Script (Day 1)

**Deliverable:** Browser-based interactive testing tool

**Features:**
- Role selection dropdown (all 6 roles)
- "Analyze Current Page" button
- Interaction recording (clicks, navigation)
- AI feedback overlay

**Usage:**
```
1. Install Tampermonkey extension
2. Add the script
3. Navigate to any platform page
4. Click 🔍 → Select role → "Analyze"
5. Review AI feedback
```

**Status:** ✅ Already implemented (see `tampermonkey-ux-tester.js`)

### 6.2 Phase 2: Playwright Integration (Days 2–3)

**Deliverable:** Automated test suite that runs in CI

**Structure:**
```
tests/
└── ux/
    ├── config/
    │   └── roles.ts              # Role definitions
    ├── lib/
    │   ├── ai-analyzer.ts        # Claude API integration
    │   ├── dom-capture.ts        # DOM structure extraction
    │   └── report-generator.ts   # Markdown report output
    ├── flows/
    │   ├── compliance-officer.spec.ts
    │   ├── executive.spec.ts
    │   └── ...
    └── reports/
        └── ux-report-{date}.md   # Generated reports
```

**Example Test:**
```typescript
test('Compliance Officer can create assessment', async ({ page }) => {
  await loginAsRole(page, 'compliance_officer');
  
  const analyzer = new UXAnalyzer('compliance_officer');
  
  // Navigate to compliance module
  await page.goto('/compliance/');
  await analyzer.captureAndAnalyze(page, 'Compliance dashboard');
  
  // Start assessment creation
  await page.click('text=Create Assessment');
  await analyzer.captureAndAnalyze(page, 'Assessment creation form');
  
  // Generate report
  const report = await analyzer.generateReport();
  expect(report.overallScore).toBeGreaterThan(6);
});
```

### 6.3 Phase 3: CI Integration (Day 3+)

**Deliverable:** UX reports on every PR

**Workflow:**
```yaml
# .github/workflows/ux-testing.yml
name: UX Testing
on:
  pull_request:
    paths:
      - '**/frontend/**'
      
jobs:
  ux-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run UX Tests
        run: npm run test:ux
      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: ux-report
          path: tests/ux/reports/
```

---

## 7. Example Output

### 7.1 Sample Analysis (Compliance Officer → Dashboard)

```markdown
# UX Analysis: Compliance Dashboard
**Role:** AI Compliance Officer
**Page:** /compliance/
**Date:** 2026-10-13

## Overall Score: 7/10

## Task Completion Assessment

| Task | Findable? | Efficient? | Clear Result? |
|------|-----------|------------|---------------|
| Create assessment | ✅ Yes | ✅ Yes | ✅ Yes |
| Track obligations | ⚠️ Unclear | ❌ No | ⚠️ Unclear |
| Review evidence | ✅ Yes | ✅ Yes | ✅ Yes |
| Monitor compliance status | ✅ Yes | ⚠️ Partial | ✅ Yes |

## Issues Found

### 🔴 High Priority
1. **Obligation deadlines not visible in list view**
   - User must click into each obligation to see deadline
   - Recommendation: Add deadline column or "Due in X days" badge

### 🟡 Medium Priority
2. **Status filter requires 3 clicks**
   - Filter → Status → Select value
   - Recommendation: Add quick-filter chips above the table

3. **"Pending" vs "In Progress" distinction unclear**
   - Both show yellow badge
   - Recommendation: Use different colors or icons

### 🟢 Low Priority
4. **Export button placement**
   - Located far from the data it exports
   - Recommendation: Move to table header area

## Positive Aspects
- Clear "Create Assessment" call-to-action
- Good use of color-coded status badges
- Evidence linking workflow is intuitive
- Breadcrumbs help with navigation

## Accessibility Notes
- ✅ All buttons have visible labels
- ✅ Color is not the only status indicator
- ⚠️ Table could benefit from row headers
```

### 7.2 Summary Report (All Roles)

```markdown
# UX Testing Summary — PR #247

| Role | Dashboard | Create Flow | Detail View | Overall |
|------|-----------|-------------|-------------|---------|
| Platform Admin | 8/10 | 7/10 | 8/10 | **7.7** |
| AI Engineer | 9/10 | 8/10 | 9/10 | **8.7** |
| Compliance Officer | 7/10 | 8/10 | 7/10 | **7.3** |
| Business Owner | 6/10 | N/A | 5/10 | **5.5** ⚠️ |
| Auditor | 7/10 | N/A | 8/10 | **7.5** |
| Executive | 5/10 | N/A | 6/10 | **5.5** ⚠️ |

### Roles Needing Attention
- **Business Owner:** Dashboard too technical, needs executive summary
- **Executive:** Too many clicks to understand overall status
```

---

## 8. Cost Analysis

### 8.1 Development Cost

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 (Tampermonkey) | 1 day | ✅ Done |
| Phase 2 (Playwright) | 2 days | Playwright already in use |
| Phase 3 (CI) | 0.5 days | GitHub Actions already configured |
| **Total** | **~3 days** | |

### 8.2 Ongoing Cost

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| Claude API | ~$10–50 | Depends on PR volume |
| Infrastructure | $0 | Runs on existing CI |
| Licenses | $0 | All open source |
| **Total** | **~$10–50/month** | |

### 8.3 Comparison to Alternatives

| Approach | Monthly Cost | Setup Time |
|----------|-------------|------------|
| **This proposal** | $10–50 | 3 days |
| Applitools Eyes | $449+ | 1–2 weeks |
| Percy + custom | $399+ | 1 week |
| Manual QA review | $2000+ (time) | Ongoing |

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| AI gives inconsistent results | Medium | Low | Use structured prompts, cache baselines |
| API cost spikes | Low | Low | Set budget alerts, batch requests |
| False positives annoy developers | Medium | Medium | Start with warnings, not blockers |
| AI hallucinates issues | Low | Medium | Require element references in reports |

---

## 10. Success Criteria

After 1 month of use, we should see:

1. **Measurable:** At least 5 UX issues caught before user feedback
2. **Qualitative:** Developers consider role perspective when building features
3. **Process:** UX report reviewed in PR checklist
4. **Adoption:** All 6 role flows have baseline scores

---

## 11. Next Steps

| Step | Owner | Timeline |
|------|-------|----------|
| Review this proposal | Team | This week |
| Try Tampermonkey script on staging | Volunteers | This week |
| Implement Playwright integration | TBD | Next sprint |
| Add to PR workflow (non-blocking) | TBD | Sprint +1 |
| Evaluate and adjust prompts | TBD | Ongoing |

---

## 12. Appendix

### A. Files Created

| File | Purpose |
|------|---------|
| `tampermonkey-ux-tester.js` | Interactive browser-based testing |
| `create_diagrams_pptx.py` | Architecture diagrams |
| This document | Concept proposal |

### B. Role Configuration (Full)

```typescript
const ROLES = {
  platform_administrator: {
    name: 'Platform Administrator',
    technicalLevel: 'high',
    primaryTasks: [
      'Manage users and roles',
      'Configure platform settings', 
      'View audit logs',
      'Manage custom roles'
    ],
    uxExpectations: [
      'Power-user interface with bulk actions',
      'Clear access to all administrative functions',
      'Audit trail visibility',
      'Quick user/role management'
    ]
  },
  ai_engineer: {
    name: 'AI Engineer',
    technicalLevel: 'high',
    primaryTasks: [
      'Register AI systems',
      'Monitor performance metrics',
      'Analyze decision traces',
      'Configure alert rules'
    ],
    uxExpectations: [
      'Technical detail readily available',
      'API documentation accessible',
      'Efficient system registration flow',
      'Clear trace visualization'
    ]
  },
  ai_compliance_officer: {
    name: 'AI Compliance Officer',
    technicalLevel: 'medium',
    primaryTasks: [
      'Create and manage assessments',
      'Track obligation deadlines',
      'Review and approve evidence',
      'Monitor compliance posture'
    ],
    uxExpectations: [
      'Clear compliance status at a glance',
      'Intuitive evidence linking',
      'Deadline visibility',
      'Audit-ready documentation'
    ]
  },
  business_owner: {
    name: 'Business Owner',
    technicalLevel: 'low',
    primaryTasks: [
      'Understand risk posture',
      'Review business impact',
      'Approve system classifications'
    ],
    uxExpectations: [
      'Executive summaries',
      'Visual risk indicators',
      'Minimal technical jargon',
      'Quick drill-down to details'
    ]
  },
  auditor: {
    name: 'Auditor',
    technicalLevel: 'medium',
    primaryTasks: [
      'Review audit trail',
      'Verify evidence integrity',
      'Export compliance reports',
      'Check historical compliance'
    ],
    uxExpectations: [
      'Read-only access clearly indicated',
      'Complete audit trail',
      'Export functionality',
      'Evidence verification tools'
    ]
  },
  executive: {
    name: 'Executive',
    technicalLevel: 'low',
    primaryTasks: [
      'View overall compliance status',
      'Identify critical issues',
      'Review trends over time'
    ],
    uxExpectations: [
      'Dashboard with key metrics',
      'Traffic light status indicators',
      'Minimal clicks to understand status',
      'Clear escalation paths'
    ]
  }
};
```

### C. Sample AI Prompt

```markdown
# UX Analysis Request

## Your Role
You are evaluating a web application from the perspective of 
a **{ROLE_NAME}**.

### Role Context
- **Description:** {DESCRIPTION}
- **Technical Level:** {TECHNICAL_LEVEL}
- **Primary Tasks:** {TASKS}
- **UX Expectations:** {EXPECTATIONS}

## Current Page
- **URL:** {URL}
- **Title:** {TITLE}

## Page Structure
{DOM_ANALYSIS}

## Your Task
Evaluate this page from the {ROLE_NAME}'s perspective:

1. **Overall Score (1-10)**
2. **Task Completion:** For each primary task, can the user find it, 
   complete it efficiently, and understand the result?
3. **Specific Issues:** List concrete problems with element references
4. **Positive Aspects:** What works well?
5. **Top 3 Recommendations:** Prioritized by impact

Be specific. Reference actual UI elements by their text or position.
```

---

## 13. Questions for Discussion

1. Should UX scores block PRs, or just warn?
2. Which flows should we test first?
3. Who reviews the UX reports?
4. How often should we run full role coverage vs. quick smoke tests?
5. Should we share reports with product/design team?

---

*End of Proposal*
