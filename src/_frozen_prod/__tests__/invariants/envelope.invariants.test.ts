import { createResultEnvelopeV1 } from "../../product/envelope/createResultEnvelopeV1";
import { verifyResultEnvelope } from "../../integrity/verifyResultEnvelope";

it("payload mutation always invalidates envelope", () => {
  const payload: any = { a: 1 };
  const env = createResultEnvelopeV1(payload);

  expect(verifyResultEnvelope(env)).toBe(true);

  payload.a = 2;
  expect(verifyResultEnvelope(env)).toBe(false);
});
