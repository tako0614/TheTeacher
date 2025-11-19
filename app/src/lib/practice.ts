import type {
  PracticeGradingRequest,
  PracticeGradingResponse,
} from "@theteacher/shared";

import { requestJson } from "./http";

export const gradePracticeAnswer = async (payload: PracticeGradingRequest) =>
  requestJson<PracticeGradingResponse>({
    path: "/ai/practice/grade",
    method: "POST",
    body: payload,
  });
