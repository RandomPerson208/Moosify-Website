import { describe, it } from "node:test";
import assert from "node:assert";
import worker from "../cloudflare-worker.js";
import { MOOSY_SYSTEM_PROMPT } from "../moosy-prompt.js";

async function chatWithStubbedAI(body) {
  let sentMessages;
  const env = {
    AI: {
      run: async (_model, { messages }) => {
        sentMessages = messages;
        return { response: "Hi!" };
      }
    }
  };
  const request = new Request("https://api.example.com/api/moosy", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": "10.9.9.9" },
    body: JSON.stringify(body)
  });
  const resp = await worker.fetch(request, env, {});
  return { resp, sentMessages };
}

describe("Moosy prompt", () => {
  it("is sent as the system message, followed by history and the new message", async () => {
    const history = [
      { role: "user", content: "hey" },
      { role: "assistant", content: "Hey there!" }
    ];
    const { resp, sentMessages } = await chatWithStubbedAI({ message: "sell me", history });
    assert.strictEqual(resp.status, 200);
    assert.deepStrictEqual(sentMessages[0], { role: "system", content: MOOSY_SYSTEM_PROMPT });
    assert.deepStrictEqual(sentMessages.slice(1), [...history, { role: "user", content: "sell me" }]);
  });

  it("says Moosy is 2-legged and both kids are boys", () => {
    assert.match(MOOSY_SYSTEM_PROMPT, /2-legged stuffed moose/);
    assert.match(MOOSY_SYSTEM_PROMPT, /Ishaan and Little Moosy\. Both are boys/);
    assert.doesNotMatch(MOOSY_SYSTEM_PROMPT, /\b(she|her)\b/i);
  });

  it("tells Moosy to believe corrections and stay on topic", () => {
    assert.match(MOOSY_SYSTEM_PROMPT, /Believe the person/);
    assert.match(MOOSY_SYSTEM_PROMPT, /Do not change the subject/);
    assert.match(MOOSY_SYSTEM_PROMPT, /never at the person you are chatting with/);
  });
});
