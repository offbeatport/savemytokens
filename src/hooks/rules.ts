export const RULES_START = "<!-- savemytokens:start -->";
export const RULES_END = "<!-- savemytokens:end -->";

export const RULES_BLOCK = `${RULES_START}
## Token discipline

- Batch shell work. Chain related commands into one call instead of one call per step; every extra
  round trip re-reads the whole conversation.
- Never dump a large result into context. Pipe long output through \`tail\`/\`grep\`, or write it to a
  file and read back only the part that matters.
- Delegate multi-step searching, log reading and file discovery to a subagent, and ask it for its
  conclusion rather than its transcript.
- Once a file exists, edit it. Do not rewrite a whole file to change part of it.
- Do not re-read a file you have already read in this session unless it changed.
${RULES_END}`;
