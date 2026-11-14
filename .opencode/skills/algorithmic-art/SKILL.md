---
name: algorithmic-art
description: Use when creating generative or procedural art with code using p5.js, seeded randomness, or parametric design.
---

# Algorithmic Art

## When to Use This Skill
- Creating generative art with p5.js or canvas APIs
- Building parametric design systems with seeded randomness
- Implementing particle systems or Perlin noise landscapes
- Producing reproducible visual outputs from code

## Workflow
1. Set up a p5.js project or HTML canvas environment
2. Choose a seed for reproducibility: `randomSeed(seed)`
3. Define the composition: shapes, colors, movement, and density
4. Implement noise or randomness: Perlin noise for organic flows, random for scattered elements
5. Add animation with `draw()` loop or requestAnimationFrame
6. Experiment with parameters — expose them as variables for easy tweaking
7. Export: `saveCanvas()` for PNG, or record frames for video
8. Archive the seed and parameters with the output for reproducibility

## Rules
- Always use seeded randomness — unseeded art can't be reproduced
- Keep the composition readable at the intended output size
- Use noise for organic, flowing patterns; random for chaotic ones
- Test with multiple seeds to verify the design is robust
- Document the parameter space and creative intent
