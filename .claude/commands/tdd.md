---
name: tdd
description: Test-driven development workflow for this repo. Use when adding new features or logic to guide writing tests first, one behavior at a time.
---

## Philosophy

Tests verify behavior through public interfaces, not implementation details. A good test survives a full internal refactor — if renaming a private function breaks a test, the test is wrong.

**Good:** test through the public API, assert on observable outcomes.
**Bad:** mock internal collaborators, test private methods, assert on call counts.

Existing examples to follow: `ai-system-registry/backend/tests/test_classifier.py` and `test_schemas.py` — pure functions, public interface only, no mocks, parametrize for flag variations.

## Anti-Pattern: Horizontal Slicing

**Do not write all tests first, then all implementation.** This produces tests that verify imagined behavior and break on unrelated changes.

```
WRONG:  RED: test1, test2, test3 → GREEN: impl1, impl2, impl3
RIGHT:  RED→GREEN: test1→impl1,  RED→GREEN: test2→impl2, ...
```

One test → one implementation → repeat.

## Workflow

### 1. Plan (before writing any code)
- [ ] Confirm what the public interface looks like
- [ ] List the behaviors to test (not implementation steps)
- [ ] Identify which behaviors are most critical — you can't test everything
- [ ] If the new code touches the DB or RabbitMQ, prefer pure functions extracted from I/O so they can be tested without infrastructure (see `classifier.py` — pure Python, no I/O, fully testable)

### 2. Tracer Bullet
Write ONE test for the most important behavior. Run it — watch it fail. Write minimal code to pass it.

```python
# Example: new classifier tier
def test_new_tier_triggers_on_flag():
    result = classify(AISystemCreate(**{**_base(), "new_flag": True}))
    assert result.tier == "new-tier"
```

### 3. Incremental Loop
For each remaining behavior:
- Write next test → confirm it fails
- Write minimal code to pass it
- Don't anticipate future tests

### 4. Refactor
After all tests pass:
- [ ] Extract duplication
- [ ] Simplify interfaces (fewer params, fewer methods)
- [ ] Move complexity behind simple interfaces
- [ ] Run tests after each refactor step
- **Never refactor while RED**

## Mocking Rules

Mock at **system boundaries only**:
- External HTTP APIs
- RabbitMQ / ClickHouse connections
- Time / randomness

**Never mock your own modules or internal collaborators.** If you feel the urge to mock something internal, extract a pure function instead and test that directly.

For FastAPI routes that hit the DB, use `pytest-anyio` with a real test DB, or extract the business logic into a pure function and test the function.

## Checklist Per Test
```
[ ] Test name describes behavior, not implementation ("test_prohibited_takes_priority_over_gpai" not "test_classify_returns_dict")
[ ] Uses public interface only (no _private imports unless unavoidable, e.g. _GPAI_SYSTEMIC_FLOPS_THRESHOLD for threshold boundary tests)
[ ] Would survive internal refactor
[ ] Code added is minimal for this test only
[ ] No speculative features added
```

## Running Tests
```bash
cd ai-system-registry/backend
ALLOWED_ORIGINS=http://localhost:3001 .venv/bin/pytest tests/ -v
```
