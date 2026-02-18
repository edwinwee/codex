/**
 * Convert common LaTeX math syntax into terminal-friendly plain text before
 * handing markdown to `marked-terminal`.
 */
export function renderLatexInMarkdown(markdown: string): string {
  if (!markdown.includes("$") && !markdown.includes("\\")) {
    return markdown;
  }

  const { markdownWithPlaceholders, protectedSegments } =
    protectCodeSegments(markdown);
  let rendered = markdownWithPlaceholders;

  rendered = rendered.replace(
    /\$\$([\s\S]+?)\$\$/g,
    (match, expression, offset, source) => {
      const renderedExpression = renderLatexExpression(expression);
      if (!renderedExpression) {
        return "";
      }
      return wrapDisplayMath(renderedExpression, offset, match.length, source);
    },
  );

  rendered = rendered.replace(
    /\\\[([\s\S]+?)\\\]/g,
    (match, expression, offset, source) => {
      const renderedExpression = renderLatexExpression(expression);
      if (!renderedExpression) {
        return "";
      }
      return wrapDisplayMath(renderedExpression, offset, match.length, source);
    },
  );

  rendered = rendered.replace(
    /\\\(((?:\\.|[^\\\n])+?)\\\)/g,
    (_match, expression) => renderLatexExpression(expression),
  );

  rendered = replaceInlineDollarMath(rendered);

  return restoreCodeSegments(rendered, protectedSegments);
}

function wrapDisplayMath(
  expression: string,
  offset: number,
  matchLength: number,
  source: string,
): string {
  const before = offset > 0 ? (source[offset - 1] ?? "") : "";
  const afterIndex = offset + matchLength;
  const after = afterIndex < source.length ? (source[afterIndex] ?? "") : "";

  const prefix = isLineBreak(before) ? "\n" : before ? "\n\n" : "";
  const suffix = isLineBreak(after) ? "\n" : after ? "\n\n" : "";

  return `${prefix}${expression}${suffix}`;
}

function isLineBreak(character: string): boolean {
  return character === "\n" || character === "\r";
}

const PROTECTED_SEGMENT_PREFIX = "__CODEX_LATEX_PROTECTED_SEGMENT_";
const PROTECTED_SEGMENT_PATTERN = new RegExp(
  `${PROTECTED_SEGMENT_PREFIX}(\\d+)__`,
  "g",
);

