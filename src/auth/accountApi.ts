export async function accountFunctionError(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "context" in error && error.context instanceof Response) {
    try {
      const body = await error.context.clone().json();
      if (typeof body.error === "string") return body.error;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
