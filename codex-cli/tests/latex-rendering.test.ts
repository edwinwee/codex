import { describe, expect, it } from "vitest";
import { renderLatexInMarkdown } from "../src/utils/latex-rendering.js";

describe("renderLatexInMarkdown", () => {
  it("renders inline superscripts and subscripts", () => {
    const input = "Equation: $x_1 + y^2$";
    expect(renderLatexInMarkdown(input)).toBe("Equation: x₁ + y²");
  });

  it("renders common symbol commands", () => {
    const input = "Greek: $\\alpha + \\beta \\to \\gamma$";
    expect(renderLatexInMarkdown(input)).toBe("Greek: α + β → γ");
  });

  it("renders block expressions using fraction and square root", () => {
    const input = "Result:\n$$\\frac{a+b}{\\sqrt{c}}$$\nDone.";
    expect(renderLatexInMarkdown(input)).toBe("Result:\n\n(a+b)/(√c)\n\nDone.");
  });

  it("supports \\(...\\) and \\[...\\] delimiters", () => {
    const input = "Inline \\(a_2\\) and block:\n\\[\\alpha^2\\]";
    expect(renderLatexInMarkdown(input)).toBe("Inline a₂ and block:\n\nα²");
  });

  it("does not convert code spans or fenced code blocks", () => {
    const input = "`$x_1$` and $x_1$\n```tex\n$y_1$\n```";
    expect(renderLatexInMarkdown(input)).toBe("`$x_1$` and x₁\n```tex\n$y_1$\n```");
  });

  it("does not treat currency-like content as math", () => {
    const input = "This costs $5 and $10.";
    expect(renderLatexInMarkdown(input)).toBe(input);
  });
});
