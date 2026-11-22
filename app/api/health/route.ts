export async function GET(request: Request) {
  void request; // reading the request keeps this handler dynamic
  return Response.json({
    app: "ClaimCrew",
    status: "ok",
    llmMode: process.env.MOCK_LLM === "false" ? "live" : "mock",
    time: new Date().toISOString(),
  });
}
