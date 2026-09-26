// Small helpers for the conversion pipeline. Every stage is a pure function of its input and
// settings, so turning a feature off recomputes from the untouched source instead of undoing
// edits. Stages are memoised on their last call: when an upstream stage returns the same
// object, downstream stages hit their cache too, so a slider only reruns what it affects.

export function memoStage<I, P, O>(fn: (input: I, params: P) => O): (input: I, params: P) => O {
  let last: { input: I; key: string; output: O } | null = null;
  return (input, params) => {
    const key = JSON.stringify(params);
    if (last && last.input === input && last.key === key) return last.output;
    const output = fn(input, params);
    last = { input, key, output };
    return output;
  };
}