function protectCodeSegments(markdown: string): {
  markdownWithPlaceholders: string;
  protectedSegments: Array<string>;
} {
  const protectedSegments: Array<string> = [];
  let index = 0;
  const markdownWithPlaceholders = markdown.replace(
    /```[\s\S]*?```|`[^`\n]*`/g,
    (segment) => {
      const placeholder = `${PROTECTED_SEGMENT_PREFIX}${index}__`;
      protectedSegments.push(segment);
      index += 1;
      return placeholder;
    },
  );

  return { markdownWithPlaceholders, protectedSegments };
}

function restoreCodeSegments(
  markdown: string,
  protectedSegments: Array<string>,
): string {
  return markdown.replace(PROTECTED_SEGMENT_PATTERN, (_match, rawIndex) => {
    const index = Number(rawIndex);
    return protectedSegments[index] ?? "";
  });
}

function replaceInlineDollarMath(markdown: string): string {
  let result = "";
  let index = 0;

  while (index < markdown.length) {
    const character = markdown[index];

    if (
      character !== "$" ||
      isEscaped(markdown, index) ||
      markdown[index + 1] === "$"
    ) {
      result += character;
      index += 1;
      continue;
    }

    const maybeClosing = findInlineMathClosingDollar(markdown, index + 1);
    if (maybeClosing === -1) {
      result += character;
      index += 1;
      continue;
    }

    const expression = markdown.slice(index + 1, maybeClosing);
    if (!isLikelyInlineMath(expression)) {
      result += character;
      index += 1;
      continue;
    }

    result += renderLatexExpression(expression);
    index = maybeClosing + 1;
  }

  return result;
}

function findInlineMathClosingDollar(markdown: string, start: number): number {
  for (let index = start; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (character === "\n") {
      return -1;
    }
    if (
      character === "$" &&
      !isEscaped(markdown, index) &&
      markdown[index - 1] !== " " &&
      markdown[index - 1] !== "\t" &&
      markdown[index + 1] !== "$"
    ) {
      return index;
    }
  }
  return -1;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function isLikelyInlineMath(expression: string): boolean {
  if (!expression.trim()) {
    return false;
  }
  if (/^\s|\s$/.test(expression)) {
    return false;
  }
  // Avoid treating "it costs $5 and $10" as inline math.
  if (/^\d[\d.,]*\s/.test(expression)) {
    return false;
  }
  return true;
}

function renderLatexExpression(expression: string): string {
  const parsed = parseSequence(expression, 0).rendered;
  return normalizeWhitespace(parsed);
}

type ParseResult = {
  rendered: string;
  next: number;
};

function parseSequence(
  source: string,
  start: number,
  terminator?: string,
): ParseResult {
  let rendered = "";
  let index = start;

  while (index < source.length) {
    const character = source[index];
    if (terminator && character === terminator) {
      return { rendered, next: index + 1 };
    }

    if (character === "{") {
      const group = parseSequence(source, index + 1, "}");
      rendered += group.rendered;
      index = group.next;
      continue;
    }

    if (character === "}") {
      return { rendered, next: index };
    }

    if (character === "^" || character === "_") {
      const argument = parseArgument(source, index + 1);
      rendered += applyDecoration(
        argument.rendered,
        character === "^" ? SUPERSCRIPT_MAP : SUBSCRIPT_MAP,
        character,
      );
      index = argument.next;
      continue;
    }

    if (character === "\\") {
      const commandResult = parseCommandAt(source, index);
      rendered += commandResult.rendered;
      index = commandResult.next;
      continue;
    }

    if (character === "&") {
      rendered += " ";
      index += 1;
      continue;
    }

    if (character === "~") {
      rendered += " ";
      index += 1;
      continue;
    }

    if (character === "\n" || character === "\r" || character === "\t") {
      rendered += " ";
      index += 1;
      continue;
    }

    rendered += character;
    index += 1;
  }

  return { rendered, next: index };
}

function parseArgument(source: string, start: number): ParseResult {
  let index = skipWhitespace(source, start);
  if (index >= source.length) {
    return { rendered: "", next: index };
  }

  let atom = parseAtom(source, index);
  index = atom.next;

  while (
    index < source.length &&
    (source[index] === "^" || source[index] === "_")
  ) {
    const decorationType = source[index];
    if (decorationType !== "^" && decorationType !== "_") {
      break;
    }
    const decorationArgument = parseArgument(source, index + 1);
    atom = {
      rendered:
        atom.rendered +
        applyDecoration(
          decorationArgument.rendered,
          decorationType === "^" ? SUPERSCRIPT_MAP : SUBSCRIPT_MAP,
          decorationType,
        ),
      next: decorationArgument.next,
    };
    index = decorationArgument.next;
  }

  return atom;
}

function parseAtom(source: string, start: number): ParseResult {
  if (start >= source.length) {
    return { rendered: "", next: start };
  }

  const character = source[start];
  if (!character) {
    return { rendered: "", next: start + 1 };
  }
  if (character === "{") {
    return parseSequence(source, start + 1, "}");
  }

  if (character === "\\") {
    return parseCommandAt(source, start);
  }

  if (character === "\n" || character === "\r" || character === "\t") {
    return { rendered: " ", next: start + 1 };
  }

  return { rendered: character, next: start + 1 };
}

function parseCommandAt(source: string, start: number): ParseResult {
  const command = readCommand(source, start);
  if (!command) {
    return { rendered: "\\", next: start + 1 };
  }

  let cursor = command.next;

  if (command.kind === "control") {
    return {
      rendered: CONTROL_COMMAND_TO_TEXT[command.name] ?? command.name,
      next: cursor,
    };
  }

  if (command.name === "frac") {
    const numerator = parseArgument(source, cursor);
    const denominator = parseArgument(source, numerator.next);
    cursor = denominator.next;
    return {
      rendered: `${wrapForFraction(numerator.rendered)}/${wrapForFraction(
        denominator.rendered,
      )}`,
      next: cursor,
    };
  }

  if (command.name === "sqrt") {
    const optionalRoot = parseOptionalBracketArgument(source, cursor);
    cursor = optionalRoot?.next ?? cursor;
    const radicand = parseArgument(source, cursor);
    cursor = radicand.next;

    const rootPrefix =
      optionalRoot && optionalRoot.rendered
        ? `${applyDecoration(optionalRoot.rendered, SUPERSCRIPT_MAP, "^")}√`
        : "√";

    return {
      rendered: `${rootPrefix}${wrapForRoot(radicand.rendered)}`,
      next: cursor,
    };
  }

  if (GROUP_ARGUMENT_COMMANDS.has(command.name)) {
    const argument = parseArgument(source, cursor);
    return {
      rendered: argument.rendered,
      next: argument.next,
    };
  }

  if (command.name === "left" || command.name === "right") {
    const delimiter = parseArgument(source, cursor);
    return {
      rendered: delimiter.rendered === "." ? "" : delimiter.rendered,
      next: delimiter.next,
    };
  }

  if (command.name === "begin" || command.name === "end") {
    const group = parseRawGroup(source, cursor);
    return {
      rendered: "",
      next: group.next,
    };
  }

  if (command.name === "limits" || command.name === "nolimits") {
    return { rendered: "", next: cursor };
  }

  return {
    rendered: LATEX_COMMAND_TO_TEXT[command.name] ?? `\\${command.name}`,
    next: cursor,
  };
}

type CommandReadResult =
  | {
      kind: "named";
      name: string;
      next: number;
    }
  | {
      kind: "control";
      name: string;
      next: number;
    };

function readCommand(source: string, start: number): CommandReadResult | null {
  if (source[start] !== "\\") {
    return null;
  }

  const first = source[start + 1];
  if (!first) {
    return null;
  }

  if (/[A-Za-z]/.test(first)) {
    let cursor = start + 2;
    while (cursor < source.length) {
      const cursorChar = source[cursor];
      if (!cursorChar || !/[A-Za-z]/.test(cursorChar)) {
        break;
      }
      cursor += 1;
    }
    return {
      kind: "named",
      name: source.slice(start + 1, cursor),
      next: cursor,
    };
  }

  return {
    kind: "control",
    name: first,
    next: start + 2,
  };
}

function parseOptionalBracketArgument(
  source: string,
  start: number,
): ParseResult | null {
  const index = skipWhitespace(source, start);
  if (source[index] !== "[") {
    return null;
  }
  return parseSequence(source, index + 1, "]");
}

function parseRawGroup(source: string, start: number): ParseResult {
  let index = skipWhitespace(source, start);
  if (source[index] !== "{") {
    return { rendered: "", next: index };
  }

  index += 1;
  let depth = 1;
  while (index < source.length && depth > 0) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
    }
    index += 1;
  }

  return { rendered: "", next: index };
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (!character || !/\s/.test(character)) {
      break;
    }
    index += 1;
  }
  return index;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function wrapForFraction(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }
  if (isSimpleToken(normalized)) {
    return normalized;
  }
  return `(${normalized})`;
}

function wrapForRoot(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }
  if (isSimpleToken(normalized)) {
    return normalized;
  }
  return `(${normalized})`;
}

function isSimpleToken(text: string): boolean {
  return /^[\p{L}\p{N}]+$/u.test(text) && text.length === 1;
}

function applyDecoration(
  text: string,
  alphabet: ReadonlyMap<string, string>,
  fallbackPrefix: "^" | "_",
): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }

  let decorated = "";
  for (const character of normalized) {
    const mapped = alphabet.get(character);
    if (!mapped) {
      return `${fallbackPrefix}(${normalized})`;
    }
    decorated += mapped;
  }
  return decorated;
}

const GROUP_ARGUMENT_COMMANDS = new Set([
  "text",
  "mathrm",
  "operatorname",
  "mathit",
  "mathbf",
  "mathsf",
  "mathtt",
  "textbf",
  "textit",
  "textrm",
  "mathbf",
  "mathcal",
  "mathbb",
  "boldsymbol",
]);

const CONTROL_COMMAND_TO_TEXT: Record<string, string> = {
  " ": " ",
  ",": " ",
  ";": " ",
  ":": " ",
  "!": "",
  "{": "{",
  "}": "}",
  "%": "%",
  "$": "$",
  "#": "#",
  "&": "&",
  "_": "_",
  "^": "^",
  "~": "~",
  "\\": "\\",
  "|": "|",
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
};

const LATEX_COMMAND_TO_TEXT: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "ϕ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  times: "×",
  cdot: "·",
  pm: "±",
  mp: "∓",
  div: "÷",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  sim: "∼",
  propto: "∝",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ll: "≪",
  gg: "≫",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  mapsto: "↦",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  land: "∧",
  lor: "∨",
  sum: "∑",
  prod: "∏",
  int: "∫",
  oint: "∮",
  aleph: "ℵ",
  Re: "ℜ",
  Im: "ℑ",
  ldots: "…",
  cdots: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  quad: " ",
  qquad: "  ",
  langle: "⟨",
  rangle: "⟩",
  lbrace: "{",
  rbrace: "}",
  vert: "|",
  Vert: "‖",
  ",": " ",
  ";": " ",
  ":": " ",
  "!": "",
};

const SUPERSCRIPT_MAP = new Map<string, string>([
  ["0", "⁰"],
  ["1", "¹"],
  ["2", "²"],
  ["3", "³"],
  ["4", "⁴"],
  ["5", "⁵"],
  ["6", "⁶"],
  ["7", "⁷"],
  ["8", "⁸"],
  ["9", "⁹"],
  ["+", "⁺"],
  ["-", "⁻"],
  ["=", "⁼"],
  ["(", "⁽"],
  [")", "⁾"],
  ["a", "ᵃ"],
  ["b", "ᵇ"],
  ["c", "ᶜ"],
  ["d", "ᵈ"],
  ["e", "ᵉ"],
  ["f", "ᶠ"],
  ["g", "ᵍ"],
  ["h", "ʰ"],
  ["i", "ⁱ"],
  ["j", "ʲ"],
  ["k", "ᵏ"],
  ["l", "ˡ"],
  ["m", "ᵐ"],
  ["n", "ⁿ"],
  ["o", "ᵒ"],
  ["p", "ᵖ"],
  ["r", "ʳ"],
  ["s", "ˢ"],
  ["t", "ᵗ"],
  ["u", "ᵘ"],
  ["v", "ᵛ"],
  ["w", "ʷ"],
  ["x", "ˣ"],
  ["y", "ʸ"],
  ["z", "ᶻ"],
  ["A", "ᴬ"],
  ["B", "ᴮ"],
  ["D", "ᴰ"],
  ["E", "ᴱ"],
  ["G", "ᴳ"],
  ["H", "ᴴ"],
  ["I", "ᴵ"],
  ["J", "ᴶ"],
  ["K", "ᴷ"],
  ["L", "ᴸ"],
  ["M", "ᴹ"],
  ["N", "ᴺ"],
  ["O", "ᴼ"],
  ["P", "ᴾ"],
  ["R", "ᴿ"],
  ["T", "ᵀ"],
  ["U", "ᵁ"],
  ["V", "ⱽ"],
  ["W", "ᵂ"],
]);

const SUBSCRIPT_MAP = new Map<string, string>([
  ["0", "₀"],
  ["1", "₁"],
  ["2", "₂"],
  ["3", "₃"],
  ["4", "₄"],
  ["5", "₅"],
  ["6", "₆"],
  ["7", "₇"],
  ["8", "₈"],
  ["9", "₉"],
  ["+", "₊"],
  ["-", "₋"],
  ["=", "₌"],
  ["(", "₍"],
  [")", "₎"],
  ["a", "ₐ"],
  ["e", "ₑ"],
  ["h", "ₕ"],
  ["i", "ᵢ"],
  ["j", "ⱼ"],
  ["k", "ₖ"],
  ["l", "ₗ"],
  ["m", "ₘ"],
  ["n", "ₙ"],
  ["o", "ₒ"],
  ["p", "ₚ"],
  ["r", "ᵣ"],
  ["s", "ₛ"],
  ["t", "ₜ"],
  ["u", "ᵤ"],
  ["v", "ᵥ"],
  ["x", "ₓ"],
  ["β", "ᵦ"],
  ["γ", "ᵧ"],
  ["ρ", "ᵨ"],
  ["φ", "ᵩ"],
  ["χ", "ᵪ"],
]);
