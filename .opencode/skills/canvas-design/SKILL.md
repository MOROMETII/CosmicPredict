---
name: canvas-design
description: Use when generating images, PDFs, or data visualizations programmatically with canvas or SVG APIs.
---

# Canvas Design

## When to Use This Skill
- Generating PNG or PDF output from code
- Creating data visualizations with canvas or SVG
- Drawing shapes, text, and images with transformations
- Building server-side image generation pipelines

## Workflow
1. Choose the rendering approach: HTML Canvas for raster, SVG for vector, Puppeteer for PDF
2. Set up the canvas: define dimensions, background, and coordinate system
3. Draw shapes: rectangles, circles, paths with fill and stroke styles
4. Add text with custom fonts, sizes, and alignment
5. Apply transformations: translate, rotate, scale for positioning
6. For data viz: map data to visual properties (x, y, size, color)
7. Export: `canvas.toDataURL()` for PNG, or use a PDF library for document output
8. Handle DPI scaling for crisp output on retina displays

## Rules
- Use vector (SVG) when the output needs to scale without pixelation
- Use canvas for raster output or pixel-level manipulation
- Set DPI scaling factor (2x or 3x) for print-quality output
- Keep the drawing code modular — separate data mapping from rendering
- Test output at multiple sizes to verify clarity
