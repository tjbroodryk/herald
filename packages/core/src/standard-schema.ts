// The Standard Schema interface (standardschema.dev), copied rather than imported so core has no dependencies.
// zod, valibot and arktype all implement it.
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
    ) => StandardResult<Output> | Promise<StandardResult<Output>>
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
  }
}

type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<unknown> }> }

export type InferOutput<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never

export function validateSync<O>(schema: StandardSchemaV1<unknown, O>, value: unknown): { value: O } | { error: string } {
  const result = schema["~standard"].validate(value)
  if (result instanceof Promise) {
    throw new Error("herald: attrs schemas must validate synchronously")
  }
  if (result.issues) {
    return { error: result.issues.map((i) => i.message).join("; ") }
  }
  return { value: result.value }
}
