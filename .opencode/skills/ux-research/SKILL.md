---
name: ux-research
description: "Conduct user research that drives product decisions — usability testing, interview protocols, survey design, affinity mapping, and research operations."
license: MIT
---

Guessing what users want is expensive. A single usability test with
5 users reveals 80% of usability problems. Research isn't a luxury —
it's a cost-saving measure.

## Research methods by question

| Question | Method | Time | Confidence |
|----------|--------|------|------------|
| What do users need? | Contextual inquiry | 2-4 weeks | High |
| Can users complete this task? | Usability test | 1-2 weeks | High |
| Which design is better? | A/B test | 2-4 weeks | Very high |
| Why are users confused? | Think-aloud protocol | 1 week | High |
| How many users have this problem? | Survey | 1-2 weeks | Medium |
| What do users expect? | Card sorting | 1 week | Medium |

## Usability test script

```markdown
## Pre-test (5 min)
- Thank participant, explain format
- "There are no wrong answers — we're testing the design, not you."
- Record screen + audio

## Tasks (20 min)
1. "Imagine you just signed up. Find the settings page."
2. "Change your email address to a new one."
3. "You want to invite a teammate. Show me how you'd do that."

## Post-test (5 min)
- "What was your overall impression?"
- "What was the most frustrating part?"
- "If you could change one thing, what would it be?"
```

## Interview protocol

```typescript
interface InterviewQuestion {
  category: 'context' | 'behavior' | 'motivation' | 'pain-point';
  question: string;
  followUp?: string;
  avoid?: string; // leading words to avoid
}

const questions: InterviewQuestion[] = [
  {
    category: 'context',
    question: "Walk me through your typical workday.",
    followUp: "What tools do you use most frequently?",
  },
  {
    category: 'behavior',
    question: "Tell me about the last time you dealt with [problem].",
    followUp: "What did you try first? What happened next?",
    avoid: "Why did you do it that way?" (sounds accusatory)
  },
  {
    category: 'motivation',
    question: "What would make this easier for you?",
    avoid: "Would you use feature X?" (everyone says yes)
  },
];
```

## Affinity mapping

```markdown
## Process
1. Write each insight on a sticky note (one insight per note)
2. Group related notes into clusters
3. Name each cluster (emergent theme)
4. Look for patterns across clusters
5. Prioritize by frequency × impact

## Template
### Theme: [Cluster Name]
- Insight 1 (3/5 participants)
- Insight 2 (4/5 participants)
- Insight 3 (2/5 participants)

### Priority: [High/Medium/Low]
### Recommendation: [Action to take]
```

## Research repository

Organize findings for long-term value:

```
research/
  participants/
    P001-interview.md
    P002-usability-test.md
  themes/
    navigation-pain-points.md
    onboarding-friction.md
  reports/
    2024-q1-usability-audit.md
  artifacts/
    journey-maps/
    personas/
```

## Anti-patterns

- Don't ask "Would you use this?" — watch what they actually do
- Don't test with more than 5 users per round — diminishing returns
- Don't lead participants — "Don't you think this is confusing?"
- Don't skip the debrief — insights fade fast
- Don't research without action — every study needs a decision it informs
