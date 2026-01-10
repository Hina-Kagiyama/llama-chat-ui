const SAFE_ARITH_RE = /^[0-9+\-*/().,\s]+$/;
const safeCalc = (expression) => {
  const s = String(expression ?? "").trim();
  if (!s) throw new Error("Empty expression.");
  if (!SAFE_ARITH_RE.test(s)) throw new Error("Expression contains disallowed characters.");

  // Very simple: we only allow digits/operators/parentheses/spaces/commas/dots.
  // Use Function as a controlled evaluator. This is still not perfect, but with the regex gate,
  // it blocks identifiers and most injection vectors.
  // eslint-disable-next-line no-new-func
  const fn = new Function(`"use strict"; return (${s});`);
  const v = fn();
  if (!Number.isFinite(v)) throw new Error("Result is not a finite number.");
  return v;
};

export const getToolSchemas = () => ([
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Evaluate a basic arithmetic expression (numbers + - * / ( ) .).",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Arithmetic expression, e.g. (2+3)*4/5" }
        },
        required: ["expression"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_time",
      description: "Get the current local time in ISO format.",
      parameters: {
        type: "object",
        properties: {
          timezone: { type: "string", description: "Optional IANA timezone (best-effort). Example: America/Denver" }
        },
        required: [],
        additionalProperties: false
      }
    }
  }
]);

export const runTool = async (name, args = {}) => {
  switch (name) {
    case "calculator": {
      const value = safeCalc(args.expression);
      return { value };
    }

    case "get_time": {
      // Browser environment: Intl can format timezones; Date always uses local time internally.
      // We return both local ISO and an optional timezone-formatted string if provided.
      const iso = new Date().toISOString();
      const tz = String(args.timezone ?? "").trim();
      if (!tz) return { iso };

      let tzText = null;
      try {
        tzText = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: false
        }).format(new Date());
      } catch {
        tzText = null;
      }
      return { iso, timezone: tz, formatted: tzText };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

